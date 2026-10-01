// Lightweight port lookup: searches every POINT-type shape across all
// imported layers by name substring. Same "search on demand, not a static
// dump" approach as the Excel version.
const MAX_PORT_RESULTS = 200;

function searchPorts(needle) {
  needle = needle.trim().toLowerCase();
  const results = [];
  for (const layer of state.layers) {
    for (const shape of layer.shapes) {
      if (shape.type !== "POINT") continue;
      if (results.length >= MAX_PORT_RESULTS) break;
      const name = shape.attr || "";
      if (needle === "" || name.toLowerCase().includes(needle)) {
        results.push({ name, lat: shape.parts[0][0][0], lon: shape.parts[0][0][1], layer: layer.layerName });
      }
    }
  }
  return results;
}
