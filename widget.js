// widget.js — League Table Widget (Tabulator)
// - No button needed. Auto-renders:
//   * If INIT_WIDGET arrives from parent: renders first division immediately.
//   * If no message arrives (local testing): loads SAMPLE_PAYLOAD after a short delay.
// - Only the Team column is clickable (if teamUrl is provided).
// - Sends { type: "TEAM_CLICK", payload: { leagueId, equipeName, url } } to parent.

//// --- State ---
let table = null;
let currentLayout = null;
let activeLeagueId = null;

let standingsByLeague = {}; // { [leagueId]: TeamRow[] }
let leagues = [];           // [{ id, name }]
let domReady = false;
let pendingPayload = null;
let initReceived = false;

// --- Local sample (used only if parent doesn't send INIT) ---
const SAMPLE_PAYLOAD = {
  leagues: [{ id: "Tr1", name: "Club Tomohawk" }],
  standingsByLeague: {
    Tr1: [
      { equipeName:"CHAKS",         points:12, victoires:4, defaites:0, nuls:0, forfaits:0, butsPour:16, butsContre:2,  differentiel:14, teamUrl:"/terrain1-chaks" },
      { equipeName:"Kelb United",   points:9,  victoires:3, defaites:1, nuls:0, forfaits:0, butsPour:12, butsContre:6,  differentiel:6,  teamUrl:"/terrain1-kelb-united" },
      { equipeName:"Leaf",          points:9,  victoires:3, defaites:1, nuls:0, forfaits:0, butsPour:10, butsContre:5,  differentiel:5,  teamUrl:"/terrain1-leaf" },
      { equipeName:"Northside",     points:6,  victoires:2, defaites:2, nuls:0, forfaits:0, butsPour:8,  butsContre:8,  differentiel:0,  teamUrl:"/terrain1-northside" },
      { equipeName:"Royal Academy", points:3,  victoires:1, defaites:3, nuls:0, forfaits:1, butsPour:5,  butsContre:12, differentiel:-7, teamUrl:"/terrain1-royal-academy" },
    ]
  }
};

// --- Listen for messages ASAP (so we don't miss early INIT) ---
window.addEventListener("message", onMessageFromHost);

// --- DOM ready: wire dropdown, process early INIT, set fallback ---
document.addEventListener("DOMContentLoaded", () => {
  domReady = true;

  const sel = document.getElementById("leagueSelect");
  if (sel) sel.addEventListener("change", () => renderLeague(sel.value));

  if (pendingPayload) {
    processInitPayload(pendingPayload);
    pendingPayload = null;
  }

  // Auto-load sample if nothing arrives shortly (useful for local testing)
  setTimeout(() => {
    if (!initReceived && Object.keys(standingsByLeague).length === 0) {
      processInitPayload(SAMPLE_PAYLOAD);
    }
  }, 250);
});

// --- Message handling ---
function onMessageFromHost(event) {
  const { type, payload } = event.data || {};
  if (!type) return;

  if (type === "INIT_WIDGET") {
    initReceived = true;
    if (!domReady) { pendingPayload = payload; return; }
    processInitPayload(payload);
  }

  if (type === "UPDATE_TABLE") {
    if (payload?.leagueId && Array.isArray(payload.standings)) {
      standingsByLeague[payload.leagueId] = payload.standings;
      if (activeLeagueId === payload.leagueId) renderLeague(activeLeagueId);
    }
  }
}

// --- Initialization from payload ---
function processInitPayload(payload) {
  leagues = payload.leagues || [];
  standingsByLeague = payload.standingsByLeague || fallbackShape(payload);

  const items = leagues.length ? leagues : keysToLeagues(standingsByLeague);
  populateLeagueDropdown(items);

  if (items.length) {
    const firstId = items[0].id;
    const sel = document.getElementById("leagueSelect");
    if (sel) sel.value = firstId;
    scheduleInitialRender(firstId);
  }
}

function fallbackShape(obj) {
  const out = {};
  Object.keys(obj || {}).forEach(k => { if (Array.isArray(obj[k])) out[k] = obj[k]; });
  return out;
}

function keysToLeagues(obj) {
  return Object.keys(obj).map(id => ({ id, name: id }));
}

function populateLeagueDropdown(items) {
  const sel = document.getElementById("leagueSelect");
  if (!sel) return;
  sel.innerHTML = "";
  items.forEach(opt => {
    const o = document.createElement("option");
    o.value = opt.id;
    o.textContent = opt.name || opt.div || opt.label || opt.id;
    sel.appendChild(o);
  });
  if (items[0]) sel.value = items[0].id;
}

// --- Ensure the very first paint shows up inside iframes ---
function scheduleInitialRender(leagueId) {
  activeLeagueId = leagueId;
  // render now
  renderLeague(leagueId);
  // render on next frame
  requestAnimationFrame(() => {
    if (activeLeagueId === leagueId) renderLeague(leagueId);
  });
  // tiny delayed render (covers slow iframe layout on some browsers)
  setTimeout(() => {
    if (activeLeagueId === leagueId) renderLeague(leagueId);
  }, 60);
}

// --- Render a league ---
function renderLeague(leagueId) {
  activeLeagueId = leagueId;

  const rows = (standingsByLeague[leagueId] || []).map(x => ({ ...x }));

  //(in case upstream didn't send position)
  rows.sort((a, b) =>
    (b.points ?? 0) - (a.points ?? 0) ||
    (b.differentiel ?? 0) - (a.differentiel ?? 0) ||
    (b.butsPour ?? 0) - (a.butsPour ?? 0) ||
    (b.victoires ?? 0) - (a.victoires ?? 0) ||
    String(a.equipeName || "").localeCompare(String(b.equipeName || ""))
  );
  rows.forEach((r, i) => r.position = i + 1);

  if (!table) initTable();

  // Set data then redraw; improves first paint reliability in iframes
  table.setData(rows).then(() => table.redraw(true));
}

//// --- Table setup ---
function getLayout() {
  // Desktop: fill width; Mobile: natural width (horizontal scroll)
  return window.matchMedia("(min-width: 900px)").matches ? "fitColumns" : "fitData";
}

function initTable() {
  const initialLayout = getLayout();
  currentLayout = initialLayout;

  table = new Tabulator("#leagueTable", {
    data: [],
    layout: initialLayout,
    index: "equipeName",
    reactiveData: true,
    height: "auto",
    selectable: 0,
    responsiveLayout: false, // keep horizontal scroll, no collapse view
    columnDefaults: {
      resizable: false,       // prevent drift from user resizes
      headerHozAlign: "center",
      hozAlign: "center",
      widthGrow: 0            // columns don't grow unless specified
    },
    columns: setColumns(),
  });

  // Swap layout on viewport changes and repaint
  const onResize = () => {
    const next = getLayout();
    if (next !== currentLayout && table) {
      table.setOptions({ layout: next });
      currentLayout = next;
      table.redraw(true);
    }
  };
  window.addEventListener("resize", debounce(onResize, 120), { passive: true });

  // Keep columns painted correctly when container lays out late
  try {
    new ResizeObserver(() => { if (table) table.redraw(true); }).observe(document.body);
  } catch {}
}

function setColumns() {
  return [
    //{ title: "Pos", field: "position", width: 64, frozen: true, hozAlign: "center", headerHozAlign: "center" },

    // Team column — only clickable cell (if teamUrl present)
    {
      title: "Équipes", field: "equipeName", minWidth: 180, widthGrow: 1,
      hozAlign: "left", headerHozAlign: "left", frozen: true,
      formatter: (cell) => {
        const label = cell.getValue() || "";
        const url = cell.getRow().getData()?.teamUrl;
        const safe = escapeHtml(label);
        return url
          ? `<span class="team-link" data-href="${escapeAttr(url)}">${safe}</span>`
          : `<span class="team-text">${safe}</span>`;
      },
      cellClick: (e, cell) => {
        const data = cell.getRow().getData();
        if (data?.teamUrl) {
          window.parent?.postMessage({
            type: "TEAM_CLICK",
            payload: { leagueId: activeLeagueId, equipeName: data.equipeName, url: data.teamUrl }
          }, "*");
        }
      }
    },
    { title: "Pts", field: "points",       width: 88, headerSortStartingDir: "desc" },
    { title: "V",   field: "victoires",    width: 72 },
    { title: "D",   field: "defaites",         width: 72 },
    { title: "N",   field: "nuls",     width: 72 },
    { title: "G+",  field: "butsPour",     width: 80 },
    { title: "G-",  field: "butsContre",   width: 80 },
    { title: "DIFF",  field: "differentiel", width: 80 },
  ];
}

//// --- Utils ---
function debounce(fn, wait) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]));
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}
