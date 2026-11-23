// Plan data, workout step building, muscle recency and history helpers.
import { store } from './store.js';

export const data = { plan: null, ex: {}, tax: null };

export async function loadData() {
  const [plan, exs, tax] = await Promise.all(
    ['plan', 'exercises', 'taxonomy'].map(n => fetch(`data/${n}.json`).then(r => r.json()))
  );
  data.plan = plan;
  data.tax = tax;
  for (const e of exs.exercises) data.ex[e.id] = e;
}

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEIGHTED = new Set(['dumbbells', 'barbell', 'kettlebell', 'plate', 'cable_machine', 'leg_extension_machine',
  'leg_curl_machine', 'leg_press_machine', 'smith_machine']);
const LOWER = new Set(['lower_quad', 'lower_hinge']);

export function allDays() {
  return data.plan.weeks.flatMap(w => w.days.map(d => ({ ...d, week: w.week })));
}
export function dayById(id) { return allDays().find(d => d.id === id); }
export function weekCount() { return data.plan.weeks.length; }

export function isWeighted(ex) {
  return ex.category === 'strength' && ex.equipment.some(g => g.anyOf.some(q => WEIGHTED.has(q)));
}
export function isLowerUnilateral(ex) {
  return ex.laterality !== 'bilateral' && (LOWER.has(ex.region) ||
    ex.muscles.primary.some(m => ['calves', 'hamstrings', 'glutes', 'quads'].includes(m)));
}

// ---------- Equipment and home swaps ----------
export function ownedTypes() { return new Set(['none', ...(store.s.equipment || []).map(e => e.type)]); }
export function missingFor(ex, owned = ownedTypes()) {
  return ex.equipment.filter(g => !g.optional && !g.anyOf.some(q => owned.has(q))).map(g => g.anyOf);
}
// Which exercise to do for a plan item at this location.
export function resolveItem(item, location = store.settings().location, owned = ownedTypes()) {
  const ex = data.ex[item.exerciseId];
  if (location === 'gym' || !missingFor(ex, owned).length) return { exId: ex.id, swap: null, missing: [] };
  for (const alt of ex.alternatives || []) {
    const a = data.ex[alt.exerciseId];
    if (a && !missingFor(a, owned).length) return { exId: a.id, swap: { from: ex.id, fit: alt.fit, note: alt.note }, missing: [] };
  }
  return { exId: ex.id, swap: null, missing: missingFor(ex, owned) };
}
// Summary of a day at home: swaps, things you can't do, and whether the gym is the better choice.
export function homeReport(day, owned = ownedTypes()) {
  const swaps = [], missing = [];
  for (const b of day.blocks) for (const item of b.items) {
    const r = resolveItem(item, 'home', owned);
    if (r.swap) swaps.push({ ...r.swap, to: r.exId, block: b.id });
    if (r.missing.length) missing.push({ exId: r.exId, needs: r.missing, block: b.id });
  }
  const partial = swaps.filter(s => s.fit === 'partial');
  return { swaps, missing, partial, gymBetter: missing.length > 0 || partial.length > 0 };
}
// Equipment needed for a day: [{label groups, owned}] for the exercises actually done there.
export function equipmentNeeded(day, location = store.settings().location, owned = ownedTypes()) {
  const seen = new Map();
  for (const b of day.blocks) for (const item of b.items) {
    const ex = data.ex[resolveItem(item, location, owned).exId];
    for (const g of ex.equipment) {
      const types = g.anyOf.filter(q => q !== 'none');
      if (!types.length) continue;
      const key = types.join('/');
      if (!seen.has(key)) seen.set(key, { types, owned: types.some(q => owned.has(q)), optional: g.optional });
    }
  }
  // Drop a group when a narrower group already covers it (for example "box or bench" when "box" is listed).
  const list = [...seen.values()];
  return list.filter(g => !list.some(o => o !== g && o.types.length < g.types.length && o.types.every(q => g.types.includes(q))));
}

// ---------- Steps ----------
// A step is one tap of "Done": one set, or one side of a set for unilateral strength work.
function shouldSplit(item, ex, blockType) {
  if (item.sides) return true;
  if (item.durationSec && item.per === 'side') return true;
  return blockType !== 'circuit' && ex.laterality === 'unilateral' && ['side', 'leg', 'arm'].includes(item.per);
}

function sideSeq(item) {
  // Returns [{side, n, total}] in the order to perform them. Left always first.
  let L, R;
  if (item.sides) { L = item.sides.left.sets; R = item.sides.right.sets; }
  else { L = R = item.sets; }
  const out = [];
  let l = 0, r = 0;
  while (l < L || r < R) {
    if (l < L) { l++; out.push({ side: 'left', n: l, total: L }); }
    if (r < R) { r++; out.push({ side: 'right', n: r, total: R }); }
  }
  return out;
}

export function buildSteps(day, location = store.settings().location) {
  const st = store.settings();
  const owned = ownedTypes();
  const steps = [];
  for (const block of day.blocks) {
    const bt = block.type;
    const isCircuit = bt === 'circuit';
    const perItem = block.items.map((item, ii) => {
      const res = resolveItem(item, location, owned);
      const ex = data.ex[res.exId];
      const split = shouldSplit(item, ex, bt);
      const list = [];
      if (split) {
        for (const s of sideSeq(item)) {
          const reps = item.sides ? item.sides[s.side].reps : item.reps;
          list.push({ side: s.side, setNo: s.n, totalSets: s.total, reps });
        }
      } else {
        for (let n = 1; n <= item.sets; n++) list.push({ side: null, setNo: n, totalSets: item.sets, reps: item.reps });
      }
      return list.map(x => ({
        ...x,
        key: `${block.id}:${ii}:${x.side || 'b'}:${x.setNo}`,
        blockId: block.id, blockType: bt, blockName: block.name, itemIdx: ii,
        exId: res.exId, swapFrom: res.swap ? res.swap.from : null, durationSec: item.durationSec || null, per: item.per || null,
        note: item.note || null, weighted: isWeighted(ex),
      }));
    });

    if (isCircuit) {
      // Interleave: round 1 of each exercise, then round 2... Split steps (timed per side) stay together.
      const rounds = Math.max(...block.items.map(i => i.sets));
      for (let r = 1; r <= rounds; r++) {
        perItem.forEach((list, ii) => {
          for (const s of list.filter(s => s.setNo === r)) {
            steps.push({ ...s, round: r, rounds });
          }
        });
        if (steps.length) {
          const last = steps[steps.length - 1];
          last.restAfter = r < rounds ? st.restCircuit : st.restStrength;
        }
      }
      // Within a round: brief side switch only.
      for (const s of steps) if (s.blockId === block.id && s.restAfter == null) s.restAfter = s.side === 'left' ? st.restSides : 0;
    } else {
      for (const list of perItem) {
        list.forEach((s, i) => {
          const nextS = list[i + 1];
          let rest = st.restStrength;
          if (s.side === 'left' && nextS && nextS.side === 'right') rest = st.restSides;
          if (bt === 'warmup') rest = 0;
          steps.push({ ...s, restAfter: rest });
        });
      }
    }
  }
  if (steps.length) steps[steps.length - 1].restAfter = 0;
  return steps;
}

export function estimateMinutes(day) {
  let sec = 0;
  for (const s of buildSteps(day)) {
    sec += s.durationSec ? s.durationSec : (s.reps || 10) * 4 + 10;
    sec += s.restAfter || 0;
  }
  return Math.round(sec / 60 / 5) * 5 || 5;
}

export function exerciseIdsOf(day) {
  const ids = [];
  for (const b of day.blocks) for (const i of b.items) { const id = resolveItem(i).exId; if (!ids.includes(id)) ids.push(id); }
  return ids;
}

// ---------- History ----------
export function lastSessionFor(dayId) {
  const s = store.s.sessions.filter(x => x.dayId === dayId);
  return s.length ? s[s.length - 1] : null;
}

// Most recent logged sets for an exercise, grouped by session (newest first).
export function exerciseHistory(exId, limit = 5) {
  const out = [];
  const sessions = store.s.sessions;
  for (let i = sessions.length - 1; i >= 0 && out.length < limit; i--) {
    const sets = sessions[i].sets.filter(x => x.exId === exId);
    if (sets.length) out.push({ date: sessions[i].start, sets });
  }
  return out;
}

// Prefill for a step: same exercise, side and set number from the last session, else that session's last set.
export function lastValuesFor(step) {
  const sessions = store.s.sessions;
  for (let i = sessions.length - 1; i >= 0; i--) {
    const sets = sessions[i].sets.filter(x => x.exId === step.exId && (x.side || null) === (step.side || null));
    if (!sets.length) continue;
    const same = sets.find(x => x.setNo === step.setNo) || sets[sets.length - 1];
    return same;
  }
  return null;
}

// ---------- Muscle recency ----------
// Days since each muscle was last trained (primary counts fully, secondary counts too).
export function muscleLastTrained() {
  const last = {};
  for (const sess of store.s.sessions) {
    const when = new Date(sess.start).getTime();
    for (const set of sess.sets) {
      const ex = data.ex[set.exId];
      if (!ex) continue;
      for (const m of [...ex.muscles.primary, ...ex.muscles.secondary]) {
        if (!last[m] || last[m] < when) last[m] = when;
      }
    }
  }
  return last;
}

export function daysSince(ts, now = Date.now()) {
  if (!ts) return null;
  const a = new Date(ts); a.setHours(0, 0, 0, 0);
  const b = new Date(now); b.setHours(0, 0, 0, 0);
  return Math.round((b - a) / 86400000);
}

// Freshness 0..1: load-weighted share of the day's muscles that have had 3+ days of rest.
const FULL_REST_DAYS = 3;
export function freshness(day, lastMap = muscleLastTrained()) {
  let tot = 0, acc = 0;
  for (const [m, load] of Object.entries(day.muscleLoad || {})) {
    const d = daysSince(lastMap[m]);
    const f = d == null ? 1 : Math.min(d, FULL_REST_DAYS) / FULL_REST_DAYS;
    tot += load; acc += load * f;
  }
  return tot ? acc / tot : 1;
}

export function topMuscles(day, n = 5) {
  return Object.entries(day.muscleLoad || {}).sort((a, b) => b[1] - a[1]).slice(0, n).map(x => x[0]);
}

// ---------- Today ----------
export function weekDays(week) { return allDays().filter(d => d.week === week); }

export function doneInCurrentCycle(dayId) {
  // A day counts as done if finished after the current week was started.
  const since = store.s.weekStartedAt ? new Date(store.s.weekStartedAt).getTime() : 0;
  return store.s.sessions.some(s => s.dayId === dayId && new Date(s.start).getTime() >= since && !s.partial);
}

export function suggestedDay() {
  const st = store.settings();
  const days = weekDays(st.week);
  const wd = WEEKDAYS[new Date().getDay()];
  const todays = days.find(d => d.weekday === wd && !doneInCurrentCycle(d.id));
  if (todays) return todays;
  return days.find(d => !doneInCurrentCycle(d.id)) || days[0];
}
