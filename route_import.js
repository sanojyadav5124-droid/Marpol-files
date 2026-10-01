// CSV/TXT route import. Same validation rules as the Excel version's
// mRouteImport.bas: header synonym matching, lat/lon range checks, speed
// sanity check, chronological ETD check, per-row rejection log.
// (Excel .xlsx and ECDIS .rtz/.rtzp import are a later phase - use CSV for now.)

const LAT_SYNONYMS = ["lat", "latitude", "wplat", "y"];
const LON_SYNONYMS = ["lon", "long", "longitude", "wplon", "x"];
const SPD_SYNONYMS = ["speed", "spd", "speedkn", "kn"];
const ETD_SYNONYMS = ["etd", "eta", "etdeta", "date", "datetime"];
const NAME_SYNONYMS = ["wpname", "name", "waypoint", "waypointname"];

function normalizeHeader(h) {
  return h.trim().toLowerCase().replace(/[\s_]/g, "");
}

function splitAuto(line) {
  if (line.includes("\t")) return line.split("\t");
  if (line.includes(";")) return line.split(";");
  return line.split(",");
}

function trimQuotes(s) {
  s = s.trim();
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') return s.slice(1, -1);
  return s;
}

// Accepts plain decimal, or "51 30.25 N" / "51 30 15 N" style DMS.
function parseLatLon(raw, isLat) {
  let s = trimQuotes(raw).trim();
  if (s === "") throw new Error("Empty coordinate");
  if (!isNaN(parseFloat(s)) && /^-?\d+(\.\d+)?$/.test(s)) {
    const v = parseFloat(s);
    checkRange(v, isLat, s);
    return v;
  }
  const hemi = s.slice(-1).toUpperCase();
  let sign = 1;
  if (hemi === "S" || hemi === "W") sign = -1;
  if ("NSEW".includes(hemi)) s = s.slice(0, -1).trim();
  s = s.replace(/[°'"]/g, " ").replace(/\s+/g, " ").trim();
  const parts = s.split(" ").map(Number);
  const deg = parts[0] || 0, min = parts[1] || 0, sec = parts[2] || 0;
  const v = sign * (deg + min / 60 + sec / 3600);
  checkRange(v, isLat, raw);
  return v;
}

function checkRange(v, isLat, raw) {
  if (isLat && (v < -90 || v > 90)) throw new Error(`Latitude out of range: ${raw}`);
  if (!isLat && (v < -180 || v > 180)) throw new Error(`Longitude out of range: ${raw}`);
}

function mapHeaders(headers) {
  const map = { lat: -1, lon: -1, spd: -1, etd: -1, name: -1 };
  headers.forEach((h, i) => {
    const n = normalizeHeader(h);
    if (LAT_SYNONYMS.includes(n)) map.lat = i;
    else if (LON_SYNONYMS.includes(n)) map.lon = i;
    else if (SPD_SYNONYMS.includes(n)) map.spd = i;
    else if (ETD_SYNONYMS.includes(n)) map.etd = i;
    else if (NAME_SYNONYMS.includes(n)) map.name = i;
  });
  return map;
}

// Returns { waypoints: [...], log: [{row, field, value, reason, fix}] }
function importRouteCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
  const result = { waypoints: [], log: [] };
  if (lines.length === 0) return result;

  const headers = splitAuto(lines[0]).map(trimQuotes);
  const map = mapHeaders(headers);
  if (map.lat < 0 || map.lon < 0 || map.spd < 0 || map.etd < 0) {
    result.log.push({ row: 1, field: "header", value: "-", reason: "Required column missing (need lat/lon/speed/ETD)", fix: "Check the header row" });
    return result;
  }

  let prevEtd = null;
  for (let r = 1; r < lines.length; r++) {
    const cols = splitAuto(lines[r]);
    const rowNum = r + 1;
    let ok = true;
    let lat, lon, spd, etd;

    try { lat = parseLatLon(cols[map.lat], true); }
    catch (e) { result.log.push({ row: rowNum, field: "Latitude", value: cols[map.lat], reason: e.message, fix: "Use decimal or D M S with N/S suffix" }); ok = false; }

    try { lon = parseLatLon(cols[map.lon], false); }
    catch (e) { result.log.push({ row: rowNum, field: "Longitude", value: cols[map.lon], reason: e.message, fix: "Use decimal or D M S with E/W suffix" }); ok = false; }

    if (ok) {
      spd = parseFloat(trimQuotes(cols[map.spd]));
      if (isNaN(spd) || spd <= 0 || spd > 40) {
        result.log.push({ row: rowNum, field: "Speed", value: cols[map.spd], reason: "Speed must be numeric, >0 and <=40kn (sanity limit)", fix: "Check the source value" });
        ok = false;
      }
    }

    if (ok) {
      const etdStr = trimQuotes(cols[map.etd]);
      etd = new Date(etdStr);
      if (isNaN(etd.getTime())) {
        result.log.push({ row: rowNum, field: "ETD/ETA", value: cols[map.etd], reason: "Unparseable date/time", fix: "Use YYYY-MM-DD HH:MM or DD-MM-YYYY HH:MM" });
        ok = false;
      }
    }

    if (ok && prevEtd && etd < prevEtd) {
      result.log.push({ row: rowNum, field: "ETD/ETA", value: cols[map.etd], reason: "Out of chronological order vs previous waypoint", fix: "Check waypoint sequence" });
      ok = false;
    }

    if (ok) {
      result.waypoints.push({
        name: map.name >= 0 ? trimQuotes(cols[map.name]) : `WP${result.waypoints.length + 1}`,
        lat, lon, speed: spd, etd: etd.toISOString(),
      });
      prevEtd = etd;
    }
  }
  return result;
}

function loadSampleRoute() {
  const sample = [
    { name: "Rotterdam Pilot", lat: 51.9167, lon: 4.1333, speed: 12, etd: "2026-08-18T06:00:00" },
    { name: "Dover Strait", lat: 50.2000, lon: 1.5000, speed: 13.5, etd: "2026-08-18T18:40:00" },
    { name: "Ushant TSS", lat: 48.3333, lon: -5.5000, speed: 14, etd: "2026-08-19T12:00:00" },
    { name: "Cape Finisterre", lat: 42.8833, lon: -9.5000, speed: 14, etd: "2026-08-20T02:15:00" },
    { name: "Gibraltar Strait", lat: 35.9500, lon: -5.5833, speed: 12, etd: "2026-08-21T10:00:00" },
    { name: "Suez Approach", lat: 31.5000, lon: 32.3333, speed: 12, etd: "2026-08-24T04:00:00" },
  ];
  return sample.map(wp => ({ ...wp, etd: new Date(wp.etd).toISOString() }));
}
