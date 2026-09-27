/**
 * The way into the two ways of strengthening a plan, from Documents (right after Instant Build
 * lands there) and from Instant Build's saved-plan strip: the Guided Interview (a conversation,
 * about 60–90 minutes, voice optional) and the form ("Answer the questions yourself", the same
 * question bank at the founder's own pace, in any order). Both write into the same answers, so
 * starting in one and finishing in the other keeps everything. After either one rebuilds the
 * documents, the same spot says what changed.
 *
 * Fills #interviewEntry when the page has one. Reads only this tab's copy of the interview answers
 * (to say "Resume" and to count what either mode has answered so far); never touches the network.
 */
(function interviewEntry() {
  'use strict';

  const box = document.getElementById('interviewEntry');
  if (!box) return;

  const PLAN_KEY = 'foundry.instant.context';
  const APPLIED_KEY = 'foundry.interview.applied';
  const STATE_KEY = 'foundry.interview.state';

  const read = (key) => {
    try {
      return JSON.parse(sessionStorage.getItem(key) || 'null');
    } catch {
      return null;
    }
  };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function paint() {
    const plan = read(PLAN_KEY);
    box.replaceChildren();
    box.hidden = !(plan && plan.ok);
    if (box.hidden) return;

    const state = read(STATE_KEY);
    const answered = state && state.answers ? Object.values(state.answers).filter((a) => a && a.status).length : 0;
    const applied = read(APPLIED_KEY);

    box.append(el('p', 'eyebrow', 'Make your plan stronger'));
    const title = el('h2', 'interview-entry-title', 'Make your plan stronger');
    box.append(title);
    box.append(
      el(
        'p',
        'hint',
        answered
          ? `You have answered ${answered} question${answered === 1 ? '' : 's'} so far, in either mode. Pick up where you left off; your answers are saved on this device.`
          : 'Your answers replace estimates across your documents, and anything you don’t know yet goes on your To-Do list. Two ways to give them, sharing the same questions and the same answers:',
      ),
    );
    if (applied && applied.at) {
      const moved = Number.isFinite(applied.before) && Number.isFinite(applied.after) && applied.after !== applied.before;
      box.append(
        el(
          'p',
          'interview-entry-applied',
          `Rebuilt from your answers${moved ? `: plan readiness went from ${applied.before}% to ${applied.after}%` : ''}.${applied.open ? ` ${applied.open} item${applied.open === 1 ? '' : 's'} added to your To-Do list.` : ''}`,
        ),
      );
      try {
        sessionStorage.removeItem(APPLIED_KEY);
      } catch {
        /* shown once is enough */
      }
    }
    const options = el('div', 'interview-entry-options');
    const iv = el('div', 'interview-entry-option');
    iv.append(
      el('p', 'interview-entry-option-title', 'Guided Interview'),
      el('p', 'hint', 'About 60–90 minutes. I’ll ask and you answer, in order, with voice optional.'),
    );
    const ivLink = el('a', 'btn primary', answered ? 'Resume the interview' : 'Start the Guided Interview');
    ivLink.href = './interview.html';
    iv.append(ivLink);
    const form = el('div', 'interview-entry-option');
    form.append(
      el('p', 'interview-entry-option-title', 'Answer the questions yourself'),
      el('p', 'hint', 'A form you can fill in at your own pace, in any order, with everything on one page.'),
    );
    const formLink = el('a', 'btn ghost', answered ? 'Resume the form' : 'Answer the questions yourself');
    formLink.href = './questions.html';
    form.append(formLink);
    options.append(iv, form);
    box.append(options);
  }

  paint();
  window.addEventListener('foundry:plan-restored', paint);
  window.addEventListener('foundry:plan-cleared', paint);
})();
