// Offline RTZ/RTZP (ECDIS route interchange, IEC 61174) import. .rtz is
// plain XML; .rtzp is a .rtz zipped up. Uses a small regex-based attribute
// scanner rather than DOMParser - keeps this testable in plain Node (no
// browser DOM needed) and RTZ's schema is simple/regular enough that this
// is reliable. Feeds the same waypoint/log format as CSV and Excel import.

function getAttr(tagXml, attrName) {
  const m = tagXml.match(new RegExp(`${attrName}="([^"]*)"`));
  return m ? xmlUnescape(m[1]) : "";
}

function parseIso8601(s) {
  return new Date(s);
}

function importRtzXml(xmlText) {
  const result = { waypoints: [], log: [] };

  const wpBlocks = xmlText.match(/<waypoint\b[^>]*>[\s\S]*?<\/waypoint>|<waypoint\b[^>]*\/>/g) || [];
  if (wpBlocks.length === 0) {
    result.log.push({ row: 0, field: "waypoints", value: "-", reason: "No <waypoint> elements found - this file may use a different RTZ schema version", fix: "Check the source RTZ file" });
    return result;
  }

  const legBlocks = xmlText.match(/<leg\b[^>]*\/>|<leg\b[^>]*>[\s\S]*?<\/leg>/g) || [];

  wpBlocks.forEach((wpXml, i) => {
    const wpTagMatch = wpXml.match(/<waypoint\b[^>]*>/);
    const wpTag = wpTagMatch ? wpTagMatch[0] : wpXml;
    const wpId = getAttr(wpTag, "id");
    const wpName = getAttr(wpTag, "name");

    const posMatch = wpXml.match(/<position\b[^>]*\/>|<position\b[^>]*>/);
    if (!posMatch) {
      result.log.push({ row: i + 1, field: "position", value: "-", reason: "Waypoint has no <position> element", fix: "Check the source RTZ file" });
      return;
    }
    const posTag = posMatch[0];
    const latStr = getAttr(posTag, "lat");
    const lonStr = getAttr(posTag, "lon");

    let ok = true;
    const lat = parseFloat(latStr), lon = parseFloat(lonStr);
    if (isNaN(lat) || lat < -90 || lat > 90) {
      result.log.push({ row: i + 1, field: "Latitude", value: latStr, reason: "Not a valid latitude", fix: "Check the <position lat=...> value" });
      ok = false;
    }
    if (isNaN(lon) || lon < -180 || lon > 180) {
      result.log.push({ row: i + 1, field: "Longitude", value: lonStr, reason: "Not a valid longitude", fix: "Check the <position lon=...> value" });
      ok = false;
    }

    // Speed convention: the rest of this app treats a waypoint's "speed" as
    // the speed for the LEG DEPARTING that waypoint (matches Route Check /
    // Simulator, which index by the starting waypoint of each leg) - so we
    // want the leg that STARTS at this waypoint, not the one that ends here.
    let speed = 0;
    const isLastWp = (i === wpBlocks.length - 1);
    const leg = legBlocks.find(l => getAttr(l, "startWaypointId") === wpId);
    if (leg) {
      const s1 = getAttr(leg, "speedMax");
      const s2 = getAttr(leg, "speed");
      speed = parseFloat(s1 || s2);
    }
    if (ok && !isLastWp && (isNaN(speed) || speed <= 0)) {
      result.log.push({ row: i + 1, field: "Speed", value: String(speed), reason: "No usable leg speed found for this waypoint", fix: "Check the source RTZ's <leg speedMax=...> values" });
      ok = false;
    }
    if (isLastWp && (isNaN(speed) || speed <= 0)) speed = 0; // destination has no outgoing leg - expected, not an error

    // ETA/ETD, if the exporting ECDIS included a schedule extension
    let etd = null, haveEtd = false;
    const schedMatch = wpXml.match(/<schedule\b[^>]*\/>|<schedule\b[^>]*>/);
    if (schedMatch) {
      const schedTag = schedMatch[0];
      const etaStr = getAttr(schedTag, "eta") || getAttr(schedTag, "etd");
      if (etaStr) {
        const d = parseIso8601(etaStr);
        if (!isNaN(d.getTime())) { etd = d; haveEtd = true; }
      }
    }
    if (ok && !haveEtd) {
      result.log.push({ row: i + 1, field: "ETD/ETA", value: "-", reason: "No schedule/ETA found on this waypoint", fix: "Position/speed still imported; add times manually in Route Import if you need chronology checks or the Simulator's time-based playback" });
      // not fatal - still import position + speed without a time
    }

    if (ok) {
      result.waypoints.push({
        name: wpName || `WP${result.waypoints.length + 1}`,
        lat, lon, speed,
        etd: haveEtd ? etd.toISOString() : null,
      });
    }
  });

  return result;
}

async function importRtzpRoute(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  // find all entry names first by reading the central directory names only
  const EOCD_SIG = 0x06054b50;
  let eocdPos = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) { eocdPos = i; break; }
  }
  if (eocdPos === -1) throw new Error("Not a valid .rtzp (ZIP) archive");
  const cdCount = dv.getUint16(eocdPos + 10, true);
  const cdOffset = dv.getUint32(eocdPos + 16, true);
  let pos = cdOffset;
  let rtzName = null;
  for (let i = 0; i < cdCount; i++) {
    const nameLen = dv.getUint16(pos + 28, true);
    const extraLen = dv.getUint16(pos + 30, true);
    const commentLen = dv.getUint16(pos + 32, true);
    const name = new TextDecoder("utf-8").decode(bytes.slice(pos + 46, pos + 46 + nameLen));
    if (name.toLowerCase().endsWith(".rtz")) rtzName = name;
    pos += 46 + nameLen + extraLen + commentLen;
  }
  if (!rtzName) throw new Error("No .rtz file found inside this .rtzp archive");
  const entries = await readZipEntries(arrayBuffer, [rtzName]);
  return importRtzXml(bytesToText(entries[rtzName]));
}
