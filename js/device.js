// Sound, wake lock and small device helpers.
import { store } from './store.js';

let ctx = null;

// Must be called from a user tap (iOS only allows audio after a gesture).
export function unlockAudio() {
  try {
    // Safari 17+: 'transient' plays short sounds over music (ducking it) instead of stopping it.
    if (navigator.audioSession) navigator.audioSession.type = 'transient';
  } catch {}
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  // Play a silent buffer to fully unlock on iOS.
  const b = ctx.createBuffer(1, 1, 22050);
  const src = ctx.createBufferSource();
  src.buffer = b; src.connect(ctx.destination); src.start(0);
}

function tone(freq, dur, when = 0, vol = 0.35) {
  if (!ctx || !store.settings().sound) return;
  const t0 = ctx.currentTime + when;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(ctx.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

export const sound = {
  tick() { tone(880, 0.12); },
  end() { tone(1046, 0.18); tone(1318, 0.18, 0.2); tone(1568, 0.35, 0.4); },
  tap() { tone(660, 0.05, 0, 0.15); },
};

export function buzz(pattern = 200) {
  // Not supported on iOS Safari; works on Android.
  try { navigator.vibrate && navigator.vibrate(pattern); } catch {}
}

let lock = null;
export async function keepAwake(on) {
  try {
    if (on) {
      if ('wakeLock' in navigator && !lock) {
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => { lock = null; });
      }
    } else if (lock) { await lock.release(); lock = null; }
  } catch { lock = null; }
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
