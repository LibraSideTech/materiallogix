import { PRODUCTS, TERMS, price, PUBLIC_CHECKOUT_OPEN } from './pricing.js';
import { apiUrl } from './api-root.js';
import { TERMS_VERSION } from './legal-version.js';

const TERM_STORAGE = 'materiallogix:checkout-term';
const ATTRIBUTION_STORAGE = 'materiallogix:attribution';
const ANALYTICS_SESSION = 'materiallogix:analytics-session';
const ANALYTICS_API = apiUrl('/api/analytics/event');
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
const ANALYTICS_EVENTS = new Set(['page_view', 'pricing_view', 'license_activated']);

// Do not infer marketing permission from diagnostics, research, or commercial-
// insights choices: none of those choices currently describes attribution.
// This stays false until the privacy UI/API explicitly returns this dedicated
// field after an affirmative choice.
export const MARKETING_CONSENT_FIELD = 'marketingAnalytics';

export function globalPrivacyControlEnabled(navigatorObject = globalThis.navigator) {
  return navigatorObject?.globalPrivacyControl === true;
}

export function marketingConsentFromPreferences(
  preferences,
  { navigatorObject = globalThis.navigator } = {}
) {
  return !!preferences
    && preferences.configured === true
    && preferences.current === true
    && preferences[MARKETING_CONSENT_FIELD] === true
    && preferences.globalPrivacyControl !== true
    && !globalPrivacyControlEnabled(navigatorObject);
}

export async function resolveMarketingConsent({
  preferences,
  navigatorObject = globalThis.navigator
} = {}) {
  // Consent must arrive as the first-party privacy API's already-resolved
  // response. Marketing code never probes the network to discover permission.
  return marketingConsentFromPreferences(preferences, { navigatorObject });
}

function marketingValue(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 200);
}

export function normalizeReferrerOrigin(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : '';
  } catch {
    return '';
  }
}

export function collectMarketingAttribution({
  consentGranted = false,
  locationObject = globalThis.location,
  documentObject = globalThis.document,
  storage = globalThis.sessionStorage
} = {}) {
  // This return must remain ahead of every storage, location-query, and
  // referrer read. Non-consenting visits leave no marketing client state.
  if (!consentGranted) return {};

  const params = new URLSearchParams(locationObject?.search || '');
  let saved = {};
  try {
    const previous = JSON.parse(storage?.getItem(ATTRIBUTION_STORAGE) || 'null');
    if (previous && typeof previous === 'object') {
      for (const key of UTM_KEYS) {
        const value = marketingValue(previous[key]);
        if (value) saved[key] = value;
      }
      const referrer = normalizeReferrerOrigin(previous.referrer);
      if (referrer) saved.referrer = referrer;
    }
  } catch {
    saved = {};
  }
  for (const key of UTM_KEYS) {
    const value = marketingValue(params.get(key));
    if (value) saved[key] = value;
  }
  if (!saved.referrer) {
    const referrer = normalizeReferrerOrigin(documentObject?.referrer);
    if (referrer) saved.referrer = referrer;
  }
  try { storage?.setItem(ATTRIBUTION_STORAGE, JSON.stringify(saved)); } catch { /* unavailable */ }
  return saved;
}

function analyticsSession({ consentGranted = false, storage = globalThis.sessionStorage } = {}) {
  if (!consentGranted) return null;
  try {
    let value = storage?.getItem(ANALYTICS_SESSION);
    if (!value) {
      value = globalThis.crypto.randomUUID();
      storage?.setItem(ANALYTICS_SESSION, value);
    }
    return value;
  } catch {
    return globalThis.crypto.randomUUID();
  }
}

export async function consentedAttribution(options = {}) {
  const consentGranted = await resolveMarketingConsent(options);
  return collectMarketingAttribution({ ...options, consentGranted });
}

/**
 * `termsAcceptance` is the evidence half of the consent checkbox. The checkbox
 * has always been enforced, but nothing recorded it, and a clickwrap agreement
 * is enforceable only if it can be shown who accepted which version and when.
 * The version is derived from the digests of the published notices themselves
 * (js/legal-version.js), so it changes whenever any of them is edited.
 */
export function buildCheckoutPayload(sku, { attribution = {}, promotionCode = '', termsAcceptance = null } = {}) {
  return {
    sku,
    ...(Object.keys(attribution).length ? { attribution } : {}),
    ...(promotionCode ? { promotionCode } : {}),
    ...(termsAcceptance ? { termsAcceptance } : {})
  };
}

export async function sendAnalytics(event, options = {}) {
  if (!ANALYTICS_EVENTS.has(event)) return false;
  const consentGranted = await resolveMarketingConsent(options);
  if (!consentGranted) return false;

  const fetcher = options.fetcher || globalThis.fetch;
  const attribution = collectMarketingAttribution({ ...options, consentGranted });
  const session = options.operationId ? null : analyticsSession({ ...options, consentGranted });
  const operationId = options.operationId || `${session}:${event}`;
  try {
    const response = await fetcher(options.analyticsUrl || ANALYTICS_API, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        event,
        operationId,
        ...(Object.keys(attribution).length ? { attribution } : {})
      }),
      keepalive: true
    });
    return response.ok;
  } catch {
    return false;
  }
}

function selectedTerm() {
  return document.querySelector('#billingTerm')?.value || 'monthly';
}

// #checkoutStatus is not on every page that can start a checkout, and writing
// .textContent straight onto a missing node throws mid-purchase.
function setStatus(message) {
  const node = document.querySelector('#checkoutStatus');
  if (node) node.textContent = message;
}

// A button may name a plan (priced by term) or a SKU directly.
const checkoutSelector = '[data-checkout-plan], [data-checkout-sku]';

function updatePricing(termId) {
  const term = TERMS.find(item => item.id === termId) || TERMS[0];
  for (const button of document.querySelectorAll(checkoutSelector)) {
    const planId = button.dataset.checkoutPlan;
    const product = PRODUCTS.find(item => item.id === planId);
    const amount = price(planId, term.id);
    const card = button.closest('.tier, .plan');
    if (!product || !card) continue;
    if (!PUBLIC_CHECKOUT_OPEN) {
      button.disabled = true;
      button.textContent = amount
        ? `${product.name} — opens with billing`
        : `${product.name} is monthly only`;
      continue;
    }
    if (!amount) {
      button.disabled = true;
      button.textContent = `${product.name} is monthly only`;
      continue;
    }
    button.disabled = false;
    const priceNode = card.querySelector('.price');
    if (priceNode) priceNode.innerHTML = `$${amount.total}<small>/${term.months === 1 ? 'mo' : `${term.months} mo`}</small>`;
    button.textContent = `Choose ${product.name}`;
  }
  try { localStorage.setItem(TERM_STORAGE, term.id); } catch { /* unavailable */ }
}

export async function beginCheckout(button) {
  if (!PUBLIC_CHECKOUT_OPEN) {
    setStatus('Paid Checkout is not open yet. Start a free preview from the Studio — no payment was taken.');
    return;
  }
  const consent = document.querySelector('#purchaseConsent');
  if (!consent?.checked) {
    consent?.focus();
    setStatus('Review and accept the purchase terms before continuing.');
    return;
  }
  // Present only where the withdrawal right applies, and required there: the
  // Refund Policy states the exception depends on the customer acknowledging it
  // at checkout, so proceeding without it would be a term we could not rely on.
  const withdrawal = document.querySelector('#withdrawalConsent');
  const withdrawalRequired = Boolean(withdrawal) && !withdrawal.closest('[hidden]') && !withdrawal.hidden;
  if (withdrawalRequired && !withdrawal.checked) {
    withdrawal.focus();
    setStatus('Confirm you want delivery to begin at once before continuing.');
    return;
  }
  // Stamped here, at the click, rather than when the request is built: the two
  // are close together today and this is the moment being evidenced.
  const termsAcceptance = {
    version: TERMS_VERSION,
    acceptedAt: new Date().toISOString(),
    ...(withdrawalRequired ? { immediateDeliveryRequested: true } : {})
  };
  const termId = selectedTerm();
  const planId = button.dataset.checkoutPlan || '';
  const directSku = button.dataset.checkoutSku || '';
  if (!directSku && !price(planId, termId)) {
    setStatus('That plan is not available for the selected term.');
    return;
  }
  const operationId = crypto.randomUUID();
  button.disabled = true;
  setStatus('Opening secure Stripe checkout…');
  const promoField = document.querySelector('#promoCode');
  const promotionCode = promoField?.value.trim().toUpperCase() || '';
  try {
    // Checkout fulfillment is operational. Do not attach marketing data until
    // the dedicated choice above is available and enforced end to end.
    const response = await fetch(apiUrl('/api/checkout/session'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operationId },
      body: JSON.stringify(buildCheckoutPayload(directSku || `${planId}_${termId}`, {
        promotionCode,
        termsAcceptance
      }))
    });
    const result = await response.json();
    if (!response.ok || !result.url) throw new Error(result.error || 'checkout_unavailable');
    location.assign(result.url);
  } catch (error) {
    button.disabled = false;
    if (error?.message === 'invalid_promo_code') {
      setStatus('That promo code is not valid or has expired. Remove it or try another — no payment was taken.');
      promoField?.focus();
    } else if (error?.message === 'promo_code_not_applicable') {
      setStatus('That code is for a different plan. Choose the plan it applies to, or remove it — no payment was taken.');
      promoField?.focus();
    } else if (error?.message === 'promo_code_already_used') {
      setStatus('That promo code was already used on this account. Remove it to continue — no payment was taken.');
      promoField?.focus();
    } else {
      setStatus('Checkout is temporarily unavailable. No payment was taken. Please try again.');
    }
  }
}

function initializeCheckout() {
  if (typeof document === 'undefined') return;
  const buttons = [...document.querySelectorAll(checkoutSelector)];
  if (!buttons.length) return;

  const promoRow = document.querySelector('#promoRow');
  if (promoRow) promoRow.hidden = !PUBLIC_CHECKOUT_OPEN;

  const selector = document.querySelector('#billingTerm');
  if (selector) {
    let remembered = null;
    try { remembered = localStorage.getItem(TERM_STORAGE); } catch { /* unavailable */ }
    if (TERMS.some(term => term.id === remembered)) selector.value = remembered;
    selector.addEventListener('change', () => updatePricing(selector.value));
    updatePricing(selector.value);
  }
  // Page/pricing analytics intentionally remain unwired until the dedicated
  // marketing choice is available in the first-party privacy controls.
  for (const button of buttons) {
    if (!PUBLIC_CHECKOUT_OPEN) {
      button.disabled = true;
      const name = button.textContent.replace(/^Choose\s+/, '') || 'this plan';
      button.textContent = `${name} — opens with billing`;
      button.title = 'Paid Checkout is not open yet';
    }
    button.addEventListener('click', () => beginCheckout(button));
  }
  if (!PUBLIC_CHECKOUT_OPEN) {
    setStatus('Paid Checkout is not open yet. No payment can be taken from this page.');
  }
}

initializeCheckout();
