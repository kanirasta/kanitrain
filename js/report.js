// Workout report: a Markdown text you can read and edit, plus a JSON record for later analysis.
import { t, L, getLang } from './i18n.js';
import { data, dayById } from './plan.js';
import { store } from './store.js';

const R = {
  en: {
    title: 'Workout report', date: 'Date', duration: 'Total time', work: 'working', rest: 'resting', other: 'other',
    place: 'Place', home: 'Home', gym: 'Gym', sets: 'Sets', done: 'done', skippedN: 'skipped', volume: 'Volume',
    rpe: 'Effort (RPE 1-10)', before: 'Runs and swims in the 2 days before', none: 'none',
    tune: 'To tune', below: 'Below target', longRest: 'Rests much longer than planned', heavier: 'Heavier than last time',
    skippedEx: 'Skipped', postponed: 'Postponed with Skip, then done', redone: 'Redone with Back', resumed: 'Workout was resumed after closing the app',
    exercises: 'Exercises', target: 'Target', set: 'Set', round: 'Round', left: 'L', right: 'R', reps: 'reps', tgt: 'target',
    time: 'time', restAfter: 'rest', notDoneAll: 'Not done ({n} sets)', noTimer: 'timer not used', plan: 'plan', notDone: 'not done', timer: 'timer', pauses: 'paused',
    lvr: 'Left vs right', maxW: 'max weight', avgT: 'avg time', insteadOf: 'instead of', times: '{n}x',
    notes: 'My notes', notesHint: '(how it felt, pain, left/right differences, anything to change)',
    sideNote: 'Left/right', painNote: 'Pain or discomfort',
  },
  es: {
    title: 'Informe del entrenamiento', date: 'Fecha', duration: 'Tiempo total', work: 'trabajando', rest: 'descansando', other: 'otros',
    place: 'Lugar', home: 'Casa', gym: 'Gimnasio', sets: 'Series', done: 'hechas', skippedN: 'salteadas', volume: 'Volumen',
    rpe: 'Esfuerzo (RPE 1-10)', before: 'Carreras y natación en los 2 días previos', none: 'ninguna',
    tune: 'Para ajustar', below: 'Debajo del objetivo', longRest: 'Descansos mucho más largos que lo planeado', heavier: 'Más peso que la vez anterior',
    skippedEx: 'Salteados', postponed: 'Pospuestos con Saltar y hechos después', redone: 'Repetidos con Atrás', resumed: 'El entrenamiento se retomó después de cerrar la app',
    exercises: 'Ejercicios', target: 'Objetivo', set: 'Serie', round: 'Ronda', left: 'Izq', right: 'Der', reps: 'reps', tgt: 'obj.',
    time: 'tiempo', restAfter: 'descanso', notDoneAll: 'No hecho ({n} series)', noTimer: 'sin temporizador', plan: 'plan', notDone: 'no hecha', timer: 'temporizador', pauses: 'pausas',
    lvr: 'Izquierda vs derecha', maxW: 'peso máx.', avgT: 'tiempo medio', insteadOf: 'en lugar de', times: '{n} vez/veces',
    notes: 'Mis notas', notesHint: '(cómo me sentí, dolor, diferencias izq/der, qué cambiar)',
    sideNote: 'Izq/der', painNote: 'Dolor o molestia',
  },
};
const r = k => (R[getLang()] || R.en)[k];
const NOTES_HEADS = [R.en.notes, R.es.notes];

const clock = sec => { if (sec == null || isNaN(sec)) return '-'; sec = Math.round(sec); const m = Math.floor(sec / 60); return `${m}:${String(sec % 60).padStart(2, '0')}`; };
const mins = ms => `${Math.round(ms / 60000)} min`;
const kg = w => `${+w} kg`;
const sum = arr => arr.reduce((a, b) => a + (b || 0), 0);
const avg = arr => { const v = arr.filter(x => x != null); return v.length ? sum(v) / v.length : null; };
const localeOf = () => (getLang() === 'es' ? 'es-UY' : 'en-US');

// Parse "block:item:side:set" keys.
const parseKey = k => { const [blockId, ii, side, setNo] = k.split(':'); return { blockId, itemIdx: +ii, side: side === 'b' ? null : side, setNo: +setNo }; };

function groups(sess) {
  const day = dayById(sess.dayId);
  const order = sess.plan || [...sess.sets.map(s => s.key), ...(sess.skipped || []).map(s => s.key)];
  const doneBy = Object.fromEntries(sess.sets.map(s => [s.key, s]));
  const skipBy = Object.fromEntries((sess.skipped || []).map(s => [s.key, s]));
  const out = new Map();
  // Group in plan order (block, then item), not in the order they were done.
  const blockIdx = id => day ? day.blocks.findIndex(b => b.id === id) : 0;
  const keys = [...order].sort((a, b) => { const x = parseKey(a), y = parseKey(b); return blockIdx(x.blockId) - blockIdx(y.blockId) || x.itemIdx - y.itemIdx; });
  for (const k of keys) {
    const p = parseKey(k);
    const g = `${p.blockId}:${p.itemIdx}`;
    const rec = doneBy[k] || skipBy[k];
    if (!rec) continue;
    if (!out.has(g)) {
      const block = day && day.blocks.find(b => b.id === p.blockId);
      out.set(g, { id: g, blockId: p.blockId, itemIdx: p.itemIdx, block, item: block && block.items[p.itemIdx], exId: rec.exId, swapFrom: rec.swapFrom || null, entries: [] });
    }
    out.get(g).entries.push({ key: k, ...p, done: !!doneBy[k], rec });
  }
  return [...out.values()];
}

function targetOf(g) {
  const it = g.item;
  if (!it) return '';
  if (it.sides) return `${it.sides.left.sets}×${it.sides.left.reps} ${r('left')} / ${it.sides.right.sets}×${it.sides.right.reps} ${r('right')}`;
  if (it.durationSec) return `${it.sets > 1 ? it.sets + ' × ' : ''}${it.durationSec >= 120 ? clock(it.durationSec) : it.durationSec + ' s'}`;
  return `${it.sets} × ${it.reps}`;
}

function setLine(e, isCircuit) {
  const s = e.rec;
  const side = e.side ? ` · ${r(e.side)}` : '';
  const lbl = `${isCircuit ? r('round') : r('set')} ${e.setNo}${side}`;
  if (!e.done) return `- ${lbl}: ${r('notDone')}`;
  const parts = [];
  if (s.durationSec) {
    parts.push(s.timerSec != null ? `${clock(s.timerSec)} ${r('timer')} (${r('plan')} ${clock(s.durationSec)})` : `${clock(s.durationSec)} (${r('noTimer')})`);
    if (s.pauses) parts.push(`${s.pauses} ${r('pauses')}`);
  } else {
    let reps = `${s.reps ?? '-'} ${r('reps')}`;
    if (s.target != null && s.reps != null && s.reps !== s.target) reps += ` (${r('tgt')} ${s.target})`;
    parts.push(s.weight != null ? `${reps} × ${kg(s.weight)}` : reps);
  }
  if (s.workSec != null) parts.push(`${r('time')} ${clock(s.workSec)}`);
  if (s.restSec != null) parts.push(`${r('restAfter')} ${clock(s.restSec)}${s.restTargetSec ? ` (${r('plan')} ${clock(s.restTargetSec)})` : ''}`);
  if (s.redone) parts.push(`${r('redone').toLowerCase()} ${s.redone}`);
  return `- ${lbl}: ${parts.join(' · ')}`;
}

function sideCompare(g) {
  const by = side => g.entries.filter(e => e.done && e.side === side).map(e => e.rec);
  const L_ = by('left'), R_ = by('right');
  if (!L_.length || !R_.length) return '';
  const bits = [];
  if (L_.some(s => s.reps != null)) bits.push(`${r('reps')} ${sum(L_.map(s => s.reps))} vs ${sum(R_.map(s => s.reps))}`);
  const wl = Math.max(0, ...L_.map(s => +s.weight || 0)), wr = Math.max(0, ...R_.map(s => +s.weight || 0));
  if (wl || wr) bits.push(`${r('maxW')} ${wl} vs ${wr} kg`);
  const tl = avg(L_.map(s => s.workSec)), tr = avg(R_.map(s => s.workSec));
  if (tl != null && tr != null) bits.push(`${r('avgT')} ${clock(tl)} vs ${clock(tr)}`);
  return bits.length ? `- ${r('lvr')}: ${bits.join(' · ')}` : '';
}

// Previous best weight per exercise, for "heavier than last time".
function previousMax(sess, exId) {
  const all = store.s.sessions;
  const idx = all.findIndex(s => s.id === sess.id);
  for (let i = (idx < 0 ? all.length : idx) - 1; i >= 0; i--) {
    const prev = all[i].sets.filter(s => s.exId === exId);
    if (prev.length) return Math.max(0, ...prev.map(s => +s.weight || 0));
  }
  return null;
}

export function buildReport(sess) {
  const day = dayById(sess.dayId);
  const name = id => L(data.ex[id]?.name) || id;
  const start = new Date(sess.start), end = new Date(sess.end);
  const dur = end - start;
  const work = sum(sess.sets.map(s => s.workSec)) * 1000, rest = sum(sess.sets.map(s => s.restSec)) * 1000;
  const hasTiming = sess.sets.some(s => s.workSec != null);
  const vol = sum(sess.sets.map(s => (s.weight && s.reps ? s.weight * s.reps : 0)));
  const total = sess.totalSteps || sess.sets.length;
  const dateTxt = start.toLocaleDateString(localeOf(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const hm = d => d.toLocaleTimeString(localeOf(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const gs = groups(sess);

  const lines = [];
  lines.push(`# ${r('title')}: ${day ? `${t('week', { n: day.week })} · ${t(day.weekday)}` : sess.dayId}`, '');
  lines.push(`- ${r('date')}: ${dateTxt}, ${hm(start)} - ${hm(end)}`);
  lines.push(`- ${r('duration')}: ${mins(dur)}${hasTiming ? ` (${mins(work)} ${r('work')}, ${mins(rest)} ${r('rest')}, ${mins(Math.max(0, dur - work - rest))} ${r('other')})` : ''}`);
  lines.push(`- ${r('place')}: ${r(sess.location === 'gym' ? 'gym' : 'home')}`);
  lines.push(`- ${r('sets')}: ${sess.sets.length}/${total} ${r('done')}${total > sess.sets.length ? `, ${total - sess.sets.length} ${r('skippedN')}` : ''}`);
  if (vol) lines.push(`- ${r('volume')}: ${Math.round(vol)} kg`);
  lines.push(`- ${r('rpe')}: ${sess.rpe ?? ''}`);
  const acts = (store.s.activities || []).filter(a => { const d = (start - new Date(a.date + 'T12:00')) / 86400000; return d > -0.5 && d <= 2.5; });
  lines.push(`- ${r('before')}: ${acts.length ? acts.map(a => `${t(a.type)} ${a.date}${a.min ? `, ${a.min} min` : ''}${a.km ? `, ${a.km} km` : ''}, ${t('effort_' + a.effort).toLowerCase()}`).join('; ') : r('none')}`);

  // Your notes go near the top so they are easy to reach on the phone.
  lines.push('', `## ${r('notes')}`, r('notesHint'), '');
  if (sess.notes) lines.push(sess.notes);
  else lines.push(`- ${r('sideNote')}: `, `- ${r('painNote')}: `, '- ');

  // Things worth acting on.
  const tune = [];
  const below = [];
  for (const g of gs) {
    const miss = g.entries.filter(e => e.done && e.rec.target != null && e.rec.reps != null && e.rec.reps < e.rec.target);
    if (miss.length) below.push(`${name(g.exId)} (${miss.map(e => `${e.side ? r(e.side) + ' ' : ''}${e.rec.reps}/${e.rec.target}`).join(', ')})`);
  }
  if (below.length) tune.push(`- ${r('below')}: ${below.join('; ')}`);
  const longRests = sess.sets.filter(s => s.restSec != null && s.restTargetSec && s.restSec > s.restTargetSec * 1.5 + 15);
  if (longRests.length) tune.push(`- ${r('longRest')}: ${longRests.length} (${longRests.map(s => `${name(s.exId)} ${clock(s.restSec)}`).slice(0, 5).join(', ')})`);
  const heavier = [];
  for (const id of new Set(sess.sets.map(s => s.exId))) {
    const now = Math.max(0, ...sess.sets.filter(s => s.exId === id).map(s => +s.weight || 0));
    const prev = previousMax(sess, id);
    if (now && prev != null && now > prev) heavier.push(`${name(id)} ${prev} → ${now} kg`);
  }
  if (heavier.length) tune.push(`- ${r('heavier')}: ${heavier.join('; ')}`);
  const skippedEx = gs.filter(g => g.entries.some(e => !e.done)).map(g => {
    const n = g.entries.filter(e => !e.done).length;
    return `${name(g.exId)} (${n}/${g.entries.length})`;
  });
  if (skippedEx.length) tune.push(`- ${r('skippedEx')}: ${skippedEx.join('; ')}`);
  const post = [...new Set((sess.events || []).filter(e => e.type === 'skip').map(e => e.exId))]
    .filter(id => sess.sets.some(s => s.exId === id) && !(sess.skipped || []).some(s => s.exId === id));
  if (post.length) tune.push(`- ${r('postponed')}: ${post.map(name).join('; ')}`);
  const redo = sess.sets.filter(s => s.redone);
  if (redo.length) tune.push(`- ${r('redone')}: ${[...new Set(redo.map(s => name(s.exId)))].join('; ')}`);
  if ((sess.events || []).some(e => e.type === 'resume')) tune.push(`- ${r('resumed')}`);
  if (tune.length) lines.push('', `## ${r('tune')}`, ...tune);

  lines.push('', `## ${r('exercises')}`);
  let lastBlock = null;
  for (const g of gs) {
    if (g.blockId !== lastBlock && g.block) {
      lines.push('', `### ${g.block.type === 'warmup' ? t('block_warmup') : L(g.block.name)}`);
      lastBlock = g.blockId;
    }
    const swap = g.swapFrom ? ` (${r('insteadOf')} ${name(g.swapFrom)})` : '';
    const tg = targetOf(g);
    lines.push('', `**${name(g.exId)}**${swap}${tg ? ` · ${r('target')} ${tg}` : ''}`);
    const isCircuit = g.block && g.block.type === 'circuit';
    if (!g.entries.some(e => e.done)) lines.push(`- ${r('notDoneAll').replace('{n}', g.entries.length)}`);
    else for (const e of g.entries) lines.push(setLine(e, isCircuit));
    const cmp = sideCompare(g);
    if (cmp) lines.push(cmp);
  }

  return lines.join('\n') + '\n';
}

// Pull your own words back out of the edited report.
export function parseReport(md) {
  const out = { notes: '', rpe: null };
  const m = md.match(/RPE 1-10\)\s*:\s*(\d+(?:[.,]\d)?)/);
  if (m) { const v = +m[1].replace(',', '.'); if (v >= 1 && v <= 10) out.rpe = v; }
  const lines = md.split('\n');
  const i = lines.findIndex(l => NOTES_HEADS.some(h => l.trim() === `## ${h}`));
  if (i >= 0) {
    let end = lines.findIndex((l, j) => j > i && /^## /.test(l));
    if (end < 0) end = lines.length;
    const body = lines.slice(i + 1, end).filter(l => !Object.values(R).some(x => l.trim() === x.notesHint));
    // Drop empty template lines like "- Pain or discomfort:" but keep filled ones.
    out.notes = body.filter(l => !/^- [^:]+:\s*$/.test(l) && l.trim() !== '-').join('\n').trim();
    const sides = body.find(l => Object.values(R).some(x => l.startsWith(`- ${x.sideNote}:`)));
    const pain = body.find(l => Object.values(R).some(x => l.startsWith(`- ${x.painNote}:`)));
    out.sideNote = sides ? sides.split(':').slice(1).join(':').trim() : '';
    out.painNote = pain ? pain.split(':').slice(1).join(':').trim() : '';
  }
  return out;
}

// Set the RPE line in an existing report without touching the rest.
export function setReportRPE(md, rpe) {
  return md.replace(/(RPE 1-10\)\s*:)[^\n]*/, `$1 ${rpe ?? ''}`);
}

// Structured record for analysis. One object per session.
export function buildJSON(sess) {
  const name = id => data.ex[id]?.name?.en || id;
  const gs = groups(sess);
  return {
    schema: 'kanitrain.session/1',
    id: sess.id,
    dayId: sess.dayId,
    week: dayById(sess.dayId)?.week ?? null,
    weekday: dayById(sess.dayId)?.weekday ?? null,
    start: sess.start,
    end: sess.end,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    durationSec: Math.round((new Date(sess.end) - new Date(sess.start)) / 1000),
    location: sess.location || null,
    rpe: sess.rpe ?? null,
    notes: sess.notes || '',
    sideNote: sess.sideNote || '',
    painNote: sess.painNote || '',
    setsDone: sess.sets.length,
    setsPlanned: sess.totalSteps || sess.sets.length,
    settings: sess.settings || null,
    exercises: gs.map(g => {
      const done = g.entries.filter(e => e.done).map(e => e.rec);
      const per = side => {
        const s = done.filter(x => (x.side || null) === side);
        if (!s.length) return null;
        return { sets: s.length, reps: sum(s.map(x => x.reps)), maxWeight: Math.max(0, ...s.map(x => +x.weight || 0)) || null, avgWorkSec: avg(s.map(x => x.workSec)) };
      };
      return {
        exId: g.exId, name: name(g.exId), swapFrom: g.swapFrom, block: g.blockId, blockType: g.block?.type || null,
        target: g.item ? { sets: g.item.sets ?? null, reps: g.item.reps ?? null, durationSec: g.item.durationSec ?? null, sides: g.item.sides ?? null, per: g.item.per ?? null } : null,
        setsPlanned: g.entries.length, setsDone: done.length,
        bySide: { left: per('left'), right: per('right'), both: per(null) },
        sets: g.entries.map(e => ({
          key: e.key, setNo: e.setNo, side: e.side, done: e.done,
          ...(e.done ? {
            reps: e.rec.reps ?? null, targetReps: e.rec.target ?? null, weight: e.rec.weight ?? null,
            durationSec: e.rec.durationSec ?? null, timerSec: e.rec.timerSec ?? null, pauses: e.rec.pauses || 0,
            workSec: e.rec.workSec ?? null, restSec: e.rec.restSec ?? null, restPlannedSec: e.rec.restTargetSec ?? null,
            redone: e.rec.redone || 0, doneAt: e.rec.at,
          } : {}),
        })),
      };
    }),
    events: sess.events || [],
  };
}

// File names for the sync repo: workouts/2026/2026-11-25-180512-w1-mon.md
export function reportPath(sess) {
  const d = new Date(sess.start);
  const p = n => String(n).padStart(2, '0');
  return `workouts/${d.getFullYear()}/${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${sess.dayId}`;
}

// Keep the notes you already wrote when the report is rebuilt.
export function keepNotes(oldMd, newMd) {
  const range = md => {
    const ls = md.split('\n');
    const a = ls.findIndex(l => NOTES_HEADS.some(h => l.trim() === `## ${h}`));
    if (a < 0) return null;
    let b = ls.findIndex((l, j) => j > a && /^## /.test(l));
    if (b < 0) b = ls.length;
    return { ls, a, b };
  };
  const o = range(oldMd), n = range(newMd);
  if (!o || !n) return newMd;
  const oldSec = o.ls.slice(o.a, o.b);
  while (oldSec.length && oldSec[oldSec.length - 1].trim() === '') oldSec.pop();
  return [...n.ls.slice(0, n.a), ...oldSec, '', ...n.ls.slice(n.b)].join('\n');
}
