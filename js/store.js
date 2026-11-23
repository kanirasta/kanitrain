// Local persistence. Everything lives in localStorage on the device.
// Keys are versioned so a future schema change can migrate cleanly.
const KEY = 'trainingApp.v1';

export const DEFAULT_EQUIPMENT = [
  { id: 'eq1', type: 'dumbbells', note: '2× 3 kg, 2× 5 kg, 2× 10 kg' },
  { id: 'eq2', type: 'barbell', note: 'Olympic bar, 7.5 kg' },
  { id: 'eq3', type: 'plate', note: '2× 2.5 kg' },
  { id: 'eq4', type: 'mini_band', note: 'Full set' },
  { id: 'eq5', type: 'pull_up_bar', note: '' },
  { id: 'eq6', type: 'box', note: 'Wooden table, used as a plyo box' },
  { id: 'eq7', type: 'treadmill', note: 'Walking treadmill, max 6 km/h' },
  { id: 'eq8', type: 'mat', note: '' },
  { id: 'eq9', type: 'couch_chair', note: 'Couch, for split squats and hip thrusts' },
];
// Equipment list revision: lets an update add a new default item once, without re-adding it after you delete it.
const EQ_REV = 2;

const DEFAULTS = {
  settings: {
    lang: 'en',
    restStrength: 90,
    restCircuit: 45,
    restSides: 10,
    weightStep: 1,
    sound: true,
    week: 1,
    location: 'home',  // 'home' uses your equipment and swaps exercises; 'gym' runs the plan as written
  },
  equipment: null,   // filled with DEFAULT_EQUIPMENT on first run
  sessions: [],      // finished workouts
  active: null,      // workout in progress (for resume)
  notes: {},         // exerciseId -> text
  lastBackupAt: null,
};

let state = load();
if (!Array.isArray(state.equipment)) state.equipment = structuredClone(DEFAULT_EQUIPMENT);
migrateEquipment();
try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}

function migrateEquipment() {
  if ((state.eqRev || 1) < 2 && !state.equipment.some(e => e.type === 'couch_chair'))
    state.equipment.push(structuredClone(DEFAULT_EQUIPMENT.find(e => e.type === 'couch_chair')));
  state.eqRev = EQ_REV;
}

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
    if (!Array.isArray(state.equipment)) state.equipment = structuredClone(DEFAULT_EQUIPMENT);
    migrateEquipment();
    save();
  },
  reset() { state = structuredClone(DEFAULTS); state.equipment = structuredClone(DEFAULT_EQUIPMENT); state.eqRev = EQ_REV; save(); },
  equipment() { return state.equipment; },
  saveEquipment(item) {
    if (item.id) { const i = state.equipment.findIndex(e => e.id === item.id); if (i >= 0) state.equipment[i] = item; }
    else state.equipment.push({ ...item, id: 'eq' + Date.now() });
    save();
  },
  deleteEquipment(id) { state.equipment = state.equipment.filter(e => e.id !== id); save(); },
};

// Ask the browser not to evict our storage (helps on iOS when installed).
export async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch {}
}
