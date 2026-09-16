import { HOUSE_VOICE_STATUS } from './house-voices.js';

const vector = profile => [profile.pace, profile.exaggeration, profile.cfgWeight, profile.temperature];
const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]));

/**
 * What still stands between the house profiles and a public launch.
 *
 * Three separate questions, and the report keeps them apart because they have
 * different answers. Does every profile carry the metadata the casting sheet
 * needs; is every one driving its own engine voice rather than two seats
 * sharing one; and are any two seats in the same language directed so alike
 * that they would read as one performer.
 *
 * That last one is compared inside a language and not across it. A Spanish seat
 * and an English seat with neighbouring direction numbers are a different model
 * speaking a different language, and no listener could confuse them; scored
 * across the whole house, those two pairs were the only findings the audit ever
 * produced and they buried the one thing actually outstanding.
 *
 * What it does not answer is whether the rendered voices sound distinct. That
 * is a listening question, and the blinded panel in docs/HOUSE_VOICE_ACCEPTANCE.md
 * is the thing that answers it. This reports the panel as outstanding for as
 * long as any seat is still a candidate.
 */
export function auditVoiceProfiles(profiles = [], minimumDistance = 0.055) {
  const findings = [];
  const ids = new Set();
  const modelVoices = new Map();
  const known = new Set(Object.values(HOUSE_VOICE_STATUS));
  let awaitingPanel = 0;
  for (const profile of profiles) {
    if (!profile.id || ids.has(profile.id)) findings.push(`duplicate_or_missing_id:${profile.id || 'missing'}`);
    ids.add(profile.id);
    if (!profile.locale || !profile.region || !profile.description || !profile.personality || !profile.attitude || !profile.cadence || !profile.avoid) findings.push(`incomplete_metadata:${profile.id}`);
    if (!known.has(profile.status)) findings.push(`unknown_status:${profile.id}`);
    else if (profile.status === HOUSE_VOICE_STATUS.candidate) {
      awaitingPanel++;
      findings.push(`awaiting_listening_panel:${profile.id}`);
    }
    if (!profile.modelVoice) findings.push(`missing_model_voice:${profile.id}`);
    else if (modelVoices.has(profile.modelVoice)) findings.push(`shared_model_voice:${modelVoices.get(profile.modelVoice)}:${profile.id}`);
    else modelVoices.set(profile.modelVoice, profile.id);
  }
  let closest = Infinity;
  for (let i = 0; i < profiles.length; i++) for (let j = i + 1; j < profiles.length; j++) {
    if (profiles[i].engineLanguage !== profiles[j].engineLanguage) continue;
    const separation = distance(vector(profiles[i]), vector(profiles[j]));
    closest = Math.min(closest, separation);
    if (separation < minimumDistance) findings.push(`profiles_too_similar:${profiles[i].id}:${profiles[j].id}`);
  }
  return {
    status: findings.length ? 'blocked' : 'pass',
    profiles: profiles.length,
    closestParameterDistance: Number.isFinite(closest) ? +closest.toFixed(4) : null,
    findings,
    // The assignment is checked here; how the rendered seats actually sound is
    // the panel's question, not this one's.
    distinctModelVoicesAssigned: modelVoices.size === profiles.length && profiles.every(profile => profile.modelVoice),
    profilesAwaitingListeningPanel: awaitingPanel,
    humanListeningPanelRequired: awaitingPanel > 0
  };
}

export function voiceReferenceConsent({ ownerConfirmed, releaseConfirmed, purpose, retentionAccepted } = {}) {
  const authorizedSource = ownerConfirmed === true || releaseConfirmed === true;
  const complete = authorizedSource && purpose === 'voice_conditioning' && retentionAccepted === true;
  return { status: complete ? 'pass' : 'blocked', authorizedSource, purpose: purpose || null, retentionAccepted: retentionAccepted === true };
}
