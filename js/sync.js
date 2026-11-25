// Upload workout reports to a private GitHub repo (Markdown + JSON per workout).
// The token lives only on this device, outside the main data, so it never ends up in a backup file.
import { store, save } from './store.js';
import { buildJSON, reportPath } from './report.js';

const TOKEN_KEY = 'kanitrain.ghToken';
const API = 'https://api.github.com';
export const DEFAULT_REPO = 'kanirasta/kanitrain-logs';

const get = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const set = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} };

const st = () => (store.s.sync ||= { repo: DEFAULT_REPO, queue: [], lastOkAt: null, error: null });
let busy = null;
let onChange = () => {};

function b64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function gh(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: `Bearer ${sync.token()}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body };
}

async function putFile(path, text, message, sha) {
  const enc = path.split('/').map(encodeURIComponent).join('/');
  const send = s => gh(`/repos/${st().repo}/contents/${enc}`, { method: 'PUT', body: JSON.stringify({ message, content: b64(text), ...(s ? { sha: s } : {}) }) });
  let res = await send(sha);
  // File already there (or our sha is stale): fetch its sha and try once more.
  if (res.status === 409 || res.status === 422) {
    const cur = await gh(`/repos/${st().repo}/contents/${enc}`);
    if (cur.ok && cur.body.sha) res = await send(cur.body.sha);
  }
  if (!res.ok) { const e = new Error(res.body.message || 'HTTP ' + res.status); e.status = res.status; throw e; }
  return res.body.content && res.body.content.sha;
}

async function uploadSession(sess) {
  const base = sess.syncPath || (sess.syncPath = reportPath(sess));
  const msg = `Workout ${sess.start.slice(0, 10)} ${sess.dayId}`;
  const shas = sess.syncSha || {};
  shas.md = await putFile(base + '.md', sess.report || '', msg, shas.md);
  shas.json = await putFile(base + '.json', JSON.stringify(buildJSON(sess), null, 2) + '\n', msg, shas.json);
  sess.syncSha = shas;
  sess.syncedAt = new Date().toISOString();
}

export const sync = {
  token: () => get(TOKEN_KEY),
  setToken(v) { set(TOKEN_KEY, (v || '').trim()); },
  repo: () => st().repo,
  setRepo(v) { st().repo = (v || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '') || DEFAULT_REPO; save(); },
  enabled() { return !!(this.token() && st().repo); },
  state: st,
  pending: () => st().queue.length,
  onChange(fn) { onChange = fn; },
  enqueue(id) { const q = st().queue; if (!q.includes(id)) q.push(id); save(); },
  enqueueAll() { for (const s of store.s.sessions) if (!s.syncedAt) this.enqueue(s.id); },

  // Upload everything waiting. Stops at the first failure and keeps the rest for later.
  flush() {
    if (busy) return busy;
    if (!this.enabled() || !st().queue.length) return Promise.resolve();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve();
    busy = (async () => {
      const s = st();
      try {
        while (s.queue.length) {
          const id = s.queue[0];
          const sess = store.s.sessions.find(x => x.id === id);
          if (sess) await uploadSession(sess);
          s.queue.shift();
          s.lastOkAt = new Date().toISOString(); s.error = null;
          save();
        }
      } catch (e) {
        s.error = e.status === 401 ? 'auth' : e.status === 403 || e.status === 404 ? 'access' : e.status ? 'other' : 'offline';
        s.errorDetail = e.message;
        save();
      } finally {
        busy = null;
        onChange();
      }
    })();
    return busy;
  },

  // Check the token can write to the repo.
  async test() {
    try {
      const res = await gh(`/repos/${st().repo}`);
      if (res.status === 401) return 'auth';
      if (!res.ok) return 'access';
      if (res.body.permissions && !res.body.permissions.push) return 'readonly';
      return res.body.private ? 'ok' : 'public';
    } catch { return 'offline'; }
  },
};
