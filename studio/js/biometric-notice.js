// The written notice shown before a voice profile is created.
//
// Biometric laws want three things before capture: written notice of what is
// collected, the specific purpose and how long it is kept, and a written
// release. The wording below is that notice. It is versioned and hashed so a
// consent taken today can be reproduced exactly, word for word, years later.
// Change the wording and you must change the version with it.

export const NOTICE_VERSION = '2026-08-30.1';

export const NOTICE_TEXT = [
  'Before MaterialLogix Studio creates a personal voice profile, you need to know what it is collecting and agree to it in writing.',
  'What is collected: recordings of a specific person’s voice, and the voice profile derived from them. That profile can identify the person who spoke, so it is treated as biometric information.',
  'The one purpose: to create and operate this voice profile so it can generate speech in that voice inside the product. It is not used to identify anyone, to train shared models, or for advertising.',
  'How long it is kept: until the profile is deleted or consent is withdrawn, and in every case no later than three years after the last interaction with this account. Withdrawing consent starts destruction of the profile and the recordings behind it.',
  'It is never sold: we do not sell, lease, trade, or otherwise profit from voice profiles or the recordings behind them.',
  'Age: voice profiles are for adults. The person whose voice this is must be 18 or older.',
  'If the voice is not yours: the person who spoke must have given you their informed consent before you recorded them, and they may withdraw it directly with us at any time.'
].join('\n');

export const CONFIRMATIONS = [
  { id: 'adult', label: 'The person whose voice this is is 18 or older.' },
  { id: 'rights', label: 'I am that person, or I have their informed consent to record and use their voice.' },
  { id: 'purpose', label: 'I have read the notice above and agree to the purpose and retention it describes.' }
];

/** The exact bytes the person read, hashed. Both sides compute this the same way. */
export async function noticeDigest(text = NOTICE_TEXT, subtle = globalThis.crypto?.subtle) {
  const bytes = new TextEncoder().encode(text);
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * A consent is complete only when every confirmation is ticked and the notice
 * that was shown is the notice we are recording.
 */
export function consentComplete({ confirmations = {}, noticeVersion, subject } = {}) {
  const everyBoxTicked = CONFIRMATIONS.every(item => confirmations[item.id] === true);
  const knownSubject = subject === 'self' || subject === 'third_party';
  return everyBoxTicked && knownSubject && noticeVersion === NOTICE_VERSION;
}

/** The payload sent to the server. It carries no voice data and no names. */
export async function consentRecord({ confirmations, subject, occurredAt = Date.now() }) {
  return {
    noticeVersion: NOTICE_VERSION,
    noticeText: NOTICE_TEXT,
    noticeSha256: await noticeDigest(),
    subject,
    confirmations: Object.fromEntries(CONFIRMATIONS.map(item => [item.id, confirmations[item.id] === true])),
    occurredAt
  };
}
