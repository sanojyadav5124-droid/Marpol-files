// Route-wide compliance check: samples every leg every ~10nm (not just the
// waypoints), so an area a leg passes through without a waypoint inside it
// still gets caught. Same approach as the Excel version's mCompliance.bas -
// Position Check and Route Check share the exact same checkPoint() engine,
// so they can never disagree with each other.

function runRouteCheck(waypoints) {
  const events = [];
  if (waypoints.length < 2) {
    return { events, message: "Load a route with at least 2 waypoints first." };
  }

  let currentAreas = new Set();
  for (let leg = 0; leg < waypoints.length - 1; leg++) {
    const wp1 = waypoints[leg], wp2 = waypoints[leg + 1];
    const legDist = nmDistance(wp1.lat, wp1.lon, wp2.lat, wp2.lon);
    const steps = Math.max(1, Math.floor(legDist / 10));

    for (let s = 0; s <= steps; s++) {
      const frac = s / steps;
      const lat = wp1.lat + (wp2.lat - wp1.lat) * frac;
      const lon = wp1.lon + (wp2.lon - wp1.lon) * frac;
      const hits = checkPoint(lat, lon);
      const hereAreas = new Set(hits.map(h => h.name));

      for (const name of currentAreas) {
        if (!hereAreas.has(name)) {
          events.push({ leg: leg + 1, event: `EXIT: ${name}`, entryWp: `WP${leg + 1}`, exitWp: `WP${leg + 2}`, rule: "" });
        }
      }
      for (const hit of hits) {
        if (!currentAreas.has(hit.name)) {
          events.push({ leg: leg + 1, event: `ENTER: ${hit.name}`, entryWp: `WP${leg + 1}`, exitWp: "", rule: hit.rule });
        }
      }
      currentAreas = hereAreas;
    }
  }

  if (events.length === 0) {
    return { events, message: "Route stays outside all defined MARPOL/ECA areas along its full length." };
  }
  return { events, message: null };
}
