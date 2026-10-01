// Offline .shp/.dbf import using the browser's native File API + DataView -
// no libraries, no VBA-style byte-order tricks. Handles Point (1), PolyLine
// (3), Polygon (5); Z/M variants and MultiPoint are flagged as unsupported
// rather than misread. Matches the Excel version's mShpImport.bas behaviour,
// but reading binary in JS is much less error-prone (DataView handles
// endianness explicitly per call, no risk of a variable name silently
// shadowing a built-in the way "lenb" did in VBA).

const MAX_VERTICES_PER_SHAPE = 400;
const MAX_SHAPES = 4000;

function readShpFile(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  const fileCode = dv.getInt32(0, false);
  if (fileCode !== 9994) throw new Error("Not a valid .shp file (bad file code - expected 9994)");
  const fileLenWords = dv.getInt32(24, false);
  const fileLenBytes = fileLenWords * 2;

  const shapes = [];
  let pos = 100;
  while (pos < fileLenBytes && shapes.length < MAX_SHAPES) {
    const contentLenWords = dv.getInt32(pos + 4, false);
    const contentLenBytes = contentLenWords * 2;
    const recStart = pos + 8;
    const shapeType = dv.getInt32(recStart, true);

    let shape = null;
    if (shapeType === 0) {
      // null shape, skip
    } else if (shapeType === 1) {
      const x = dv.getFloat64(recStart + 4, true);
      const y = dv.getFloat64(recStart + 12, true);
      shape = { type: "POINT", parts: [[[y, x]]] };
    } else if (shapeType === 3 || shapeType === 5) {
      // Multi-part shapes (an island separate from the mainland, a ring
      // with a hole) store a "parts" index array marking where each part's
      // points start within the flat points array. Splitting on that -
      // instead of flattening every part into one continuous line - is
      // what stops the renderer drawing a stray line connecting the end of
      // one landmass straight to the start of the next.
      const numParts = dv.getInt32(recStart + 36, true);
      const numPoints = dv.getInt32(recStart + 40, true);
      const partsStart = recStart + 44;
      const partIndices = [];
      for (let p = 0; p < numParts; p++) partIndices.push(dv.getInt32(partsStart + p * 4, true));
      partIndices.push(numPoints); // sentinel end index for the last part

      const ptsStart = partsStart + 4 * numParts;
      const step = numPoints > MAX_VERTICES_PER_SHAPE ? Math.ceil(numPoints / MAX_VERTICES_PER_SHAPE) : 1;

      const parts = [];
      for (let p = 0; p < numParts; p++) {
        const startIdx = partIndices[p], endIdx = partIndices[p + 1];
        const ring = [];
        for (let i = startIdx; i < endIdx; i += step) {
          const x = dv.getFloat64(ptsStart + i * 16, true);
          const y = dv.getFloat64(ptsStart + i * 16 + 8, true);
          ring.push([y, x]);
        }
        if (ring.length >= 2) parts.push(ring); // drop degenerate slivers decimation could leave with <2 points
      }
      shape = { type: shapeType === 3 ? "POLYLINE" : "POLYGON", parts };
    } else {
      shape = { type: `UNSUPPORTED(${shapeType})`, parts: [] };
    }
    if (shape) shapes.push(shape);
    pos = recStart + contentLenBytes;
  }
  return shapes;
}

// Pulls the first Character field out of a dBase III .dbf as a generic
// name/label per record - schema-agnostic, works for Natural Earth and
// world_port_index alike without knowing field names in advance.
function readDbfAttributes(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  const numRecords = dv.getInt32(4, true);
  const headerSize = dv.getInt16(8, true);
  const recordSize = dv.getInt16(10, true);
  if (numRecords <= 0) return [];

  let fieldPos = 32;
  let firstCharOffset = -1, firstCharLen = 0, runningOffset = 1; // 1 byte deletion flag
  while (true) {
    const marker = dv.getUint8(fieldPos);
    if (marker === 0x0D) break;
    const fieldType = String.fromCharCode(dv.getUint8(fieldPos + 11));
    const fieldLen = dv.getUint8(fieldPos + 16);
    if (firstCharOffset === -1 && fieldType === "C") {
      firstCharOffset = runningOffset;
      firstCharLen = fieldLen;
    }
    runningOffset += fieldLen;
    fieldPos += 32;
  }
  if (firstCharOffset === -1) return [];

  const decoder = new TextDecoder("latin1");
  const attrs = [];
  for (let r = 0; r < numRecords; r++) {
    const recPos = headerSize + r * recordSize + firstCharOffset;
    const bytes = new Uint8Array(arrayBuffer, recPos, firstCharLen);
    attrs.push(decoder.decode(bytes).trim());
  }
  return attrs;
}

function deriveLayerName(filename) {
  return filename.replace(/\.shp$/i, "");
}

// Reads a .shp File object (and its matching .dbf File object if provided)
// and returns { layerName, shapes: [{type, verts, attr}] }.
function importShapefile(shpFile, dbfFile, onDone) {
  const layerName = deriveLayerName(shpFile.name);
  const shpReader = new FileReader();
  shpReader.onload = (e) => {
    let shapes;
    try {
      shapes = readShpFile(e.target.result);
    } catch (err) {
      onDone(null, err.message);
      return;
    }
    if (dbfFile) {
      const dbfReader = new FileReader();
      dbfReader.onload = (e2) => {
        let attrs = [];
        try { attrs = readDbfAttributes(e2.target.result); } catch (err) { /* no attributes, not fatal */ }
        shapes.forEach((s, i) => { s.attr = attrs[i] || ""; });
        onDone({ layerName, shapes }, null);
      };
      dbfReader.readAsArrayBuffer(dbfFile);
    } else {
      shapes.forEach(s => { s.attr = ""; });
      onDone({ layerName, shapes }, null);
    }
  };
  shpReader.onerror = () => onDone(null, "Could not read the .shp file.");
  shpReader.readAsArrayBuffer(shpFile);
}
