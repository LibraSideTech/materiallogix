import { cloudVideoSecondsForCents, CLOUD_PRICING, PUBLIC_CHECKOUT_OPEN } from './pricing.js';
import { PRICING } from './pricing-catalog.js';
import { openBillingPortal, pendingUsageReleases } from './billing-client.js';
import { apiUrl } from './api-root.js';

const status = document.querySelector('#usageStatus');
const cards = document.querySelector('#usageCards');
const table = document.querySelector('#usageTable');
const walletStatus = document.querySelector('#walletStatus');
const walletAmount = document.querySelector('#walletAmount');
const autoThreshold = document.querySelector('#autoThreshold');
const autoRefill = document.querySelector('#autoRefill');
const autoCap = document.querySelector('#autoCap');
const card = (label, value) => `<div class="usage-card"><span class="eyebrow">${label}</span><b>${value}</b></div>`;
const safe = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[character]));
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(cents || 0) / 100);
const cents = input => Math.round(Number(input.value) * 100);
const videoTime = seconds => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(total / 60), remainder = total % 60;
  return minutes && remainder ? `${minutes}m ${remainder}s` : minutes ? `${minutes}m` : `${remainder}s`;
};
const productLabel = value => ({ photo: 'Photo', video: 'Video', voice: 'Voice', music: 'Music' }[value] || String(value || 'Studio'));

// The plan card showed the raw plan id -- a customer on Pro Studio read
// "fullPro". Names come from the same table the pricing pages present, and a
// per-product plan says which Studio it was bought for.
const PLAN_KEYS = { voice_starter: 'voiceStarter', single: 'single', singlePro: 'singlePro', full: 'full', fullPro: 'fullPro' };
const planLabel = (plan, selectedProduct) => {
  const suspended = String(plan || '').startsWith('suspended:');
  const base = String(plan || '').replace('suspended:', '');
  const name = PRICING[PLAN_KEYS[base]]?.name;
  if (!name) return base ? String(base) : 'No active plan';
  // Voice Starter is voice-only by definition, so naming the product twice adds nothing.
  const scoped = (base === 'single' || base === 'singlePro') && selectedProduct
    ? `${name} — ${productLabel(selectedProduct)}`
    : name;
  return suspended ? `${scoped} (suspended)` : scoped;
};
const activityLabel = value => ({
  proof_export: 'Watermarked proof', clean_export: 'Clean export', client_review: 'Client review file',
  contact_sheet: 'Contact sheet', upload: 'Job on your computer', cloud_submission: 'Cloud job'
}[value] || String(value || 'Activity').replaceAll('_', ' '));
const statusLabel = value => ({ settled: 'Used', voided: 'Returned', authorized: 'Held', release_pending: 'Still finishing' }[value] || String(value || 'Unknown'));
const resultLabel = item => item.status === 'voided'
  ? `Returned${item.void_reason ? ` · ${String(item.void_reason).replaceAll('_', ' ')}` : ''}`
  : item.status === 'authorized' ? 'Held until the job finishes'
    : item.status === 'settled' ? 'Counted once your file was delivered'
      : 'Will retry on its own when you are back online';

// A customer is never shown a raw API code. Known causes get a sentence, and
// anything unrecognised gets an honest generic one instead of the code itself.
const PROBLEM_REASONS = {
  request_unavailable: 'Sign in to your MaterialLogix account, or try again in a moment.',
  license_required: 'Sign in to your MaterialLogix account first.',
  unauthorized: 'Sign in to your MaterialLogix account first.',
  rate_limited: 'Too many requests at once — wait a minute and try again.',
  invalid_auto_topup: 'Those three amounts do not work together. Check them and try again.',
  wallet_unavailable: 'The cloud wallet is not available right now. Try again in a moment.'
};
const reasonFor = code => PROBLEM_REASONS[String(code)] || 'Please try again in a moment.';

async function api(path, options = {}) {
  const response = await fetch(apiUrl(path), { credentials: 'include', cache: 'no-store',
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }, ...options });
  const data = response.headers.get('Content-Type')?.includes('application/json') ? await response.json() : {};
  if (!response.ok) throw new Error(data.error || 'request_unavailable');
  return data;
}

function renderRules() {
  const refillCents = cents(walletAmount);
  const refillSeconds = cloudVideoSecondsForCents(refillCents);
  document.querySelector('#walletEstimate').textContent = Number.isInteger(refillCents) && refillCents >= 1000 && refillCents <= 50000
    ? `At the current ${money(CLOUD_PRICING.videoUpscale.price * 100)}/finished-minute rate, this adds about ${videoTime(refillSeconds)} of Video processing. Each completed package rounds once to 10 seconds.`
    : 'Choose an amount from $10 through $500 to see its current Video-time estimate.';
  document.querySelector('#autoRules').textContent = `If the verified cloud balance is at or below ${money(cents(autoThreshold))}, add exactly ${money(cents(autoRefill))}. Never spend more than ${money(cents(autoCap))} on automatic refills in a calendar month. A 15-minute cooldown, idempotency, and failure pause prevent refill loops. You can disable this immediately.`;
  document.querySelector('#walletRefill').textContent = `Review ${money(cents(walletAmount))} refill`;
}
[walletAmount, autoThreshold, autoRefill, autoCap].forEach(input => input.addEventListener('input', renderRules));
document.querySelectorAll('[data-wallet-suggestion]').forEach(button => button.onclick = () => {
  walletAmount.value = Number(button.dataset.walletSuggestion).toFixed(2); renderRules();
});
renderRules();

async function load() {
  const [data, wallet, auto] = await Promise.all([api('/api/usage'), api('/api/wallet'), api('/api/wallet/auto-topup')]);
  const includedVideoSeconds = Number.isFinite(Number(wallet.promotionalVideoSecondsAtCurrentRate))
    ? Number(wallet.promotionalVideoSecondsAtCurrentRate)
    : cloudVideoSecondsForCents(wallet.promotionalVideoCents);
  const purchasedVideoSeconds = Number.isFinite(Number(wallet.purchasedVideoSecondsAtCurrentRate))
    ? Number(wallet.purchasedVideoSecondsAtCurrentRate)
    : cloudVideoSecondsForCents(wallet.balanceCents);
  const cloudPhoto = wallet.cloudPhoto || { priceReady: false, executionAvailable: false };
  const cloudPhotoLabel = cloudPhoto.priceReady
    ? `${money(cloudPhoto.minimumCentsPerImage)} minimum · ${money(cloudPhoto.retailCentsPerMegapixel)}/MP`
    : 'Unavailable pending benchmark and price approval';
  status.textContent = `${data.period} · server-verified`;
  cards.innerHTML = [
    card('Plan', safe(planLabel(data.license?.plan, data.license?.selected_product ?? data.license?.selectedProduct))),
    card('Used this month', `${Number(data.included.used).toLocaleString()} / ${Number(data.included.limit).toLocaleString()}`),
    card('Left this month', Number(data.included.remaining).toLocaleString()),
    card('Video time included', videoTime(includedVideoSeconds)),
    card('Wallet', `${money(wallet.balanceCents)} · about ${videoTime(purchasedVideoSeconds)}`),
    card('Cloud Photo', cloudPhotoLabel),
    card('Still finishing', pendingUsageReleases().length.toLocaleString())
  ].join('');
  document.querySelector('#walletBalance').textContent = `Included Video: ${videoTime(includedVideoSeconds)} remaining (resets; no rollover) · Purchased wallet: ${money(wallet.balanceCents)}, about ${videoTime(purchasedVideoSeconds)} at the current rate · hard stop at $0.00`
    // Credit buys rendering, never delivery: laneFor() returns the preview
    // lane for an account with no plan however large the balance is, so a
    // credit-only customer exports a watermarked proof. Nothing said so.
    + ' · Credit pays for cloud rendering only. Clean delivery comes with a plan, so exports stay preview-marked whatever the balance.';
  document.querySelector('#cloudPhotoPricing').textContent = cloudPhoto.priceReady
    ? `Cloud Photo generation is quoted separately before every job: ${money(cloudPhoto.minimumCentsPerImage)} minimum per image and ${money(cloudPhoto.retailCentsPerMegapixel)} per megapixel, up to ${Number(cloudPhoto.maxVariations)} variation${Number(cloudPhoto.maxVariations) === 1 ? '' : 's'}. ${cloudPhoto.executionAvailable ? 'Execution is available.' : 'Execution remains unavailable until provider and quality acceptance pass.'} Local Photo editing and generation on this computer do not use cloud wallet funds.`
    : 'Cloud Photo generation is unavailable until its measured provider cost, customer price, rights, and output quality are accepted. Local Photo editing and generation on this computer do not use cloud wallet funds.';
  const tx = wallet.recent.map(item => `<tr><td>${safe(item.entry_type)}</td><td>${money(item.amount_cents)}</td><td>${new Date(Number(item.created_at) * 1000).toLocaleString()}</td></tr>`).join('');
  document.querySelector('#walletTransactions').innerHTML = `<table class="usage-table"><thead><tr><th>Activity</th><th>Amount</th><th>Time</th></tr></thead><tbody>${tx || '<tr><td colspan="3">No wallet transactions.</td></tr>'}</tbody></table>`;
  const promoTx = (wallet.promotionalRecent || []).map(item => `<tr><td>${safe(item.entry_type)}</td><td>${money(item.amount_cents)}</td><td>${new Date(Number(item.created_at) * 1000).toLocaleString()}</td></tr>`).join('');
  document.querySelector('#walletTransactions').insertAdjacentHTML('afterbegin', `<p class="note">Included Video time is a promotional plan benefit, not cash or a transferable wallet balance. It expires at the next paid-period boundary and is used before purchased wallet funds.</p><table class="usage-table"><thead><tr><th>Included-time activity</th><th>Value</th><th>Time</th></tr></thead><tbody>${promoTx || '<tr><td colspan="3">No included Video-time activity.</td></tr>'}</tbody></table>`);
  const settings = auto.settings || {};
  if (auto.configured) {
    autoThreshold.value = (Number(settings.threshold_cents) / 100).toFixed(2);
    autoRefill.value = (Number(settings.refill_cents) / 100).toFixed(2);
    autoCap.value = (Number(settings.monthly_cap_cents) / 100).toFixed(2);
    walletStatus.textContent = settings.enabled ? 'Automatic top-up is on.' : `Automatic top-up is off${settings.paused_reason ? ` (${settings.paused_reason.replaceAll('_', ' ')})` : ''}.`;
  } else walletStatus.textContent = 'Automatic top-up is off.';
  renderRules();
  // The privacy controls -- diagnostics, research consent, data export, voice
  // consent withdrawal and account deletion -- install themselves into the
  // topbar, but only in authenticated access mode, and nothing was ever setting
  // it. The Privacy policy promises those controls and CCPA/GDPR require the
  // deletion route, so the account page declares the mode it has just proved by
  // loading verified account data, then brings them in.
  document.documentElement.dataset.accessMode = 'authenticated';
  import('./privacy.js').catch(() => { /* Usage still works without the dialog. */ });
  const summaryRows = (data.breakdown || []).map(item => `<tr><td>${safe(productLabel(item.product))}</td><td>${safe(activityLabel(item.artifact_kind))}</td><td>${Number(item.operations).toLocaleString()}</td><td>${Number(item.included_units).toLocaleString()}</td><td>${Number(item.purchased_units).toLocaleString()}</td><td>${safe(statusLabel(item.status))}</td></tr>`).join('');
  document.querySelector('#usageBreakdown').innerHTML = `<table class="usage-table"><thead><tr><th>Studio</th><th>What happened</th><th>Jobs</th><th>From your plan</th><th>From add-ons</th><th>Result</th></tr></thead><tbody>${summaryRows || '<tr><td colspan="6">No usage in this billing period.</td></tr>'}</tbody></table>`;
  const serverRows = (data.recent || []).map(item => `<tr><td>${safe(productLabel(item.product))}</td><td>${safe(activityLabel(item.artifact_kind))}</td><td>${Number(item.requested_units)}</td><td>${Number(item.included_units)}</td><td>${Number(item.purchased_units)}</td><td>${safe(statusLabel(item.status))}</td><td>${safe(resultLabel(item))}</td><td>${new Date(Number(item.updated_at || item.created_at)*1000).toLocaleString()}</td></tr>`);
  const localRows = pendingUsageReleases().map(item => `<tr><td>Studio</td><td>Interrupted job</td><td>—</td><td>—</td><td>—</td><td>Still finishing</td><td>Will retry on its own when you are back online</td><td>${new Date(item.queuedAt).toLocaleString()}</td></tr>`);
  const rows = [...localRows, ...serverRows].join('');
  table.innerHTML = `<table class="usage-table"><thead><tr><th>Studio</th><th>What happened</th><th>Jobs</th><th>From your plan</th><th>From add-ons</th><th>Status</th><th>What that means</th><th>Updated</th></tr></thead><tbody>${rows || '<tr><td colspan="8">No production activity yet.</td></tr>'}</tbody></table>`;
}


function lockWalletWhileCheckoutClosed() {
  if (PUBLIC_CHECKOUT_OPEN) return;
  const note = document.querySelector('#walletStatus') || document.querySelector('#walletBalance');
  if (note) note.textContent = 'Cloud wallet refills stay closed until public billing opens. Local Studio work does not use this balance.';
  for (const id of ['walletRefill','autoSetup','autoEnable','autoDisable']) {
    const node = document.querySelector('#' + id);
    if (node) { node.disabled = true; node.title = 'Opens with billing'; }
  }
  for (const node of document.querySelectorAll('[data-wallet-suggestion]')) {
    node.disabled = true;
  }
}
lockWalletWhileCheckoutClosed();

document.querySelector('#walletRefill').onclick = async () => {
  if (!PUBLIC_CHECKOUT_OPEN) { walletStatus.textContent = 'Wallet refills open with billing.'; return; }
  const amountCents = cents(walletAmount);
  if (!Number.isInteger(amountCents) || amountCents < 1000 || amountCents > 50000) { walletStatus.textContent = 'Choose a refill from $10.00 through $500.00.'; return; }
  if (!confirm(`Continue to Stripe to add exactly ${money(amountCents)} to your prepaid cloud wallet? This is a one-time refill and does not enable automatic top-up.`)) return;
  walletStatus.textContent = 'Creating secure Stripe Checkout…';
  try {
    const result = await api('/api/wallet/checkout', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ amountCents }) });
    location.assign(result.url);
  } catch (error) { walletStatus.textContent = `That refill could not start. ${reasonFor(error.message)}`; }
};

// The Terms promise cancellation from the account, and consumer subscription
// rules require it to be at least as easy as signing up was. openBillingPortal
// existed and nothing called it, so there was no route to cancel anywhere in
// the product.
document.querySelector('#managePlan').onclick = async () => {
  const billingStatus = document.querySelector('#billingStatus');
  billingStatus.textContent = 'Opening your billing settings…';
  try {
    await openBillingPortal();
  } catch (error) {
    billingStatus.textContent = `Billing settings could not open. ${reasonFor(error.message)}`;
  }
};

document.querySelector('#autoSetup').onclick = async () => {
  if (!PUBLIC_CHECKOUT_OPEN) { walletStatus.textContent = 'Automatic top-up opens with billing.'; return; }
  walletStatus.textContent = 'Opening Stripe to save a payment method securely…';
  try {
    const result = await api('/api/wallet/auto-topup/setup', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } });
    location.assign(result.url);
  } catch (error) { walletStatus.textContent = `Card setup could not start. ${reasonFor(error.message)}`; }
};

document.querySelector('#autoEnable').onclick = async () => {
  if (!PUBLIC_CHECKOUT_OPEN) { walletStatus.textContent = 'Automatic top-up opens with billing.'; return; }
  renderRules();
  if (!confirm(`${document.querySelector('#autoRules').textContent}\n\nExplicitly enable this automatic billing rule?`)) return;
  walletStatus.textContent = 'Saving automatic top-up rule…';
  try {
    await api('/api/wallet/auto-topup', { method: 'POST', body: JSON.stringify({ enabled: true, confirm: true,
      thresholdCents: cents(autoThreshold), refillCents: cents(autoRefill), monthlyCapCents: cents(autoCap) }) });
    walletStatus.textContent = 'Automatic top-up is on, with the rule shown above.';
  } catch (error) { walletStatus.textContent = `Automatic top-up was not switched on. ${reasonFor(error.message)}`; }
};

document.querySelector('#autoDisable').onclick = async () => {
  try {
    await api('/api/wallet/auto-topup', { method: 'POST', body: JSON.stringify({ enabled: false }) });
    walletStatus.textContent = 'Automatic top-up is off, effective now. You can still add funds by hand.';
  } catch (error) { walletStatus.textContent = `Automatic top-up was not switched off. ${reasonFor(error.message)}`; }
};

load().catch(error => {
  status.textContent = `Your usage is unavailable. ${reasonFor(error.message)}`;
  // Leaving these on their "Loading…" placeholders reads as a hang and, for a
  // balance, as a figure that is about to appear. Say what is actually known.
  document.querySelector('#walletBalance').textContent = 'Your balance appears here once you are signed in. Cloud work cannot start without it.';
  document.querySelector('#cloudPhotoPricing').textContent = 'Cloud Photo rates appear here once you are signed in. Photo work on your own computer never uses wallet funds.';
  // A one-line message does not belong in a scrolling table: the row clipped at
  // the container edge and grew a scrollbar to reach the end of a sentence.
  cards.innerHTML = '<p class="note">This appears once you are signed in.</p>';
  for (const [selector, message] of [
    ['#usageBreakdown', 'Your usage appears here once you are signed in.'],
    ['#walletTransactions', 'Your wallet activity appears here once you are signed in.'],
    ['#usageTable', 'Your jobs appear here once you are signed in.']
  ]) {
    document.querySelector(selector).innerHTML = `<p class="note">${message}</p>`;
  }
});
