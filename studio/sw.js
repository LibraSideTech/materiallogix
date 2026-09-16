// Service worker: makes the web app installable and resilient.
//
// Network-first for everything. Stale caches are costly in development, and
// in production this app must not run old logic without saying so.
// The cache is a fallback for flaky Wi-Fi and offline opens, not a speedup.

const CACHE = 'materiallogix-shell-v25';
const PEOPLE_CACHE = 'materiallogix-people-proof-v1';
const SHELL = [
  './', 'index.html', 'voice.html', 'music.html', 'usage.html', 'admin.html', 'manifest.webmanifest', 'icon.svg',
  'css/app.css', 'css/photo-editor.css', 'css/music.css', 'css/admin.css', 'css/usage.css',
  'css/voice-console.css', 'css/studio-entry.css', 'css/video.css', 'assets/preview-stamp.wav',
  'js/bootstrap.js', 'js/studio-shell.js', 'js/studio-nav.js', 'js/api-root.js', 'js/activity.js', 'js/privacy.js',
  'js/studio-entry.js',
  'js/app.js', 'js/generate-reference.js', 'js/model.js', 'js/store.js', 'js/crop.js', 'js/analyze.js',
  'js/export.js', 'js/clientpage.js', 'js/history.js', 'js/zip.js',
  'js/generate.js', 'js/inpaint-foundation.js', 'js/cloud-video.js', 'js/spin-viewer.js', 'js/geometry.js', 'js/human-geometry.js', 'js/human-geometry-notice.js', 'js/device.js', 'js/raw.js', 'js/raw-preview.js', 'js/voice.js',
  'js/companion-link.js', 'js/vendor/qrcodegen.js', 'js/video-pace.js',
  'js/editing.js', 'js/print.js', 'js/house-voices.js', 'js/voice-quality.js', 'js/voice-reference.js', 'js/color-management.js',
  'js/features.js', 'js/capture-guidance.js', 'js/capture-pacer.js', 'js/prompt-guard.js', 'js/app-version.js',
  'js/pricing.js', 'js/pricing-catalog.js', 'js/license.js', 'js/license-key.js',
  'js/recording-consent.js', 'js/video-pace.js', 'js/routes.js',
  'js/music.js', 'js/music-audio.js', 'js/music-store.js', 'js/music-project.js'
  ,'js/billing-client.js', 'js/usage.js', 'js/admin.js',
  'js/checkout-result.js', 'js/checkout-survey.js', 'js/survey-policy.js', 'js/biometric-notice.js',
  'js/voice-mix-ui.js', 'js/voice-mix.js', 'js/audio-visualizer.js',
  'js/loudness.js', 'js/take-defects.js', 'js/long-form.js', 'js/seam-check.js', 'js/wav-export.js',
  'js/premium-voice-ui.js', 'js/premium-voice.js',
  'js/voice-take-analysis.js', 'js/voice-take-analysis-worker.js',
  'js/personal-geometry-consent.js', 'js/personal-geometry-storage.js', 'js/personal-geometry-pack.js',
  'js/local-face-map.js', 'js/tattoo-mapping.js', 'js/video-pro-editor.js', 'js/video-timeline.js',
  'assets/raw/worker.js',
  'site/media/studio-entry-photo.webp', 'site/media/studio-entry-video.webp',
  'site/media/studio-entry-voice.webp', 'site/media/studio-entry-music.webp'
];
// The same worker is used by local/Windows copies at `/` and by the hosted
// application at `/studio/`. Resolve every entry from the registration scope,
// not the origin root. The entry artwork lives beside `/studio/` on the hosted
// site but under `site/` in a local checkout, so adapt only that source prefix.
function scopeUrl(path) {
  const scope = new URL(self.registration.scope);
  const hostedPath = scope.pathname.endsWith('/studio/') && path.startsWith('site/media/')
    ? `../media/${path.slice('site/media/'.length)}`
    : path;
  return new URL(hostedPath, scope);
}
const SHELL_URLS = SHELL.map(scopeUrl);
const SHELL_PATHS = new Set(SHELL_URLS.map(url => url.pathname));
// Proof-only candidate assets are warmed only when the explicit parity suite
// runs. Keeping 14 MiB out of the mandatory shell protects normal installs.
const PEOPLE_ASSETS = [
  'assets/human/human.esm.js',
  'assets/human/models/blazeface.json', 'assets/human/models/blazeface.bin',
  'assets/human/models/facemesh.json', 'assets/human/models/facemesh.bin',
  'assets/human/models/handtrack.json', 'assets/human/models/handtrack.bin',
  'assets/human/models/handlandmark-lite.json', 'assets/human/models/handlandmark-lite.bin',
  'assets/human/models/movenet-lightning.json', 'assets/human/models/movenet-lightning.bin',
  'assets/human/models/blazepose-full.json', 'assets/human/models/blazepose-full.bin'
];
const PEOPLE_PATHS = new Set(PEOPLE_ASSETS.map(path => scopeUrl(path).pathname));
const NETWORK_TIMEOUT_MS = 1200;

async function networkFirst(request, event, cacheName = CACHE) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    const response = await fetch(request, { cache: 'no-store', signal: controller.signal });
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(cacheName).then(cache => cache.put(request, copy)).catch(() => undefined));
    }
    return response;
  } catch {
    return (await caches.open(cacheName).then(cache => cache.match(request, { ignoreSearch: true }))) || new Response(
      '<!doctype html><title>MaterialLogix Studio offline</title><h1>Offline shell unavailable</h1><p>Reconnect once to repair the application shell. Your project data has not been deleted.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
    );
  } finally {
    clearTimeout(timer);
  }
}

async function installShell() {
  const cache = await caches.open(CACHE);
  const results = await Promise.allSettled(SHELL_URLS.map(async url => {
    const request = new Request(url, { cache: 'reload' });
    const response = await fetch(request);
    if (!response.ok) throw new Error(`${response.status} ${url.pathname}`);
    await cache.put(request, response);
  }));
  const failures = results.filter(result => result.status === 'rejected');
  // One optional or temporarily unavailable asset must not brick installation.
  // Missing entries remain visible in the console and are retried network-first
  // when requested; the next cache version gets another clean installation.
  if (failures.length) console.warn(`MaterialLogix offline shell cached with ${failures.length} missing entr${failures.length === 1 ? 'y' : 'ies'}.`);
  await self.skipWaiting();
}

self.addEventListener('install', event => {
  event.waitUntil(installShell());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE && key !== PEOPLE_CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Only the declared shell may be cached. API/account responses must never be
  // persisted by the offline cache. This includes same-origin production APIs
  // and the absolute license/billing origin used by local and installed builds.
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.origin !== location.origin) return;
  if (PEOPLE_PATHS.has(url.pathname)) {
    event.respondWith(networkFirst(event.request, event, PEOPLE_CACHE));
    return;
  }
  if (SHELL_PATHS.has(url.pathname)) event.respondWith(networkFirst(event.request, event));
});
