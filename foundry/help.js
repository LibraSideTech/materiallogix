'use strict';

/**
 * Help page wiring: the support contact, in one place.
 *
 * FOUNDRY_SUPPORT_EMAIL is the existing MaterialLogix support address, taken from the Studio
 * site's contact page (site/contact.html in the Studio repository), not a new one. Change it here and
 * the page follows; the addresses written into help.html are only the no-script fallback and must
 * be kept in step with this constant.
 */
const FOUNDRY_SUPPORT_EMAIL = 'admin@materiallogix.com';

/** Which runtime the founder is in, so a report says desktop app or browser without asking. */
function helpRuntime() {
  // The store app sets a narrow window.foundryDesktop too (its on-device Ask bridge), so check for
  // the native shell first or every phone report would say "desktop app".
  if (window.Capacitor?.isNativePlatform?.()) return 'Foundry mobile app';
  return window.foundryDesktop ? 'Foundry desktop app' : 'Foundry in a browser';
}

/**
 * Browser family and OS only — never the full user-agent string, which is detailed enough to help
 * fingerprint a device (FOUNDRY_RESEARCH_AND_EDITIONS_PLAN.md §2.1 lists it as must-never-leave).
 */
function coarseBrowser() {
  const ua = navigator.userAgent || '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'other browser';
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS'
    : /Linux/.test(ua) ? 'Linux' : 'other OS';
  return `${browser} on ${os}`;
}

/**
 * The support mail link. A fixed template plus coarse runtime facts: it never carries anything
 * from the founder's intake, plan or documents (the egress tests and canary QA check this).
 */
function supportMailto(kind) {
  const subject = kind === 'issue' ? 'Foundry issue report' : 'Foundry help';
  // A template, not data: nothing about the founder's business is added, only what they type.
  const body = kind === 'issue'
    ? [
        'What I was doing:',
        '',
        'What happened:',
        '',
        'What I expected:',
        '',
        'Screen (Instant Build, Documents, Review, Help):',
        '',
        `Running: ${helpRuntime()}`,
        `Screen size: ${window.innerWidth}x${window.innerHeight}`,
        `Browser: ${coarseBrowser()}`,
      ].join('\n')
    : '';
  const params = [`subject=${encodeURIComponent(subject)}`];
  if (body) params.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${FOUNDRY_SUPPORT_EMAIL}?${params.join('&')}`;
}

for (const link of document.querySelectorAll('[data-support]')) {
  link.href = supportMailto(link.dataset.support);
}
const address = document.getElementById('supportAddress');
if (address) {
  address.href = `mailto:${FOUNDRY_SUPPORT_EMAIL}`;
  address.textContent = FOUNDRY_SUPPORT_EMAIL;
}

// Opening a question from a link (help.html#faq) should not leave the answer folded away.
if (location.hash === '#faq') document.querySelector('.help-faq details')?.setAttribute('open', '');
