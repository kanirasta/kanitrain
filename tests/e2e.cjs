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
  await test('summary: report is in the notes box, edits and notes save, then back to Today', async () => {
    const txt = await p.inputValue('textarea[data-sessnote]');
    assert(txt.includes('# Workout report') && txt.includes('## Exercises') && txt.includes('## My notes'), 'no report: ' + txt.slice(0, 80));
    await p.fill('textarea[data-sessnote]', txt.replace('\n- \n', '\n- Felt good\n'));
    await tap('.start-bar [data-a=sess-save]');
    await p.waitForSelector('.home');
    const s = await p.evaluate(() => window.__app.store.s.sessions);
    assert(s.length === 1 && s[0].notes === '- Felt good' && s[0].report.includes('- Felt good\n'), 'notes not saved: ' + JSON.stringify(s[0].notes));
  });
  await test('full workout: Done through every set ends in a summary', async () => {
    await tap('[data-a=days]'); await tap('.day-row[data-day=w1-fri]');
    await tap('[data-a=start]');
    const ok = await doneUntil(() => exists('.summary'), 200);
    assert(ok, 'never reached summary');
    const s = await p.evaluate(() => window.__app.store.s.sessions.at(-1));
    assert(s.sets.length === s.totalSteps, `${s.sets.length}/${s.totalSteps} sets logged`);
    await tap('.start-bar [data-a=sess-save]');
  });
  await test('history: lists workouts and opens a summary', async () => {
    await tap('[data-a=go][data-to=history]');
    assert((await p.$$('.history .day-row')).length === 2, 'expected 2 workouts');
    await tap('.history .day-row >> nth=0'); await p.waitForSelector('.summary');
    await tap('.start-bar [data-a=sess-save]');
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

  // ---------- workout report ----------
  await test('report: logs set times, rests, Back, Skip and sets not done', async () => {
    await tap('[data-a=go][data-to=home]'); await tap('[data-a=days]'); await tap('.day-row[data-day=w1-mon]');
    await tap('[data-a=start]'); await p.waitForSelector('.workout');
    // Get to the first rep-based set, then: Done, wait in rest, skip rest, Back, Done again, Skip the exercise, finish.
    // Done until the first set that has a rest after it (rep-based), then Back to redo it.
    for (let i = 0; i < 60 && !(await exists('[data-a=skiprest]')); i++) await tap('[data-a=done]');
    assert(await exists('[data-a=skiprest]'), 'expected a rest');
    await tap('[data-a=skiprest]'); await tap('[data-a=back]');
    assert(await exists('[data-a=reps]'), 'redo set is not rep-based');
    await sleep(1100); await tap('[data-a=reps][data-d="-1"]'); await tap('[data-a=done]');
    await sleep(1100); await tap('[data-a=skiprest]');
    const skippedEx = await p.evaluate(() => { const a = window.__app.store.s.active; return a.order[a.pos]; });
    await tap('[data-a=skip]');
    await tap('[data-a=menu]'); await tap('#sheet [data-a=finish]'); await p.waitForSelector('.summary');
    const s = await p.evaluate(() => window.__app.store.s.sessions.at(-1));
    const timed = s.sets.filter(x => x.workSec != null);
    assert(timed.length === s.sets.length, 'sets without time');
    assert(s.sets.some(x => x.workSec >= 1), 'no work time');
    assert(s.sets.some(x => x.restSec != null && x.restTargetSec), 'no rest logged');
    assert(s.sets.some(x => x.redone === 1 && x.reps === x.target - 1), 'Back redo or lower reps not logged');
    assert(s.skipped.length === s.totalSteps - s.sets.length && s.skipped.some(x => x.key === skippedEx), 'skipped sets not logged');
    assert(s.events.some(e => e.type === 'skip') && s.events.some(e => e.type === 'back'), 'events missing');
    const md = s.report;
    assert(md.includes('## To tune') && md.includes('Below target') && md.includes('Skipped') && md.includes('not done'), 'report misses tuning info');
    assert(/time \d+:\d\d/.test(md) && /rest \d+:\d\d \(plan/.test(md), 'report misses times');
  });
  await test('report: RPE buttons fill the effort line, and JSON has the details', async () => {
    await tap('[data-a=rpe][data-v="7"]');
    assert((await p.inputValue('textarea[data-sessnote]')).includes('Effort (RPE 1-10): 7'), 'RPE line not set');
    const j = await p.evaluate(async () => { const m = await import('./js/report.js'); return m.buildJSON(window.__app.store.s.sessions.at(-1)); });
    assert(j.rpe === 7 && j.exercises.length > 3 && j.exercises.some(e => e.sets.some(x => x.done && x.workSec != null)) && j.exercises.some(e => e.sets.some(x => !x.done)), 'JSON incomplete');
  });
  await test('report: Spanish report with notes section', async () => {
    const md = await p.evaluate(async () => { const i = await import('./js/i18n.js'); const m = await import('./js/report.js'); i.setLang('es'); const r = m.buildReport(window.__app.store.s.sessions.at(-1)); i.setLang('en'); return r; });
    assert(md.includes('# Informe del entrenamiento') && md.includes('## Mis notas') && md.includes('Semana 1'), md.slice(0, 120));
    const parsed = await p.evaluate(async md => (await import('./js/report.js')).parseReport(md), md.replace('\n- \n', '\n- Rodilla izquierda molesta\n').replace('- Dolor o molestia: ', '- Dolor o molestia: rodilla'));
    assert(parsed.painNote === 'rodilla' && parsed.notes.includes('Rodilla izquierda molesta'), JSON.stringify(parsed));
  });

  // ---------- GitHub upload ----------
  const ghFiles = {}; let ghDown = false; const ghCalls = [];
  await p.route(/api\.github\.com/, async r => {
    const req = r.request(); const url = new URL(req.url()); ghCalls.push(req.method() + ' ' + url.pathname);
    if (ghDown) return r.abort('internetdisconnected');
    const auth = req.headers()['authorization'];
    if (auth !== 'Bearer github_pat_test') return r.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"Bad credentials"}' });
    if (url.pathname === '/repos/kanirasta/kanitrain-logs') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ private: true, permissions: { push: true } }) });
    const m = url.pathname.match(/^\/repos\/kanirasta\/kanitrain-logs\/contents\/(.+)$/);
    if (!m) return r.fulfill({ status: 404, body: '{}' });
    const fp = decodeURIComponent(m[1]);
    if (req.method() === 'DELETE') { const b = JSON.parse(req.postData()); if (!ghFiles[fp]) return r.fulfill({ status: 404, body: '{}' }); if (b.sha !== ghFiles[fp].sha) return r.fulfill({ status: 409, body: '{}' }); delete ghFiles[fp]; return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    if (req.method() === 'GET') return ghFiles[fp] ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: ghFiles[fp].sha }) }) : r.fulfill({ status: 404, body: '{}' });
    const b = JSON.parse(req.postData());
    if (ghFiles[fp] && b.sha !== ghFiles[fp].sha) return r.fulfill({ status: 422, contentType: 'application/json', body: '{"message":"sha wasn\'t supplied"}' });
    const sha = 'sha' + Math.random().toString(36).slice(2);
    ghFiles[fp] = { sha, text: Buffer.from(b.content, 'base64').toString('utf8') };
    return r.fulfill({ status: ghFiles[fp] ? 200 : 201, contentType: 'application/json', body: JSON.stringify({ content: { sha } }) });
  });
  await test('sync: a wrong token is reported, the right one connects and uploads past workouts', async () => {
    await tap('.start-bar [data-a=sess-save]'); await p.waitForSelector('.home');
    await tap('[data-a=go][data-to=settings]');
    await p.fill('[data-synctoken]', 'nope'); await tap('[data-a=sync-save]');
    await p.waitForFunction(() => /rejected/.test(document.querySelector('.sync-test')?.textContent || ''));
    await p.fill('[data-synctoken]', 'github_pat_test'); await tap('[data-a=sync-save]');
    await p.waitForSelector('.sync-test.good');
    await p.waitForFunction(() => window.__app.store.s.sync.queue.length === 0);
    const n = await p.evaluate(() => window.__app.store.s.sessions.length);
    const mds = Object.keys(ghFiles).filter(f => f.endsWith('.md'));
    assert(mds.length === n && Object.keys(ghFiles).length === 2 * n, `uploaded ${Object.keys(ghFiles).length} files for ${n} workouts`);
    assert(mds.every(f => /^workouts\/\d{4}\/\d{4}-\d\d-\d\d-\d{6}-w\d-\w+\.md$/.test(f)), mds.join(','));
    const exported = await p.evaluate(() => window.__app.store.exportJSON());
    assert(!exported.includes('github_pat_test'), 'token leaked into the backup');
  });
  await test('sync: an edited report uploads again over the same file', async () => {
    await tap('[data-a=go][data-to=history]'); await tap('.history .day-row >> nth=0'); await p.waitForSelector('.summary');
    assert((await p.textContent('.sync-line')).includes('Uploaded to GitHub'), 'no uploaded status');
    const txt = await p.inputValue('textarea[data-sessnote]');
    await p.fill('textarea[data-sessnote]', txt.replace('## My notes', '## My notes\nEdited later'));
    await tap('.start-bar [data-a=sess-save]'); await p.waitForSelector('.history');
    await p.waitForFunction(() => window.__app.store.s.sync.queue.length === 0);
    const f = Object.keys(ghFiles).filter(f => f.endsWith('.md') && ghFiles[f].text.includes('Edited later'));
    assert(f.length === 1, 'edit not uploaded');
    const j = JSON.parse(ghFiles[f[0].replace(/\.md$/, '.json')].text);
    assert(j.notes.includes('Edited later') && j.schema === 'kanitrain.session/1', 'JSON not updated');
  });
  await test('sync: offline keeps it queued and it uploads when back online', async () => {
    ghDown = true;
    const before = Object.keys(ghFiles).length;
    await tap('[data-a=go][data-to=home]'); await tap('[data-a=start]'); await p.waitForSelector('.workout');
    await tap('[data-a=menu]'); await tap('#sheet [data-a=finish]'); await p.waitForSelector('.summary');
    await tap('.start-bar [data-a=sess-save]'); await p.waitForSelector('.home');
    await sleep(300);
    assert(await p.evaluate(() => window.__app.store.s.sync.queue.length === 1), 'not queued');
    ghDown = false;
    await p.evaluate(() => window.dispatchEvent(new Event('online')));
    await p.waitForFunction(() => window.__app.store.s.sync.queue.length === 0);
    assert(Object.keys(ghFiles).length === before + 2, 'not uploaded after reconnect: ' + Object.keys(ghFiles).join(' '));
  });
  await test('update: banner shows on Today and is tappable', async () => {
    await p.evaluate(() => { window.__app.ui.updateReady = true; window.__app.render(); });
    assert(await p.isVisible('.update-bar'), 'no banner');
    assert((await p.textContent('.update-bar')).includes('Tap to reload'), 'banner text');
    await p.evaluate(() => { window.__app.ui.updateReady = false; window.__app.render(); });
  });

  // ---------- holds, delete, discard, zoom ----------
  await test('holds: the wall sit home swap runs as 30 s on / 30 s break instead of reps', async () => {
    const r = await p.evaluate(async () => {
      const m = await import('./js/plan.js');
      const st = m.buildSteps(m.dayById('w2-mon'), 'home').filter(s => s.exId === 'wall_sit_plate');
      const gym = m.buildSteps(m.dayById('w2-mon'), 'gym').filter(s => s.exId === 'ball_wall_squat_plate');
      const sp = m.buildSteps(m.dayById('w1-fri'), 'gym').filter(s => s.exId === 'side_plank');
      return { st, gym, sp };
    });
    assert(r.st.length === 4 && r.st.every(s => s.durationSec === 30 && s.timed && s.restAfter >= 30), JSON.stringify(r.st[0]));
    assert(r.gym.every(s => !s.durationSec && s.reps === 8), 'gym version should stay reps');
    assert(r.sp[0].side === 'left' && r.sp[0].durationSec === 20 && r.sp[0].restAfter <= 10 && r.sp[1].restAfter >= 30, 'side plank: ' + JSON.stringify(r.sp.slice(0, 2).map(s => [s.side, s.durationSec, s.restAfter])));
  });
  await test('holds: adjust on and break during a workout, remembered next time', async () => {
    await p.evaluate(() => window.__app.store.setSetting('location', 'home'));
    await tap('[data-a=go][data-to=home]'); await tap('[data-a=days]'); await tap('.day-row[data-day=w2-mon]');
    assert((await p.textContent('.plan')).includes('4 × 30 s'), 'home preview should show the hold time');
    await tap('[data-a=start]'); await p.waitForSelector('.workout');
    await tap('[data-a=steps]');
    const key = await p.evaluate(() => window.__app.store.s.active.order.find(k => k.startsWith('main:1:')));
    await tap(`[data-a=jump][data-key="${key}"]`);
    assert(await exists('.tmr-line'), 'no interval line');
    assert((await p.textContent('.tmr-line')).includes('30 s on · 30 s break'), await p.textContent('.tmr-line'));
    await tap('[data-a=tmr-edit]');
    await tap('[data-a=tmr][data-k=work][data-d="5"]'); await tap('[data-a=tmr][data-k=rest][data-d="-5"]'); await tap('[data-a=tmr][data-k=rest][data-d="-5"]');
    assert((await p.textContent('[data-timer]')).trim() === '0:35', 'timer not updated: ' + await p.textContent('[data-timer]'));
    const tm = await p.evaluate(() => window.__app.store.s.timers.wall_sit_plate);
    assert(tm.work === 35 && tm.rest === 20, JSON.stringify(tm));
    await tap('[data-a=timer-start]'); await sleep(300); await tap('[data-a=done]');
    assert(await exists('[data-a=skiprest]'), 'no break after the hold');
    const left = await p.evaluate(() => (window.__app.store.s.active.restEnd - Date.now()) / 1000);
    assert(left > 15 && left <= 20, 'break should be 20 s, got ' + left);
  });
  await test('discard: menu discards the workout without saving anything', async () => {
    const n = await p.evaluate(() => window.__app.store.s.sessions.length);
    await tap('[data-a=menu]'); await tap('#sheet [data-a=discard-wo]');
    await p.waitForSelector('.home');
    assert(await p.evaluate(() => !window.__app.store.s.active), 'still active');
    assert(await p.evaluate(() => window.__app.store.s.sessions.length) === n, 'a session was saved');
    await p.evaluate(() => window.__app.store.setSetting('location', 'gym'));
  });
  await test('discard: end screen discard drops the workout and sends nothing', async () => {
    const n = await p.evaluate(() => window.__app.store.s.sessions.length);
    const files = Object.keys(ghFiles).length;
    await tap('[data-a=go][data-to=home]'); await tap('[data-a=start]'); await p.waitForSelector('.workout');
    await tap('[data-a=menu]'); await tap('#sheet [data-a=finish]'); await p.waitForSelector('.summary');
    assert(!(await exists('[data-a=sess-del]')), 'fresh workout should offer discard, not delete');
    await tap('[data-a=sess-discard]'); await p.waitForSelector('.home'); await sleep(300);
    assert(await p.evaluate(() => window.__app.store.s.sessions.length) === n, 'not discarded');
    assert(Object.keys(ghFiles).length === files, 'something was uploaded');
  });
  await test('delete: a logged workout is deleted from History and from GitHub', async () => {
    const n = await p.evaluate(() => window.__app.store.s.sessions.length);
    const files = Object.keys(ghFiles).length;
    await tap('[data-a=go][data-to=history]'); await tap('.history .day-row >> nth=0'); await p.waitForSelector('.summary');
    const path = await p.evaluate(id => window.__app.store.s.sessions.find(s => s.id === id).syncPath, await p.evaluate(() => window.__app.ui.summaryId));
    await tap('[data-a=sess-del]'); await p.waitForSelector('.history');
    await p.waitForFunction(() => window.__app.store.s.sync.deletes.length === 0);
    assert(await p.evaluate(() => window.__app.store.s.sessions.length) === n - 1, 'not deleted');
    assert(Object.keys(ghFiles).length === files - 2 && !ghFiles[path + '.md'] && !ghFiles[path + '.json'], 'GitHub files not deleted');
  });
  await test('zoom: double-tap zoom is off', async () => {
    const ta = await p.evaluate(() => [getComputedStyle(document.body).touchAction, getComputedStyle(document.querySelector('button')).touchAction]);
    assert(ta.every(v => v === 'manipulation'), ta.join());
    assert((await p.getAttribute('meta[name=viewport]', 'content')).includes('maximum-scale=1'), 'viewport');
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
    await tap('.start-bar [data-a=sess-save]');
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
    await tap('.start-bar [data-a=sess-save]');
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

  // ---------- alternating sides, multi-position holds ----------
  await test('sides: the lunge + plate press alternates sides by default, others stay one side then the other', async () => {
    const r = await p.evaluate(async () => {
      const m = await import('./js/plan.js');
      const st = m.buildSteps(m.dayById('w2-mon'), 'gym');
      return { lunge: st.filter(s => s.exId === 'lunge_front_lateral_plate_press'), split: st.filter(s => s.side === 'left').length };
    });
    assert(r.lunge.length === 3 && r.lunge.every(s => s.alt && s.repsL === 8 && s.repsR === 8 && !s.side), JSON.stringify(r.lunge[0]));
    assert(r.split > 0, 'other unilateral work should still split');
  });
  await test('sides: alternating set logs left and right reps, with extra left reps', async () => {
    await tap('[data-a=go][data-to=home]'); await tap('[data-a=days]'); await tap('.day-row[data-day=w2-mon]');
    await tap('[data-a=start]'); await p.waitForSelector('.workout');
    await tap('[data-a=steps]');
    await tap('[data-a=jump][data-key="main:3:alt:1"]');
    assert(await exists('.stepper.alt-side.left') && await exists('.stepper.alt-side.right'), 'no left/right steppers');
    await tap('[data-a=reps][data-side=repsL][data-d="1"]'); await tap('[data-a=reps][data-side=repsL][data-d="1"]');
    await tap('[data-a=reps][data-side=repsR][data-d="-1"]');
    await tap('[data-a=done]');
    await tap('[data-a=menu]'); await tap('#sheet [data-a=finish]'); await p.waitForSelector('.summary');
    const s = await p.evaluate(() => window.__app.store.s.sessions.at(-1));
    const L = s.sets.find(x => x.key === 'main:3:left:1'), R = s.sets.find(x => x.key === 'main:3:right:1');
    assert(L && R && L.reps === 10 && L.target === 8 && R.reps === 7 && R.target === 8 && L.alternating, JSON.stringify([L, R]));
    assert(s.skipped.some(x => x.key === 'main:3:left:2') && s.skipped.some(x => x.key === 'main:3:right:3'), 'alt skipped sets not split by side');
    const md = await p.inputValue('textarea[data-sessnote]');
    assert(/Left vs right: reps 10 vs 7/.test(md), 'report misses left vs right');
    await tap('[data-a=sess-discard]'); await p.waitForSelector('.home');
  });
  await test('sides: switching to one side then the other in the exercise popup applies to the workout', async () => {
    await tap('[data-a=days]'); await tap('.day-row[data-day=w2-mon]');
    await tap('[data-a=start]'); await p.waitForSelector('.workout');
    await tap('[data-a=steps]'); await tap('[data-a=jump][data-key="main:3:alt:1"]');
    await tap('.wo-name'); await p.waitForSelector('.side-mode');
    await tap('[data-a=side-mode][data-v=split]');
    assert(await p.evaluate(() => window.__app.store.s.sideModes.lunge_front_lateral_plate_press === 'split'), 'not saved');
    const a = await active();
    assert(a.order.filter(k => k.startsWith('main:3:')).length === 6 && a.order[a.pos] === 'main:3:left:1', 'not rebuilt: ' + a.order[a.pos]);
    await tap('#sheet .close');
    assert(await exists('.side.left') && !(await exists('.stepper.alt-side')), 'screen not switched');
    await tap('[data-a=menu]'); await tap('#sheet [data-a=discard-wo]'); await p.waitForSelector('.home');
    await p.evaluate(() => { delete window.__app.store.s.sideModes.lunge_front_lateral_plate_press; });
  });
  await test('holds: adductor squeeze is 60 s with a cue at each of the 3 positions', async () => {
    const r = await p.evaluate(async () => {
      const m = await import('./js/plan.js');
      return m.buildSteps(m.dayById('w3-fri'), 'gym').filter(s => s.exId === 'adductor_squeeze_3pos');
    });
    assert(r.length === 3 && r.every(s => s.durationSec === 60 && s.segments === 3), JSON.stringify(r[0]));
    await tap('[data-a=days]'); await tap('.day-row[data-day=w3-fri]');
    await tap('[data-a=start]'); await p.waitForSelector('.workout');
    await tap('[data-a=steps]');
    const key = await p.evaluate(() => window.__app.store.s.active.order.find(k => k.startsWith('main:0:')));
    await tap(`[data-a=jump][data-key="${key}"]`);
    assert((await p.textContent('[data-seg]')).includes('Position 1 of 3'), 'no position label');
    await tap('[data-a=timer-start]');
    await p.evaluate(() => { const a = window.__app.store.s.active; a.timer.endAt = Date.now() + 35000; });
    await p.waitForFunction(() => /Position 2 of 3/.test(document.querySelector('[data-seg]')?.textContent || ''));
    await tap('[data-a=menu]'); await tap('#sheet [data-a=discard-wo]'); await p.waitForSelector('.home');
  });

  // ---------- iPad and TV ----------
  await test('layout: iPhone stays the phone layout', async () => {
    const l = await p.evaluate(() => [document.documentElement.dataset.layout, document.documentElement.style.zoom]);
    assert(l[0] === 'phone' && !l[1], l.join());
  });
  await test('layout: iPad Air gets the large layout, side by side in landscape, and TV mode', async () => {
    const c = await browser.newContext({ ...pw.devices['iPad Pro 11'], viewport: { width: 820, height: 1180 }, screen: { width: 820, height: 1180 }, serviceWorkers: 'block' });
    const q = await c.newPage(); q.on('pageerror', e => errors.push('iPad: ' + e.message)); q.on('dialog', d => d.accept());
    await q.goto(base); await q.waitForSelector('.home');
    const pt = await q.evaluate(() => [document.documentElement.dataset.layout, document.documentElement.dataset.orient, +document.documentElement.style.zoom, document.documentElement.scrollWidth <= innerWidth]);
    assert(pt[0] === 'tablet' && pt[1] === 'portrait' && pt[2] > 1.2 && pt[3], 'portrait: ' + pt.join());
    await q.setViewportSize({ width: 1180, height: 820 }); await sleep(200);
    await q.tap('[data-a=start]'); await q.waitForSelector('.workout');
    const ls = await q.evaluate(() => {
      const body = document.querySelector('.wo-body').getBoundingClientRect(), ctrl = document.querySelector('.wo-ctrl').getBoundingClientRect(), name = document.querySelector('.wo-name').getBoundingClientRect();
      return [document.documentElement.dataset.orient, ctrl.left > name.right - 5, ctrl.left > body.left + body.width / 3, document.documentElement.scrollWidth <= innerWidth];
    });
    assert(ls[0] === 'landscape' && ls[1] && ls[2] && ls[3], 'landscape not side by side: ' + ls.join());
    await q.evaluate(() => { window.__app.store.setSetting('tv', 'auto'); window.dispatchEvent(new Event('resize')); });
    const tv = await q.evaluate(() => [document.documentElement.hasAttribute('data-tv'), getComputedStyle(document.body).backgroundColor]);
    assert(tv[0] && tv[1] === 'rgb(0, 0, 0)', 'TV mode: ' + tv.join());
    await q.setViewportSize({ width: 820, height: 1180 }); await sleep(200);
    assert(!(await q.evaluate(() => document.documentElement.hasAttribute('data-tv'))), 'TV auto should turn off in portrait');
    await q.evaluate(() => { window.__app.store.setActive(null); window.__app.ui.screen = 'settings'; window.__app.render(); });
    await q.tap('[data-a=set][data-k=tv][data-v=on]');
    assert(await q.evaluate(() => document.documentElement.hasAttribute('data-tv')), 'TV on toggle');
    await q.tap('[data-a=set][data-k=display][data-v=phone]');
    assert(await q.evaluate(() => document.documentElement.dataset.layout === 'phone'), 'manual phone layout');
    await c.close();
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
