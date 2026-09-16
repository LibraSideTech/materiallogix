// When to ask a customer how a purchase went.
//
// Three rules, in order: ask only a small random share of buyers, never ask
// again once someone answers that it went well, and return exactly once to
// someone whose answer said it went badly so we can see whether it improved.
// Pure functions only — the browser pieces live in checkout-survey.js.

export const SURVEY_STORAGE = 'materiallogix:checkout-survey';
export const SAMPLE_SHARE = 0.25;
export const LOW_RATING = 3;
export const COMMENT_LIMIT = 200;

export const RATINGS = [
  { value: 1, label: 'Not great' },
  { value: 3, label: 'Fine' },
  { value: 5, label: 'Great' }
];

/** Read the saved record, tolerating absent, blocked, or corrupt storage. */
export function readRecord(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(SURVEY_STORAGE));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Decide whether to show the question after a completed purchase.
 * `roll` is injected so the decision stays deterministic under test.
 */
export function shouldAsk(record, roll = Math.random()) {
  if (!record || typeof record !== 'object') return roll < SAMPLE_SHARE;
  if (record.followUpPending === true) return true;
  if (typeof record.rating === 'number') return false;
  return roll < SAMPLE_SHARE;
}

/**
 * The record to save once the customer answers or dismisses the question.
 * A low answer earns one follow-up; a good answer closes the loop for good.
 */
export function nextRecord(record, { rating = null, dismissed = false, now = Date.now() } = {}) {
  if (dismissed) {
    return { ...(record || {}), askedAt: now, followUpPending: false };
  }
  const value = Number(rating);
  if (!Number.isInteger(value) || value < 1 || value > 5) return record || null;
  return {
    ...(record || {}),
    askedAt: now,
    answeredAt: now,
    rating: value,
    followUpPending: value <= LOW_RATING
  };
}

/** Trim a free-text answer to something safe and short enough to store. */
export function cleanComment(value) {
  if (typeof value !== 'string') return '';
  let plain = '';
  for (const character of value) {
    const code = character.codePointAt(0);
    plain += code < 32 || code === 127 ? ' ' : character;
  }
  return plain.replace(/\s+/g, ' ').trim().slice(0, COMMENT_LIMIT);
}
