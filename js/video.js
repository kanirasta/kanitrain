// Exercise demo player. Uses the YouTube IFrame API so the app owns the controls:
// taps go to our own layer (never to YouTube's overlays), the demo segment loops
// between startSec and endSec, and there is a slow-motion toggle.
let apiPromise = null;
function loadApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev && prev(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { apiPromise = null; reject(new Error('api')); };
    document.head.appendChild(s);
    setTimeout(() => reject(new Error('timeout')), 4000);
  });
  return apiPromise;
}

const ICONS = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor" stroke="none"/></svg>',
  muted: '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
  restart: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/></svg>',
};

// box: the .video element. opts: {id, start, end}
export function mountVideo(box, { id, start = 0, end = null }) {
  const frame = document.createElement('div');
  frame.className = 'frame';
  const host = document.createElement('div');
  frame.appendChild(host);
  const tapLayer = document.createElement('button');
  tapLayer.className = 'tap-layer';
  tapLayer.setAttribute('aria-label', 'play/pause');
  frame.appendChild(tapLayer);
  const bar = document.createElement('div');
  bar.className = 'vbar';
  bar.innerHTML = `<button class="vbtn" data-v="toggle">${ICONS.pause}</button>
    <button class="vbtn" data-v="restart">${ICONS.restart}</button>
    <button class="vbtn wide" data-v="speed">0.5×</button>
    <button class="vbtn" data-v="sound">${ICONS.muted}</button>`;
  box.prepend(bar);
  box.prepend(frame);
  box.querySelector('[data-a=video]')?.remove();

  let player = null, playing = true, slow = false;
  const setIcon = () => { bar.querySelector('[data-v=toggle]').innerHTML = playing ? ICONS.pause : ICONS.play; };
  const toggle = () => {
    if (!player) return;
    if (playing) player.pauseVideo(); else player.playVideo();
  };
  const restart = () => { if (player) { player.seekTo(start, true); player.playVideo(); } };
  tapLayer.addEventListener('click', e => { e.stopPropagation(); toggle(); });
  bar.addEventListener('click', e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    e.stopPropagation();
    if (b.dataset.v === 'toggle') toggle();
    if (b.dataset.v === 'restart') restart();
    if (b.dataset.v === 'speed' && player) {
      slow = !slow; player.setPlaybackRate(slow ? 0.5 : 1);
      b.textContent = slow ? '1×' : '0.5×';
    }
    if (b.dataset.v === 'sound' && player) {
      if (player.isMuted()) { player.unMute(); b.innerHTML = ICONS.sound; } else { player.mute(); b.innerHTML = ICONS.muted; }
    }
  });

  const params = { start, playsinline: 1, rel: 0, iv_load_policy: 3, modestbranding: 1, controls: 0, disablekb: 1, fs: 0, autoplay: 1, mute: 1 };
  if (end) params.end = end;

  loadApi().then(YT => {
    player = new YT.Player(host, {
      videoId: id, host: 'https://www.youtube-nocookie.com', playerVars: params,
      events: {
        onReady: e => { e.target.mute(); e.target.playVideo(); },
        onStateChange: e => {
          if (e.data === YT.PlayerState.ENDED) { e.target.seekTo(start, true); e.target.playVideo(); }
          if (e.data === YT.PlayerState.PLAYING) { playing = true; setIcon(); }
          if (e.data === YT.PlayerState.PAUSED) { playing = false; setIcon(); }
        },
      },
    });
    // Loop before YouTube's end screen can appear.
    const stopAt = end || null;
    const iv = setInterval(() => {
      if (!document.body.contains(frame)) { clearInterval(iv); try { player.destroy(); } catch {} return; }
      if (!player.getCurrentTime) return;
      const tNow = player.getCurrentTime(), dur = player.getDuration && player.getDuration();
      const limit = stopAt || (dur ? dur - 1.5 : null);
      if (limit && tNow >= limit) { player.seekTo(start, true); }
    }, 250);
  }).catch(() => {
    // Fallback: plain embed (no custom controls).
    bar.remove(); tapLayer.remove();
    const q = new URLSearchParams({ ...params, controls: 1, mute: 0 });
    const f = document.createElement('iframe');
    f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${q}`;
    f.allow = 'autoplay; encrypted-media; picture-in-picture';
    host.replaceWith(f);
  });
}
