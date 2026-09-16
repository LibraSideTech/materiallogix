// Inworld premium stock voices only. This never touches voice cloning -
// personal voice profiles stay on-device via the existing Chatterbox pack
// system in personal-geometry-pack.js and its siblings; nothing here reads
// or sends a customer's own recorded voice.
import { apiUrl } from './api-root.js';

// The provider bills and limits per character. The page has to know the same
// number the worker enforces, or a script over it comes back as a bare
// "invalid text" after the customer has already waited for the request.
// test/premium-voice.test.mjs pins the two together.
export const PREMIUM_VOICE_MAX_CHARACTERS = 4000;
export const PREMIUM_VOICE_CONSENT_NOTICE =
  'Premium voice sends the script text on screen - not your voice or any recording - to Inworld, ' +
  'a third-party narration service, so it can be read aloud in one of their studio voices. Nothing ' +
  'about your own voice or likeness is ever sent for this feature.';

export class PremiumVoiceAllowanceExhaustedError extends Error {
  constructor(includedSecondsRemaining) {
    super('premium_voice_allowance_exhausted');
    this.includedSecondsRemaining = includedSecondsRemaining;
  }
}

/**
 * @param {{ text: string, voiceId: string, consentAccepted: boolean }} input
 * @param {typeof fetch} fetcher
 */
export async function synthesizePremiumVoiceNarration({ text, voiceId, consentAccepted }, fetcher = fetch) {
  if (!consentAccepted) throw new Error('premium_voice_consent_required');
  const response = await fetcher(apiUrl('/api/voice/premium/synthesize'), {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voiceId }),
    signal: AbortSignal.timeout(30_000)
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 402 && result.error === 'premium_voice_allowance_exhausted') {
    throw new PremiumVoiceAllowanceExhaustedError(result.includedSecondsRemaining ?? 0);
  }
  if (!response.ok) throw new Error(result.error || 'premium_voice_request_failed');
  return result;
}
