// Formats a printable voyage compliance report from the current route +
// a fresh Route Check run - doesn't compute anything of its own, so it can
// never disagree with what Route Check shows. "Export as PDF" is just the
// browser's native print dialog (Ctrl+P -> Save as PDF) - no library, works
// offline, and every modern browser has it built in.

function generateReport() {
  const wps = state.route.waypoints;
  const el = document.getElementById("reportContent");
  if (wps.length < 2) {
    el.innerHTML = `<p class="hint">No route loaded — nothing to report yet.</p>`;
    return;
  }

  let totalDist = 0;
  for (let i = 0; i < wps.length - 1; i++) totalDist += nmDistance(wps[i].lat, wps[i].lon, wps[i + 1].lat, wps[i + 1].lon);

  const result = runRouteCheck(wps);

  let html = `
    <h3 style="margin-bottom:2px;">VOYAGE COMPLIANCE REPORT</h3>
    <div class="hint">Generated: ${new Date().toLocaleString()}</div>
    <p><strong>Route:</strong> ${wps[0].name} &rarr; ${wps[wps.length - 1].name} (${wps.length} waypoints)<br>
    <strong>Total distance:</strong> ${totalDist.toFixed(1)} nm &nbsp;
    <strong>ETD:</strong> ${new Date(wps[0].etd).toLocaleString()} &nbsp;
    <strong>ETA:</strong> ${new Date(wps[wps.length - 1].etd).toLocaleString()}</p>

    <h3>Waypoints</h3>
    <table><thead><tr><th>WP</th><th>Name</th><th>Lat</th><th>Lon</th><th>Speed (kn)</th><th>ETD/ETA</th></tr></thead><tbody>
    ${wps.map((wp, i) => `<tr><td>${i + 1}</td><td>${wp.name}</td><td>${wp.lat.toFixed(4)}</td><td>${wp.lon.toFixed(4)}</td><td>${wp.speed}</td><td>${new Date(wp.etd).toLocaleString()}</td></tr>`).join("")}
    </tbody></table>

    <h3>MARPOL / ECA Compliance Timeline</h3>`;

  if (result.message) {
    html += `<p>${result.message}</p>`;
  } else {
    html += `<table><thead><tr><th>Leg</th><th>Event</th><th>Entry WP</th><th>Exit WP</th><th>Rule</th></tr></thead><tbody>
    ${result.events.map(ev => `<tr><td>${ev.leg}</td><td>${ev.event}</td><td>${ev.entryWp}</td><td>${ev.exitWp}</td><td>${ev.rule}</td></tr>`).join("")}
    </tbody></table>`;
  }

  el.innerHTML = html;
}
