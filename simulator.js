// Animated vessel playback along the loaded route, using the exact same
// checkPoint() engine as Position Check/Route Check - status banner and
// event log here can never disagree with those pages. Speed multiplier is
// scaled sim-time, not real time (a multi-day voyage at true 1:1 speed
// would take days to watch) - at 1x, each real second advances the
// simulated clock ~10 minutes.

const sim = {
  waypoints: [], cumDist: [], totalDist: 0,
  simTime: null, running: false, currentAreas: new Set(),
  intervalId: null,
};

const BASE_SIM_MINUTES_PER_TICK = 10;
const TICK_MS = 1000;

function simReset() {
  const wps = state.route.waypoints.filter(wp => wp.etd);
  if (wps.length < 2) {
    document.getElementById("simStatus").textContent = "Load a route with at least 2 timestamped waypoints first (Route Import).";
    sim.waypoints = [];
    return;
  }
  sim.waypoints = wps;
  sim.cumDist = [0];
  sim.totalDist = 0;
  for (let i = 1; i < wps.length; i++) {
    const d = nmDistance(wps[i - 1].lat, wps[i - 1].lon, wps[i].lat, wps[i].lon);
    sim.cumDist.push(sim.cumDist[i - 1] + d);
    sim.totalDist += d;
  }
  sim.simTime = new Date(wps[0].etd);
  sim.running = false;
  sim.currentAreas = new Set();
  clearInterval(sim.intervalId);
  document.getElementById("simEventLog").innerHTML = "";
  document.getElementById("simStatus").textContent = `Loaded ${wps.length} timestamped waypoints, ${sim.totalDist.toFixed(1)} nm total. Ready.`;
  advanceAndRender(sim.simTime);
}

function simPlay() {
  if (sim.waypoints.length === 0) { simReset(); if (sim.waypoints.length === 0) return; }
  sim.running = true;
  clearInterval(sim.intervalId);
  sim.intervalId = setInterval(simTick, TICK_MS);
}

function simPause() {
  sim.running = false;
  clearInterval(sim.intervalId);
}

function simStep() {
  if (sim.waypoints.length === 0) { simReset(); if (sim.waypoints.length === 0) return; }
  const mult = parseFloat(document.getElementById("simSpeedMult").value) || 1;
  const next = new Date(sim.simTime.getTime() + BASE_SIM_MINUTES_PER_TICK * mult * 60000);
  advanceAndRender(next);
}

function simInstant() {
  if (sim.waypoints.length === 0) { simReset(); if (sim.waypoints.length === 0) return; }
  sim.running = false;
  clearInterval(sim.intervalId);
  const last = sim.waypoints[sim.waypoints.length - 1];
  advanceAndRender(new Date(last.etd));
  const result = runRouteCheck(state.route.waypoints);
  renderRouteCheckResults(result);
  document.getElementById("simStatus").textContent = "Instant: jumped to voyage end. Full leg-by-leg timeline is on Route Check.";
}

function simTick() {
  if (!sim.running) { clearInterval(sim.intervalId); return; }
  const mult = parseFloat(document.getElementById("simSpeedMult").value) || 1;
  const next = new Date(sim.simTime.getTime() + BASE_SIM_MINUTES_PER_TICK * mult * 60000);
  advanceAndRender(next);
}

function advanceAndRender(targetTime) {
  const wps = sim.waypoints;
  const lastEtd = new Date(wps[wps.length - 1].etd);
  if (targetTime >= lastEtd) {
    targetTime = lastEtd;
    sim.running = false;
    clearInterval(sim.intervalId);
  }
  sim.simTime = targetTime;

  let legIdx = wps.length - 2;
  for (let i = 0; i < wps.length - 1; i++) {
    const t1 = new Date(wps[i].etd), t2 = new Date(wps[i + 1].etd);
    if (targetTime >= t1 && targetTime <= t2) { legIdx = i; break; }
  }
  const wp1 = wps[legIdx], wp2 = wps[legIdx + 1];
  const t1 = new Date(wp1.etd).getTime(), t2 = new Date(wp2.etd).getTime();
  let frac = t2 === t1 ? 0 : (targetTime.getTime() - t1) / (t2 - t1);
  frac = Math.max(0, Math.min(1, frac));

  const curLat = wp1.lat + (wp2.lat - wp1.lat) * frac;
  const curLon = wp1.lon + (wp2.lon - wp1.lon) * frac;
  const course = initialBearing(wp1.lat, wp1.lon, wp2.lat, wp2.lon);
  const distRun = sim.cumDist[legIdx] + nmDistance(wp1.lat, wp1.lon, curLat, curLon);
  const distToGo = sim.totalDist - distRun;

  document.getElementById("simPosition").textContent = `${curLat.toFixed(4)}, ${curLon.toFixed(4)}`;
  document.getElementById("simCourse").textContent = `${course.toFixed(0)} deg`;
  document.getElementById("simSpeed").textContent = `${wp1.speed.toFixed(1)} kn`;
  document.getElementById("simTime").textContent = sim.simTime.toLocaleString();
  document.getElementById("simDistRun").textContent = distRun.toFixed(1);
  document.getElementById("simDistToGo").textContent = distToGo.toFixed(1);
  document.getElementById("simEta").textContent = lastEtd.toLocaleString();

  window.vesselPos = { lat: curLat, lon: curLon };
  if (typeof drawMap === "function" && document.getElementById("page-worldmap").classList.contains("active")) drawMap();

  const hits = checkPoint(curLat, curLon);
  const hereAreas = new Set(hits.map(h => h.name));
  const logBody = document.getElementById("simEventLog");

  for (const name of sim.currentAreas) {
    if (!hereAreas.has(name)) {
      logBody.innerHTML += `<tr><td>${sim.simTime.toLocaleString()}</td><td>EXIT</td><td>${name}</td><td>${curLat.toFixed(4)}, ${curLon.toFixed(4)}</td></tr>`;
    }
  }
  for (const hit of hits) {
    if (!sim.currentAreas.has(hit.name)) {
      logBody.innerHTML += `<tr><td>${sim.simTime.toLocaleString()}</td><td>ENTER</td><td>${hit.name}</td><td>${curLat.toFixed(4)}, ${curLon.toFixed(4)}</td></tr>`;
    }
  }
  sim.currentAreas = hereAreas;

  const banner = document.getElementById("simStatusBanner");
  if (hits.length === 0) {
    banner.textContent = "Clear water — no MARPOL/ECA area in effect.";
    banner.className = "status-banner";
  } else {
    banner.textContent = "IN: " + hits.map(h => h.name).join("; ") + (!sim.running && sim.simTime.getTime() === lastEtd.getTime() ? "  — voyage complete." : "");
    banner.className = "status-banner inside";
  }
}
