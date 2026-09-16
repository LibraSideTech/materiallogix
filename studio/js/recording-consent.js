// Whether this computer is allowed to open a microphone.
//
// Withdrawing voice consent called the account API, printed a sentence, and
// recorded nothing anywhere the Studios could read. Voice and Music both went
// straight to getUserMedia with no check at all, so a customer who had
// withdrawn consent could still be recorded by the product they withdrew it
// from. This is the state that stops that.
//
// It is deliberately local. The account is the record of what was agreed, but
// the microphone is on this device, and the block has to hold with no network.
// Audio a customer imports is untouched: the product never recorded it, so
// consent to record has nothing to say about it.

const KEY = 'cros:recording-consent-withdrawn';

/** True when recording has been switched off on this computer. */
export function recordingConsentWithdrawn(storage = globalThis.localStorage) {
  try { return storage?.getItem(KEY) === '1'; } catch { return false; }
}

/** Called when the account confirms a withdrawal, so the block survives reloads. */
export function withdrawRecordingConsent(storage = globalThis.localStorage) {
  try { storage?.setItem(KEY, '1'); } catch { /* a device that cannot store it cannot enforce it */ }
}

/** Give recording back, which is a consent decision and must be deliberate. */
export function restoreRecordingConsent(storage = globalThis.localStorage) {
  try { storage?.removeItem(KEY); } catch { /* nothing to clear */ }
}

/** What to tell someone who presses Record with consent withdrawn. */
export const RECORDING_WITHDRAWN_MESSAGE =
  'Recording is off because you withdrew voice consent. You can still import audio you already have.';
