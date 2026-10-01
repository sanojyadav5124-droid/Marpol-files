// Point-in-area compliance engine. Same rules as the Excel version's
// mGeoAreas.bas: ray-casting for POLYGON areas (bounding-box pre-filter for
// speed), simple threshold test for LAT_SOUTH_OF. Reads directly from the
// GEO_AREAS data - edit that file to add/adjust areas, no engine changes needed.

function pointInPolygon(lat, lon, verts) {
  let minLat = verts[0][0], maxLat = verts[0][0], minLon = verts[0][1], maxLon = verts[0][1];
  for (const [vlat, vlon] of verts) {
    if (vlat < minLat) minLat = vlat;
    if (vlat > maxLat) maxLat = vlat;
    if (vlon < minLon) minLon = vlon;
    if (vlon > maxLon) maxLon = vlon;
  }
  if (lat < minLat || lat > maxLat || lon < minLon || lon > maxLon) return false;

  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const [ilat, ilon] = verts[i];
    const [jlat, jlon] = verts[j];
    if ((ilon > lon) !== (jlon > lon)) {
      const xIntersect = (jlat - ilat) * (lon - ilon) / (jlon - ilon) + ilat;
      if (lat < xIntersect) inside = !inside;
    }
  }
  return inside;
}

function checkPoint(lat, lon) {
  const hits = [];
  for (const area of GEO_AREAS) {
    let match = false;
    if (area.testType === "POLYGON") {
      match = pointInPolygon(lat, lon, area.param);
    } else if (area.testType === "LAT_SOUTH_OF") {
      match = lat <= area.param;
    } else if (area.testType === "LAT_NORTH_OF") {
      match = lat >= area.param;
    }
    if (match) hits.push({ name: area.name, appliesTo: area.appliesTo, rule: area.rule });
  }
  return hits;
}

function nmDistance(lat1, lon1, lat2, lon2) {
  const R = 3440.065;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function initialBearing(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const p1 = lat1 * toRad, p2 = lat2 * toRad, dl = (lon2 - lon1) * toRad;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  let brng = Math.atan2(y, x) * 180 / Math.PI;
  if (brng < 0) brng += 360;
  return brng;
}
