// Picks the layout from the screen: phone, tablet (bigger text, side by side in landscape) or TV (high contrast, huge).
// Everything is scaled with CSS zoom so the phone layout stays the single source of truth.
const ZOOM = {
  phone: { portrait: 1, landscape: 1 },
  tablet: { portrait: 1.4, landscape: 1.25 },
  tv: { portrait: 1.4, landscape: 1.5 },
};

export function detectDevice() {
  const s = Math.min(screen.width, screen.height);
  return s >= 700 ? 'tablet' : 'phone';
}

export function currentLayout(settings) {
  const landscape = innerWidth > innerHeight;
  const device = settings.display && settings.display !== 'auto' ? settings.display : detectDevice();
  const tv = settings.tv === 'on' || (settings.tv === 'auto' && device === 'tablet' && landscape);
  return { device, tv, orient: landscape ? 'landscape' : 'portrait' };
}

export function applyLayout(settings) {
  const l = currentLayout(settings);
  const root = document.documentElement;
  const z = ZOOM[l.tv ? 'tv' : l.device][l.orient];
  root.dataset.layout = l.device;
  root.dataset.orient = l.orient;
  if (l.tv) root.dataset.tv = ''; else delete root.dataset.tv;
  root.style.zoom = z === 1 ? '' : String(z);
  root.style.setProperty('--z', z);
  return l;
}
