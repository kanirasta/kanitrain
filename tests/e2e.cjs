// End-to-end tap-through tests on an emulated iPhone 15 Pro.
// Run: node tests/e2e.cjs            (serves this repo on a local port)
//      BASE_URL=https://kanirasta.github.io/kanitrain/ node tests/e2e.cjs
// Needs Playwright (npm i -D playwright). BROWSER=webkit uses WebKit when installed.
const http = require('http');
const fs = require('fs');
const path = require('path');
const pw = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, resp) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f)) { resp.writeHead(404); return resp.end(); }
      resp.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(resp);
    }).listen(0, () => res(srv));
  });
}

const results = [];
async function test(name, fn) {
  try { await fn(); results.push([true, name]); console.log('  ok  ', name); }
  catch (e) { results.push([false, name, e]); console.log('  FAIL', name, '\n       ', e.message.split('\n')[0]); }
}
function assert(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let srv, base = process.env.BASE_URL;
  if (!base) { srv = await serve(); base = `http://localhost:${srv.address().port}/`; }
  const engine = pw[process.env.BROWSER || 'chromium'];
  const browser = await engine.launch();
  const ctx = await browser.newContext({ ...pw.devices['iPhone 15 Pro'], acceptDownloads: true, serviceWorkers: 'block' });
  ctx.setDefaultTimeout(5000);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('dialog', d => d.accept());
  // Keep YouTube offline in tests: an empty page stands in for the embed.
  // A fake IFrame API records what the app asks the player to do.
  const FAKE_YT = `window.__yt = { calls: [] };
    window.YT = { PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2 }, Player: function (el, o) {
      const f = document.createElement('iframe'); f.src = 'about:blank'; f.dataset.vid = o.videoId; el.replaceWith(f);
      let t = o.playerVars.start || 0, muted = true; const self = this; window.__yt.vars = o.playerVars;
      const st = s => o.events.onStateChange && o.events.onStateChange({ data: s, target: self });
      Object.assign(this, { playVideo() { __yt.calls.push('play'); st(1); }, pauseVideo() { __yt.calls.push('pause'); st(2); },
        seekTo(x) { t = x; __yt.calls.push('seek' + x); }, setPlaybackRate(r) { __yt.calls.push('rate' + r); },
        mute() { muted = true; }, unMute() { muted = false; __yt.calls.push('unmute'); }, isMuted() { return muted; },
        getCurrentTime() { return t; }, getDuration() { return 100; }, destroy() {} });
      setTimeout(() => o.events.onReady && o.events.onReady({ target: self }), 10);
    } };
    window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady();`;
  await p.route(/youtube\.com\/iframe_api/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_YT }));
  await p.route(/youtube(-nocookie)?\.com\/(?!iframe_api)/, r => r.fulfill({ status: 200, contentType: 'text/html', body: '<body style="background:#000"></body>' }));

  const tap = sel => p.tap(sel);
  const exists = async sel => !!(await p.$(sel));
  const sheetOpen = () => exists('#sheet .sheet');
  const active = () => p.evaluate(() => window.__app.store.s.active);
  // Synthetic touch events: raw CDP touches leave Chromium's tap emulation stuck for later taps.
  async function swipeDown(sel) {
    await p.evaluate(sel => {
      const el = document.querySelector(sel); const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      const t = (yy) => new Touch({ identifier: 1, target: el, clientX: x, clientY: yy });
      el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [t(y)], changedTouches: [t(y)] }));
      el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [t(y + 120)] }));
    }, sel);
  }
  async function openExercise(i = 10) { await tap(`.ex-row >> nth=${i}`); await p.waitForSelector('#sheet .sheet'); }
  async function playVideo() { await tap('[data-a=video]'); await p.waitForSelector('#sheet iframe'); }
  async function doneUntil(pred, max = 120) {
    for (let i = 0; i < max; i++) {
      if (await pred()) return true;
      if (await exists('[data-a=skiprest]')) await tap('[data-a=skiprest]');
      else await tap('[data-a=done]');
    }
    return false;
  }

  console.log(`Testing ${base} on ${process.env.BROWSER || 'chromium'} (iPhone 15 Pro)`);
  await p.goto(base);
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  await p.waitForSelector('.home');
  // Most tests check the coach's plan as written; the optional extras get their own tests at the end.
  const plainPlan = () => p.evaluate(() => { const s = window.__app.store; s.setSetting('extraCalves', false); s.setSetting('extraAnkles', false); s.setSetting('extraPogo', false); window.__app.render(); });
  await plainPlan();

  // ---------- details popup ----------
  await test('details: open, play video, close with X', async () => {
    await openExercise(); await playVideo(); await tap('#sheet .close'); await sleep(150);
    assert(!(await sheetOpen()), 'popup still open');
  });
  await test('video: app controls pause, restart, slow motion, sound and loop the demo', async () => {
    await openExercise(); await playVideo();
    await p.waitForFunction(() => window.__yt && window.__yt.calls.includes('play'));
    const vars = await p.evaluate(() => window.__yt.vars);
    assert(vars.controls === 0 && vars.rel === 0 && vars.iv_load_policy === 3 && vars.playsinline === 1, 'player vars ' + JSON.stringify(vars));
    await tap('.tap-layer'); await tap('[data-v=restart]'); await tap('[data-v=speed]'); await tap('[data-v=sound]');
    const calls = await p.evaluate(() => window.__yt.calls);
    for (const c of ['pause', 'seek0', 'rate0.5', 'unmute']) assert(calls.includes(c), 'missing ' + c + ' in ' + calls);
    await tap('#sheet .close'); await sleep(150);
    assert(!(await sheetOpen()), 'popup still open');
  });
  await test('video: trimmed demos start and stop at the demo part', async () => {
    await tap('[data-a=days]'); await tap('.day-row[data-day=w1-mon]');
    await tap('.ex-row[data-ex=db_rdl]'); await p.waitForSelector('#sheet .sheet'); await playVideo();
    await p.waitForFunction(() => window.__yt && window.__yt.vars && window.__yt.vars.start === 21);
    const v = await p.evaluate(() => window.__yt.vars);
    assert(v.start === 21 && v.end === 50, 'start/end ' + v.start + '/' + v.end);
    await tap('#sheet .close'); await sleep(150);
  });
  await test('details: close with bottom Close button after video', async () => {
    await openExercise(); await playVideo();
    await p.evaluate(() => document.querySelector('.sheet-body').scrollTo(0, 1e6));
    await tap('.sheet-done'); await sleep(150);
    assert(!(await sheetOpen()), 'popup still open');
  });
  await test('details: close with swipe down on the header', async () => {
    await openExercise(); await playVideo(); await swipeDown('.sheet-head'); await sleep(150);
    assert(!(await sheetOpen()), 'popup still open');
  });
  await test('details: close by tapping the dimmed area', async () => {
    const st = await p.evaluate(() => ({ sheet: JSON.stringify(window.__app.ui.sheet), screen: window.__app.ui.screen, y: scrollY }));
    if (await sheetOpen()) throw new Error('precondition: popup already open ' + JSON.stringify(st));
    await openExercise(); await p.touchscreen.tap(200, 20); await sleep(150);
    assert(!(await sheetOpen()), 'popup still open');
  });
  await test('details: closing with X does not also tap what is underneath', async () => {
    const day = await p.textContent('.home h1');
    await openExercise(); await playVideo(); await tap('#sheet .close'); await sleep(400);
    assert(!(await sheetOpen()), 'a popup is open (ghost tap opened something)');
    assert((await p.textContent('.home h1')) === day, 'day changed');
  });
  await test('details: open and close 5 different exercises in a row', async () => {
    for (let i = 0; i < 5; i++) { await openExercise(i); await tap('#sheet .close'); await sleep(80); }
    assert(!(await sheetOpen()), 'popup still open');
    assert(await exists('.home'), 'not on home');
  });
  await test('details: notes are saved', async () => {
    await openExercise(3);
    await p.fill('textarea[data-note]', 'Use 12 kg next time');
    await p.dispatchEvent('textarea[data-note]', 'change');
    await tap('#sheet .close');
    await openExercise(3);
    assert((await p.inputValue('textarea[data-note]')) === 'Use 12 kg next time', 'note lost');
    await tap('#sheet .close');
  });

  // ---------- day switching ----------
  await test('change day: picker opens, picking a day updates the preview', async () => {
    await tap('[data-a=days]');
    assert(await sheetOpen(), 'picker did not open');
    const rows = await p.$$('.day-row');
    assert(rows.length >= 9, 'expected 9 sessions, got ' + rows.length);
    await tap('.day-row[data-day=w1-wed]'); await sleep(100);
    assert(!(await sheetOpen()), 'picker still open');
    assert((await p.textContent('.home h1')).includes('Wednesday'), 'preview not updated');
    assert((await p.$$('.equip li')).length > 0, 'no equipment');
  });

  // ---------- workout ----------
  await test('workout: start shows warm-up with timer and wake lock screen', async () => {
    await tap('[data-a=start]'); await p.waitForSelector('.workout');
    assert(await exists('[data-a=timer-start]'), 'no start timer on warm-up');
    const y = await p.evaluate(() => window.scrollY);
    assert(y === 0, 'workout not scrolled to top');
  });
  await test('workout: timed set counts down and completes itself', async () => {
    // Shorten the warm-up timer to 2 s via the timer state, then start it.
    await tap('[data-a=timer-start]');
    await p.evaluate(() => { const a = window.__app.store.s.active; a.timer.endAt = Date.now() + 1500; });
    await p.waitForFunction(() => Object.keys(window.__app.store.s.active.done).length === 1, null, { timeout: 5000 });
  });
  await test('workout: Done per set advances and logs reps', async () => {
    const before = Object.keys((await active()).done).length;
    if (await exists('[data-a=skiprest]')) await tap('[data-a=skiprest]');
    await tap('[data-a=reps][data-d="1"]');
    const name = await p.textContent('.wo-name');
    await tap('[data-a=done]');
    const a = await active();
    assert(Object.keys(a.done).length === before + 1, 'set not logged');
    const last = Object.values(a.done).sort((x, y) => x.at.localeCompare(y.at)).pop();
    assert(last.reps === 11, 'edited reps not saved, got ' + last.reps);
    assert(name, 'no exercise name');
  });
  await test('workout: circuit interleaves exercises round by round', async () => {
    const seen = [];
    for (let i = 0; i < 3; i++) {
      if (await exists('[data-a=skiprest]')) await tap('[data-a=skiprest]');
      seen.push(await p.textContent('.wo-name')); await tap('[data-a=done]');
    }
    assert(new Set(seen).size === 3, 'expected 3 different exercises in a round: ' + seen.join(' | '));
  });
  await test('workout: rest timer shows after a round and ends by itself', async () => {
    await doneUntil(() => exists('.rest'), 10);
    assert(await exists('.rest'), 'no rest screen');
    await p.evaluate(() => { window.__app.store.s.active.restEnd = Date.now() + 800; });
    await p.waitForSelector('.workout:not(.rest)', { timeout: 4000 });
  });
  await test('workout: +15 s and -15 s change the rest', async () => {
    await doneUntil(() => exists('.rest'), 10);
    const a1 = (await active()).restEnd;
    await tap('[data-a=rest-add][data-d="15"]');
    const a2 = (await active()).restEnd;
    assert(Math.round((a2 - a1) / 1000) === 15, '+15 did not add 15 s');
    await tap('[data-a=rest-add][data-d="-15"]');
    await tap('[data-a=skiprest]');
  });
  await test('workout: Back undoes the last set', async () => {
    const n = Object.keys((await active()).done).length;
    const pos = (await active()).pos;
    await tap('[data-a=back]');
    const a = await active();
    assert(Object.keys(a.done).length === n - 1, 'set not undone');
    assert(a.pos < pos, 'did not move back');
    await tap('[data-a=done]');
  });
  await test('workout: Skip moves the exercise to the end', async () => {
    await doneUntil(() => exists('.stepper.weight'), 80);
    if (await exists('[data-a=skiprest]')) await tap('[data-a=skiprest]');
    const a = await active();
    const key = a.order[a.pos];
    await tap('footer [data-a=skip]');
    const b = await active();
    assert(b.order[b.pos] !== key, 'still on skipped set');
    assert(b.order.indexOf(key) > b.order.length - 10, 'skipped set not at the end');
  });
  await test('workout: weight +/- and it carries to the next set', async () => {
    await doneUntil(() => exists('.stepper.weight'), 40);
    if (await exists('[data-a=skiprest]')) await tap('[data-a=skiprest]');
    for (let i = 0; i < 5; i++) await tap('[data-a=weight][data-d="1"]');
    await tap('[data-a=weight][data-d="-1"]');
    const w = await p.textContent('.stepper.weight .num b');
    await tap('[data-a=done]');
    if (await exists('[data-a=skiprest]')) await tap('[data-a=skiprest]');
    assert(await exists('.stepper.weight'), 'next step has no weight');
    assert((await p.textContent('.stepper.weight .num b')) === w, `weight not carried (${w})`);
  });
  await test('workout: unilateral sets alternate Left then Right', async () => {
    await doneUntil(() => exists('.side.left'), 40);
    if (await exists('[data-a=skiprest]')) await tap('[data-a=skiprest]');
    assert(await exists('.side.left'), 'no left side step');
    await tap('[data-a=done]');
    if (await exists('[data-a=skiprest]')) await tap('[data-a=skiprest]');
    assert(await exists('.side.right'), 'right did not follow left');
  });
  await test('workout: all-sets list opens and jumping works', async () => {
    await tap('[data-a=steps]');
    assert(await sheetOpen(), 'list did not open');
    const rows = await p.$$('.step-row:not([disabled])');
    await rows[rows.length - 1].tap();
    await sleep(100);
    assert(!(await sheetOpen()), 'list did not close after jump');
  });
  await test('workout: menu opens and closes with X', async () => {
    await tap('[data-a=menu]'); assert(await sheetOpen(), 'menu did not open');
    await tap('#sheet .close'); await sleep(100); assert(!(await sheetOpen()), 'menu did not close');
  });
  await test('workout: details popup works mid-workout', async () => {
    await tap('.wo-name'); assert(await sheetOpen(), 'details did not open');
    if (await exists('[data-a=video]')) await playVideo();
    await tap('#sheet .close'); await sleep(100);
    assert(!(await sheetOpen()), 'details did not close'); assert(await exists('.workout'), 'left workout');
  });
  await test('workout: resumes where you left off after closing the app', async () => {
    const a = await active();
    await p.reload(); await p.waitForSelector('.home');
    assert(await exists('.card.resume'), 'no resume card');
    await tap('.card.resume [data-a=resume]');
    const b = await active();
    assert(b.pos === a.pos && Object.keys(b.done).length === Object.keys(a.done).length, 'state changed after resume');
  });
  await test('workout: finish early shows the summary', async () => {
    await tap('[data-a=menu]'); await tap('#sheet [data-a=finish]');
    await p.waitForSelector('.summary');
    assert((await p.textContent('.stats')).includes('/'), 'no sets stat');
  });
  await test('summary: session notes save, then back to Today', async () => {
    await p.fill('textarea[data-sessnote]', 'Felt good');
    await p.dispatchEvent('textarea[data-sessnote]', 'change');
    await tap('.start-bar [data-a=go]');
    await p.waitForSelector('.home');
    const s = await p.evaluate(() => window.__app.store.s.sessions);
    assert(s.length === 1 && s[0].notes === 'Felt good', 'notes not saved');
  });
  await test('full workout: Done through every set ends in a summary', async () => {
    await tap('[data-a=days]'); await tap('.day-row[data-day=w1-fri]');
    await tap('[data-a=start]');
    const ok = await doneUntil(() => exists('.summary'), 200);
    assert(ok, 'never reached summary');
    const s = await p.evaluate(() => window.__app.store.s.sessions.at(-1));
    assert(s.sets.length === s.totalSteps, `${s.sets.length}/${s.totalSteps} sets logged`);
    await tap('.start-bar [data-a=go]');
  });
  await test('history: lists workouts and opens a summary', async () => {
    await tap('[data-a=go][data-to=history]');
    assert((await p.$$('.history .day-row')).length === 2, 'expected 2 workouts');
    await tap('.history .day-row >> nth=0'); await p.waitForSelector('.summary');
    await tap('.start-bar [data-a=go]');
  });

  // ---------- settings ----------
  await test('settings: Spanish switches the UI and back', async () => {
    await tap('[data-a=go][data-to=settings]');
    await tap('[data-a=set][data-v=es]');
    assert((await p.textContent('.settings h1')) === 'Ajustes', 'not Spanish');
    await tap('[data-a=set][data-v=en]');
    assert((await p.textContent('.settings h1')) === 'Settings', 'not English');
  });
  await test('settings: rest time choice is used in the next workout', async () => {
    await tap('[data-a=set][data-k=restStrength][data-v="60"]');
    assert((await p.evaluate(() => window.__app.store.s.settings.restStrength)) === 60, 'setting not saved');
  });
  await test('settings: shows the build version', async () => {
    assert(/Version \d{4}-\d\d-\d\d/.test(await p.textContent('.settings .tiny')), 'no version');
  });
  await test('settings: export backup produces a valid file', async () => {
    await p.evaluate(() => { navigator.canShare = () => false; });
    const [dl] = await Promise.all([p.waitForEvent('download'), tap('[data-a=export]')]);
    const file = await dl.path();
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert(j.app === 'training' && j.data.sessions.length === 2, 'bad backup');
    fs.copyFileSync(file, path.join(require('os').tmpdir(), 'kanitrain-test-backup.json'));
  });
  await test('settings: import restores a backup', async () => {
    const backup = path.join(require('os').tmpdir(), 'kanitrain-test-backup.json');
    await p.evaluate(() => { window.__app.store.reset(); });
    await p.setInputFiles('input[data-import]', backup);
    await sleep(200);
    assert((await p.evaluate(() => window.__app.store.s.sessions.length)) === 2, 'sessions not restored');
  });

  await test('offline install: first visit does not reload the page under you', async () => {
    const c2 = await browser.newContext({ ...pw.devices['iPhone 15 Pro'] });
    const p2 = await c2.newPage();
    let navs = 0; p2.on('framenavigated', f => { if (f === p2.mainFrame()) navs++; });
    await p2.goto(base); await p2.waitForSelector('.home');
    await p2.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 8000 });
    await sleep(500);
    await c2.close();
    assert(navs === 1, `page reloaded ${navs - 1} time(s) on first visit`);
  });

  // ---------- equipment and home swaps ----------
  const goHomeDay = async id => { await tap('[data-a=go][data-to=home]'); await tap('[data-a=days]'); await tap(`.day-row[data-day=${id}]`); await sleep(100); };
  await test('equipment: defaults are your home list', async () => {
    const eq = await p.evaluate(() => window.__app.store.s.equipment.map(e => e.type));
    for (const k of ['dumbbells', 'barbell', 'plate', 'mini_band', 'pull_up_bar', 'box', 'treadmill', 'mat', 'couch_chair']) assert(eq.includes(k), 'missing ' + k);
  });
  await test('equipment: an older saved list gets the couch once, and a deleted couch stays deleted', async () => {
    const add = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('trainingApp.v1')); s.equipment = s.equipment.filter(e => e.type !== 'couch_chair'); delete s.eqRev; localStorage.setItem('trainingApp.v1', JSON.stringify(s)); });
    await p.reload(); await p.waitForSelector('.home');
    assert(await p.evaluate(() => window.__app.store.s.equipment.filter(e => e.type === 'couch_chair').length === 1), 'couch not added to old list');
    await p.evaluate(() => { const st = window.__app.store; st.deleteEquipment(st.s.equipment.find(e => e.type === 'couch_chair').id); });
    await p.reload(); await p.waitForSelector('.home');
    assert(await p.evaluate(() => !window.__app.store.s.equipment.some(e => e.type === 'couch_chair')), 'deleted couch came back');
  });
  await test('home: back squat is swapped, but lighter weights alone do not flag the gym', async () => {
    await tap('[data-a=go][data-to=settings]');
    await p.evaluate(() => { window.__app.store.reset(); });
    await plainPlan();
    await goHomeDay('w1-mon');
    assert(await exists('.seg.loc button.on[data-v=home]'), 'not at home');
    assert(await exists('.ex-row[data-ex=goblet_squat_tempo]'), 'back squat not swapped');
    assert(!(await exists('.ex-row[data-ex=back_squat]')), 'back squat still listed');
    assert(!(await exists('.card.gym-hint')), 'load-only swap flagged the gym');
    assert(await exists('.home-ok'), 'no swap summary');
  });
  await test('home: a missing machine flags the day for the gym', async () => {
    await goHomeDay('w1-wed');
    assert(await exists('.card.gym-hint'), 'no gym hint');
    await goHomeDay('w1-mon');
  });
  await test('home: couch replaces the bench for split squats and hip thrusts', async () => {
    await goHomeDay('w3-mon');
    assert(await exists('.ex-row[data-ex=bulgarian_split_squat]'), 'bulgarian split squat swapped despite couch');
    await goHomeDay('w2-wed');
    assert(await exists('.ex-row[data-ex=db_hip_thrust_couch]'), 'hip thrust not on the couch');
    await goHomeDay('w1-mon');
  });
  await test('home: swapped exercise popup explains the swap', async () => {
    await tap('.ex-row[data-ex=goblet_squat_tempo]'); await p.waitForSelector('#sheet .sheet');
    assert((await p.textContent('.swap-note')).includes('Barbell back squat'), 'no swap note');
    await tap('#sheet .close'); await sleep(100);
  });
  await test('gym: switching shows the plan as written', async () => {
    await tap('.seg.loc [data-v=gym]');
    assert(await exists('.ex-row[data-ex=back_squat]'), 'back squat not back');
    assert(!(await exists('.card.gym-hint')), 'gym hint still shown');
    await tap('.seg.loc [data-v=home]');
  });
  await test('equipment: add a bench and bench presses stop being swapped', async () => {
    await goHomeDay('w1-fri');
    assert(await exists('.ex-row[data-ex=db_floor_press]'), 'expected floor press at home without bench');
    await tap('[data-a=go][data-to=settings]');
    await tap('[data-a=eq-add]');
    await p.selectOption('[data-eqtype]', 'flat_bench');
    await p.fill('[data-eqnote]', 'Foldable');
    await tap('[data-a=eq-save]');
    assert((await p.textContent('.eq-list')).includes('Foldable'), 'bench not listed');
    await goHomeDay('w1-fri');
    assert(await exists('.ex-row[data-ex=db_bench_press]'), 'bench press still swapped');
  });
  await test('equipment: edit and delete', async () => {
    await tap('[data-a=go][data-to=settings]');
    const id = await p.evaluate(() => window.__app.store.s.equipment.find(e => e.type === 'flat_bench').id);
    await tap(`[data-a=eq-edit][data-id="${id}"]`);
    await p.fill('[data-eqnote]', 'Adjustable later');
    await tap('[data-a=eq-save]');
    assert((await p.textContent('.eq-list')).includes('Adjustable later'), 'edit not saved');
    await tap(`[data-a=eq-del][data-id="${id}"]`);
    assert(!(await p.evaluate(() => window.__app.store.s.equipment.some(e => e.type === 'flat_bench'))), 'not deleted');
    await goHomeDay('w1-fri');
    assert(await exists('.ex-row[data-ex=db_floor_press]'), 'swap did not come back');
  });
  await test('home workout: steps use the swapped exercises and survive resume', async () => {
    await goHomeDay('w1-mon');
    await tap('[data-a=start]'); await p.waitForSelector('.workout');
    const ids = await p.evaluate(() => { const a = window.__app.store.s.active; return a.location; });
    assert(ids === 'home', 'location not stored');
    await p.reload(); await p.waitForSelector('.home'); await tap('.card.resume [data-a=resume]');
    await tap('[data-a=steps]');
    const txt = await p.textContent('#sheet');
    assert(txt.includes('Goblet squat, slow tempo') && !txt.includes('Barbell back squat'), 'swap lost after resume');
    await tap('#sheet .close'); await tap('[data-a=menu]'); await tap('#sheet [data-a=finish]'); await p.waitForSelector('.summary');
    await tap('.start-bar [data-a=go]');
  });
  await test('every plan exercise has a home path or is flagged', async () => {
    const r = await p.evaluate(async () => {
      const m = await import('./js/plan.js');
      return m.allDays().map(d => { const h = m.homeReport(d); return d.id + ':' + h.swaps.length + '/' + h.partial.length + '/' + h.missing.length; });
    });
    console.log('        home report (swaps/partial/missing):', r.join(' '));
  });

  // ---------- optional extras ----------
  const setExtras = (c, a, pg) => p.evaluate(([c, a, pg]) => { const s = window.__app.store; s.setSetting('extraCalves', c); s.setSetting('extraAnkles', a); s.setSetting('extraPogo', pg); window.__app.render(); }, [c, a, pg]);
  await test('extras: defaults are calves and ankles on, pogo off', async () => {
    await tap('[data-a=go][data-to=settings]');
    await p.evaluate(() => window.__app.store.reset()); await p.reload(); await p.waitForSelector('.home');
    const s = await p.evaluate(() => window.__app.store.settings());
    assert(s.extraCalves === true && s.extraAnkles === true && s.extraPogo === false, JSON.stringify(s));
  });
  await test('extras: calves block at the end and ankle drills right after the warm-up', async () => {
    await goHomeDay('w1-mon');
    const blocks = await p.$$eval('.plan .block', els => els.map(e => e.querySelector('.ex-row')?.dataset.block));
    assert(blocks[1] === 'x-ankles', 'ankles not after warm-up: ' + blocks);
    assert(blocks[blocks.length - 1] === 'x-calves', 'calves not last: ' + blocks);
    assert(!blocks.includes('x-pogo'), 'pogo on by default');
  });
  await test('extras: calf raises go left first with an extra left set', async () => {
    const seq = await p.evaluate(async () => {
      const m = await import('./js/plan.js');
      return m.buildSteps(m.dayById('w1-mon')).filter(s => s.exId === 'calf_raise_straight_sl').map(s => s.side[0].toUpperCase()).join('');
    });
    assert(seq === 'LRLRL', 'calf order ' + seq);
  });
  await test('extras: Settings toggles turn blocks on and off', async () => {
    await tap('[data-a=go][data-to=settings]');
    await tap('.extras [data-k=extraPogo][data-v=true]');
    await tap('.extras [data-k=extraCalves][data-v=false]');
    await goHomeDay('w1-wed');
    assert(await exists('.ex-row[data-ex=pogo_hops]'), 'no pogo on Wednesday');
    assert(!(await exists('.ex-row[data-ex=calf_raise_straight_sl]')), 'calves still shown');
    await goHomeDay('w1-mon');
    assert(!(await exists('.ex-row[data-ex=pogo_hops]')), 'pogo on Monday');
    await setExtras(true, true, false);
  });
  await test('extras: a workout with extras runs to the end', async () => {
    await goHomeDay('w1-fri');
    await tap('[data-a=start]'); await p.waitForSelector('.workout');
    assert(await doneUntil(() => exists('.summary'), 200), 'never reached summary');
    const n = await p.evaluate(() => { const s = window.__app.store.s.sessions; return s[s.length - 1].sets.filter(x => x.exId.startsWith('calf_raise')).length; });
    assert(n === 10, 'calf sets logged ' + n);
    await tap('.start-bar [data-a=go]');
  });

  // ---------- runs and swims ----------
  await test('runs: log a hard run from Today and see it in History', async () => {
    await goHomeDay('w1-mon');
    await tap('[data-a=log-act]'); await p.waitForSelector('.act-form');
    await p.fill('[data-actmin]', '40'); await p.fill('[data-actkm]', '7.5');
    await tap('[data-a=act-effort][data-v=hard]');
    assert(await p.$eval('[data-actmin]', e => e.value) === '40', 'typed value lost after picking effort');
    await tap('[data-a=act-save]'); await sleep(100);
    assert(!(await sheetOpen()), 'sheet still open');
    const a = await p.evaluate(() => window.__app.store.s.activities);
    assert(a.length === 1 && a[0].type === 'run' && a[0].min === 40 && a[0].km === 7.5 && a[0].effort === 'hard', JSON.stringify(a));
    await tap('[data-a=go][data-to=history]');
    assert((await p.textContent('.history')).includes('7.5 km'), 'run not in history');
  });
  await test('runs: a hard run yesterday warns on a leg day and ranks leg days lower', async () => {
    await p.evaluate(() => { const s = window.__app.store; const d = new Date(Date.now() - 86400000); s.s.activities[0].date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    await goHomeDay('w1-mon');
    assert(await exists('.card.run-hint'), 'no run hint on leg day');
    assert((await p.textContent('.card.run-hint')).includes('yesterday'), 'hint text');
    const r = await p.evaluate(async () => { const m = await import('./js/plan.js'); const f = m.freshness(m.dayById('w1-mon')); return f; });
    assert(r < 1, 'freshness not lowered: ' + r);
  });
  await test('runs: swim logs and both can be deleted', async () => {
    await tap('[data-a=go][data-to=history]');
    await tap('.history [data-a=log-act]'); await p.waitForSelector('.act-form');
    await tap('[data-a=act-type][data-v=swim]'); await p.fill('[data-actmin]', '30');
    await tap('[data-a=act-save]'); await sleep(100);
    assert(await p.evaluate(() => window.__app.store.s.activities.some(a => a.type === 'swim' && a.min === 30)), 'swim not saved');
    while (await exists('[data-a=act-del]')) { await tap('[data-a=act-del] >> nth=0'); await sleep(50); }
    assert(await p.evaluate(() => window.__app.store.s.activities.length === 0), 'not deleted');
  });
  await test('runs: an empty entry is not saved', async () => {
    await tap('.history [data-a=log-act]'); await p.waitForSelector('.act-form');
    await tap('[data-a=act-save]'); await sleep(100);
    assert(await sheetOpen(), 'sheet closed without data');
    assert(await p.evaluate(() => window.__app.store.s.activities.length === 0), 'empty entry saved');
    await tap('#sheet .close');
  });

  await test('no JavaScript errors during the run', async () => {
    assert(errors.length === 0, errors.join(' | '));
  });

  await browser.close();
  if (srv) srv.close();
  const failed = results.filter(r => !r[0]);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
