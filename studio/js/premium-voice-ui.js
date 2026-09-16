// Inworld premium stock voices only - gated on the same Pro entitlement as
// Voice Pro Mix. Never touches voice cloning; personal voice profiles stay
// on-device via the existing Chatterbox pack system.
import { activeLicense } from './license.js';
import { hasProAccess } from './pricing.js';
import { performancePlan } from './voice.js';
import {
  PremiumVoiceAllowanceExhaustedError, PREMIUM_VOICE_CONSENT_NOTICE,
  PREMIUM_VOICE_MAX_CHARACTERS, synthesizePremiumVoiceNarration
} from './premium-voice.js';

const $ = selector => document.querySelector(selector);
const section = $('#premiumVoiceSection');
if (section) {
  const notice = $('#premiumVoiceNotice');
  const consent = $('#premiumVoiceConsent');
  const voiceId = $('#premiumVoiceId');
  const renderButton = $('#premiumVoiceRender');
  const status = $('#premiumVoiceStatus');
  const player = $('#premiumVoicePlayer');
  const script = $('#script');
  const spanishScript = $('#spanishScript');
  const spanishApproved = $('#spanishApproved');
  const language = $('#lang');
  let entitled = false;
  let narrationUrl = '';

  if (notice) notice.textContent = PREMIUM_VOICE_CONSENT_NOTICE;

  const spanishSelected = () => language?.value === 'es';

  // The reading is of the script the studio is set to, not whichever textarea
  // comes first in the document. With Spanish selected the English box is
  // neither the copy anyone asked to have read nor the copy a translator
  // approved.
  const activeScript = () => (spanishSelected() ? spanishScript?.value : script?.value) || '';

  // Send the words, not the direction. A leading "(calm)" and the stars around
  // an emphasised word are instructions to the local performance engine; a
  // hosted reader has no idea what they are and reads them out.
  const spokenText = () => performancePlan(activeScript()).segments.map(segment => segment.text).join(' ').trim();

  // Why the button will not go, in the customer's terms. What holds it at
  // Standard is already written under the legend, so the status line does not
  // repeat it back.
  function blockingReason() {
    if (!entitled) return '';
    const text = spokenText();
    if (!consent?.checked || !text) return '';
    if (spanishSelected() && !spanishApproved?.checked) {
      return 'Spanish needs a fluent human review and approval before it is read aloud.';
    }
    if (text.length > PREMIUM_VOICE_MAX_CHARACTERS) {
      return `This script is ${text.length.toLocaleString()} characters. Premium voice reads up to ${PREMIUM_VOICE_MAX_CHARACTERS.toLocaleString()} at a time — shorten it, or render it in parts.`;
    }
    return '';
  }

  function updateRenderEnabled() {
    if (status.dataset.state === 'busy') return;
    const reason = blockingReason();
    renderButton.disabled = !entitled || !consent?.checked || !spokenText() || Boolean(reason);
    consent.disabled = !entitled;
    voiceId.disabled = !entitled;
    if (reason || status.dataset.state === 'blocked') status.textContent = reason;
    status.dataset.state = reason ? 'blocked' : '';
  }
  for (const control of [consent, script, spanishScript, spanishApproved, language]) {
    control?.addEventListener('change', updateRenderEnabled);
    control?.addEventListener('input', updateRenderEnabled);
  }

  renderButton?.addEventListener('click', async () => {
    const text = spokenText();
    if (!entitled || !text || !consent?.checked || blockingReason()) return;
    renderButton.disabled = true;
    status.dataset.state = 'busy';
    status.textContent = 'Reading your script…';
    try {
      const result = await synthesizePremiumVoiceNarration({
        text, voiceId: voiceId?.value || 'Sarah', consentAccepted: consent.checked
      });
      const bytes = Uint8Array.from(atob(result.audioBase64), char => char.charCodeAt(0));
      if (narrationUrl) URL.revokeObjectURL(narrationUrl);
      narrationUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
      player.src = narrationUrl;
      player.hidden = false;
      const remaining = Math.max(0, Math.round((result.includedSecondsRemaining ?? 0) / 60));
      status.dataset.state = '';
      status.textContent = `Done. About ${remaining} min left in your monthly allowance.`;
    } catch (error) {
      status.dataset.state = '';
      status.textContent = error instanceof PremiumVoiceAllowanceExhaustedError
        ? "This month's premium voice allowance is used up."
        : 'Premium voice generation failed. Try again in a moment.';
    } finally {
      renderButton.disabled = !entitled || !consent?.checked || !spokenText() || Boolean(blockingReason());
      consent.disabled = !entitled;
      voiceId.disabled = !entitled;
    }
  });

  addEventListener('pagehide', () => { if (narrationUrl) URL.revokeObjectURL(narrationUrl); });

  // The panel is on screen at every level. Standard sees what premium voice is
  // and what holds it; the controls simply do not operate.
  activeLicense()
    .then(license => { entitled = hasProAccess(license, 'voice'); })
    .catch(() => { entitled = false; })
    .finally(() => {
      section.hidden = false;
      section.classList.toggle('voice-locked', !entitled);
      updateRenderEnabled();
    });
}
