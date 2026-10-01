// Navigation, theming, admin gate, and the actual page logic for the pages
// that exist in this phase: Dashboard, Position Check, Route Import,
// Route Check, Settings. (World Map, Port Data, Simulator, Reports,
// .shp import are later phases - their tabs show a "coming in a later
// phase" placeholder for now rather than a dead link.)

document.addEventListener("DOMContentLoaded", async () => {
  loadState();
  applyTheme(state.theme);
  document.getElementById("themeSelect").value = state.theme;
  setAdminUI(false);

  document.getElementById("themeSelect").addEventListener("change", (e) => {
    state.theme = e.target.value;
    applyTheme(state.theme);
    saveState();
  });
  document.getElementById("adminBtn").addEventListener("click", onAdminClick);
  document.getElementById("userBtn").addEventListener("click", () => setAdminUI(false));

  document.querySelectorAll("nav#tabs button").forEach(btn => {
    btn.addEventListener("click", () => showPage(btn.dataset.page));
  });
  document.querySelectorAll(".tile").forEach(tile => {
    tile.addEventListener("click", () => showPage(tile.dataset.page));
  });

  document.getElementById("exportBtn").addEventListener("click", exportStateToFile);
  document.getElementById("importFile").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    importStateFromFile(f, (ok, err) => {
      if (ok) {
        applyTheme(state.theme);
        document.getElementById("themeSelect").value = state.theme;
        renderRouteTable();
        alert("Project loaded.");
      } else {
        alert("Could not load file: " + err);
      }
    });
  });

  // Position Check
  document.getElementById("checkPositionBtn").addEventListener("click", () => {
    const lat = parseFloat(document.getElementById("posLat").value);
    const lon = parseFloat(document.getElementById("posLon").value);
    if (isNaN(lat) || isNaN(lon)) { alert("Enter a valid latitude and longitude."); return; }
    const hits = checkPoint(lat, lon);
    renderPositionResults(hits);
  });

  // Route Import
  document.getElementById("loadSampleBtn").addEventListener("click", () => {
    state.route.waypoints = loadSampleRoute();
    saveState();
    renderRouteTable();
    setImportStatus(`${state.route.waypoints.length} sample waypoints loaded.`, false);
  });
  document.getElementById("routeFileInput").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const name = f.name.toLowerCase();
    setImportStatus("Importing...", false);

    if (name.endsWith(".csv") || name.endsWith(".txt")) {
      const reader = new FileReader();
      reader.onload = (ev) => applyImportResult(importRouteCSV(ev.target.result));
      reader.readAsText(f);
    } else if (name.endsWith(".xlsx")) {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try { applyImportResult(await importXlsxRoute(ev.target.result)); }
        catch (err) { setImportStatus("Error: " + err.message, true); }
      };
      reader.readAsArrayBuffer(f);
    } else if (name.endsWith(".rtzp")) {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try { applyImportResult(await importRtzpRoute(ev.target.result)); }
        catch (err) { setImportStatus("Error: " + err.message, true); }
      };
      reader.readAsArrayBuffer(f);
    } else if (name.endsWith(".rtz")) {
      const reader = new FileReader();
      reader.onload = (ev) => applyImportResult(importRtzXml(ev.target.result));
      reader.readAsText(f);
    } else {
      setImportStatus("Unrecognised file type. Use .csv, .txt, .xlsx, .rtz or .rtzp.", true);
    }
  });

  function applyImportResult(result) {
    state.route.waypoints = result.waypoints;
    saveState();
    renderRouteTable();
    renderImportLog(result.log);
    setImportStatus(`${result.waypoints.length} waypoints imported, ${result.log.length} rejected/flagged — see log below.`, result.log.length > 0);
  }

  // Route Check
  document.getElementById("runRouteCheckBtn").addEventListener("click", () => {
    const result = runRouteCheck(state.route.waypoints);
    renderRouteCheckResults(result);
  });

  // World Map
  initWorldMap();
  document.getElementById("mapFullWorldBtn").addEventListener("click", mapZoomFullWorld);
  document.getElementById("mapFitRouteBtn").addEventListener("click", mapZoomToRoute);
  document.getElementById("showAreasChk").addEventListener("change", drawMap);

  // GIS Import
  document.getElementById("importShpBtn").addEventListener("click", () => {
    const shpFile = document.getElementById("shpFileInput").files[0];
    const dbfFile = document.getElementById("dbfFileInput").files[0];
    if (!shpFile) { alert("Choose a .shp file first."); return; }
    document.getElementById("shpImportStatus").textContent = "Importing...";
    importShapefile(shpFile, dbfFile, (result, err) => {
      if (err) {
        document.getElementById("shpImportStatus").textContent = "Error: " + err;
        return;
      }
      state.layers.push({ layerName: result.layerName, visible: true, shapes: result.shapes });
      saveState();
      renderLayerList();
      document.getElementById("shpImportStatus").textContent =
        `${result.shapes.length} shape(s) imported as layer "${result.layerName}".`;
      drawMap();
    });
  });

  // Port Data
  document.getElementById("portSearchBtn").addEventListener("click", () => {
    const results = searchPorts(document.getElementById("portSearchInput").value);
    renderPortResults(results);
  });
  document.getElementById("portLocateBtn").addEventListener("click", () => {
    const results = searchPorts(document.getElementById("portSearchInput").value);
    if (results.length === 0) { alert("No search results yet - run a search first."); return; }
    mapView.centerLat = results[0].lat;
    mapView.centerLon = results[0].lon;
    mapView.zoom = 20;
    drawMap();
    showPage("worldmap");
  });

  // Simulator
  document.getElementById("simPlayBtn").addEventListener("click", simPlay);
  document.getElementById("simPauseBtn").addEventListener("click", simPause);
  document.getElementById("simStepBtn").addEventListener("click", simStep);
  document.getElementById("simResetBtn").addEventListener("click", simReset);
  document.getElementById("simInstantBtn").addEventListener("click", simInstant);

  // Reports
  document.getElementById("genReportBtn").addEventListener("click", generateReport);
  document.getElementById("printReportBtn").addEventListener("click", () => window.print());

  renderRouteTable();
  renderLayerList();
  showPage("dashboard");
});

function renderLayerList() {
  const el = document.getElementById("layerList");
  if (state.layers.length === 0) { el.innerHTML = `<p class="hint">No layers imported yet.</p>`; return; }
  el.innerHTML = state.layers.map((layer, i) => `
    <div style="display:flex; align-items:center; gap:10px; padding:6px 0;">
      <input type="checkbox" ${layer.visible ? "checked" : ""} data-layer-idx="${i}" class="layerToggle">
      <strong>${layer.layerName}</strong>
      <span class="hint">(${layer.shapes.length} shapes)</span>
    </div>`).join("");
  el.querySelectorAll(".layerToggle").forEach(cb => {
    cb.addEventListener("change", (e) => {
      state.layers[e.target.dataset.layerIdx].visible = e.target.checked;
      saveState();
      drawMap();
    });
  });
}

function renderPortResults(results) {
  document.getElementById("portSearchStatus").textContent =
    `${results.length} match(es)` + (results.length >= MAX_PORT_RESULTS ? ` (capped at ${MAX_PORT_RESULTS} - narrow your search)` : "");
  const el = document.getElementById("portResults");
  if (results.length === 0) { el.innerHTML = ""; return; }
  el.innerHTML = `<table><thead><tr><th>Name</th><th>Latitude</th><th>Longitude</th><th>Layer</th></tr></thead><tbody>` +
    results.map(r => `<tr><td>${r.name}</td><td>${r.lat.toFixed(4)}</td><td>${r.lon.toFixed(4)}</td><td>${r.layer}</td></tr>`).join("") +
    `</tbody></table>`;
}

function showPage(pageId) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll("nav#tabs button").forEach(b => b.classList.remove("active"));
  const page = document.getElementById(`page-${pageId}`);
  if (page) page.classList.add("active");
  const btn = document.querySelector(`nav#tabs button[data-page="${pageId}"]`);
  if (btn) btn.classList.add("active");
  // the map canvas has zero width while its page is display:none, so
  // whatever size it got at DOMContentLoaded is wrong - remeasure on
  // every visit to the World Map tab, not just once at startup.
  if (pageId === "worldmap" && typeof resizeMapCanvas === "function") {
    resizeMapCanvas();
    drawMap();
  }
}

function applyTheme(themeName) {
  document.body.setAttribute("data-theme", themeName);
}

async function onAdminClick() {
  if (state.isAdmin) return;
  const pwd = prompt("Enter Admin password:");
  if (!pwd) return;

  if (!state.adminPasswordHash) {
    if (pwd === DEFAULT_ADMIN_PASSWORD) {
      state.adminPasswordHash = await saltedHash(pwd, ADMIN_SALT);
      saveState();
      setAdminUI(true);
    } else {
      alert("Incorrect password.");
    }
    return;
  }
  const testHash = await saltedHash(pwd, ADMIN_SALT);
  if (testHash === state.adminPasswordHash) {
    setAdminUI(true);
  } else {
    alert("Incorrect password.");
  }
}

function setAdminUI(isAdmin) {
  state.isAdmin = isAdmin;
  const adminBtn = document.getElementById("adminBtn");
  adminBtn.classList.toggle("active", isAdmin);
  adminBtn.textContent = isAdmin ? "🛡 ADMIN" : "🛡 ADMIN";
}

function renderPositionResults(hits) {
  const el = document.getElementById("positionResults");
  if (hits.length === 0) {
    el.innerHTML = `<div class="status-banner">No MARPOL special area or ECA applies at this position.</div>`;
    return;
  }
  el.innerHTML = `<div class="status-banner inside">IN: ${hits.map(h => h.name).join("; ")}</div>` +
    `<table><thead><tr><th>Area</th><th>Applies to</th><th>Rule</th></tr></thead><tbody>` +
    hits.map(h => `<tr><td>${h.name}</td><td>${h.appliesTo}</td><td>${h.rule}</td></tr>`).join("") +
    `</tbody></table>`;
}

function renderRouteTable() {
  const el = document.getElementById("routeTable");
  const wps = state.route.waypoints;
  if (wps.length === 0) {
    el.innerHTML = `<p class="hint">No route loaded yet.</p>`;
    return;
  }
  let rows = "";
  for (let i = 0; i < wps.length; i++) {
    const wp = wps[i];
    let legDist = "";
    if (i < wps.length - 1) {
      const next = wps[i + 1];
      legDist = nmDistance(wp.lat, wp.lon, next.lat, next.lon).toFixed(1);
    }
    rows += `<tr><td>${i + 1}</td><td>${wp.name}</td><td>${wp.lat.toFixed(4)}</td><td>${wp.lon.toFixed(4)}</td><td>${wp.speed}</td><td>${wp.etd ? new Date(wp.etd).toLocaleString() : "—"}</td><td>${legDist}</td></tr>`;
  }
  el.innerHTML = `<table><thead><tr><th>WP</th><th>Name</th><th>Lat</th><th>Lon</th><th>Speed (kn)</th><th>ETD/ETA</th><th>Leg dist (nm)</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderImportLog(log) {
  const el = document.getElementById("importLog");
  if (log.length === 0) { el.innerHTML = ""; return; }
  el.innerHTML = `<table><thead><tr><th>Row</th><th>Field</th><th>Value</th><th>Reason</th><th>Fix</th></tr></thead><tbody>` +
    log.map(l => `<tr class="log-row-reject"><td>${l.row}</td><td>${l.field}</td><td>${l.value}</td><td>${l.reason}</td><td>${l.fix}</td></tr>`).join("") +
    `</tbody></table>`;
}

function setImportStatus(msg, isWarning) {
  document.getElementById("importStatus").textContent = msg;
}

function renderRouteCheckResults(result) {
  const el = document.getElementById("routeCheckResults");
  if (result.message) {
    el.innerHTML = `<div class="status-banner">${result.message}</div>`;
    return;
  }
  el.innerHTML = `<table><thead><tr><th>Leg</th><th>Event</th><th>Entry WP</th><th>Exit WP</th><th>Rule</th></tr></thead><tbody>` +
    result.events.map(ev => `<tr><td>${ev.leg}</td><td>${ev.event}</td><td>${ev.entryWp}</td><td>${ev.exitWp}</td><td>${ev.rule}</td></tr>`).join("") +
    `</tbody></table>`;
}
