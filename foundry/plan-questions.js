'use strict';

/**
 * "Complete your plan" — the questions a lender-ready business plan needs and the intake never
 * asked.
 *
 * The instant pack is built from nine answers, which is the whole promise: type a little, get a
 * real document book immediately. A plan a bank will read needs roughly fifty, and asking for
 * fifty up front would mean nobody ever sees the first document. So the questions live here,
 * afterwards, a few at a time, ordered by how much each one moves the plan.
 *
 * All the ordering, storage and scoring is in FoundryEngines.planQuestions and the pipeline; this
 * file only wires the DOM, like the other scripts on this page.
 */

const PLAN_STORAGE_KEY = 'foundry.instant.context';
/** How many to put in front of someone at once. Enough to be worth opening, few enough to finish. */
const BATCH_SIZE = 3;

function loadPlanPipeline() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(PLAN_STORAGE_KEY) || 'null');
    if (saved?.ok) return saved;
  } catch {
    /* ignore */
  }
  return null;
}

function planEngines() {
  return window.FoundryEngines?.planQuestions || null;
}

function completeness(pipeline) {
  const engines = planEngines();
  if (!engines || !pipeline) return null;
  // Only the items that apply to this plan count (see assessPlanForIntake).
  return engines.assessPlanForIntake(pipeline.intake || {});
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/** The headline: where the plan stands, in the terms a lender would use. */
function renderProgress(pipeline) {
  const score = completeness(pipeline);
  if (!score) return;
  const missing = score.critical_missing.length;
  setText('planProgressPercent', `${score.percent}%`);
  setText(
    'planProgressLine',
    missing === 0
      ? 'Every item a lender treats as mandatory is answered. What is left strengthens the plan rather than gating it.'
      : `${missing} ${missing === 1 ? 'item a lender treats as mandatory is' : 'items a lender treats as mandatory are'} still missing.`,
  );
  const bar = document.getElementById('planProgressBar');
  if (bar) {
    // Zero is drawn as an empty track, not as a sliver. Forcing a 2% minimum so the bar was
    // "visible" at 0% produced a two-pixel dot that reads as a rendering artifact rather than a
    // value; the figure beside it already says 0%, so an empty track is unambiguous. A small
    // non-zero score still gets a minimum, or 1% would be indistinguishable from none.
    bar.style.width = score.percent === 0 ? '0' : `${Math.max(4, score.percent)}%`;
    bar.parentElement?.setAttribute('aria-valuenow', String(score.percent));
  }

  // The card lives in the page header rather than inside the panel, so the score is on screen
  // before anything is clicked. A page showing a finished-looking book of documents, with no
  // indication it is a fraction of what a bank expects, gives a founder no reason to look.
  const card = document.getElementById('planStatusCard');
  if (card) card.hidden = false;

  const pack = pipeline.document_pack;
  if (pack?.documents?.length) {
    const n = pack.documents.length;
    setText('planPackLine', `${n} document${n === 1 ? '' : 's'} in this pack.`);
  }
}

let currentBatch = [];

/** One question as a field: what is being asked, why a lender wants it, and room to answer. */
function drawQuestion(q) {
  const field = document.createElement('div');
  field.className = 'field plan-question';

  const meta = document.createElement('span');
  meta.className = 'plan-question-meta';
  meta.textContent = q.critical ? `${q.section} · needed before submitting` : q.section;

  const label = document.createElement('label');
  label.setAttribute('for', `planQ_${q.id}`);
  label.textContent = q.question;

  // Why a lender wants it, not why the form wants it. That difference is the whole reason this
  // is a set of questions rather than a set of required fields.
  const why = document.createElement('span');
  why.className = 'hint';
  why.textContent = q.why;

  const input = document.createElement('textarea');
  input.id = `planQ_${q.id}`;
  input.rows = 2;
  input.placeholder = `For example: ${q.example}`;
  input.dataset.requirementId = q.id;

  // Grow with the answer where CSS field-sizing is unsupported (Safari, Firefox).
  if (!(window.CSS && CSS.supports('field-sizing', 'content'))) {
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = `${input.scrollHeight + 2}px`;
    });
  }

  field.append(meta, label, why, input);
  return field;
}

/**
 * Draws a batch and records it as the current one.
 *
 * Every field is optional. A founder who cannot answer something today leaves it blank and the
 * plan goes on reporting that item missing, which is the honest outcome — the alternative is a
 * required field that teaches people to type anything to get past it.
 */
function drawBatch(questions) {
  const list = document.getElementById('planQuestionList');
  if (!list) return;
  currentBatch = questions;
  list.replaceChildren();

  const saveBtn = document.getElementById('planSaveBtn');
  const skipBtn = document.getElementById('planSkipBtn');
  if (!questions.length) {
    const done = document.createElement('p');
    done.className = 'hint';
    done.textContent =
      'Nothing left to ask. Every question this plan needs has an answer, and the documents are built from them.';
    list.append(done);
    saveBtn?.setAttribute('hidden', '');
    skipBtn?.setAttribute('hidden', '');
    return;
  }
  saveBtn?.removeAttribute('hidden');
  skipBtn?.removeAttribute('hidden');
  for (const q of questions) list.append(drawQuestion(q));
}

/** The next few unanswered questions, skipping any the founder has stepped past this session. */
function renderQuestions(pipeline, skipIds = new Set()) {
  const engines = planEngines();
  if (!engines) return;
  const open = engines
    .nextPlanQuestions(pipeline.intake || {})
    .filter((q) => !skipIds.has(q.id));
  drawBatch(open.slice(0, BATCH_SIZE));
}

function collectAnswers() {
  const answers = {};
  for (const q of currentBatch) {
    const input = document.getElementById(`planQ_${q.id}`);
    const value = (input?.value || '').trim();
    if (value) answers[q.id] = value;
  }
  return answers;
}

/**
 * The revenue build-up editor in the panel, filled from the plan. Saving rebuilds finance and the
 * documents through applyRevenueBuildupToPipeline; removing it returns to cost-implied revenue.
 */
let revenueEditor = null;
function syncRevenueEditor(pipeline) {
  const box = document.getElementById('planRevenueEditor');
  if (!box || !window.FoundryRevenueBuildup) return;
  const current = pipeline?.intake?.plan_detail?.financials?.revenue_buildup || null;
  if (!revenueEditor) revenueEditor = window.FoundryRevenueBuildup.mount(box, { initial: current, idPrefix: 'rbPlan' });
  else revenueEditor.setValue(current);
  const has = Boolean(current?.tiers?.length);
  const title = document.getElementById('planRevenueTitle');
  if (title) title.textContent = has ? `Revenue build-up · ${current.tiers.length} product${current.tiers.length === 1 ? '' : 's'}` : 'Revenue build-up · not added yet';
  const remove = document.getElementById('planRevenueRemoveBtn');
  if (remove) remove.hidden = !has;
  const panel = document.getElementById('planRevenuePanel');
  if (panel && !has) panel.open = true;
}

function saveRevenueBuildup(buildup) {
  const pipeline = loadPlanPipeline();
  const apply = window.FoundryEngines?.pipeline?.applyRevenueBuildupToPipeline;
  if (!pipeline || !apply) {
    setText('planRevenueStatus', 'This build cannot save a revenue build-up.');
    return;
  }
  const before = completeness(pipeline)?.percent ?? 0;
  const next = apply(pipeline, buildup);
  if (!next?.ok) {
    setText('planRevenueStatus', 'Could not update. Nothing was changed.');
    return;
  }
  const store = window.FoundryPlanStore?.shared;
  if (store) store.savePipeline(next);
  else sessionStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(next));
  const after = completeness(next)?.percent ?? 0;
  renderProgress(next);
  renderQuestions(next, skippedThisVisit);
  syncRevenueEditor(next);
  const rm = next.finance?.revenue_model;
  const warnings = (rm?.flags || []).filter((f) => f.severity === 'warning').length;
  setText(
    'planRevenueStatus',
    buildup && rm?.basis === 'buildup'
      ? `Revenue now comes from your build-up${after > before ? `; the plan moved from ${before}% to ${after}%` : ''}.${warnings ? ` ${warnings} sanity check${warnings === 1 ? '' : 's'} to look at in Revenue Model.` : ''}`
      : 'Build-up removed. Revenue is implied by costs again.',
  );
  window.dispatchEvent(new CustomEvent('foundry:pipeline-updated', { detail: { pipeline: next } }));
}

/** Questions stepped past in this visit. Not persisted — see the skip handler. */
const skippedThisVisit = new Set();

function initPlanQuestions() {
  const panel = document.getElementById('planPanel');
  const openBtn = document.getElementById('planBtn');
  if (!panel || !openBtn) return;

  const engines = planEngines();
  if (!engines?.nextPlanQuestions) {
    // The bundle is older than this page. Say so rather than leaving a button that does nothing.
    openBtn.disabled = true;
    openBtn.title = 'This build does not include the plan questions.';
    return;
  }

  const refresh = () => {
    const pipeline = loadPlanPipeline();
    if (!pipeline) return;
    renderProgress(pipeline);
    renderQuestions(pipeline, skippedThisVisit);
    syncRevenueEditor(pipeline);
  };

  document.getElementById('planRevenueSaveBtn')?.addEventListener('click', () => {
    const value = revenueEditor?.value();
    if (!value) {
      setText('planRevenueStatus', 'Add at least one product with a price and an expected volume, or use Remove build-up.');
      return;
    }
    saveRevenueBuildup(value);
  });
  document.getElementById('planRevenueRemoveBtn')?.addEventListener('click', async () => {
    const remove = await window.FoundryDialog.confirm('Remove the revenue build-up? Revenue goes back to the figure implied by your costs.', {
      confirmLabel: 'Remove build-up',
      danger: true,
    });
    if (!remove) return;
    saveRevenueBuildup(null);
  });

  // Fill the card before anything is clicked, so the score is on screen from the start.
  const initial = loadPlanPipeline();
  if (initial) renderProgress(initial);
  // A plan restored from this device (or opened from a file) arrives after this runs.
  window.addEventListener('foundry:plan-restored', (event) => {
    const next = event.detail?.pipeline;
    if (!next?.ok) return;
    skippedThisVisit.clear();
    renderProgress(next);
    if (!panel.hidden) renderQuestions(next, skippedThisVisit);
  });
  window.addEventListener('foundry:plan-cleared', () => {
    panel.hidden = true;
    const card = document.getElementById('planStatusCard');
    if (card) card.hidden = true;
  });

  openBtn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      refresh();
      // On a phone the panel is below the whole document, and 'nearest' stopped with only its
      // first line on screen, so narrow screens scroll it to the top. Wide screens keep the short
      // 'nearest' scroll. Focus follows without scrolling again, so the on-screen keyboard does
      // not shove the view somewhere else.
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const narrow = window.matchMedia?.('(max-width: 900px)').matches;
      panel.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: narrow ? 'start' : 'nearest' });
      document.querySelector('#planQuestionList textarea')?.focus({ preventScroll: true });
    }
  });

  document.getElementById('planCloseBtn')?.addEventListener('click', () => {
    panel.hidden = true;
    openBtn.focus();
  });

  document.getElementById('planSkipBtn')?.addEventListener('click', () => {
    // Skipping shows the next few rather than closing: the point is to find questions someone
    // can answer now, not to make them answer these. Skips last for this visit only — a question
    // stepped past today is still worth asking next time, and it is still missing either way.
    const pipeline = loadPlanPipeline();
    if (!pipeline) return;
    for (const q of currentBatch) skippedThisVisit.add(q.id);
    const before = currentBatch.map((q) => q.id).join();
    renderQuestions(pipeline, skippedThisVisit);
    if (!currentBatch.length || currentBatch.map((q) => q.id).join() === before) {
      setText('planStatus', 'That is the last of them. Answer any of the above when you can.');
    } else {
      setText('planStatus', '');
    }
  });

  document.getElementById('planSaveBtn')?.addEventListener('click', () => {
    const pipeline = loadPlanPipeline();
    if (!pipeline) return;
    const answers = collectAnswers();
    if (!Object.keys(answers).length) {
      setText('planStatus', 'Nothing entered yet — fill in whichever you can, or skip to see others.');
      return;
    }
    const apply = window.FoundryEngines?.pipeline?.applyPlanAnswersToPipeline;
    if (!apply) {
      setText('planStatus', 'This build cannot save answers.');
      return;
    }
    setText('planStatus', 'Adding to your documents…');
    const next = apply(pipeline, answers);
    if (!next?.ok) {
      setText('planStatus', 'Could not update. Nothing was changed.');
      return;
    }
    const store = window.FoundryPlanStore?.shared;
    if (store) store.savePipeline(next);
    else sessionStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(next));

    const before = completeness(pipeline)?.percent ?? 0;
    const after = completeness(next)?.percent ?? 0;
    renderProgress(next);
    renderQuestions(next, skippedThisVisit);
    setText(
      'planStatus',
      after > before
        ? `Added. Your plan moved from ${before}% to ${after}%.`
        : 'Added to your documents.',
    );
    // The page owns the rendered document; ask it to redraw from the stored pipeline.
    window.dispatchEvent(new CustomEvent('foundry:pipeline-updated', { detail: { pipeline: next } }));
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPlanQuestions);
} else {
  initPlanQuestions();
}
