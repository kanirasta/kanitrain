// Local persistence. Everything lives in localStorage on the device.
// Keys are versioned so a future schema change can migrate cleanly.
const KEY = 'trainingApp.v1';

const DEFAULTS = {
  settings: {
    lang: 'en',
    restStrength: 90,
    restCircuit: 45,
    restSides: 10,
    weightStep: 1,
    sound: true,
    week: 1,
  },
  sessions: [],      // finished workouts
  active: null,      // workout in progress (for resume)
  notes: {},         // exerciseId -> text
  lastBackupAt: null,
};

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const s = JSON.parse(raw);
    return { ...structuredClone(DEFAULTS), ...s, settings: { ...DEFAULTS.settings, ...(s.settings || {}) } };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn('save failed', e); }
}

export const store = {
  get s() { return state; },
  settings() { return state.settings; },
  setSetting(k, v) { state.settings[k] = v; save(); },
  setActive(a) { state.active = a; save(); },
  addSession(sess) { state.sessions.push(sess); save(); },
  setNote(exId, txt) { if (txt) state.notes[exId] = txt; else delete state.notes[exId]; save(); },
  updateSession(id, patch) {
    const s = state.sessions.find(x => x.id === id);
    if (s) { Object.assign(s, patch); save(); }
  },
  exportJSON() {
    state.lastBackupAt = new Date().toISOString();
    save();
    return JSON.stringify({ app: 'training', version: 1, exportedAt: state.lastBackupAt, data: state }, null, 1);
  },
  importJSON(text) {
    const obj = JSON.parse(text);
    if (!obj || obj.app !== 'training' || !obj.data || !Array.isArray(obj.data.sessions)) throw new Error('bad');
    state = { ...structuredClone(DEFAULTS), ...obj.data, settings: { ...DEFAULTS.settings, ...obj.data.settings } };
    save();
  },
  reset() { state = structuredClone(DEFAULTS); save(); },
};

// Ask the browser not to evict our storage (helps on iOS when installed).
export async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch {}
}
