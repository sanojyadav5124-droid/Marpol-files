// Canvas-based offline world map. Equirectangular projection (lon -> x,
// lat -> y, simple linear scale - same approach as the Excel version's
// XY-scatter chart, but a real canvas gives free pan/zoom, which Excel
// charts don't). No map tiles, no internet - only your imported layers,
// the loaded route, and (once the Simulator runs) the vessel marker.

let mapView = { centerLon: 0, centerLat: 20, zoom: 1 }; // zoom: pixels per degree at zoom=1 is baseCale
let mapCanvas, mapCtx;
let mapDragging = false, mapDragStart = null;

function initWorldMap() {
  mapCanvas = document.getElementById("mapCanvas");
  mapCtx = mapCanvas.getContext("2d");
  resizeMapCanvas();
  window.addEventListener("resize", () => { resizeMapCanvas(); drawMap(); });

  mapCanvas.addEventListener("mousedown", (e) => {
    mapDragging = true;
    mapDragStart = { x: e.offsetX, y: e.offsetY, centerLon: mapView.centerLon, centerLat: mapView.centerLat };
  });
  window.addEventListener("mouseup", () => { mapDragging = false; });
  mapCanvas.addEventListener("mousemove", (e) => {
    if (!mapDragging) return;
    const scale = baseScale() * mapView.zoom;
    const dx = (e.offsetX - mapDragStart.x) / scale;
    const dy = (e.offsetY - mapDragStart.y) / scale;
    mapView.centerLon = mapDragStart.centerLon - dx;
    mapView.centerLat = mapDragStart.centerLat + dy;
    drawMap();
  });
  mapCanvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    mapView.zoom = Math.max(0.3, Math.min(60, mapView.zoom * factor));
    drawMap();
  }, { passive: false });

  drawMap();
}

function resizeMapCanvas() {
  const wrap = mapCanvas.parentElement;
  mapCanvas.width = wrap.clientWidth;
  mapCanvas.height = 520;
}

function baseScale() {
  // pixels per degree of longitude at zoom=1, sized so the whole world fits width-wise
  return mapCanvas.width / 360;
}

function project(lat, lon) {
  const scale = baseScale() * mapView.zoom;
  const x = mapCanvas.width / 2 + (lon - mapView.centerLon) * scale;
  const y = mapCanvas.height / 2 - (lat - mapView.centerLat) * scale;
  return [x, y];
}

function themeColor(varName) {
  return getComputedStyle(document.body).getPropertyValue(varName).trim();
}

function drawMap() {
  if (!mapCtx) return;
  const w = mapCanvas.width, h = mapCanvas.height;
  mapCtx.fillStyle = themeColor("--bg");
  mapCtx.fillRect(0, 0, w, h);

  // graticule every 30 degrees, faint
  mapCtx.strokeStyle = "rgba(255,255,255,0.06)";
  mapCtx.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 30) {
    mapCtx.beginPath();
    const [x1, y1] = project(-90, lon);
    const [x2, y2] = project(90, lon);
    mapCtx.moveTo(x1, y1); mapCtx.lineTo(x2, y2); mapCtx.stroke();
  }
  for (let lat = -60; lat <= 90; lat += 30) {
    mapCtx.beginPath();
    const [x1, y1] = project(lat, -180);
    const [x2, y2] = project(lat, 180);
    mapCtx.moveTo(x1, y1); mapCtx.lineTo(x2, y2); mapCtx.stroke();
  }

  // imported layers (checked ones only)
  mapCtx.strokeStyle = "rgba(144,180,200,0.9)";
  mapCtx.lineWidth = 0.75;
  for (const layer of state.layers) {
    if (!layer.visible) continue;
    for (const shape of layer.shapes) {
      if (shape.type === "POLYGON" || shape.type === "POLYLINE") {
        for (const ring of shape.parts) {
          mapCtx.beginPath();
          ring.forEach(([lat, lon], i) => {
            const [x, y] = project(lat, lon);
            if (i === 0) mapCtx.moveTo(x, y); else mapCtx.lineTo(x, y);
          });
          mapCtx.stroke();
        }
      } else if (shape.type === "POINT") {
        const [x, y] = project(shape.parts[0][0][0], shape.parts[0][0][1]);
        mapCtx.fillStyle = themeColor("--accent");
        mapCtx.beginPath();
        mapCtx.arc(x, y, 2.5, 0, Math.PI * 2);
        mapCtx.fill();
      }
    }
  }

  // MARPOL/ECA area outlines (from GEO_AREAS, toggleable)
  if (document.getElementById("showAreasChk") && document.getElementById("showAreasChk").checked) {
    mapCtx.strokeStyle = "rgba(242,166,90,0.45)";
    mapCtx.lineWidth = 1;
    for (const area of GEO_AREAS) {
      if (area.testType !== "POLYGON") continue;
      mapCtx.beginPath();
      area.param.forEach(([lat, lon], i) => {
        const [x, y] = project(lat, lon);
        if (i === 0) mapCtx.moveTo(x, y); else mapCtx.lineTo(x, y);
      });
      mapCtx.closePath();
      mapCtx.stroke();
    }
  }

  // route track
  const wps = state.route.waypoints;
  if (wps.length >= 2) {
    mapCtx.strokeStyle = themeColor("--accent2");
    mapCtx.lineWidth = 2;
    mapCtx.beginPath();
    wps.forEach(([], i) => {}); // noop guard
    wps.forEach((wp, i) => {
      const [x, y] = project(wp.lat, wp.lon);
      if (i === 0) mapCtx.moveTo(x, y); else mapCtx.lineTo(x, y);
    });
    mapCtx.stroke();
    mapCtx.fillStyle = themeColor("--accent2");
    wps.forEach(wp => {
      const [x, y] = project(wp.lat, wp.lon);
      mapCtx.beginPath();
      mapCtx.arc(x, y, 3.5, 0, Math.PI * 2);
      mapCtx.fill();
    });
  }

  // vessel marker (Simulator writes into window.vesselPos)
  if (window.vesselPos) {
    const [x, y] = project(window.vesselPos.lat, window.vesselPos.lon);
    mapCtx.fillStyle = "#FF5050";
    mapCtx.beginPath();
    mapCtx.moveTo(x, y - 8);
    mapCtx.lineTo(x - 6, y + 6);
    mapCtx.lineTo(x + 6, y + 6);
    mapCtx.closePath();
    mapCtx.fill();
  }
}

function mapZoomFullWorld() {
  mapView = { centerLon: 0, centerLat: 20, zoom: 1 };
  drawMap();
}

function mapZoomToRoute() {
  const wps = state.route.waypoints;
  if (wps.length === 0) { alert("No route loaded to zoom to."); return; }
  let minLat = wps[0].lat, maxLat = wps[0].lat, minLon = wps[0].lon, maxLon = wps[0].lon;
  wps.forEach(wp => {
    minLat = Math.min(minLat, wp.lat); maxLat = Math.max(maxLat, wp.lat);
    minLon = Math.min(minLon, wp.lon); maxLon = Math.max(maxLon, wp.lon);
  });
  mapView.centerLat = (minLat + maxLat) / 2;
  mapView.centerLon = (minLon + maxLon) / 2;
  const spanLon = Math.max(2, maxLon - minLon) * 1.4;
  mapView.zoom = Math.max(0.3, Math.min(60, 360 / spanLon));
  drawMap();
}
