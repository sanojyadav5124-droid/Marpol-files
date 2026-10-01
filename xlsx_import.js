// Minimal .xlsx reader: .xlsx is a ZIP of XML (SpreadsheetML). Pulls the
// first worksheet + shared strings table via readZipEntries, then a small
// regex-based cell scanner (deliberately not a full XML parser - the
// SpreadsheetML cell schema is regular enough that this is reliable, and
// it means the same code can be tested in Node without a DOM).

function xmlUnescape(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const strings = [];
  // each <si> can contain a single <t> or multiple <r><t> runs - concatenate all <t> text within each <si>
  const siBlocks = xml.match(/<si[ >][\s\S]*?<\/si>/g) || [];
  for (const block of siBlocks) {
    const parts = block.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
    const text = parts.map(p => xmlUnescape(p.replace(/<[^>]+>/g, ""))).join("");
    strings.push(text);
  }
  return strings;
}

// Excel serial date -> JS Date (1900 date system, with the well-known
// 1900-was-not-a-leap-year quirk Excel deliberately preserves for
// Lotus 1-2-3 compatibility).
function excelSerialToDate(serial) {
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400;
  const dateInfo = new Date(utcValue * 1000);
  const fractionalDay = serial - Math.floor(serial);
  const totalSeconds = Math.round(fractionalDay * 86400);
  dateInfo.setUTCHours(0, 0, 0, 0);
  dateInfo.setUTCSeconds(totalSeconds);
  return dateInfo;
}

function colLetterToIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// Returns array of rows, each row an array of cell values indexed by column
// (0-based), with gaps as undefined for empty cells - matches how a CSV
// importer would see a 2D grid.
function parseWorksheetXml(xml, sharedStrings) {
  const rows = [];
  const rowBlocks = xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || [];
  for (const rowXml of rowBlocks) {
    const cellMatches = rowXml.match(/<c[^>]*\/>|<c[^>]*>[\s\S]*?<\/c>/g) || [];
    const row = [];
    for (const cellXml of cellMatches) {
      const refMatch = cellXml.match(/r="([A-Z]+)\d+"/);
      const typeMatch = cellXml.match(/t="([^"]+)"/);
      const valMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
      const inlineMatch = cellXml.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/);
      if (!refMatch) continue;
      const colIdx = colLetterToIndex(refMatch[1]);
      let value;
      if (inlineMatch) {
        value = xmlUnescape(inlineMatch[1]);
      } else if (valMatch) {
        const raw = valMatch[1];
        if (typeMatch && typeMatch[1] === "s") {
          value = sharedStrings[parseInt(raw, 10)] || "";
        } else if (typeMatch && typeMatch[1] === "str") {
          value = xmlUnescape(raw);
        } else {
          value = raw; // numeric (or date serial) - caller decides how to interpret
        }
      } else {
        value = "";
      }
      row[colIdx] = value;
    }
    rows.push(row);
  }
  return rows;
}

async function importXlsxRoute(arrayBuffer) {
  const entries = await readZipEntries(arrayBuffer, [
    "xl/sharedStrings.xml", "xl/worksheets/sheet1.xml",
  ]);
  if (!entries["xl/worksheets/sheet1.xml"]) {
    throw new Error("Could not find xl/worksheets/sheet1.xml - only the first sheet is read in this version.");
  }
  const sharedStrings = parseSharedStrings(entries["xl/sharedStrings.xml"] ? bytesToText(entries["xl/sharedStrings.xml"]) : "");
  const rows = parseWorksheetXml(bytesToText(entries["xl/worksheets/sheet1.xml"]), sharedStrings);
  return rowsToWaypointResult(rows);
}

// Shared with CSV import: given a 2D array of rows (row 0 = header), applies
// the same header-synonym matching and validation rules.
function rowsToWaypointResult(rows) {
  const result = { waypoints: [], log: [] };
  if (rows.length === 0) return result;
  const headers = rows[0].map(h => (h === undefined ? "" : String(h)));
  const map = mapHeaders(headers);
  if (map.lat < 0 || map.lon < 0 || map.spd < 0 || map.etd < 0) {
    result.log.push({ row: 1, field: "header", value: "-", reason: "Required column missing (need lat/lon/speed/ETD)", fix: "Check the header row" });
    return result;
  }

  let prevEtd = null;
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r] || [];
    const rowNum = r + 1;
    let ok = true;
    let lat, lon, spd, etd;

    const latRaw = cols[map.lat] === undefined ? "" : String(cols[map.lat]);
    const lonRaw = cols[map.lon] === undefined ? "" : String(cols[map.lon]);
    try { lat = parseFloat(latRaw); if (isNaN(lat) || lat < -90 || lat > 90) throw new Error("Latitude out of range: " + latRaw); }
    catch (e) { result.log.push({ row: rowNum, field: "Latitude", value: latRaw, reason: e.message, fix: "Use a decimal latitude" }); ok = false; }
    try { lon = parseFloat(lonRaw); if (isNaN(lon) || lon < -180 || lon > 180) throw new Error("Longitude out of range: " + lonRaw); }
    catch (e) { result.log.push({ row: rowNum, field: "Longitude", value: lonRaw, reason: e.message, fix: "Use a decimal longitude" }); ok = false; }

    if (ok) {
      spd = parseFloat(cols[map.spd]);
      if (isNaN(spd) || spd <= 0 || spd > 40) {
        result.log.push({ row: rowNum, field: "Speed", value: cols[map.spd], reason: "Speed must be numeric, >0 and <=40kn", fix: "Check the source value" });
        ok = false;
      }
    }

    if (ok) {
      const etdRaw = cols[map.etd];
      if (typeof etdRaw === "string" && /^\d+(\.\d+)?$/.test(etdRaw) && parseFloat(etdRaw) > 1000) {
        etd = excelSerialToDate(parseFloat(etdRaw)); // Excel date serial
      } else {
        etd = new Date(etdRaw);
      }
      if (isNaN(etd.getTime())) {
        result.log.push({ row: rowNum, field: "ETD/ETA", value: etdRaw, reason: "Unparseable date/time", fix: "Use a real date cell or an ISO date string" });
        ok = false;
      }
    }

    if (ok && prevEtd && etd < prevEtd) {
      result.log.push({ row: rowNum, field: "ETD/ETA", value: cols[map.etd], reason: "Out of chronological order vs previous waypoint", fix: "Check waypoint sequence" });
      ok = false;
    }

    if (ok) {
      result.waypoints.push({
        name: map.name >= 0 && cols[map.name] !== undefined ? String(cols[map.name]) : `WP${result.waypoints.length + 1}`,
        lat, lon, speed: spd, etd: etd.toISOString(),
      });
      prevEtd = etd;
    }
  }
  return result;
}
