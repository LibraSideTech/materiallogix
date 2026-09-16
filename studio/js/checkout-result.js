import { activate } from './license.js';
import { apiUrl } from './api-root.js';
import { offerCheckoutSurvey } from './checkout-survey.js';

// Activation analytics remains disabled until an end-to-end marketing choice exists.
const LICENSE_PENDING_STORE = 'materiallogix:pending-checkout';
export const WALLET_PENDING_STORE = 'materiallogix:pending-wallet-checkout';
export const CHECKOUT_REQUEST_TIMEOUT_MS = 7000;
export const CHECKOUT_POLL_DELAYS_MS = Object.freeze([0, 1000, 2000, 4000, 8000]);

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function sessionStore() {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}

export function normalizeCheckoutRecord(value, expectedFlow = 'license') {
  if (!value || typeof value !== 'object') return null;
  const sessionId = String(value.sessionId || '');
  const claim = String(value.claim || '');
  const flow = value.flow === 'wallet' ? 'wallet' : 'license';
  if (flow !== expectedFlow || !/^cs_[A-Za-z0-9_]{8,200}$/.test(sessionId) ||
      !/^[A-Za-z0-9._~-]{8,200}$/.test(claim)) return null;
  return {
    sessionId,
    claim,
    flow,
    createdAt: Number.isFinite(Number(value.createdAt)) ? Number(value.createdAt) : Date.now()
  };
}

function readPendingCheckout(storageKey, flow) {
  const target = sessionStore();
  if (!target) return null;
  try { return normalizeCheckoutRecord(JSON.parse(target.getItem(storageKey) || 'null'), flow); }
  catch { return null; }
}

function persistPendingCheckout(storageKey, record) {
  const target = sessionStore();
  if (!target) return false;
  try {
    const serialized = JSON.stringify(record);
    target.setItem(storageKey, serialized);
    return target.getItem(storageKey) === serialized;
  } catch { return false; }
}

function clearPendingCheckout(storageKey) {
  try { sessionStore()?.removeItem(storageKey); } catch { /* URL is also scrubbed only after success. */ }
}

export function scrubCheckoutReturnUrl(urlValue, marker = 'checkout') {
  const url = new URL(urlValue);
  url.searchParams.delete(marker);
  url.searchParams.delete('session_id');
  url.searchParams.delete('claim');
  return url.toString();
}

function scrubBrowserUrl(marker) {
  try { history.replaceState({}, '', scrubCheckoutReturnUrl(location.href, marker)); }
  catch { /* Recovery does not depend on cosmetic URL cleanup. */ }
}

function redactedReference(sessionId) {
  return `…${String(sessionId).slice(-10)}`;
}

function retryableError(message, status = 0) {
  const error = new Error(message || 'request_unavailable');
  error.checkoutRetryable = status === 409 || status === 408 || status === 429 || status >= 500 || status === 0;
  error.status = status;
  return error;
}

async function checkoutResult(record) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECKOUT_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(apiUrl(`/api/checkout/result?session_id=${encodeURIComponent(record.sessionId)}&claim=${encodeURIComponent(record.claim)}`), {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
      signal: controller.signal
    });
    let result = {};
    try { result = await response.json(); } catch { /* Use the structured fallback below. */ }
    if (!response.ok) throw retryableError(result.error || 'request_unavailable', response.status);
    return result;
  } catch (error) {
    if (error?.checkoutRetryable === false || error?.checkoutRetryable === true) throw error;
    const message = error?.name === 'AbortError' ? 'request_timed_out' : 'network_unavailable';
    throw retryableError(message);
  } finally {
    clearTimeout(timeout);
  }
}

export async function pollCheckoutResult(attempt, {
  delays = CHECKOUT_POLL_DELAYS_MS,
  wait = pause,
  onAttempt = () => {}
} = {}) {
  let lastError = retryableError('fulfillment_pending', 409);
  for (let index = 0; index < delays.length; index += 1) {
    if (delays[index] > 0) await wait(delays[index]);
    onAttempt(index + 1, delays.length, lastError);
    try { return await attempt(index + 1); }
    catch (error) {
      lastError = error instanceof Error ? error : retryableError('request_unavailable');
      if (lastError.checkoutRetryable === false || index === delays.length - 1) throw lastError;
    }
  }
  throw lastError;
}

function recoveryView(flow, record, host) {
  const id = `checkout-recovery-${flow}`;
  document.querySelector(`#${id}`)?.remove();
  const card = document.createElement('aside');
  card.id = id;
  card.className = 'survey-card';
  card.setAttribute('role', 'region');
  card.setAttribute('aria-label', flow === 'wallet' ? 'Wallet refill status' : 'Purchase activation status');

  const message = document.createElement('p');
  message.className = 'survey-question';
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  message.setAttribute('aria-atomic', 'true');

  const detail = document.createElement('p');
  detail.className = 'note';
  detail.textContent = `Support reference ${redactedReference(record.sessionId)}`;

  const actions = document.createElement('div');
  actions.className = 'survey-choices';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'btn sm';
  retry.textContent = 'Retry confirmation';
  retry.hidden = true;
  actions.append(retry);
  card.append(message, detail, actions);
  host.append(card);
  return { card, message, detail, retry };
}

function customerError(error, flow) {
  if (error?.message === 'invalid_claim' || error?.message === 'invalid_session') {
    return `This ${flow === 'wallet' ? 'wallet refill' : 'purchase'} return could not be verified. No access or balance change is being assumed. Contact support with the reference below.`;
  }
  if (error?.message === 'activation_failed') {
    return 'Your purchase was confirmed, but this browser could not activate it yet. Retry confirmation; your purchase record is retained.';
  }
  return `Confirmation is taking longer than expected. Your ${flow === 'wallet' ? 'refill' : 'purchase'} record is retained. Check your connection, then retry confirmation.`;
}

async function completeCheckout(record, flow, result) {
  if (flow === 'wallet') {
    if (result.kind !== 'wallet_refill' || !Number.isInteger(Number(result.amountCents))) {
      throw retryableError('wallet_confirmation_invalid');
    }
    return result;
  }
  if (!result.licenseKey) throw retryableError('fulfillment_pending', 409);
  const license = await activate(result.licenseKey);
  if (!license) throw retryableError('activation_failed');
  return { ...result, license };
}

/**
 * Recover a Stripe Checkout redirect without trusting the redirect itself as
 * proof of payment. The claim is persisted before it is removed from the URL,
 * and every automatic retry cycle is strictly bounded.
 */
export function startCheckoutRecovery({
  flow = 'license',
  marker = flow === 'wallet' ? 'wallet' : 'checkout',
  storageKey = flow === 'wallet' ? WALLET_PENDING_STORE : LICENSE_PENDING_STORE,
  host = typeof document !== 'undefined' ? document.body : null,
  onComplete = () => {}
} = {}) {
  if (typeof location === 'undefined' || typeof document === 'undefined' || !host) return null;
  const url = new URL(location.href);
  const isReturn = url.searchParams.get(marker) === 'success';
  const urlRecord = normalizeCheckoutRecord({
    sessionId: url.searchParams.get('session_id'),
    claim: url.searchParams.get('claim'),
    flow,
    createdAt: Date.now()
  }, flow);
  const storedRecord = readPendingCheckout(storageKey, flow);
  const record = isReturn && urlRecord ? urlRecord : storedRecord;
  if (!record) return null;

  // Do not remove the claim from browser history unless a verified copy exists
  // in session storage. If storage is blocked, keeping the return URL is the
  // only reload-safe recovery path.
  const persisted = isReturn && urlRecord ? persistPendingCheckout(storageKey, record) : Boolean(storedRecord);
  if (persisted) scrubBrowserUrl(marker);

  const view = recoveryView(flow, record, host);
  let cycle = null;
  const run = () => {
    if (cycle) return cycle;
    view.retry.hidden = true;
    view.retry.disabled = true;
    view.message.textContent = flow === 'wallet' ? 'Confirming your wallet refill…' : 'Confirming your purchase and activating access…';
    cycle = pollCheckoutResult(
      async () => completeCheckout(record, flow, await checkoutResult(record)),
      {
        onAttempt: (current, total) => {
          if (current > 1) view.message.textContent = `Payment confirmation is still pending. Retrying safely (${current} of ${total})…`;
        }
      }
    ).then(async result => {
      clearPendingCheckout(storageKey);
      scrubBrowserUrl(marker);
      view.message.textContent = flow === 'wallet'
        ? `${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(result.amountCents) / 100)} was confirmed in your cloud wallet.`
        : 'Your purchase is active. MaterialLogix Studio is ready.';
      view.detail.textContent = 'Confirmation complete.';
      await onComplete(result);
      if (flow === 'license') {
        globalThis.dispatchEvent(new CustomEvent('materiallogix:license-activated', { detail: { plan: result.license.plan } }));
        globalThis.refreshMaterialLogixLicense?.();
        setTimeout(() => {
          view.card.remove();
          offerCheckoutSurvey(`checkout:${record.sessionId}`);
        }, 1800);
      } else setTimeout(() => view.card.remove(), 3000);
      return result;
    }).catch(error => {
      view.message.textContent = customerError(error, flow);
      view.retry.hidden = false;
      view.retry.disabled = false;
      return null;
    }).finally(() => { cycle = null; });
    return cycle;
  };
  view.retry.addEventListener('click', run);
  void run();
  return { record, persisted, retry: run, element: view.card };
}

if (typeof document !== 'undefined' && typeof location !== 'undefined' && !/\/usage\.html$/i.test(location.pathname)) {
  startCheckoutRecovery();
}
