// The pricing model — single source of truth for the site, the app, and the
// license issuer. Change numbers here, everywhere follows.
//
// Unit economics that make this safe: every render in v1 executes on the
// customer's own hardware, so marginal cost per render is zero — a user who
// renders 1,000 times costs exactly what a user who renders once costs.
// The only spend-per-use surface is the future cloud tier, which is
// prepaid-credits-only with hard caps. Subscriptions here price CAPABILITY,
// not consumption.

export const TERMS = [
  { id: 'monthly', label: 'Month-to-month', months: 1 },
  { id: 'quarterly', label: '3 months', months: 3 },
  { id: 'yearly', label: 'Annual', months: 12 }
];

export const PRODUCTS = [
  {
    id: 'voice_starter',
    plan: 'voice_starter', selectedProduct: 'voice',
    name: 'Voice Starter',
    monthly: 5,
    totals: { monthly: 5 },
    pitch: '30 finished local voice minutes each month and one active personal voice profile.'
  },
  {
    id: 'single_photo',
    plan: 'single', selectedProduct: 'photo',
    name: 'Single Studio — Photo',
    monthly: 15,
    totals: { monthly: 15, quarterly: 40, yearly: 140 },
    pitch: 'Photo direction, review, and delivery.'
  },
  {
    id: 'single_video',
    plan: 'single', selectedProduct: 'video',
    name: 'Single Studio — Video',
    monthly: 15,
    totals: { monthly: 15, quarterly: 40, yearly: 140 },
    pitch: 'Video direction, editing, and accepted render features.'
  },
  {
    id: 'single_voice',
    plan: 'single', selectedProduct: 'voice',
    name: 'Single Studio — Voice',
    monthly: 15,
    totals: { monthly: 15, quarterly: 40, yearly: 140 },
    pitch: 'Voice direction and accepted local voice features.'
  },
  {
    id: 'single_pro_photo',
    plan: 'singlePro', selectedProduct: 'photo',
    name: 'Single Studio Pro — Photo',
    monthly: 25,
    totals: { monthly: 25, quarterly: 67, yearly: 235 },
    pitch: 'Photo, at pro quality — deliver up to 12288 px instead of 4096, plus Generative Fill (Beta, local engine required).'
  },
  {
    id: 'single_pro_video',
    plan: 'singlePro', selectedProduct: 'video',
    name: 'Single Studio Pro — Video',
    monthly: 25,
    totals: { monthly: 25, quarterly: 67, yearly: 235 },
    pitch: 'Video, at pro quality — the Pro Motion Engine, for work that has to hold up on a big screen.'
  },
  {
    id: 'single_pro_voice',
    plan: 'singlePro', selectedProduct: 'voice',
    name: 'Single Studio Pro — Voice',
    monthly: 25,
    totals: { monthly: 25, quarterly: 67, yearly: 235 },
    pitch: '5 personal voice profiles on your own device, plus 120 minutes of premium natural voice each month.'
  },
  {
    id: 'full',
    plan: 'full', selectedProduct: null,
    name: 'Full Studio',
    monthly: 29,
    totals: { monthly: 29, quarterly: 77, yearly: 275 },
    pitch: 'Photo, Video, Voice, and Music in one license.'
  },
  {
    id: 'full_pro',
    plan: 'fullPro', selectedProduct: null,
    name: 'Pro Studio',
    monthly: 39,
    totals: { monthly: 39, quarterly: 104, yearly: 366 },
    pitch: 'Photo, Video, Voice, and Music together, at pro quality.'
  }
];

/** Price for a product on a term, and the effective monthly rate. */
export function price(productId, termId) {
  const p = PRODUCTS.find(x => x.id === productId);
  const t = TERMS.find(x => x.id === termId);
  if (!p || !t) return null;
  const total = p.totals[termId];
  if (total === undefined) return null;
  const baseline = p.monthly * t.months;
  const savings = baseline - total;
  return { total, perMonth: +(total / t.months).toFixed(2), months: t.months,
    savings, savingsPercent: baseline === total ? 0 : +((savings / baseline) * 100).toFixed(1) };
}

// ---------------------------------------------------------------------------
// Monthly production-unit policy. Limits are enforced consistently across
// the site, application, and license service.
//   1 unit  = one clean image render (export crop)
//   UPSCALING CONSUMES NO UNITS: local upscaling (image and video) is
//   unlimited on every paid plan. Renders are
//   metered; enhancement is not. Video ships 1080-first; 4K is opt-in.
//   1 unit  = one minute of rendered voice (rounded up per render)
//   4 units = one minute of rendered video
// Local renders cost us $0, so units price VALUE, not cost — overage can
// never bleed money. Cloud jobs are separate prepaid credits on top.

export const MONTHLY_UNITS = { voice_starter: 30, single: 500, singlePro: 500, full: 1000, fullPro: 1000 };
export const CLOUD_PRICING = {
  imageUpscale: { price: 0.10, unit: 'image', measuredCost: 0.0009, measuredAt: '1024px source, 4x, RTX 4090' },
  voiceRender: { price: 0.25, unit: 'minute', measuredCost: 0.00007, measuredAt: '0.34 GPU-seconds per finished minute' },
  videoUpscale: { price: 3.00, unit: 'output minute', measuredCostRegular: 0.19, measuredCostPro: 0.59 },
  minimumRefill: 10,
  maximumRefill: 500,
  prepaidOnly: true,
  autoCharge: 'optional-explicit-opt-in'
};

export const CLOUD_BILLING_INCREMENT_SECONDS = 10;

/** Convert wallet cents to whole billable Video time without promising a
 * partial block the customer cannot spend. */
export function cloudVideoSecondsForCents(amountCents) {
  const cents = Number.isFinite(Number(amountCents)) ? Math.max(0, Math.floor(Number(amountCents))) : 0;
  const blockCents = Math.round(CLOUD_PRICING.videoUpscale.price * 100 * CLOUD_BILLING_INCREMENT_SECONDS / 60);
  return Math.floor(cents / blockCents) * CLOUD_BILLING_INCREMENT_SECONDS;
}

/** Quote one compiled cloud package. Duration is rounded once at job level,
 * never once per frame or clip. Money is returned in cents for safe billing. */
export function quoteCloudJob({ kind, durationSeconds = 0, imageCount = 0 }) {
  if (kind === 'image') {
    const count = Math.max(1, Math.ceil(Number(imageCount) || 0));
    return { kind, billedSeconds: 0, blocks: count, amountCents: count * 10 };
  }
  const seconds = Math.max(0, Number(durationSeconds) || 0);
  const billedSeconds = Math.ceil(seconds / CLOUD_BILLING_INCREMENT_SECONDS) * CLOUD_BILLING_INCREMENT_SECONDS;
  const rate = kind === 'voice' ? CLOUD_PRICING.voiceRender.price : CLOUD_PRICING.videoUpscale.price;
  return {
    kind,
    billedSeconds,
    blocks: billedSeconds / CLOUD_BILLING_INCREMENT_SECONDS,
    amountCents: Math.round((billedSeconds / 60) * rate * 100)
  };
}

// Cloud video processing is one batched provider job per video. The cost is no
// longer an estimate: both paths were rendered on a rented RTX 4090 at $0.34/hr
// and timed (see docs/TIER_AND_PRICING_MATRIX.md and the evidence JSON behind
// docs/VIDEO_PHYSICS_TIER_COMPARISON.md). Keyframes are included, since FLF2V
// needs two per clip.
//
// The gate on this lane was: prove the full $20 benefit costs <=$5, target <=$3.
// At the measured pro cost, $20 at $3/minute is 6.67 output minutes for $3.93,
// so the gate is met ON COST. It stays disabled because cost was not the only
// blocker: provisioning a pod took 23-40 minutes of billed model downloading
// before the first frame, which dwarfs the marginal numbers below on sporadic
// traffic. These figures are honest only behind a warm pool or the models
// network volume, which cuts start-up to about 2 minutes.
export const CLOUD_VIDEO = {
  // 4K is reachable through the cloud path, which doubles the delivery spec.
  // The local pipeline stops at the 1080 delivery specs in tools/video_ops.py,
  // so this is a ceiling for cloud work and not a blanket product capability.
  maxOutput: '4K',            // cloud resolution ceiling
  maxJobMinutes: 5,           // per-job length cap
  // Must mirror includesVideoPlan in workers/license-service.ts, which is what
  // actually grants the credit. The credit follows the Video studio, so a
  // per-product plan earns it only when Video is the studio chosen, while the
  // all-studio plans earn it outright. The Pro keys were missing here long
  // after the Pro plans were sellable, which read as "Pro gets no credit" to
  // anyone checking the app side.
  includedPromotionalCents: { videoSingle: 2000, videoSinglePro: 2000, full: 2000, fullPro: 2000 },
  includedEquivalentSeconds: 400,
  pricePerMinute: 3,
  measuredCostPerOutputMinute: { regular: 0.19, pro: 0.59 },
  measuredCostExcludesProvisioning: true,
  productionEnabled: false
};

// Public Stripe Checkout stays closed until accounts, catalog, and production
// billing evidence are live. Marketing may describe plans; it must not sell them.
export const PUBLIC_CHECKOUT_OPEN = false;

// Quality lanes: what each tier's renders run through. Free is a real
// preview lane — capable, capped, and always watermarked. Paid licenses use
// the production profile for the product or products they include.
//
// This table is enforced, not descriptive. js/app.js imports laneFor and
// resolves the lane from the licence before it renders or exports, and
// test/node.test.mjs asserts both the import and that call site so the table
// cannot quietly go back to being documentation.
//
// `video.model` follows the committed recommendation in
// docs/VIDEO_PHYSICS_TIER_COMPARISON.md: the tier split is single-keyframe vs
// pinned-endpoint (FLF2V), and 14B buys visibly better motion for ~5x the wall
// clock at a few cents more GPU time. FLF2V itself is NOT a paid gate: without
// it small handheld objects drift with no hand causing them, which reads as
// broken rather than as a cheap tier.
export const LANES = {
  free: {
    label: 'Preview lane',
    voice: { maxWords: 60, stamped: true, knobs: true },
    // Free gets the SAME regular-tier video path as paid Single, pinned endpoint
    // included. What free does not get is a clean file: the preview is
    // watermarked and 720p until the export is paid for (VIDEO_PAY_PER_EXPORT).
    video: { model: 'wan2.2-ti2v-5B', flf2v: true, note: 'regular tier; watermarked until exported' },
    // Same general model as paid, delivered at 2x. The tier split is the
    // delivery size, not the model: free used to get the anime model, which
    // smooths live footage into cartoon.
    upscale: { model: 'realesrgan-x4plus', factor: '2×' },
    imageExport: 'proof only (watermark + 960px)',
    imageMaxEdge: 960,
    videoExport: 'proof only (visual + audible watermark, 720p)',
    packs: 0, clientLinks: 0
  },
  paid: {
    label: 'Studio lane',
    voice: { maxWords: Infinity, stamped: false, knobs: true },
    video: { model: 'wan2.2-ti2v-5B', flf2v: true, note: 'pinned endpoint; ~1.5 min per clip' },
    upscale: { model: 'realesrgan-x4plus', factor: '4×' },
    imageExport: 'clean, up to 4096 px on the long edge',
    imageMaxEdge: 4096,
    videoExport: 'clean, platform spec',
    packs: 5, clientLinks: 25
  },
  // Full Studio only. Same licensing family, same GPU dollars to within cents;
  // what it really costs the customer is patience (~7.4 min per clip vs ~1.5).
  studioPro: {
    label: 'Studio Pro lane',
    voice: { maxWords: Infinity, stamped: false, knobs: true },
    video: { model: 'wan2.2-i2v-A14B', flf2v: true, note: 'pinned endpoint; ~7.4 min per clip' },
    upscale: { model: 'realesrgan-x4plus', factor: '4×' },
    imageExport: 'clean, up to 12288 px on the long edge',
    imageMaxEdge: 12288,
    videoExport: 'clean, platform spec',
    packs: 5, clientLinks: 25
  }
};

/** Long-edge ceiling a license may deliver a finished still at. */
export function imageExportCeiling(license, product = 'photo') {
  return laneFor(license, product).imageMaxEdge;
}

export const VOICE_STARTER_LANE = Object.freeze({
  ...LANES.paid,
  label: 'Voice Starter lane',
  voice: Object.freeze({ maxWords: Infinity, stamped: false, knobs: true, quality: 'standard', batch: false, multiTake: false }),
  packs: 1,
  clientLinks: 0
});

export function laneFor(license, product) {
  if (!license) return LANES.free;
  const chosen = license.selected_product ?? license.selectedProduct;
  if (license.plan === 'voice_starter' && product === 'voice') return VOICE_STARTER_LANE;
  // Pro Studio is pro quality across every covered Studio, including Music.
  if (license.plan === 'fullPro') return LANES.studioPro;
  // Single Studio Pro buys pro quality for the ONE studio it was bought for,
  // and nothing at all for the others — exactly like regular Single. Letting
  // one Single Pro purchase unlock pro quality everywhere would leave nobody a
  // reason to buy Pro Studio. Music has no Single SKU, so Single Pro never
  // reaches it.
  if (license.plan === 'singlePro') return chosen === product ? LANES.studioPro : LANES.free;
  // Full Studio is all four Studios at regular quality. It resolved to the pro
  // lane while it was the top tier; with Pro Studio above it, that would have
  // given away the thing Pro Studio sells.
  if (license.plan === 'full') return LANES.paid;
  if (license.plan === 'single') return chosen === product ? LANES.paid : LANES.free;
  return LANES.free;
}

export function hasProAccess(license, product) {
  if (!license || String(license.plan).startsWith('suspended:')) return false;
  const chosen = license.selected_product ?? license.selectedProduct;
  return license.plan === 'fullPro' || (license.plan === 'singlePro' && chosen === product);
}

// --- Music Studio entitlement ----------------------------------------------

// Music is the fourth Studio. Full Studio and Pro Studio include it: covers()
// in js/license.js and planCoversProduct in workers/lib/plan-access.ts both
// grant it, and this file's laneFor agrees. What does NOT exist is a standalone
// Music plan -- there is no single_music SKU, so Music cannot be bought on its
// own and a Single Studio bought for another product does not reach it.
//
// Do not add a second gate here. An earlier revision of this file refused Music
// export on every plan on the grounds that it "was not on sale", which quietly
// took the Studio away from Full and Pro Studio customers who are entitled to
// it. Entitlement is answered in one place; this only maps it onto capacity.

// Capacity per tier, per docs/MUSIC_ACCEPTANCE.md. Free Preview is a full
// preview of Pro creation -- the same track ceiling and the same render depth --
// because what is bought is the export, not the workspace.
// stemExport is permission to DOWNLOAD stems; stemAuthoring is permission to
// build and hear them. The two differ, and only for stems: the preview can
// author stems and is stopped at the download, while Standard cannot author
// them at all. Collapsing that into one flag made free and Standard look
// identical on stems when in use they are opposite, and anything reading only
// the delivery flag inherits that blindness without noticing.
export const MUSIC_TIERS = Object.freeze({
  free: Object.freeze({ maxTracks: 64, exportBitDepth: 24, stemAuthoring: true, stemExport: false }),
  standard: Object.freeze({ maxTracks: 24, exportBitDepth: 16, stemAuthoring: false, stemExport: false }),
  pro: Object.freeze({ maxTracks: 64, exportBitDepth: 24, stemAuthoring: true, stemExport: true })
});

/**
 * The Music Studio's entitlement, resolved from a verified licence. Derived
 * from laneFor and hasProAccess so it cannot drift from the rest of the app;
 * test/music-entitlement.test.mjs cross-checks all three against covers().
 */
export function musicAccessFor(license) {
  const tier = hasProAccess(license, 'music') ? 'pro'
    : laneFor(license, 'music') !== LANES.free ? 'standard'
      : 'free';
  const shape = MUSIC_TIERS[tier];
  return tier === 'free'
    ? { tier, ...shape, canExport: false, reason: 'payment_required' }
    : { tier, ...shape, canExport: true, reason: null };
}

// --- Allowance metering (per calendar month, local) -------------------------

const USAGE_KEY = () => 'cros:usage:' + new Date().toISOString().slice(0, 7);

export function usageThisMonth() {
  try { return JSON.parse(localStorage.getItem(USAGE_KEY())) || { exports: 0 }; }
  catch { return { exports: 0 }; }
}

export function recordExport(units = 1) {
  const u = usageThisMonth();
  u.exports = (u.exports || 0) + units;
  try { localStorage.setItem(USAGE_KEY(), JSON.stringify(u)); } catch { /* full */ }
  return u;
}

/** Units remaining this month for any licensed plan. Free tier has none. */
export function planRemaining(license) {
  if (!license) return 0;
  const plan = String(license.plan).replace('suspended:', '');
  const cap = MONTHLY_UNITS[plan];
  if (!cap) return 0;
  const bonus = usageThisMonth().bonus || 0;      // purchased overage packs
  return Math.max(0, cap + bonus - (usageThisMonth().exports || 0));
}

// Back-compat alias.
export const liteRemaining = planRemaining;
