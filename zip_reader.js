// Minimal ZIP reader for .xlsx and .rtzp (both are just ZIP archives) -
// uses the browser's/Node's built-in DecompressionStream("deflate-raw"),
// no external library needed. Reads the End Of Central Directory record
// to find the central directory (reliable file sizes/offsets, unlike
// scanning local headers sequentially), then extracts only the named
// entries requested rather than the whole archive.

async function readZipEntries(arrayBuffer, wantedNames) {
  const bytes = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);

  // find End Of Central Directory signature (0x06054b50), searching from
  // the end since a variable-length comment can follow it.
  const EOCD_SIG = 0x06054b50;
  let eocdPos = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65557); i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) { eocdPos = i; break; }
  }
  if (eocdPos === -1) throw new Error("Not a valid ZIP archive (no End Of Central Directory found)");

  const cdCount = dv.getUint16(eocdPos + 10, true);
  const cdOffset = dv.getUint32(eocdPos + 16, true);

  const wanted = new Set(wantedNames);
  const found = {};

  let pos = cdOffset;
  const CD_SIG = 0x02014b50;
  for (let i = 0; i < cdCount; i++) {
    if (dv.getUint32(pos, true) !== CD_SIG) break;
    const compMethod = dv.getUint16(pos + 10, true);
    const compSize = dv.getUint32(pos + 20, true);
    const uncompSize = dv.getUint32(pos + 24, true);
    const nameLen = dv.getUint16(pos + 28, true);
    const extraLen = dv.getUint16(pos + 30, true);
    const commentLen = dv.getUint16(pos + 32, true);
    const localHeaderOffset = dv.getUint32(pos + 42, true);
    const nameBytes = bytes.slice(pos + 46, pos + 46 + nameLen);
    const name = new TextDecoder("utf-8").decode(nameBytes);

    if (wanted.has(name)) {
      const raw = await extractLocalEntry(bytes, dv, localHeaderOffset, compMethod, compSize);
      found[name] = raw;
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return found;
}

async function extractLocalEntry(bytes, dv, localOffset, compMethod, compSize) {
  const LOCAL_SIG = 0x04034b50;
  if (dv.getUint32(localOffset, true) !== LOCAL_SIG) throw new Error("Bad local file header");
  const nameLen = dv.getUint16(localOffset + 26, true);
  const extraLen = dv.getUint16(localOffset + 28, true);
  const dataStart = localOffset + 30 + nameLen + extraLen;
  const compData = bytes.slice(dataStart, dataStart + compSize);

  if (compMethod === 0) return compData; // stored, no compression
  if (compMethod === 8) return await inflateRaw(compData); // deflate
  throw new Error(`Unsupported ZIP compression method: ${compMethod}`);
}

async function inflateRaw(compressedBytes) {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(compressedBytes);
  writer.close();
  const chunks = [];
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

function bytesToText(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}
