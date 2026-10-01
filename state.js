// Central app state + persistence. Two layers, same idea as the Excel
// version having both "the workbook file" and "whatever's typed right now":
//   1. Auto-save to localStorage on every change (survives closing the tab).
//   2. Explicit Export/Import to a JSON file (portable between machines/
//      browsers, and your actual backup - localStorage alone is fragile).

const STORAGE_KEY = "marpolVoyageControl_v1";

const state = {
  theme: "Ocean Deep",
  isAdmin: false,
  adminPasswordHash: null,   // set on first admin login if not already set
  vessel: { name: "MV NORTHERN STAR", voyage: "" },
  route: { waypoints: [] },  // [{name, lat, lon, speed, etd}]
  layers: [],                // imported .shp-derived layers (future phase)
};

function saveState() {
  const toSave = {
    theme: state.theme,
    adminPasswordHash: state.adminPasswordHash,
    vessel: state.vessel,
    route: state.route,
    layers: state.layers,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.warn("Could not save to localStorage:", e);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    Object.assign(state, saved);
  } catch (e) {
    console.warn("Could not load saved state:", e);
  }
}

function exportStateToFile() {
  const toSave = {
    theme: state.theme,
    adminPasswordHash: state.adminPasswordHash,
    vessel: state.vessel,
    route: state.route,
    layers: state.layers,
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(toSave, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `marpol_voyage_control_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importStateFromFile(file, onDone) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const loaded = JSON.parse(e.target.result);
      Object.assign(state, loaded);
      saveState();
      if (onDone) onDone(true);
    } catch (err) {
      if (onDone) onDone(false, err.message);
    }
  };
  reader.readAsText(file);
}

// Simple salted hash (matches the intent of the Excel version's approach -
// not cryptographic-grade, just enough to stop a casual glance revealing
// the password; uses the browser's built-in SubtleCrypto when available).
async function saltedHash(pwd, salt) {
  const enc = new TextEncoder();
  const data = enc.encode(salt + pwd + salt);
  if (window.crypto && window.crypto.subtle) {
    const digest = await window.crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  // fallback (very old browsers without SubtleCrypto)
  let h = 5381;
  for (let i = 0; i < data.length; i++) h = ((h * 33) ^ data[i]) >>> 0;
  return h.toString(16);
}

const ADMIN_SALT = "marpol-voyage-control-salt";
const DEFAULT_ADMIN_PASSWORD = "Marpol@2026";
