// Executable inline scripts and the shared font onload handler are pinned by
// hash. Inline style attributes remain a documented compatibility exception:
// the current HTML and Studio runtime set styles directly. Remove
// `style-src-attr 'unsafe-inline'` after those declarations move to classes.
const FONT_ONLOAD_HASH = "'sha256-MhtPZXr7+LpJUY5qtMutB+qWfQtMaPccfe7QXtCcEYc='";

export const PUBLIC_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  `script-src 'unsafe-hashes' 'sha256-YRGQuXfd1C2KqcYnVbTF7rgtaUKhjsx+AaM+yPuTX/w=' ${FONT_ONLOAD_HASH}`,
  `script-src-attr 'unsafe-hashes' ${FONT_ONLOAD_HASH}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "style-src-elem 'self' https://fonts.googleapis.com 'sha256-yFapD7kFYrLSjRN3BC5m5d/8hVm7QN0QrgiiC3Di78g=' 'sha256-wP/scJHVoa3smKYanY38YY9p6zOe0QwhosrG3r3ClFs=' 'sha256-l9e9W/PZcm62KjHAGse41jLNc3zJJkguUfqrhJgI47o=' 'sha256-Z3Up1LQ0ojOtmgruX3eilfiAf2XqenmhvFVPHgqfD0c='",
  "style-src-attr 'unsafe-inline'",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self'",
  "media-src 'self'",
  "manifest-src 'self'",
  "worker-src 'none'",
  "child-src 'none'",
  "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com"
].join('; ');

export const STUDIO_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  `script-src 'self' blob: https://cdn.jsdelivr.net 'wasm-unsafe-eval' 'unsafe-hashes' 'sha256-wt1BzVKDMN2N7AdgYOT4ogH37cht2qoL3gKZT7DvNeA=' 'sha256-01JG7u2AbBQLrDRTuipMQb+RpknR3CNs5L/QoplgIiY=' 'sha256-qphfRNmmo43KJ0y4gVCVJMz1hdrAg2sPkbgN9rfEvF4=' 'sha256-WHxBvuw43O2fmi97Zmdho8acx9Qm3zajb/atjQu2XXE=' 'sha256-Rjg3AsOsKyFPe5JFokn/0mJ7ECH3i+Nj1Q+NPPytTbQ=' 'sha256-UzG8dAYT17iKWRWesiEjuVZNHrYfMfi82TmHTpdbj6g=' 'sha256-Gtz754kFhmv9wVyyfgBPIURPn5sVfJnKq08gFVzMGU0=' 'sha256-PhFSkX7c55TzA1SEi0kWep+KNpI9OGW+yH4j59gQpH0=' ${FONT_ONLOAD_HASH}`,
  `script-src-attr 'unsafe-hashes' ${FONT_ONLOAD_HASH}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "style-src-elem 'self' https://fonts.googleapis.com 'sha256-hEorC3vXD/qzPbny+dyxcybfeL/YMxaTU2fzi233llE=' 'sha256-wQe8GRLgVZ4cESlus9vQU2gkK0mB2a/fdE9RKGxQTag=' 'sha256-OQBo6Ya6KV02akBlyMJRj70iIiqmd+6/so0A13omeys='",
  "style-src-attr 'unsafe-inline'",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: http://127.0.0.1:8189",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "connect-src 'self' https://materiallogix.com https://cdn.jsdelivr.net https://storage.googleapis.com https://fonts.googleapis.com https://fonts.gstatic.com http://127.0.0.1:8188 http://localhost:8188 http://127.0.0.1:8189"
].join('; ');

const SECURITY_HEADERS = Object.freeze({
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-site',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), display-capture=(), browsing-topics=(), clipboard-read=(), clipboard-write=(self)',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
});

const REVALIDATE = 'public, max-age=0, must-revalidate';
const NO_STORE = 'no-store';
const SERVICE_WORKER_NO_STORE = 'no-cache, no-store, must-revalidate';

// The European Economic Area and the United Kingdom, where a consumer buying at
// a distance has a 14-day right to withdraw. Digital content delivered at once
// is an exception to it, but only if the customer asked for immediate delivery
// and acknowledged that the right ends on delivery -- so the acknowledgement is
// shown to these customers and to nobody else.
export const WITHDRAWAL_RIGHT_COUNTRIES = new Set([
  // EU 27
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
  'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  // Rest of the EEA
  'IS', 'LI', 'NO',
  // United Kingdom
  'GB'
]);

/**
 * Whether this request is from somewhere the withdrawal right applies.
 *
 * The country comes from the edge, never from a header a client can set. When
 * the edge cannot say, the answer is yes: showing the acknowledgement to
 * someone it does not cover costs a line of text, while omitting it from
 * someone it does cover leaves them a 14-day unconditional refund on delivered
 * content.
 */
export function withdrawalRightApplies(request) {
  const country = request.cf?.country;
  return typeof country !== 'string' || WITHDRAWAL_RIGHT_COUNTRIES.has(country.toUpperCase());
}

function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

function isStudioPath(pathname) {
  return pathname === '/studio' || pathname.startsWith('/studio/');
}

export function secureResponse(response, { cacheControl, pathname = '/' } = {}) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  headers.set(
    'Content-Security-Policy',
    isStudioPath(pathname) ? STUDIO_CONTENT_SECURITY_POLICY : PUBLIC_CONTENT_SECURITY_POLICY
  );
  if (cacheControl) headers.set('Cache-Control', cacheControl);
  else if (isRedirect(response.status) || response.status >= 400) headers.set('Cache-Control', NO_STORE);
  else if (!headers.has('Cache-Control')) headers.set('Cache-Control', REVALIDATE);
  if (pathname === '/studio/sw.js') headers.set('Service-Worker-Allowed', '/studio/');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function secureRedirect(destination, status) {
  return secureResponse(Response.redirect(destination, status), {
    cacheControl: NO_STORE,
    pathname: new URL(destination).pathname
  });
}

async function fetchAsset(request, env, options) {
  const pathname = new URL(request.url).pathname;
  try {
    return secureResponse(await env.ASSETS.fetch(request), { ...options, pathname });
  } catch {
    return secureResponse(new Response('Static content is temporarily unavailable.', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    }), { cacheControl: NO_STORE, pathname });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    const path = url.pathname;
    const canonical = (nextPath, status = 301) =>
      secureRedirect('https://materiallogix.com' + nextPath + url.search + url.hash, status);

    if (host === 'app.materiallogix.com' || host === 'studio.materiallogix.com') {
      if (path === '/voice' || path === '/voice.html') return canonical('/studio/voice.html');
      if (path === '/' || path === '/index.html') return canonical('/studio/');
      return canonical(path === '/studio' || path.startsWith('/studio/') ? path : '/studio' + path);
    }
    if (host === 'voice.materiallogix.com') return canonical('/studio/voice.html');
    if (host === 'demo.materiallogix.com') {
      return secureRedirect('https://materiallogix.com/studio/?demo=1', 302);
    }
    if (host === 'legal.materiallogix.com') {
      return canonical(path === '/legal' || path.startsWith('/legal/') ? path : '/legal' + (path === '/' ? '/' : path));
    }
    if (host === 'www.materiallogix.com') return canonical(path);

    if (path === '/app' || path === '/app/') return canonical('/studio/');
    if (path.startsWith('/app/')) return canonical('/studio/' + path.slice('/app/'.length));
    if (path === '/voice') return canonical('/studio/voice.html', 302);

    // Only the answer, never the country: the page needs to know which
    // acknowledgement to show, not where the customer is. Never cached, so a
    // shared cache cannot hand one region's answer to another.
    if (path === '/region') {
      return secureResponse(new Response(
        JSON.stringify({ withdrawalRights: withdrawalRightApplies(request) }),
        { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      ), { cacheControl: NO_STORE, pathname: path });
    }

    if (path === '/studio/sw.js') {
      return fetchAsset(request, env, { cacheControl: SERVICE_WORKER_NO_STORE });
    }

    return fetchAsset(request, env);
  }
};
