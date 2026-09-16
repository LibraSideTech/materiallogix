// Shared navigation and fail-closed production access boundary. Authentication
// decisions belong to the same-origin server/edge, never downloadable JavaScript.

import { apiUrl } from './api-root.js';
import { APP_VERSION, MINIMUM_COMPATIBLE, versionBehind } from './app-version.js';

function addAdminLink() {
  if (location.pathname.toLowerCase().endsWith('/admin.html') || document.querySelector('#mlAdminLink')) return;
  const link = Object.assign(document.createElement('a'), {
    id: 'mlAdminLink', href: 'admin.html', textContent: 'Admin',
    className: 'btn sm', style: 'text-decoration:none'
  });
  // Prefer the existing "More" dropdown pattern where a page has one;
  // studio-nav.js runs on every page and page layouts aren't identical
  // (only index.html/voice.html currently have .topbar-more-menu), so fall
  // back to the topbar itself rather than doing nothing.
  const moreMenu = document.querySelector('.topbar-more-menu');
  const topbar = document.querySelector('.topbar, header.topbar');
  if (moreMenu) moreMenu.prepend(link);
  else if (topbar) topbar.append(link);
}

async function enforceAccessBoundary() {
  const params = new URLSearchParams(location.search);
  const local = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
  const demo = params.get('demo') === '1';
  if (local || demo) {
    document.documentElement.dataset.accessMode = demo ? 'demo' : 'local';
    return;
  }

  let authenticated = false;
  try {
    const response = await fetch(apiUrl('/api/session'), {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    if (response.ok) {
      const session = await response.json();
      authenticated = session?.authenticated === true;
      // Convenience only: showing this link changes nothing about who can
      // actually use /admin.html, since every admin API call independently
      // re-checks assertAdmin() against ADMIN_EMAIL_HASHES server-side.
      if (session?.isAdmin === true) addAdminLink();
    }
  } catch { /* Fail closed. */ }
  if (authenticated) {
    document.documentElement.dataset.accessMode = 'authenticated';
    return;
  }

  // The site is public: an unauthenticated visitor lands straight in the
  // free lane. Paid capability stays gated where it always was - at export
  // authorization and entitlements - never at the front door.
  document.documentElement.dataset.accessMode = 'demo';
}

await enforceAccessBoundary();

// Installed copies check the live stamp once per boot. The hosted app is
// always current, so it skips.
async function checkForUpdates() {
  if (location.hostname === 'materiallogix.com') return;
  let stamp;
  try {
    const response = await fetch('https://materiallogix.com/studio/version.json', {
      cache: 'no-store', signal: AbortSignal.timeout(4000)
    });
    if (!response.ok) return;
    stamp = await response.json();
  } catch { return; }
  // A fetched value never reaches innerHTML: only strict semver is trusted,
  // and the bar is built from text nodes.
  const semver = /^\d+\.\d+\.\d+$/;
  if (!semver.test(stamp?.version || '') || !versionBehind(APP_VERSION, stamp.version)) return;
  const blocking = semver.test(stamp?.minimum || '') && versionBehind(APP_VERSION, stamp.minimum);
  const bar = document.createElement('div');
  bar.id = 'mlUpdateBar';
  bar.setAttribute('role', blocking ? 'alertdialog' : 'status');
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483000;display:flex;gap:14px;align-items:center;justify-content:center;padding:12px 18px;background:#171512;color:#f4efe4;border-top:1px solid #d6b26e;font:500 13px/1.4 Inter,sans-serif';
  const message = document.createElement('span');
  message.textContent = blocking
    ? 'This copy is too old to work correctly. Update to continue.'
    : `A newer Studio (${stamp.version}) is available.`;
  const link = document.createElement('a');
  link.href = 'https://materiallogix.com/#access';
  link.textContent = 'Get the update';
  link.style.cssText = 'color:#171512;background:#d6b26e;padding:7px 14px;border-radius:9px;text-decoration:none;font-weight:600';
  bar.append(message, link);
  if (!blocking) {
    const later = document.createElement('button');
    later.textContent = 'Later';
    later.style.cssText = 'background:none;border:1px solid #4a4438;color:#a69c86;padding:7px 12px;border-radius:9px;cursor:pointer';
    later.onclick = () => bar.remove();
    bar.append(later);
  } else {
    document.querySelector('#app')?.setAttribute('inert', '');
  }
  document.body.append(bar);
}
checkForUpdates();

// index.html hosts both Photo and Video, so the URL alone cannot say which
// Studio the chrome is wrapping; the entrance records the choice on the way in.
function activeStudioName() {
  const here = location.pathname.toLowerCase();
  if (here.endsWith('/voice.html') || here.endsWith('/voice')) return 'Voice';
  if (here.endsWith('/music.html') || here.endsWith('/music')) return 'Music';
  try {
    const startProduct = sessionStorage.getItem('mlx:start-product');
    if (startProduct === 'video') return 'Video';
    if (startProduct === 'photo') return 'Photo';
  } catch { /* unavailable */ }
  return 'Studio';
}

// The topbar used to read "Studio" and "Review" on every page, so Video Studio
// introduced itself as Review and no page said which Studio you were in.
const studioName = activeStudioName();
const brandSuffix = document.querySelector('.topbar .brand .brand-studio');
if (brandSuffix) brandSuffix.textContent = `${studioName} Studio`;
const breadcrumbHere = document.querySelector('.topbar .breadcrumbs b');
if (breadcrumbHere) breadcrumbHere.textContent = studioName;

await import('./privacy.js');
