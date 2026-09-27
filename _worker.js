// MaterialLogix host routing and Pages-compatible homepage bootstrap.

// Release gate: everything not open to the public yet lives behind this. One switch
// (the RELEASE_STAGE Pages environment variable, set to "live" to open) controls every
// gated path, so /studio/, /api/ and /foundry/ all launch together. Unset or any other
// value keeps the gate closed, which is the safe default for a fresh environment.
const GATED_PREFIXES = ['/studio/', '/api/', '/foundry/'];

function isGatedPath(path) {
  return GATED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function releaseIsLive(env) {
  return Boolean(env) && env.RELEASE_STAGE === 'live';
}

const COMING_SOON_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Coming soon · MaterialLogix</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#171615;color:#f4f0e8;font-family:Georgia,'Times New Roman',serif;text-align:center}
  main{max-width:32rem;padding:2rem}
  .eyebrow{letter-spacing:.08em;text-transform:uppercase;color:#c59a4a;font-size:.85rem}
  h1{font-size:2.25rem;margin:.5rem 0 .75rem}
  p{color:#c9c2b6;margin:0 0 1.5rem}
  a{color:#c59a4a;text-decoration:none;border:1px solid #c59a4a;padding:.6rem 1.25rem;border-radius:2px}
</style>
</head>
<body>
<main>
  <span class="eyebrow">MaterialLogix</span>
  <h1>Coming soon.</h1>
  <p>This part of MaterialLogix is not open for access yet.</p>
  <a href="/">Explore MaterialLogix</a>
</main>
</body>
</html>`;

function comingSoonResponse(path) {
  const isApi = path.startsWith('/api/');
  const headers = new Headers({
    'Content-Type': isApi ? 'application/json' : 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
    'X-MaterialLogix-Release': 'coming-soon'
  });
  const body = isApi ? JSON.stringify({ error: 'coming_soon' }) : COMING_SOON_HTML;
  return new Response(body, { status: 503, headers });
}

// Foundry's own egress lockdown (apps/foundry-ui/public/_headers in the Foundry repo):
// same-origin only, plus the loopback Ollama port the desktop/local build talks to.
// Kept byte-for-byte in step with that file.
const FOUNDRY_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:11434 http://localhost:11434; font-src 'self' data:; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'none'; manifest-src 'self'; form-action 'none'; frame-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'";

function withFoundryHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', FOUNDRY_CSP);
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=()');
  headers.set('X-MaterialLogix-Release', 'live');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    const path = url.pathname;
    const canonical = (nextPath, status = 301) =>
      Response.redirect('https://materiallogix.com' + nextPath + url.search + url.hash, status);

    if (host === 'app.materiallogix.com' || host === 'studio.materiallogix.com') {
      if (path === '/voice' || path === '/voice.html') return canonical('/studio/voice.html');
      if (path === '/' || path === '/index.html') return canonical('/studio/');
      return canonical(path === '/studio' || path.startsWith('/studio/') ? path : '/studio' + path);
    }
    if (host === 'voice.materiallogix.com') return canonical('/studio/voice.html');
    if (host === 'demo.materiallogix.com') {
      return Response.redirect('https://materiallogix.com/studio/?demo=1', 302);
    }
    if (host === 'legal.materiallogix.com') {
      return canonical(path === '/legal' || path.startsWith('/legal/') ? path : '/legal' + (path === '/' ? '/' : path));
    }
    if (host === 'www.materiallogix.com') return canonical(path);

    if (path === '/app' || path === '/app/') return canonical('/studio/');
    if (path.startsWith('/app/')) return canonical('/studio/' + path.slice('/app/'.length));
    if (path === '/voice') return canonical('/studio/voice.html', 302);
    if (path === '/foundry') return canonical('/foundry/');

    if (isGatedPath(path) && !releaseIsLive(env)) {
      return comingSoonResponse(path);
    }

    if (path === '/studio/sw.js') {
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-cache');
      return new Response(response.body, { status: response.status, headers });
    }

    if (path.startsWith('/foundry/')) {
      return withFoundryHeaders(await env.ASSETS.fetch(request));
    }

    const response = await env.ASSETS.fetch(request);
    if ((path === '/' || path === '/index.html') && response.headers.get('content-type')?.includes('text/html')) {
      return new HTMLRewriter()
        .on('body', {
          element(element) {
            element.append('<script type="module" src="/checkout-site.js?v=20260903"></script>', { html: true });
          }
        })
        .transform(response);
    }
    return response;
  }
};
