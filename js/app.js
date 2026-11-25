import { t, L, setLang, getLang, LANGS } from './i18n.js';
import { store, requestPersistence } from './store.js';
import {
  data, loadData, allDays, dayById, weekCount, buildSteps, estimateMinutes, exerciseIdsOf, exerciseHistory,
  lastValuesFor, muscleLastTrained, recentRunFor, actTime, daysSince, freshness, topMuscles, weekDays, doneInCurrentCycle,
  suggestedDay, isLowerUnilateral, lastSessionFor, resolveItem, homeReport, equipmentNeeded,
} from './plan.js';
import { mountVideo } from './video.js';
import { buildReport, parseReport, setReportRPE, keepNotes } from './report.js';
import { sync } from './sync.js';
import { unlockAudio, sound, buzz, keepAwake, isStandalone, isIOS } from './device.js';

export const BUILD = '2026-11-25a';
const $app = document.getElementById('app');
const $sheet = document.getElementById('sheet');

const ui = {
  screen: 'home',       // home | workout | summary | history | settings
  dayId: null,          // day shown on home
  sheet: null,          // {type:'ex', exId, item} | {type:'days'} | {type:'steps'} | {type:'menu'}
  summaryId: null,
  draft: null,          // {key, reps, weight}
  toast: null,
};

// ---------- helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const muscleName = m => L(data.tax.muscles[m] || data.tax.mobilityTargets[m]) || m;
const equipName = q => L(data.tax.equipment[q]) || q;
const fmtClock = sec => { sec = Math.max(0, Math.ceil(sec)); const m = Math.floor(sec / 60); const s = sec % 60; return `${m}:${String(s).padStart(2, '0')}`; };
const fmtDur = ms => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
const fmtDate = iso => new Date(iso).toLocaleDateString(getLang() === 'es' ? 'es-UY' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short' });
function rel(ts) {
  const d = daysSince(ts);
  if (d == null) return t('never');
  if (d === 0) return t('todayShort');
  if (d === 1) return t('yesterday');
  return t('daysAgo', { n: d });
}
const dayTitle = d => `${t('week', { n: d.week })} · ${t(d.weekday)}`;
const perLabel = p => ({ side: t('perSide'), leg: t('perLeg'), arm: t('perArm'), step: t('perStep') }[p] || '');
const fmtW = w => (w == null || w === '' ? '' : `${+w} ${t('kg')}`);

function presc(item) {
  const per = item.per ? ` ${perLabel(item.per)}` : '';
  if (item.sides) {
    const l = item.sides.left, r = item.sides.right;
    return `${l.sets}×${l.reps} ${t('left').charAt(0)} / ${r.sets}×${r.reps} ${t('right').charAt(0)}`;
  }
  if (item.durationSec) {
    const d = item.durationSec >= 120 ? `${Math.round(item.durationSec / 60)} ${t('min')}` : `${item.durationSec} s`;
    return item.sets > 1 ? `${item.sets} × ${d}${per}` : d;
  }
  return `${item.sets} × ${item.reps}${per}`;
}


function showToast(msg) {
  ui.toast = msg;
  render();
  setTimeout(() => { if (ui.toast === msg) { ui.toast = null; render(); } }, 2600);
}

// ---------- render root ----------
function render() {
  const s = ui.screen;
  let html = '';
  if (s === 'home') html = renderHome();
  else if (s === 'workout') html = renderWorkout();
  else if (s === 'summary') html = renderSummary();
  else if (s === 'history') html = renderHistory();
  else if (s === 'settings') html = renderSettings();
  if (['home', 'history', 'settings'].includes(s)) {
    if (ui.updateReady) html = `<button class="update-bar" data-a="reload">${t('updateReady')}</button>` + html;
    html += renderTabs();
  }
  if (ui.toast) html += `<div class="toast">${esc(ui.toast)}</div>`;
  $app.innerHTML = html;
  if ($app.dataset.screen !== s) window.scrollTo(0, 0);
  $app.dataset.screen = s;
  renderSheet();
}

function renderTabs() {
  const tab = (id, label, icon) => `<button class="tab ${ui.screen === id ? 'on' : ''}" data-a="go" data-to="${id}">${icon}<span>${label}</span></button>`;
  return `<nav class="tabs">
    ${tab('home', t('today'), ICON.today)}
    ${tab('history', t('history'), ICON.history)}
    ${tab('settings', t('settings'), ICON.settings)}
  </nav>`;
}

// ---------- home ----------
function renderHome() {
  const day = dayById(ui.dayId) || suggestedDay();
  ui.dayId = day.id;
  const active = store.s.active;
  const lastMap = muscleLastTrained();
  const last = lastSessionFor(day.id);
  const nEx = exerciseIdsOf(day).length;
  const install = isIOS() && !isStandalone() ? `<div class="card hint"><b>${t('installTitle')}</b><p>${t('installBody')}</p></div>` : '';

  const resume = active ? `<div class="card resume">
      <div><b>${t('resume')}</b><p class="muted">${esc(dayTitle(dayById(active.dayId)))} · ${t('resumeHint', { when: rel(active.start) })}</p></div>
      <div class="row"><button class="btn ghost" data-a="discard">${t('discard')}</button><button class="btn primary" data-a="resume">${t('resume')}</button></div>
    </div>` : '';

  const muscles = topMuscles(day, 6).map(m => `<span class="chip">${esc(muscleName(m))}<small>${rel(lastMap[m])}</small></span>`).join('');
  const loc = store.settings().location;
  const orWord = ` ${getLang() === 'es' ? 'o' : 'or'} `;
  const equip = equipmentNeeded(day).map(g => `<li class="${loc === 'home' ? (g.owned ? 'have' : 'need') : ''}">${esc(g.types.map(equipName).join(orWord))}${g.optional ? ` <small>(${t('optional')})</small>` : ''}</li>`).join('');
  const report = loc === 'home' ? homeReport(day) : null;
  const locSeg = `<div class="seg loc">${[['home', t('atHome')], ['gym', t('atGym')]].map(([v, l]) => `<button class="${loc === v ? 'on' : ''}" data-a="set" data-k="location" data-v="${v}">${l}</button>`).join('')}</div>`;
  const gymCard = report && report.gymBetter ? `<div class="card gym-hint"><b>${t('betterAtGym')}</b>
      <ul class="plain">${report.missing.map(m => `<li>${esc(L(data.ex[m.exId].name))}: ${t('needs')} ${esc(m.needs.map(g => g.map(equipName).join(orWord)).join(', '))}</li>`).join('')}
      ${report.partial.map(sw => `<li>${esc(L(data.ex[sw.from].name))} → ${esc(L(data.ex[sw.to].name))}: ${esc(L(sw.note))}</li>`).join('')}</ul>
      <button class="btn ghost small" data-a="set" data-k="location" data-v="gym">${t('switchToGym')}</button></div>` : '';
  const swapLine = report && report.swaps.length && !report.gymBetter ? `<p class="muted small home-ok">${t('homeSwaps', { n: report.swaps.length })}</p>` : '';
  const run = recentRunFor(day);
  const runCard = run ? `<div class="card run-hint"><p>${t('ranHint', { when: rel(actTime(run)).toLowerCase(), effort: t('effort_' + run.effort).toLowerCase() })}</p>
      <button class="btn ghost small" data-a="days">${t('changeDay')}</button></div>` : '';

  const blocks = day.blocks.map(b => {
    const title = b.type === 'warmup' ? t('block_warmup') : L(b.name);
    const rows = b.items.map((item, ii) => {
      const r = resolveItem(item);
      const ex = data.ex[r.exId];
      const sub = r.swap ? `<small class="swap ${r.swap.reason === 'load' ? 'good' : r.swap.fit}">${t('insteadOf', { name: L(data.ex[r.swap.from].name) })}</small>`
        : r.missing.length ? `<small class="swap missing">${t('needs')} ${esc(r.missing.map(g => g.map(equipName).join(orWord)).join(', '))}</small>` : '';
      return `<button class="ex-row" data-a="ex" data-ex="${ex.id}" data-block="${b.id}" data-item="${ii}">
        <span class="ex-name">${esc(L(ex.name))}${ex.videos.length ? ICON.play : ''}${sub}</span>
        <span class="ex-presc">${esc(presc(item))}</span>
      </button>`;
    }).join('');
    return `<section class="block${b.extra ? ' extra' : ''}"><h3>${esc(title)}</h3>${rows}</section>`;
  }).join('');

  return `<main class="home">
    <header class="top">
      <div>
        <p class="eyebrow">${day.id === suggestedDay().id ? t('upNext') : t('pickDay')}</p>
        <h1>${esc(dayTitle(day))}</h1>
        <p class="muted">${t('estTime', { min: estimateMinutes(day) })} · ${t('exercises', { n: nEx })} · ${last ? t('doneOn', { when: rel(last.start) }) : t('notDone')}</p>
      </div>
      <button class="btn ghost small" data-a="days">${t('changeDay')}</button>
    </header>
    ${install}${resume}
    ${runCard}${locSeg}${gymCard}${swapLine}
    <section class="card"><h2>${t('muscles')}</h2><div class="chips">${muscles}</div>
      <button class="btn ghost small log-act" data-a="log-act">+ ${t('logActivity')}</button></section>
    <section class="card"><h2>${t('equipment')}</h2><ul class="equip">${equip}</ul></section>
    <section class="card plan">${blocks}</section>
    <div class="start-bar"><button class="btn primary big" data-a="start" ${active ? 'disabled' : ''}>${t('start')}</button></div>
  </main>`;
}

// ---------- sheets ----------
function renderSheet() {
  const sh = ui.sheet;
  if (!sh) {
    $sheet.innerHTML = ''; $sheet.className = ''; delete $sheet.dataset.key; document.body.classList.remove('locked');
    return;
  }
  let body = '';
  if (sh.type === 'ex') body = renderExSheet(sh);
  else if (sh.type === 'days') body = renderDaysSheet();
  else if (sh.type === 'steps') body = renderStepsSheet();
  else if (sh.type === 'menu') body = renderMenuSheet();
  else if (sh.type === 'activity') body = renderActivitySheet();
  // Keep an open video iframe alive across re-renders.
  const keepScroll = $sheet.querySelector('.sheet-body')?.scrollTop || 0;
  if ($sheet.dataset.key === JSON.stringify(sh) && $sheet.innerHTML) return;
  $sheet.dataset.key = JSON.stringify(sh);
  $sheet.className = 'open';
  document.body.classList.add('locked');
  $sheet.innerHTML = `<div class="scrim" data-a="close"></div>
    <div class="sheet" role="dialog">
      <div class="sheet-head" data-drag><div class="grab"></div>
        <button class="close" data-a="close" aria-label="${t('close')}">${ICON.x}</button></div>
      <div class="sheet-body">${body}
        <button class="btn ghost sheet-done" data-a="close">${t('close')}</button></div></div>`;
  $sheet.querySelector('.sheet-body').scrollTop = keepScroll;
}

function renderExSheet({ exId, blockId, itemIdx, dayId }) {
  const ex = data.ex[exId];
  const day = dayById(dayId);
  const item = day && blockId != null ? day.blocks.find(b => b.id === blockId)?.items[itemIdx] : null;
  const v = ex.videos[0];
  const lastMap = muscleLastTrained();
  const prim = ex.muscles.primary.map(m => `<span class="chip strong">${esc(muscleName(m))}</span>`).join('');
  const sec = ex.muscles.secondary.map(m => `<span class="chip">${esc(muscleName(m))}</span>`).join('');
  const mob = (ex.mobilityTargets || []).map(m => `<span class="chip">${esc(muscleName(m))}</span>`).join('');
  const equip = ex.equipment.map(g => g.anyOf.filter(q => q !== 'none').map(equipName).join(` ${getLang() === 'es' ? 'o' : 'or'} `)).filter(Boolean).join(', ');
  const steps = (L(ex.instructions) || []).map(s => `<li>${esc(s)}</li>`).join('');
  const cues = (L(ex.cues) || []).map(s => `<li>${esc(s)}</li>`).join('');
  const hist = exerciseHistory(exId, 4).map(h => `<li><span class="muted">${fmtDate(h.date)}</span> ${h.sets.map(s =>
    `${s.side ? (s.side === 'left' ? 'L ' : 'R ') : ''}${s.weight ? `${+s.weight}×` : ''}${s.reps ?? (s.durationSec ? s.durationSec + 's' : '')}`).join(', ')}</li>`).join('');
  const video = v ? `<div class="video" id="video" data-yt="${esc(v.youtubeId)}" data-start="${v.startSec || 0}" data-end="${v.endSec || ''}">
      <button class="btn primary" data-a="video">${ICON.play} ${t('watchVideo')}</button>
      <p class="muted small">${esc(v.title || '')}${v.channel ? ' · ' + esc(v.channel) : ''}</p>
      <a class="link" href="https://www.youtube.com/watch?v=${esc(v.youtubeId)}${v.startSec ? '&t=' + v.startSec + 's' : ''}" target="_blank" rel="noopener">${t('openYoutube')}</a>
    </div>` : `<p class="muted">${t('noVideo')}</p>`;
  const leftFirst = isLowerUnilateral(ex) ? `<p class="badge-left">${t('leftFirst')}</p>` : '';
  const res = item ? resolveItem(item) : null;
  const swapNote = res && res.swap ? `<p class="swap-note"><b>${t('homeSwap')}</b> ${t('insteadOf', { name: L(data.ex[res.swap.from].name) })}. ${esc(L(res.swap.note))}</p>` : '';
  return `<h2 class="sheet-title">${esc(L(ex.name))}</h2>
    ${item ? `<p class="presc-line">${t('prescription')}: <b>${esc(presc(item))}</b>${item.note ? ` · ${esc(item.note)}` : ''}</p>` : ''}
    ${swapNote}${leftFirst}
    ${video}
    <div class="chips">${prim}${sec}${mob}</div>
    ${equip ? `<p class="muted">${t('equipment')}: ${esc(equip)}</p>` : ''}
    <h3>${t('howTo')}</h3><ol class="steps">${steps}</ol>
    ${cues ? `<h3>${t('cues')}</h3><ul class="cues">${cues}</ul>` : ''}
    <h3>${t('history')}</h3>${hist ? `<ul class="hist">${hist}</ul>` : `<p class="muted">${t('noHistory')}</p>`}
    <h3>${t('notes')}</h3>
    <textarea class="notes" data-note="${ex.id}" placeholder="${t('notesPh')}">${esc(store.s.notes[ex.id] || '')}</textarea>
    <p class="muted tiny">${t('reviewFlag')} · ${esc(ex.sourceName)}</p>`;
}

function renderDaysSheet() {
  const lastMap = muscleLastTrained();
  const week = store.settings().week;
  const row = d => {
    const f = Math.round(freshness(d, lastMap) * 100);
    const done = doneInCurrentCycle(d.id);
    const chips = topMuscles(d, 4).map(m => `<span class="chip">${esc(muscleName(m))}<small>${rel(lastMap[m])}</small></span>`).join('');
    return `<button class="day-row ${d.id === ui.dayId ? 'on' : ''}" data-a="pickday" data-day="${d.id}">
      <div class="day-head"><b>${esc(dayTitle(d))}</b>${done ? `<span class="done-badge">${ICON.check}</span>` : ''}${store.settings().location === 'home' && homeReport(d).gymBetter ? `<span class="gym-badge">${t('gymBadge')}</span>` : ''}<span class="fresh" style="--f:${f}%">${t('freshness', { pct: f })}</span></div>
      <div class="chips">${chips}</div></button>`;
  };
  const sortF = arr => arr.map(d => [d, freshness(d, lastMap) - (doneInCurrentCycle(d.id) ? 1 : 0)]).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  const thisW = sortF(weekDays(week)).map(row).join('');
  const others = sortF(allDays().filter(d => d.week !== week)).map(row).join('');
  return `<h2 class="sheet-title">${t('pickDay')}</h2><p class="muted">${t('sortedHint')}</p>
    <h3>${t('thisWeek')}</h3>${thisW}<h3>${t('otherWeeks')}</h3>${others}`;
}

// ---------- workout engine ----------
let steps = [], stepMap = {};
function loadSteps(dayId, location) { steps = buildSteps(dayById(dayId), location); stepMap = Object.fromEntries(steps.map(s => [s.key, s])); }

function startWorkout() {
  unlockAudio();
  const day = dayById(ui.dayId);
  const location = store.settings().location;
  loadSteps(day.id, location);
  store.setActive({
    id: 's' + Date.now(), dayId: day.id, start: new Date().toISOString(),
    location, order: steps.map(s => s.key), plan: steps.map(s => s.key), pos: 0, done: {}, phase: 'work', restEnd: null, restTotal: 0,
    timer: null, workAt: Date.now(), rest: null, redos: {}, events: [],
  });
  ui.draft = null;
  ui.screen = 'workout';
  keepAwake(true);
  requestPersistence();
  render();
}

function resumeWorkout() {
  unlockAudio();
  const a = store.s.active;
  loadSteps(a.dayId, a.location || 'gym');
  a.order = a.order.filter(k => stepMap[k]);
  logEvent('resume');
  store.setActive(a);
  ui.screen = 'workout';
  keepAwake(true);
  render();
}

const A = () => store.s.active;
// Timing for the report: when the current set started, and the rest after each set.
function logEvent(type, extra = {}) { const a = A(); (a.events ||= []).push({ type, at: new Date().toISOString(), ...extra }); }
function endRest(at = Date.now()) {
  const a = A();
  if (a.rest && a.done[a.rest.key]) {
    a.done[a.rest.key].restSec = Math.max(0, Math.round((at - a.rest.start) / 1000));
    a.done[a.rest.key].restTargetSec = a.restTotal;
  }
  a.rest = null; a.phase = 'work'; a.restEnd = null; a.workAt = at;
}
const cur = () => stepMap[A().order[A().pos]];
function nextKeyAfter(pos) { const a = A(); for (let i = pos + 1; i < a.order.length; i++) if (!a.done[a.order[i]]) return a.order[i]; return null; }

function draftFor(step) {
  if (ui.draft && ui.draft.key === step.key) return ui.draft;
  const a = A();
  if (a.draft && a.draft.key === step.key) return (ui.draft = a.draft);
  const prev = a.done[step.key];
  // Weight: this set if redone, else the latest set of this exercise today (same side first), else last session.
  const today = Object.entries(a.done).filter(([k]) => stepMap[k]?.exId === step.exId && a.done[k].weight != null)
    .sort((x, y) => x[1].at.localeCompare(y[1].at));
  const todaySame = today.filter(([k]) => stepMap[k].side === step.side);
  const pick = arr => arr.length ? arr[arr.length - 1][1].weight : null;
  const last = lastValuesFor(step);
  ui.draft = {
    key: step.key,
    reps: prev?.reps ?? step.reps ?? null,
    weight: prev?.weight ?? pick(todaySame) ?? pick(today) ?? last?.weight ?? null,
  };
  return ui.draft;
}

function completeStep(extra = {}) {
  const a = A();
  const step = cur();
  if (!step) return;
  const d = draftFor(step);
  const now = Date.now();
  const tm = a.timer;
  let timerSec = null;
  if (step.durationSec && tm) timerSec = Math.round(step.durationSec - Math.max(0, tm.running ? (tm.endAt - now) / 1000 : tm.remaining));
  a.done[step.key] = {
    reps: step.durationSec ? null : d.reps, weight: step.weighted ? d.weight : null,
    durationSec: step.durationSec || null, at: new Date(now).toISOString(),
    target: step.durationSec ? null : (step.reps ?? null), swapFrom: step.swapFrom || null,
    workSec: a.workAt ? Math.round((now - a.workAt) / 1000) : null,
    ...(step.durationSec ? { timerSec, pauses: (tm && tm.pauses) || 0 } : {}),
    ...(a.redos && a.redos[step.key] ? { redone: a.redos[step.key] } : {}),
    ...extra,
  };
  a.timer = null;
  ui.draft = null; a.draft = null;
  // advance to next not-done step
  let p = a.pos + 1;
  while (p < a.order.length && a.done[a.order[p]]) p++;
  a.pos = p;
  if (p >= a.order.length) { store.setActive(a); finishWorkout(); return; }
  const rest = step.restAfter || 0;
  if (rest > 0) { a.phase = 'rest'; a.restTotal = rest; a.restEnd = now + rest * 1000; a.rest = { key: step.key, start: now }; }
  else { a.phase = 'work'; a.workAt = now; }
  store.setActive(a);
  sound.tap();
  render();
}

function goBack() {
  const a = A();
  if (a.phase === 'rest') { a.phase = 'work'; a.restEnd = null; a.rest = null; }
  a.workAt = Date.now();
  // previous step in order that is done
  let p = a.pos - 1;
  while (p >= 0 && !a.done[a.order[p]]) p--;
  if (p < 0) { store.setActive(a); render(); return; }
  const key = a.order[p];
  const prev = a.done[key];
  delete a.done[key];
  (a.redos ||= {})[key] = (a.redos[key] || 0) + 1;
  logEvent('back', { key, exId: stepMap[key].exId });
  a.pos = p;
  a.timer = null;
  ui.draft = a.draft = { key, reps: prev.reps ?? stepMap[key].reps, weight: prev.weight };
  store.setActive(a);
  render();
}

function skipExercise() {
  // Move this exercise's remaining steps (same block + item) to the end.
  const a = A();
  const step = cur();
  const same = k => { const s = stepMap[k]; return s.blockId === step.blockId && s.itemIdx === step.itemIdx; };
  const before = a.order.slice(0, a.pos);
  const rest = a.order.slice(a.pos);
  const moved = rest.filter(k => same(k) && !a.done[k]);
  const keep = rest.filter(k => !moved.includes(k));
  if (!keep.some(k => !a.done[k])) { showToast(t('skipHint')); return; }
  a.order = [...before, ...keep, ...moved];
  logEvent('skip', { key: step.key, exId: step.exId, sets: moved.length });
  a.phase = 'work'; a.timer = null; ui.draft = null; a.workAt = Date.now();
  store.setActive(a);
  ui.sheet = null;
  render();
}

function jumpTo(key) {
  const a = A();
  if (a.done[key]) return;
  a.order = a.order.filter(k => k !== key);
  a.order.splice(a.pos, 0, key);
  if (a.phase === 'rest') endRest();
  logEvent('jump', { key, exId: stepMap[key].exId });
  a.phase = 'work'; a.timer = null; ui.draft = null; a.workAt = Date.now();
  store.setActive(a);
  ui.sheet = null;
  render();
}

function finishWorkout() {
  const a = A();
  if (a.phase === 'rest') endRest();
  logEvent('finish');
  const sets = a.order.filter(k => a.done[k]).map(k => {
    const s = stepMap[k]; const d = a.done[k];
    return { key: k, exId: s.exId, side: s.side, setNo: s.setNo, blockId: s.blockId, ...d };
  }).sort((x, y) => x.at.localeCompare(y.at));
  const total = a.order.length;
  const skipped = (a.plan || a.order).filter(k => !a.done[k] && stepMap[k]).map(k => {
    const s = stepMap[k];
    return { key: k, exId: s.exId, side: s.side, setNo: s.setNo, blockId: s.blockId, target: s.reps ?? null, durationSec: s.durationSec || null, swapFrom: s.swapFrom || null };
  });
  const st = store.settings();
  const sess = {
    id: a.id, dayId: a.dayId, start: a.start, end: new Date().toISOString(),
    sets, totalSteps: total, partial: sets.length < total / 2, notes: '',
    location: a.location || 'gym', plan: a.plan || a.order, skipped, events: a.events || [], rpe: null,
    settings: { restStrength: st.restStrength, restCircuit: st.restCircuit, restSides: st.restSides, extraCalves: st.extraCalves, extraAnkles: st.extraAnkles, extraPogo: st.extraPogo },
  };
  sess.report = buildReport(sess);
  store.addSession(sess);
  store.setActive(null);
  keepAwake(false);
  sound.end();
  checkWeekAdvance();
  ui.summaryId = sess.id;
  ui.summaryFrom = 'home';
  ui.screen = 'summary';
  ui.dayId = null;
  render();
}

function checkWeekAdvance() {
  const st = store.settings();
  const days = weekDays(st.week);
  if (days.every(d => doneInCurrentCycle(d.id))) {
    const next = st.week >= weekCount() ? 1 : st.week + 1;
    store.s.weekStartedAt = new Date().toISOString();
    store.setSetting('week', next);
    setTimeout(() => showToast(t('weekDone', { n: days[0].week, m: next })), 400);
  }
}

// ---------- workout view ----------
function renderWorkout() {
  const a = A();
  if (!a) { ui.screen = 'home'; return renderHome(); }
  const day = dayById(a.dayId);
  const doneCount = Object.keys(a.done).length;
  const pct = Math.round(doneCount / a.order.length * 100);
  const step = cur();
  const ex = data.ex[step.exId];
  const top = `<header class="wo-top">
      <button class="icon-btn" data-a="menu" aria-label="menu">${ICON.dots}</button>
      <div class="wo-progress"><div class="bar"><i style="width:${pct}%"></i></div>
        <span class="muted small">${doneCount}/${a.order.length} · <span data-elapsed>${fmtClock((Date.now() - new Date(a.start)) / 1000)}</span></span></div>
      <button class="icon-btn" data-a="steps" aria-label="${t('allSteps')}">${ICON.list}</button>
    </header>`;

  if (a.phase === 'rest') {
    const left = (a.restEnd - Date.now()) / 1000;
    const nx = step;
    const nex = data.ex[nx.exId];
    return `<main class="workout rest">${top}
      <div class="rest-wrap">
        <p class="eyebrow">${t('rest')}</p>
        <div class="ring" style="--p:${Math.max(0, left / a.restTotal)}"><span data-rest>${fmtClock(left)}</span></div>
        <div class="row center"><button class="btn ghost" data-a="rest-add" data-d="-15">−15 s</button><button class="btn ghost" data-a="rest-add" data-d="15">+15 s</button></div>
        <div class="card next-card" data-a="ex" data-ex="${nex.id}" data-block="${nx.blockId}" data-item="${nx.itemIdx}">
          <p class="eyebrow">${t('nextUp')}</p>
          <b>${esc(L(nex.name))}</b>
          <p class="muted">${esc(stepLabel(nx))}${nx.side ? ` · ${t(nx.side)}` : ''} · ${esc(targetText(nx))}</p>
        </div>
      </div>
      <footer class="wo-actions"><button class="btn ghost" data-a="back">${t('back')}</button>
        <button class="btn primary big" data-a="skiprest">${t('skipRest')}</button></footer>
    </main>`;
  }

  const d = draftFor(step);
  const last = lastValuesFor(step);
  const lastTxt = last ? t('lastTime', { v: `${last.weight ? fmtW(last.weight) + ' × ' : ''}${last.reps ?? (last.durationSec ? last.durationSec + ' s' : '')}` }) : (step.weighted ? t('firstTime') : '');
  const blockTitle = step.blockType === 'warmup' ? t('block_warmup') : L(step.blockName);
  const showLeftFirst = isLowerUnilateral(ex) && (step.side === 'left' && step.setNo === 1 || (!step.side && step.per === 'side'));
  const sideBadge = step.side ? `<span class="side ${step.side}">${t(step.side)}</span>` : '';

  let center;
  if (step.durationSec) {
    const tm = a.timer;
    const remaining = tm ? (tm.running ? (tm.endAt - Date.now()) / 1000 : tm.remaining) : step.durationSec;
    const btn = !tm ? `<button class="btn primary" data-a="timer-start">${ICON.play} ${t('startTimer')}</button>`
      : tm.running ? `<button class="btn ghost" data-a="timer-pause">${t('pause')}</button>`
        : `<button class="btn primary" data-a="timer-start">${t('resumeTimer')}</button>`;
    center = `<div class="ring big" style="--p:${Math.max(0, remaining / step.durationSec)}"><span data-timer>${fmtClock(remaining)}</span></div>
      <div class="row center">${btn}</div>`;
  } else {
    const per = step.per && !step.side ? ` <small>${perLabel(step.per)}</small>` : '';
    center = `<div class="target"><div class="stepper">
        <button class="step-btn" data-a="reps" data-d="-1">−</button>
        <div class="num"><b>${d.reps ?? '-'}</b><span>${t('reps')}${per}</span></div>
        <button class="step-btn" data-a="reps" data-d="1">+</button></div>
      ${step.weighted ? `<div class="stepper weight">
        <button class="step-btn" data-a="weight" data-d="-1">−</button>
        <button class="num" data-a="weight-edit"><b>${d.weight ?? '-'}</b><span>${t('kg')}</span></button>
        <button class="step-btn" data-a="weight" data-d="1">+</button></div>` : ''}
    </div>`;
  }

  const dots = Array.from({ length: step.totalSets }, (_, i) => {
    const k = steps.find(s => s.blockId === step.blockId && s.itemIdx === step.itemIdx && s.side === step.side && s.setNo === i + 1)?.key;
    return `<i class="${k && a.done[k] ? 'd' : ''} ${i + 1 === step.setNo ? 'c' : ''}"></i>`;
  }).join('');

  return `<main class="workout">${top}
    <div class="wo-body">
      <p class="eyebrow">${esc(blockTitle)}${step.round ? ` · ${t('roundOf', { n: step.round, total: step.rounds })}` : ''}${step.swapFrom ? ` · ${t('homeSwap')}` : ''}</p>
      <button class="wo-name" data-a="ex" data-ex="${ex.id}" data-block="${step.blockId}" data-item="${step.itemIdx}">
        ${esc(L(ex.name))} <span class="info">${ICON.info}</span></button>
      <div class="set-line">${sideBadge}<span>${t('setOf', { n: step.setNo, total: step.totalSets })}</span><span class="dots">${dots}</span></div>
      ${showLeftFirst ? `<p class="badge-left">${t('leftFirst')}</p>` : ''}
      ${center}
      ${lastTxt ? `<p class="muted center">${esc(lastTxt)}</p>` : ''}
      ${step.note ? `<p class="note">${esc(step.note)}</p>` : ''}
      ${(L(ex.cues) || []).length ? `<ul class="cues compact">${L(ex.cues).slice(0, 3).map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    </div>
    <footer class="wo-actions">
      <button class="btn ghost" data-a="back" ${Object.keys(a.done).length ? '' : 'disabled'}>${t('back')}</button>
      <button class="btn primary big" data-a="done">${t('done')}</button>
      <button class="btn ghost" data-a="skip">${t('skip')}</button>
    </footer>
  </main>`;
}

function stepLabel(s) { return s.round ? t('roundOf', { n: s.round, total: s.rounds }) : t('setOf', { n: s.setNo, total: s.totalSets }); }
function targetText(s) {
  if (s.durationSec) return `${s.durationSec >= 120 ? Math.round(s.durationSec / 60) + ' ' + t('min') : s.durationSec + ' s'}`;
  return `${s.reps} ${t('reps')}${s.per && !s.side ? ' ' + perLabel(s.per) : ''}`;
}

function renderStepsSheet() {
  const a = A();
  let lastBlock = null;
  const rows = a.order.map((k, i) => {
    const s = stepMap[k]; const ex = data.ex[s.exId];
    const hdr = s.blockId !== lastBlock ? `<h3>${esc(s.blockType === 'warmup' ? t('block_warmup') : L(s.blockName))}</h3>` : '';
    lastBlock = s.blockId;
    const st = a.done[k] ? 'done' : i === a.pos ? 'cur' : '';
    const val = a.done[k] ? `${a.done[k].weight ? fmtW(a.done[k].weight) + ' × ' : ''}${a.done[k].reps ?? ''}` : targetText(s);
    return `${hdr}<button class="step-row ${st}" data-a="jump" data-key="${k}" ${a.done[k] ? 'disabled' : ''}>
      <span>${a.done[k] ? ICON.check : ''}</span><span class="grow">${esc(L(ex.name))}<small>${esc(stepLabel(s))}${s.side ? ' · ' + t(s.side) : ''}</small></span><span class="muted">${esc(val)}</span></button>`;
  }).join('');
  return `<h2 class="sheet-title">${t('allSteps')}</h2>${rows}`;
}

function renderMenuSheet() {
  return `<h2 class="sheet-title">${esc(dayTitle(dayById(A().dayId)))}</h2>
    <button class="menu-row" data-a="skip">${t('skipEx')}<small>${t('skipHint')}</small></button>
    <button class="menu-row" data-a="steps">${t('allSteps')}</button>
    <button class="menu-row danger" data-a="finish">${t('finishEarly')}</button>`;
}

// ---------- summary ----------
function renderSummary() {
  const sess = store.s.sessions.find(s => s.id === ui.summaryId);
  if (!sess) { ui.screen = 'home'; return renderHome(); }
  const day = dayById(sess.dayId);
  const dur = new Date(sess.end) - new Date(sess.start);
  const vol = sess.sets.reduce((a, s) => a + (s.weight && s.reps ? s.weight * s.reps : 0), 0);
  // weight increases vs previous session with that exercise
  const idx = store.s.sessions.indexOf(sess);
  const incs = [];
  const exIds = [...new Set(sess.sets.map(s => s.exId))];
  for (const id of exIds) {
    const maxNow = Math.max(0, ...sess.sets.filter(s => s.exId === id).map(s => +s.weight || 0));
    if (!maxNow) continue;
    for (let i = idx - 1; i >= 0; i--) {
      const prev = store.s.sessions[i].sets.filter(s => s.exId === id);
      if (!prev.length) continue;
      const maxPrev = Math.max(0, ...prev.map(s => +s.weight || 0));
      if (maxNow > maxPrev) incs.push(`${L(data.ex[id].name)}: ${fmtW(maxPrev)} → ${fmtW(maxNow)}`);
      break;
    }
  }
  const skipped = sess.totalSteps - sess.sets.length;
  if (sess.report == null) store.updateSession(sess.id, { report: buildReport(sess) });
  const rpe = Array.from({ length: 10 }, (_, i) => i + 1).map(n => `<button class="${sess.rpe === n ? 'on' : ''}" data-a="rpe" data-id="${sess.id}" data-v="${n}">${n}</button>`).join('');
  return `<main class="summary">
    <header class="top"><div><p class="eyebrow">${fmtDate(sess.start)}</p><h1>${t('summary')}</h1><p class="muted">${esc(dayTitle(day))}</p></div></header>
    <div class="stats">
      <div class="stat"><b>${fmtDur(dur)}</b><span>${t('duration')}</span></div>
      <div class="stat"><b>${sess.sets.length}/${sess.totalSteps}</b><span>${t('setsDone')}</span></div>
      <div class="stat"><b>${Math.round(vol).toLocaleString()} ${t('kg')}</b><span>${t('volume')}</span></div>
    </div>
    ${incs.length ? `<section class="card"><h2>${t('increases')}</h2><ul class="plain">${incs.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}
    ${skipped > 0 ? `<p class="muted">${t('skipped')}: ${skipped}</p>` : ''}
    <section class="card"><h2>${t('rpeTitle')}</h2><p class="muted small">${t('rpeHint')}</p><div class="seg rpe">${rpe}</div></section>
    <section class="card report"><h2>${t('sessionNotes')}</h2><p class="muted small">${t('reportHint')}</p>
      <textarea class="notes report-text" data-sessnote="${sess.id}" spellcheck="false">${esc(store.s.sessions.find(s => s.id === sess.id).report || '')}</textarea>
      <div class="row"><button class="btn ghost small" data-a="sess-share" data-id="${sess.id}">${t('share')}</button>
        <button class="btn ghost small" data-a="sess-regen" data-id="${sess.id}">${t('regen')}</button></div>
      <p class="muted small sync-line">${esc(syncLine(sess))}</p></section>
    <div class="start-bar"><button class="btn primary big" data-a="sess-save" data-id="${sess.id}">${t('save')}</button></div>
  </main>`;
}

function syncLine(sess) {
  if (!sync.enabled()) return t('syncOffLine');
  const st = sync.state();
  if (sess && sess.syncedAt && !st.queue.includes(sess.id)) return t('syncedAt', { when: new Date(sess.syncedAt).toLocaleString(getLang() === 'es' ? 'es-UY' : 'en-US', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) });
  if (st.error) return t('syncErr_' + st.error);
  return st.queue.length ? t('syncPending', { n: st.queue.length }) : '';
}

function saveSession(id) {
  const sess = store.s.sessions.find(x => x.id === id);
  const box = document.querySelector('textarea[data-sessnote]');
  const md = box ? box.value : sess.report || '';
  const parsed = parseReport(md);
  store.updateSession(id, { report: md, notes: parsed.notes, sideNote: parsed.sideNote || '', painNote: parsed.painNote || '', rpe: parsed.rpe ?? sess.rpe ?? null });
  if (sync.enabled()) { sync.enqueue(id); sync.flush(); }
  ui.screen = ui.summaryFrom === 'history' ? 'history' : 'home';
  window.scrollTo(0, 0);
  render();
  showToast(sync.enabled() ? (navigator.onLine === false ? t('savedOffline') : t('savedSyncing')) : t('saved'));
}

async function shareReport(id) {
  const sess = store.s.sessions.find(x => x.id === id);
  const box = document.querySelector('textarea[data-sessnote]');
  const text = box ? box.value : sess.report || '';
  if (navigator.share) {
    try { await navigator.share({ text, title: t('sessionNotes') }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); showToast(t('copied')); } catch { showToast(t('copyFailed')); }
}

// ---------- runs and swims ----------
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function renderActivitySheet() {
  const seg = (a, opts, on) => `<div class="seg">${opts.map(([v, l]) => `<button class="${v === on ? 'on' : ''}" data-a="${a}" data-v="${v}">${l}</button>`).join('')}</div>`;
  return `<h2 class="sheet-title">${t('logActivity')}</h2>
    <div class="act-form">
      ${seg('act-type', [['run', t('run')], ['swim', t('swim')]], 'run')}
      <label>${t('date')}<input type="date" data-actdate value="${todayISO()}" max="${todayISO()}"></label>
      <div class="row"><label>${t('durationMin')}<input type="number" inputmode="numeric" min="1" data-actmin></label>
        <label>${t('distanceKm')}<input type="number" inputmode="decimal" min="0" step="0.1" data-actkm></label></div>
      <h3>${t('effort')}</h3>
      ${seg('act-effort', [['easy', t('effort_easy')], ['moderate', t('effort_moderate')], ['hard', t('effort_hard')]], 'moderate')}
      <button class="btn primary big" data-a="act-save">${t('saveShort')}</button>
    </div>`;
}
const actLine = a => [a.min ? `${a.min} min` : '', a.km ? `${+a.km} km` : '', t('effort_' + a.effort)].filter(Boolean).join(' · ');

// ---------- history ----------
function renderHistory() {
  const rows = [
    ...store.s.sessions.map(s => ({ ts: new Date(s.start).getTime(), html: (() => {
      const d = dayById(s.dayId);
      return `<button class="day-row" data-a="open-sess" data-id="${s.id}">
      <div class="day-head"><b>${esc(d ? dayTitle(d) : s.dayId)}</b><span class="muted">${fmtDate(s.start)}</span></div>
      <p class="muted small">${fmtDur(new Date(s.end) - new Date(s.start))} · ${s.sets.length}/${s.totalSteps} ${t('setsDone').toLowerCase()}</p></button>`;
    })() })),
    ...store.activities().map(a => ({ ts: actTime(a), html: `<div class="day-row act-row" data-act="${a.id}">
      <div class="day-head"><b>${t(a.type)}</b><span class="muted">${fmtDate(actTime(a))}</span>
        <button class="btn ghost small" data-a="act-del" data-id="${a.id}" aria-label="${t('delete')}">${ICON.x}</button></div>
      <p class="muted small">${esc(actLine(a))}</p></div>` })),
  ].sort((a, b) => b.ts - a.ts).map(r => r.html).join('');
  return `<main class="history"><header class="top"><h1>${t('sessions')}</h1>
    <button class="btn ghost small" data-a="log-act">+ ${t('logActivityShort')}</button></header>${rows || `<p class="muted">${t('noSessions')}</p>`}</main>`;
}

// ---------- settings ----------
function renderSettings() {
  const st = store.settings();
  const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button class="${String(st[key]) === String(v) ? 'on' : ''}" data-a="set" data-k="${key}" data-v="${v}">${esc(l)}</button>`).join('')}</div>`;
  const secOpts = arr => arr.map(n => [n, t('seconds', { n })]);
  const weeks = Array.from({ length: weekCount() }, (_, i) => [i + 1, String(i + 1)]);
  return `<main class="settings"><header class="top"><h1>${t('settings')}</h1></header>
    <section class="card"><h2>${t('language')}</h2>${seg('lang', LANGS)}</section>
    <section class="card"><h2>${t('currentWeek')}</h2>${seg('week', weeks)}</section>
    <section class="card"><h2>${t('restStrength')}</h2>${seg('restStrength', secOpts([60, 90, 120, 180]))}
      <h2>${t('restCircuit')}</h2>${seg('restCircuit', secOpts([0, 30, 45, 60]))}
      <h2>${t('restSides')}</h2>${seg('restSides', secOpts([0, 5, 10, 20]))}</section>
    <section class="card"><h2>${t('weightStep')}</h2>${seg('weightStep', [[0.5, '0.5 kg'], [1, '1 kg'], [2, '2 kg'], [2.5, '2.5 kg']])}</section>
    <section class="card"><h2>${t('sound')}</h2>${seg('sound', [[true, t('on')], [false, t('off')]])}
      <button class="btn ghost small" data-a="test-sound">${t('soundTest')}</button><p class="muted small">${t('soundHint')}</p></section>
    ${renderEquipmentCard()}
    <section class="card extras"><h2>${t('extras')}</h2><p class="muted small">${t('extrasHint')}</p>
      <h3>${t('extraCalves')}</h3>${seg('extraCalves', [[true, t('on')], [false, t('off')]])}
      <h3>${t('extraAnkles')}</h3>${seg('extraAnkles', [[true, t('on')], [false, t('off')]])}
      <h3>${t('extraPogo')}</h3>${seg('extraPogo', [[true, t('on')], [false, t('off')]])}<p class="muted small">${t('extraPogoHint')}</p></section>
    ${renderSyncCard()}
    <section class="card"><h2>${t('data')}</h2>
      <p class="muted small">${store.s.lastBackupAt ? t('lastBackup', { when: rel(store.s.lastBackupAt) }) : t('noBackup')}</p>
      <div class="row"><button class="btn primary" data-a="export">${t('exportData')}</button>
      <label class="btn ghost">${t('importData')}<input type="file" accept="application/json,.json" data-import hidden></label></div>
      <button class="btn danger small" data-a="reset">${t('reset')}</button></section>
    <p class="muted tiny center">${t('version')} ${BUILD}</p>
  </main>`;
}

function renderSyncCard() {
  const on = sync.enabled();
  const st = sync.state();
  const test = ui.syncTest ? `<p class="small sync-test ${ui.syncTest === 'ok' ? 'good' : ''}">${t('syncTest_' + ui.syncTest)}</p>` : '';
  return `<section class="card sync-form"><h2>${t('syncTitle')}</h2><p class="muted small">${t('syncHint')}</p>
    <label class="field">${t('syncRepo')}<input data-syncrepo type="text" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(sync.repo())}"></label>
    <label class="field">${t('syncToken')}<input data-synctoken type="password" autocomplete="off" placeholder="${on ? t('syncTokenSaved') : 'github_pat_...'}"></label>
    <div class="row"><button class="btn primary small" data-a="sync-save">${t('syncConnect')}</button>
      ${on ? `<button class="btn ghost small" data-a="sync-now">${t('syncNow')}</button><button class="btn ghost small" data-a="sync-off">${t('syncDisconnect')}</button>` : ''}</div>
    ${test}<p class="muted small">${esc(on ? syncLine(null) || (st.lastOkAt ? t('syncLastOk', { when: rel(st.lastOkAt) }) : '') : t('syncOffLine'))}</p></section>`;
}

function renderEquipmentCard() {
  const list = store.equipment();
  const ed = ui.eqEdit;
  const types = Object.keys(data.tax.equipment).filter(k => k !== 'none' && !k.includes('/'));
  const form = item => `<div class="eq-form">
      <select data-eqtype>${types.map(k => `<option value="${k}" ${item.type === k ? 'selected' : ''}>${esc(equipName(k))}</option>`).join('')}</select>
      <input data-eqnote type="text" placeholder="${t('eqNotePh')}" value="${esc(item.note || '')}">
      <div class="row"><button class="btn ghost small" data-a="eq-cancel">${t('cancel')}</button><button class="btn primary small" data-a="eq-save" data-id="${item.id || ''}">${t('saveShort')}</button></div>
    </div>`;
  const rows = list.map(e => ed && ed.id === e.id ? form(e) : `<div class="eq-row"><div><b>${esc(equipName(e.type))}</b>${e.note ? `<small>${esc(e.note)}</small>` : ''}</div>
      <button class="btn ghost small" data-a="eq-edit" data-id="${e.id}">${t('edit')}</button>
      <button class="btn ghost small" data-a="eq-del" data-id="${e.id}" aria-label="${t('delete')}">${ICON.x}</button></div>`).join('');
  return `<section class="card"><h2>${t('myEquipment')}</h2><p class="muted small">${t('myEquipmentHint')}</p>
    <div class="eq-list">${rows || `<p class="muted">${t('noEquipment')}</p>`}</div>
    ${ed && !ed.id ? form({ type: types[0], note: '' }) : `<button class="btn ghost small" data-a="eq-add">+ ${t('addEquipment')}</button>`}</section>`;
}

// ---------- actions ----------
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const a = el.dataset.a;
  const act = store.s.active;
  switch (a) {
    case 'go': ui.screen = el.dataset.to; ui.sheet = null; window.scrollTo(0, 0); break;
    case 'days': ui.sheet = { type: 'days' }; break;
    case 'pickday': ui.dayId = el.dataset.day; ui.sheet = null; window.scrollTo(0, 0); break;
    case 'ex': ui.sheet = { type: 'ex', exId: el.dataset.ex, blockId: el.dataset.block, itemIdx: +el.dataset.item, dayId: act && ui.screen === 'workout' ? act.dayId : ui.dayId }; break;
    case 'close': ui.sheet = null; break;
    case 'video': {
      const box = el.closest('.video');
      const id = box.dataset.yt, start = box.dataset.start;
      if (!navigator.onLine) { showToast(t('videoOffline')); return; }
      mountVideo(box, { id, start: +start || 0, end: +box.dataset.end || null });
      return;
    }
    case 'start': startWorkout(); return;
    case 'resume': resumeWorkout(); return;
    case 'discard': if (confirm(t('discard') + '?')) { store.setActive(null); } break;
    case 'done': unlockAudio(); completeStep(); return;
    case 'back': goBack(); return;
    case 'skip': if (A().phase !== 'work') endRest(); skipExercise(); return;
    case 'skiprest': endRest(); store.setActive(A()); break;
    case 'rest-add': A().restEnd += (+el.dataset.d) * 1000; A().restTotal = Math.max(A().restTotal + (+el.dataset.d), 1); store.setActive(A()); break;
    case 'reps': { const d = draftFor(cur()); d.reps = Math.max(0, (d.reps || 0) + (+el.dataset.d)); A().draft = d; store.setActive(A()); break; }
    case 'weight': { const d = draftFor(cur()); const stp = store.settings().weightStep; d.weight = Math.max(0, Math.round(((+d.weight || 0) + (+el.dataset.d) * stp) * 100) / 100); A().draft = d; store.setActive(A()); break; }
    case 'weight-edit': {
      const d = draftFor(cur());
      const v = prompt(t('weight') + ' (' + t('kg') + ')', d.weight ?? '');
      if (v !== null && v.trim() !== '' && !isNaN(+v.replace(',', '.'))) { d.weight = +v.replace(',', '.'); A().draft = d; store.setActive(A()); }
      break;
    }
    case 'timer-start': {
      unlockAudio();
      const step = cur(); const tm = A().timer;
      const remaining = tm ? tm.remaining : step.durationSec;
      A().timer = { running: true, endAt: Date.now() + remaining * 1000, remaining, lastBeep: null, pauses: tm ? tm.pauses || 0 : 0 };
      store.setActive(A());
      break;
    }
    case 'timer-pause': { const tm = A().timer; tm.remaining = Math.max(0, (tm.endAt - Date.now()) / 1000); tm.running = false; tm.pauses = (tm.pauses || 0) + 1; store.setActive(A()); break; }
    case 'menu': ui.sheet = { type: 'menu' }; break;
    case 'steps': ui.sheet = { type: 'steps' }; break;
    case 'jump': jumpTo(el.dataset.key); return;
    case 'finish': if (confirm(t('finishConfirm'))) { ui.sheet = null; finishWorkout(); } return;
    case 'open-sess': ui.summaryId = el.dataset.id; ui.summaryFrom = 'history'; ui.screen = 'summary'; window.scrollTo(0, 0); break;
    case 'rpe': {
      const sess = store.s.sessions.find(x => x.id === el.dataset.id);
      const v = +el.dataset.v === sess.rpe ? null : +el.dataset.v;
      const box = document.querySelector('textarea[data-sessnote]');
      const md = setReportRPE(box ? box.value : sess.report, v);
      store.updateSession(sess.id, { rpe: v, report: md });
      break;
    }
    case 'sess-save': saveSession(el.dataset.id); return;
    case 'sess-share': await shareReport(el.dataset.id); return;
    case 'sess-regen': {
      const sess = store.s.sessions.find(x => x.id === el.dataset.id);
      if (!confirm(t('regenConfirm'))) return;
      const box = document.querySelector('textarea[data-sessnote]');
      store.updateSession(sess.id, { report: keepNotes(box ? box.value : sess.report || '', buildReport(sess)) });
      break;
    }
    case 'sync-save': {
      const f = el.closest('.sync-form');
      sync.setRepo(f.querySelector('[data-syncrepo]').value);
      const tok = f.querySelector('[data-synctoken]').value.trim();
      if (tok) sync.setToken(tok);
      ui.syncTest = 'testing'; render();
      ui.syncTest = await sync.test();
      if (ui.syncTest === 'ok' || ui.syncTest === 'public') { sync.enqueueAll(); sync.flush(); }
      break;
    }
    case 'sync-off': if (confirm(t('syncOffConfirm'))) { sync.setToken(''); ui.syncTest = null; } break;
    case 'sync-now': sync.enqueueAll(); sync.flush(); showToast(t('syncing')); return;
    case 'reload': location.reload(); return;
    case 'eq-add': ui.eqEdit = { id: null }; break;
    case 'eq-edit': ui.eqEdit = { id: el.dataset.id }; break;
    case 'eq-cancel': ui.eqEdit = null; break;
    case 'eq-save': {
      const box = el.closest('.eq-form');
      const item = { type: box.querySelector('[data-eqtype]').value, note: box.querySelector('[data-eqnote]').value.trim() };
      if (el.dataset.id) item.id = el.dataset.id;
      store.saveEquipment(item); ui.eqEdit = null; break;
    }
    case 'eq-del': {
      const e = store.equipment().find(x => x.id === el.dataset.id);
      if (e && confirm(t('deleteConfirm', { name: equipName(e.type) }))) store.deleteEquipment(e.id);
      break;
    }
    case 'set': {
      const k = el.dataset.k; let v = el.dataset.v;
      if (['restStrength', 'restCircuit', 'restSides', 'week', 'weightStep'].includes(k)) v = +v;
      if (k === 'sound' || k.startsWith('extra')) v = v === 'true';
      if (k === 'week' && v !== store.settings().week) { store.s.weekStartedAt = new Date().toISOString(); ui.dayId = null; }
      store.setSetting(k, v);
      if (k === 'lang') setLang(v);
      break;
    }
    case 'log-act': ui.sheet = { type: 'activity' }; break;
    case 'act-type': case 'act-effort':
      // Toggle in place so typed values survive.
      el.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el)); return;
    case 'act-save': {
      const f = el.closest('.act-form');
      const pick = a => f.querySelector(`[data-a=${a}].on`)?.dataset.v;
      const min = Math.round(+f.querySelector('[data-actmin]').value || 0);
      const km = +String(f.querySelector('[data-actkm]').value || '').replace(',', '.') || null;
      const date = f.querySelector('[data-actdate]').value || todayISO();
      if (!min && !km) { showToast(t('actNeedOne')); return; }
      store.addActivity({ type: pick('act-type') || 'run', date, min: min || null, km, effort: pick('act-effort') || 'moderate' });
      ui.sheet = null; render(); showToast(t('actSaved')); return;
    }
    case 'act-del': if (confirm(t('deleteActConfirm'))) store.deleteActivity(el.dataset.id); break;
    case 'test-sound': unlockAudio(); setTimeout(() => sound.end(), 50); return;
    case 'export': await exportData(); break;
    case 'reset': if (confirm(t('resetConfirm'))) { store.reset(); setLang('en'); ui.dayId = null; } break;
  }
  render();
});

// Keep report edits even if the app is closed before Save.
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset && el.dataset.sessnote) store.updateSession(el.dataset.sessnote, { report: el.value });
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.note) store.setNote(el.dataset.note, el.value.trim());
  if (el.dataset.sessnote) store.updateSession(el.dataset.sessnote, { report: el.value });
  if (el.hasAttribute('data-import') && el.files[0]) {
    try { store.importJSON(await el.files[0].text()); setLang(store.settings().lang); showToast(t('importOk')); }
    catch { showToast(t('importBad')); }
  }
});

async function exportData() {
  const json = store.exportJSON();
  const name = `kanitrain-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], name, { type: 'application/json' });
  // iOS: the share sheet lets you save to Files or send to yourself.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const aEl = document.createElement('a');
  aEl.href = url; aEl.download = name; document.body.appendChild(aEl); aEl.click(); aEl.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------- ticking ----------
setInterval(() => {
  if (ui.screen !== 'workout') return;
  const a = A(); if (!a) return;
  const el = document.querySelector('[data-elapsed]');
  if (el) el.textContent = fmtClock((Date.now() - new Date(a.start)) / 1000);
  if (a.phase === 'rest') {
    const left = (a.restEnd - Date.now()) / 1000;
    const r = document.querySelector('[data-rest]');
    if (r) { r.textContent = fmtClock(left); r.parentElement.style.setProperty('--p', Math.max(0, left / a.restTotal)); }
    beepCountdown(a, left, 'rest');
    if (left <= 0) { endRest(Math.min(a.restEnd, Date.now())); store.setActive(a); sound.end(); buzz([200, 100, 200]); render(); }
  } else if (a.timer && a.timer.running) {
    const step = cur();
    const left = (a.timer.endAt - Date.now()) / 1000;
    const r = document.querySelector('[data-timer]');
    if (r) { r.textContent = fmtClock(left); r.parentElement.style.setProperty('--p', Math.max(0, left / step.durationSec)); }
    beepCountdown(a, left, 'timer');
    if (left <= 0) { sound.end(); buzz([300]); completeStep(); }
  }
}, 200);

function beepCountdown(a, left, tag) {
  const s = Math.ceil(left);
  if (s >= 1 && s <= 3 && a._beep !== tag + s) { a._beep = tag + s; sound.tick(); }
}

// iOS can swallow the first click after you touch a YouTube iframe, so close buttons also react to touchend.
// preventDefault stops the follow-up click from landing on whatever is under the button once the sheet is gone.
document.addEventListener('touchend', e => {
  if (ui.sheet && e.target.closest('#sheet [data-a=close]')) { e.preventDefault(); ui.sheet = null; render(); }
}, { passive: false });
// Close a sheet by dragging its header down (also a fallback if iOS shifts the view after fullscreen video).
let dragY = null;
document.addEventListener('touchstart', e => { if (e.target.closest('[data-drag]')) dragY = e.touches[0].clientY; }, { passive: true });
document.addEventListener('touchend', e => {
  if (dragY != null && e.changedTouches[0].clientY - dragY > 60 && ui.sheet) { ui.sheet = null; render(); }
  dragY = null;
}, { passive: true });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.sheet) { ui.sheet = null; render(); } });
// iOS can leave the page scrolled or zoomed after exiting a fullscreen YouTube video. Snap it back.
const resetViewport = () => { if (ui.sheet) setTimeout(() => window.scrollTo(0, window.scrollY), 50); };
window.addEventListener('resize', resetViewport);
document.addEventListener('webkitfullscreenchange', resetViewport);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (ui.screen === 'workout') { keepAwake(true); render(); }
  sync.flush();
  if (swReg) swReg.update().catch(() => {});
});
window.addEventListener('online', () => sync.flush());
let swReg = null;

// ---------- icons ----------
const ICON = {
  today: '<svg viewBox="0 0 24 24"><path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/></svg>',
  history: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  play: '<svg class="i" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  dots: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  info: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  check: '<svg class="i" viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>',
};

// ---------- boot ----------
(async function boot() {
  setLang(store.settings().lang);
  try { await loadData(); }
  catch (err) { $app.innerHTML = `<p class="pad">Could not load plan data. ${esc(err.message)}</p>`; return; }
  if (store.s.active && !dayById(store.s.active.dayId)) store.setActive(null);
  render();
  sync.onChange(() => { if (['settings', 'summary', 'history'].includes(ui.screen) && !document.activeElement?.matches('textarea, input')) render(); });
  sync.flush();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then(reg => { swReg = reg; return reg.update(); }).catch(() => {});
    // A new version took over. Right after opening the app on Today, just reload.
    // Later (or mid-workout, or with a popup open) show a banner and let you tap to reload.
    // The very first install must not reload or show anything.
    const hadController = !!navigator.serviceWorker.controller;
    const bootAt = Date.now();
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || ui.updateReady) return;
      if (Date.now() - bootAt < 15000 && ui.screen === 'home' && !ui.sheet && !store.s.active) { location.reload(); return; }
      ui.updateReady = true;
      if (ui.screen !== 'workout' && !document.activeElement?.matches('textarea, input')) render();
    });
  }
})();

// Exposed for tests.
window.__app = { ui, store, render, data, sync };
