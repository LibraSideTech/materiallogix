/**
 * The privacy promise, in one place.
 *
 * The Guided Interview says it at the start and in its settings; Help says it too. Both read it
 * from here (the interview renders it, help.html's copy is checked against it by
 * packages/interview/src/privacy-copy.test.js), so the wording cannot drift between them.
 *
 * It has to stay literally true:
 *   - Business plan information lives in this browser or app on this device (plan-store.js).
 *   - The interview's optional helper is a model running on this device (loopback on desktop,
 *     Apple or Google on-device models on phones). Voice prompts are bundled audio files. Voice
 *     answers, where offered, use on-device speech recognition only.
 *   - Nothing is used to train anything; there is nothing that could.
 * Customer-facing interview copy never says "AI": it is Foundry, or the interviewer.
 *
 * RESEARCH_UPDATE_NOTE is for wherever an in-app research-data update control lives: that update
 * downloads public data only and sends nothing about the customer. Show it beside that control.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FoundryPrivacyCopy = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const PLAN_PRIVACY_PROMISE =
    "Your business plan information stays on this device. Foundry doesn't send it to MaterialLogix or anyone else, and it's never used to train anything. You can delete it at any time.";

  const RESEARCH_UPDATE_NOTE =
    'Updating research data downloads public information only. Nothing about you or your business plan is sent.';

  /** Fill every [data-privacy-promise] element on a page with the promise. */
  function fill(doc) {
    if (!doc || !doc.querySelectorAll) return;
    for (const el of doc.querySelectorAll('[data-privacy-promise]')) el.textContent = PLAN_PRIVACY_PROMISE;
    for (const el of doc.querySelectorAll('[data-research-update-note]')) el.textContent = RESEARCH_UPDATE_NOTE;
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => fill(document));
    else fill(document);
  }

  return { PLAN_PRIVACY_PROMISE, RESEARCH_UPDATE_NOTE, fill };
});
