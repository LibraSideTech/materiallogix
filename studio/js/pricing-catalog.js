export const ACTIVE_PRICE_CATALOG = Object.freeze({
  version: 'launch-2026-08-27',
  effectiveFrom: '2026-08-27',
  stage: 'launch_founding',
  currency: 'usd'
});

export const PRICING = Object.freeze({
  preview: Object.freeze({ name: 'Free Preview', totalCents: 0, billedEveryMonths: 0 }),
  voiceStarter: Object.freeze({
    name: 'Voice Starter',
    description: '30 finished local voice minutes each month and one active personal voice profile.',
    monthly: Object.freeze({ totalCents: 500, billedEveryMonths: 1 })
  }),
  single: Object.freeze({
    name: 'Single Studio',
    description: 'Choose one: Photo, Video, or Voice.',
    products: Object.freeze({
      photo: Object.freeze({
        monthly: Object.freeze({ totalCents: 1500, billedEveryMonths: 1 }),
        quarterly: Object.freeze({ totalCents: 4000, billedEveryMonths: 3 }),
        yearly: Object.freeze({ totalCents: 14000, billedEveryMonths: 12 })
      }),
      video: Object.freeze({
        monthly: Object.freeze({ totalCents: 1500, billedEveryMonths: 1 }),
        quarterly: Object.freeze({ totalCents: 4000, billedEveryMonths: 3 }),
        yearly: Object.freeze({ totalCents: 14000, billedEveryMonths: 12 })
      }),
      voice: Object.freeze({
        monthly: Object.freeze({ totalCents: 1500, billedEveryMonths: 1 }),
        quarterly: Object.freeze({ totalCents: 4000, billedEveryMonths: 3 }),
        yearly: Object.freeze({ totalCents: 14000, billedEveryMonths: 12 })
      })
    })
  }),
  singlePro: Object.freeze({
    name: 'Single Studio Pro',
    description: 'Choose one: Photo, Video, or Voice, at pro quality.',
    products: Object.freeze({
      photo: Object.freeze({
        monthly: Object.freeze({ totalCents: 2500, billedEveryMonths: 1 }),
        quarterly: Object.freeze({ totalCents: 6700, billedEveryMonths: 3 }),
        yearly: Object.freeze({ totalCents: 23500, billedEveryMonths: 12 })
      }),
      video: Object.freeze({
        monthly: Object.freeze({ totalCents: 2500, billedEveryMonths: 1 }),
        quarterly: Object.freeze({ totalCents: 6700, billedEveryMonths: 3 }),
        yearly: Object.freeze({ totalCents: 23500, billedEveryMonths: 12 })
      }),
      voice: Object.freeze({
        monthly: Object.freeze({ totalCents: 2500, billedEveryMonths: 1 }),
        quarterly: Object.freeze({ totalCents: 6700, billedEveryMonths: 3 }),
        yearly: Object.freeze({ totalCents: 23500, billedEveryMonths: 12 })
      })
    })
  }),
  full: Object.freeze({
    name: 'Full Studio',
    description: 'Photo, Video, Voice, and Music together.',
    monthly: Object.freeze({ totalCents: 2900, billedEveryMonths: 1 }),
    quarterly: Object.freeze({ totalCents: 7700, billedEveryMonths: 3 }),
    yearly: Object.freeze({ totalCents: 27500, billedEveryMonths: 12 })
  }),
  fullPro: Object.freeze({
    name: 'Pro Studio',
    description: 'Photo, Video, Voice, and Music together, at pro quality.',
    monthly: Object.freeze({ totalCents: 3900, billedEveryMonths: 1 }),
    quarterly: Object.freeze({ totalCents: 10400, billedEveryMonths: 3 }),
    yearly: Object.freeze({ totalCents: 36600, billedEveryMonths: 12 })
  })
});

export function termPresentation(plan, term, selectedProduct = null) {
  const offer = PRICING[plan];
  const isPerProductPlan = plan === 'single' || plan === 'singlePro';
  const terms = isPerProductPlan ? offer?.products?.[selectedProduct] : offer;
  // Derived from the table rather than restated, so adding a product to PRICING
  // makes it presentable in the same edit instead of throwing a second list.
  if (isPerProductPlan && !Object.prototype.hasOwnProperty.call(offer?.products ?? {}, String(selectedProduct))) {
    throw new Error('single_product_required');
  }
  const selected = terms?.[term];
  const monthly = terms?.monthly;
  if (!selected || !monthly) throw new Error('unknown_pricing_term');
  const baselineCents = monthly.totalCents * selected.billedEveryMonths;
  const savingsCents = Math.max(0, baselineCents - selected.totalCents);
  const savingsPercent = baselineCents ? savingsCents / baselineCents * 100 : 0;
  return {
    catalogVersion: ACTIVE_PRICE_CATALOG.version,
    totalCents: selected.totalCents,
    billedEveryMonths: selected.billedEveryMonths,
    monthlyEquivalentCents: Math.round(selected.totalCents / selected.billedEveryMonths),
    savingsCents,
    savingsPercent: +savingsPercent.toFixed(1),
    savingsBadge: savingsCents ? `Save ${Math.round(savingsPercent)}%` : null
  };
}

export const money = cents => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD'
}).format(cents / 100);
