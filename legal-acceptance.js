// The agreement a customer accepts at checkout, shown rather than linked.
//
// A checkbox beside a link asks someone to agree to a document they were never
// shown. This puts the documents themselves in the purchase flow: the full text
// of every notice, scrollable in place, with the three that govern the purchase
// -- Terms, Refund Policy, Privacy -- having to be read to the end before the
// agreement can be accepted.
//
// The text is fetched from the published pages, never copied. site/legal/ is
// hash-pinned by docs/legal-approval-record.md, so a duplicate here would drift
// away from the approved wording and the customer would be shown one thing and
// bound by another.

const DOCUMENTS = [
  { slug: 'terms', name: 'Terms of Service', required: true },
  { slug: 'refunds', name: 'Refund Policy', required: true },
  { slug: 'privacy', name: 'Privacy', required: true },
  { slug: 'eula', name: 'Software License', required: false },
  { slug: 'aup', name: 'Acceptable Use', required: false },
  { slug: 'biometric', name: 'Voice and biometric data', required: false },
  { slug: 'security', name: 'Security', required: false },
  { slug: 'copyright', name: 'Copyright', required: false },
  { slug: 'trademark', name: 'Trademark', required: false },
  { slug: 'licenses', name: 'Open-source notices', required: false }
];

const REQUIRED = DOCUMENTS.filter(entry => entry.required);

const STYLE = `
.legal-accept{margin:22px 0 0;border:1px solid var(--hair);border-radius:14px;background:var(--card,rgba(255,255,255,.03));overflow:hidden}
.legal-accept-head{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--hair)}
.legal-accept-head h3{margin:0;font:400 17px/1.2 var(--serif,Georgia,serif)}
.legal-accept-progress{font-size:12px;color:var(--muted)}
.legal-accept-tabs{display:flex;flex-wrap:wrap;gap:6px;padding:12px 16px 0}
.legal-accept-tabs button{font:600 11px/1 var(--sans,system-ui);letter-spacing:.04em;padding:7px 11px;border:1px solid var(--hair);border-radius:999px;background:transparent;color:var(--ink);cursor:pointer;min-height:32px}
.legal-accept-tabs button[aria-selected=true]{background:var(--ink);color:var(--card,#fff);border-color:var(--ink)}
.legal-accept-tabs button[data-read=true]::after{content:" \\2713";color:var(--gold,#b98232)}
.legal-accept-body{max-height:340px;overflow-y:auto;padding:16px;margin:12px 16px 0;border:1px solid var(--hair);border-radius:10px;background:var(--glass,rgba(0,0,0,.02));font-size:13.5px;line-height:1.6}
.legal-accept-body h1{font:400 20px/1.25 var(--serif,Georgia,serif);margin:0 0 10px}
.legal-accept-body h2{font:600 14px/1.3 var(--sans,system-ui);margin:18px 0 6px}
.legal-accept-body p,.legal-accept-body li{color:var(--ink-2,inherit)}
.legal-accept-body a{color:inherit}
.legal-accept-end{margin-top:14px;padding-top:10px;border-top:1px solid var(--hair);font-size:12px;color:var(--muted)}
.legal-accept-foot{padding:14px 16px 16px}
.commerce-consent{display:flex;gap:10px;align-items:flex-start;font-size:13px}
/* An author display rule outranks the user-agent [hidden] rule, so the
   withdrawal acknowledgement would stay visible everywhere without this. */
.commerce-consent[hidden]{display:none}
.commerce-consent + .commerce-consent{margin-top:10px}
.commerce-consent input{margin-top:3px;min-width:18px;min-height:18px}
.legal-accept-hint{margin:8px 0 0;font-size:12px;color:var(--muted)}
@media (max-width:560px){.legal-accept-body{max-height:260px}}
`;

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) if (child) node.append(child);
  return node;
};

/** The published page's own content, with its site chrome and scripts removed. */
async function documentBody(slug) {
  const response = await fetch(`/legal/${slug}.html`, { credentials: 'omit' });
  if (!response.ok) throw new Error(`legal_document_unavailable:${slug}`);
  const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
  const main = parsed.querySelector('#main-content') || parsed.body;
  for (const strip of main.querySelectorAll('script,style,nav,footer,.legal-back,.topbar')) strip.remove();
  // Same-origin published copy, but the acceptance panel has no reason to run
  // anything, so nothing executable survives the copy.
  const holder = document.createElement('div');
  holder.innerHTML = main.innerHTML;
  for (const node of holder.querySelectorAll('*')) {
    for (const attribute of [...node.attributes]) {
      if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
    }
  }
  for (const link of holder.querySelectorAll('a[href]')) {
    link.target = '_blank';
    link.rel = 'noopener';
  }
  return holder.innerHTML;
}

/**
 * Build the acceptance panel. Returns a handle exposing which documents have
 * been read, so a caller can gate its own control if it needs to.
 */
export async function installLegalAcceptance(container) {
  // #purchaseConsent is an id and checkout.js reads it by id, so a second panel
  // anywhere on the page would leave two elements answering to it and the
  // checkout gate reading whichever came first.
  if (!container || document.querySelector('#purchaseConsent')) return null;
  if (!document.querySelector('#legalAcceptStyle')) {
    document.head.append(el('style', { id: 'legalAcceptStyle', textContent: STYLE }));
  }

  const read = new Set();
  const cache = new Map();
  let active = DOCUMENTS[0];

  const progress = el('p', { className: 'legal-accept-progress' });
  const body = el('div', { className: 'legal-accept-body', tabIndex: 0 });
  body.setAttribute('role', 'document');
  const tabs = el('div', { className: 'legal-accept-tabs', role: 'tablist' });
  const hint = el('p', { className: 'legal-accept-hint' });

  const consentInput = el('input', { id: 'purchaseConsent', type: 'checkbox', disabled: true });
  const consent = el('label', { className: 'commerce-consent' }, consentInput,
    el('span', {
      textContent: 'I have read and agree to the Terms of Service, Refund Policy, and Privacy policy shown above, '
        + 'including the Software License and Acceptable Use policy they incorporate. Paid plans renew at the selected '
        + 'interval until cancelled.'
    }));

  // Shown only where the withdrawal right exists. The Refund Policy says this
  // is acknowledged at checkout, so this is that acknowledgement; without it
  // the exception does not apply and the 14 days survive delivery.
  const withdrawalInput = el('input', { id: 'withdrawalConsent', type: 'checkbox', disabled: true });
  const withdrawal = el('label', { className: 'commerce-consent' }, withdrawalInput,
    el('span', {
      textContent: 'I ask MaterialLogix to begin delivery at once, so my licensed download and clean exports are '
        + 'available immediately, and I accept that my 14-day right to withdraw ends once delivery is complete. '
        + 'The voluntary 14-day refund in the Refund Policy is unaffected.'
    }));
  withdrawal.hidden = true;

  const panel = el('section', { className: 'legal-accept' },
    el('div', { className: 'legal-accept-head' },
      el('h3', { textContent: 'Your agreement' }), progress),
    tabs, body,
    el('div', { className: 'legal-accept-foot' }, consent, withdrawal, hint));

  const buttons = new Map();

  function refresh() {
    const done = REQUIRED.filter(entry => read.has(entry.slug)).length;
    progress.textContent = `${done} of ${REQUIRED.length} required documents read`;
    for (const [slug, button] of buttons) button.dataset.read = String(read.has(slug));
    const ready = done === REQUIRED.length;
    consentInput.disabled = !ready;
    withdrawalInput.disabled = !ready;
    hint.textContent = ready
      ? 'Every document above stays available to read again at any time.'
      : `Read to the end of ${REQUIRED.filter(entry => !read.has(entry.slug)).map(entry => entry.name).join(', ')} to continue.`;
  }

  function markReadIfAtEnd() {
    if (read.has(active.slug)) return;
    // A document shorter than the panel has no scrolling to do and counts as
    // read once it has been shown.
    const atEnd = body.scrollHeight - body.scrollTop - body.clientHeight <= 12;
    if (!atEnd) return;
    read.add(active.slug);
    refresh();
  }

  async function show(entry) {
    active = entry;
    for (const [slug, button] of buttons) button.setAttribute('aria-selected', String(slug === entry.slug));
    if (!cache.has(entry.slug)) {
      body.textContent = `Loading ${entry.name}…`;
      try {
        cache.set(entry.slug, await documentBody(entry.slug));
      } catch {
        body.textContent = `${entry.name} could not be loaded. Open it from the Legal page before continuing.`;
        return;
      }
    }
    body.innerHTML = cache.get(entry.slug);
    body.append(el('p', {
      className: 'legal-accept-end',
      textContent: `End of ${entry.name}.`
    }));
    body.scrollTop = 0;
    // Re-check after layout: a short document is already at its end.
    requestAnimationFrame(markReadIfAtEnd);
  }

  for (const entry of DOCUMENTS) {
    const button = el('button', {
      type: 'button',
      textContent: entry.required ? `${entry.name} *` : entry.name
    });
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', 'false');
    button.onclick = () => show(entry);
    buttons.set(entry.slug, button);
    tabs.append(button);
  }

  body.addEventListener('scroll', markReadIfAtEnd, { passive: true });
  container.append(panel);
  refresh();
  await show(DOCUMENTS[0]);

  // The edge answers from request.cf.country, which a client cannot set. If it
  // cannot answer, show the acknowledgement: an extra line for someone it does
  // not cover is cheaper than losing the exception for someone it does.
  let withdrawalRights = true;
  try {
    const response = await fetch('/region', { credentials: 'omit', cache: 'no-store' });
    if (response.ok) withdrawalRights = (await response.json())?.withdrawalRights !== false;
  } catch { /* Keep the protective default. */ }
  withdrawal.hidden = !withdrawalRights;

  return {
    hasReadRequired: () => REQUIRED.every(entry => read.has(entry.slug)),
    documentsRead: () => [...read],
    withdrawalRightsApply: () => withdrawalRights,
    accepted: () => consentInput.checked && (!withdrawalRights || withdrawalInput.checked)
  };
}
