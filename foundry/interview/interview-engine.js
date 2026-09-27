/**
 * The Guided Interview's flow: which question comes next, what counts as done, how far along the
 * founder is and how long is left, and what goes on the To-Do list.
 *
 * Everything here is deterministic. The questions, their order and their branches come from the
 * versioned question bank (question-bank.js, generated from packages/interview/question-bank.json);
 * nothing a model says can add, remove or reorder a question, so the documents built from the
 * answers never depend on a model being present.
 *
 * Every question can be answered, skipped, or answered "I don't know yet". Skipping and "I don't
 * know yet" never block: the interview moves on and the question becomes a To-Do.
 *
 * UMD so the Node tests can require it; in the page it is window.FoundryInterviewEngine.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FoundryInterviewEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const STATE_SCHEMA = 'materiallogix.foundry.interview-state';
  const STATE_VERSION = 1;

  /** The statuses a question can be in. Anything else is "not reached yet". */
  const STATUS = Object.freeze({ answered: 'answered', unknown: 'unknown', skipped: 'skipped' });

  // -------------------------------------------------------------------------------------------
  // Industry branch
  // -------------------------------------------------------------------------------------------

  /** Finance cost-model industry ids → question-bank branches. */
  const INDUSTRY_FROM_COST_MODEL = Object.freeze({
    food_service: 'food_service',
    retail: 'retail',
    professional_services: 'professional_services',
    cleaning_services: 'trades_home',
    software_saas: 'software_saas',
    personal_services: 'personal_care',
  });

  const TRADES_RE = /\b(plumb\w*|hvac|electric(al|ian)|landscap\w*|lawn|handyman|roof\w*|contractor|remodel\w*|carpent\w*|paint(er|ing)|cleaning|janitorial|pest control|pressure washing|moving company|movers)\b/;
  const CARE_RE = /\b(salon|barber\w*|nails?|spa|esthetic\w*|lash\w*|brow\w*|massage|hair)\b/;
  const FOOD_RE = /\b(cafe|café|coffee|restaurant|bakery|food truck|bistro|diner|pizzeria|bar\b|brewery|juice|catering|deli)\b/;
  const RETAIL_RE = /\b(shop|store|boutique|retail|e-?commerce|online store)\b/;
  const SAAS_RE = /\b(saas|software|app\b|platform|subscription software)\b/;
  const PRO_RE = /\b(consult\w*|agency|bookkeep\w*|accounting|advisory|coach\w*|design studio|law firm|marketing services)\b/;

  /**
   * Which industry branch applies, from the plan Instant Build already made. The finance engine's
   * own classification is used when present, so the interview and the numbers agree about what
   * kind of business this is; the description is read as a fallback.
   */
  function industryFor(pipeline) {
    const text = String(pipeline?.intake?.business_description || '').toLowerCase();
    // Trades read as "general" or cleaning in the cost model; the interview asks trade questions.
    if (TRADES_RE.test(text) && !FOOD_RE.test(text)) return 'trades_home';
    const fromModel = INDUSTRY_FROM_COST_MODEL[pipeline?.finance?.cost_model?.industry?.id];
    if (fromModel) return fromModel;
    if (SAAS_RE.test(text)) return 'software_saas';
    if (FOOD_RE.test(text)) return 'food_service';
    if (CARE_RE.test(text)) return 'personal_care';
    if (PRO_RE.test(text)) return 'professional_services';
    if (RETAIL_RE.test(text)) return 'retail';
    return 'generic';
  }

  /** What the flow needs to know about the plan: industry branch and stage. */
  function contextFrom(pipeline, overrides = {}) {
    return {
      industry: overrides.industry || industryFor(pipeline),
      stage: overrides.stage || pipeline?.intake?.stage || 'idea',
      industry_label: pipeline?.finance?.cost_model?.industry?.label || null,
      naics: pipeline?.finance?.cost_model?.industry?.naics || null,
    };
  }

  // -------------------------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------------------------

  function newState(bank, ctx = {}, now = new Date()) {
    const iso = new Date(now).toISOString();
    return {
      schema: STATE_SCHEMA,
      version: STATE_VERSION,
      bank_version: bank.version,
      started_at: iso,
      updated_at: iso,
      context: { industry: ctx.industry || 'generic', stage: ctx.stage || 'idea' },
      current: null,
      answers: {},
      completed_at: null,
      applied_at: null,
    };
  }

  /**
   * Lift a stored state to the current shape. Returns null for anything that is not an interview
   * state, so a corrupt record starts a fresh interview rather than breaking the page.
   */
  function migrateState(raw, bank) {
    if (!raw || typeof raw !== 'object' || raw.schema !== STATE_SCHEMA) return null;
    const version = Number(raw.version);
    if (!Number.isInteger(version) || version < 1) return null;
    if (version > STATE_VERSION) return null;
    const state = { ...raw, answers: { ...(raw.answers || {}) } };
    // Answers to questions a newer bank no longer asks are dropped; everything else is kept.
    if (bank) {
      const ids = new Set(bank.questions.map((q) => q.id));
      for (const id of Object.keys(state.answers)) if (!ids.has(id)) delete state.answers[id];
      if (state.current && !ids.has(state.current)) state.current = null;
      state.bank_version = bank.version;
    }
    return state;
  }

  function touch(state, now) {
    return { ...state, updated_at: new Date(now || Date.now()).toISOString() };
  }

  function setResponse(state, qid, response, now) {
    const next = touch(state, now);
    next.answers = { ...state.answers, [qid]: { ...response, updated_at: next.updated_at } };
    return next;
  }

  /** Record an answer. An empty answer is treated as a skip, never as erasing a previous one. */
  function answer(state, qid, value, now, extra = {}) {
    if (isEmptyValue(value)) return skip(state, qid, now);
    const previous = state.answers[qid] || {};
    return setResponse(state, qid, { status: STATUS.answered, value, followup: previous.followup, ...extra }, now);
  }

  function markUnknown(state, qid, now) {
    return setResponse(state, qid, { status: STATUS.unknown }, now);
  }

  function skip(state, qid, now) {
    const previous = state.answers[qid];
    // Skipping a question that already has an answer leaves the answer alone: stepping past it
    // on a second visit must not erase what the founder said last week.
    if (previous && previous.status === STATUS.answered) return state;
    return setResponse(state, qid, { status: STATUS.skipped }, now);
  }

  /** The founder's reply to a clarifying follow-up, kept beside the answer it clarifies. */
  function recordFollowup(state, qid, followup, now) {
    const previous = state.answers[qid];
    if (!previous) return state;
    return setResponse(state, qid, { ...previous, followup: { ...followup } }, now);
  }

  function isEmptyValue(value) {
    if (value == null) return true;
    if (typeof value === 'string') return !value.trim();
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') {
      if (value.special) return false;
      if ('amount' in value) return !Number.isFinite(Number(value.amount));
      if (Array.isArray(value.tiers)) return value.tiers.length === 0;
      if (Array.isArray(value.items)) return value.items.length === 0;
      return Object.keys(value).length === 0;
    }
    return false;
  }

  function responded(state, qid) {
    return Boolean(state.answers[qid] && STATUS[state.answers[qid].status]);
  }

  // -------------------------------------------------------------------------------------------
  // Flow
  // -------------------------------------------------------------------------------------------

  function answerValue(state, qid) {
    const a = state.answers[qid];
    return a && a.status === STATUS.answered ? a.value : undefined;
  }

  /** Whether a question applies, given the industry, the stage and earlier answers. */
  function isVisible(q, state, ctx) {
    const industry = (ctx && ctx.industry) || (state.context && state.context.industry) || 'generic';
    const stage = (ctx && ctx.stage) || (state.context && state.context.stage) || 'idea';
    if (Array.isArray(q.industries) && q.industries.length && !q.industries.includes(industry)) return false;
    const w = q.when;
    if (!w) return true;
    if (w.stage_in && !w.stage_in.includes(stage)) return false;
    // `all`: every listed condition must hold (e.g. the net-worth range only for a founder who
    // both wants government work and checked an owner group a net-worth-tested program covers).
    if (Array.isArray(w.all) && !w.all.every((c) => answerConditionHolds(c, state))) return false;
    if (w.q && !answerConditionHolds(w, state)) return false;
    return true;
  }

  /** One condition on an earlier answer: { q, in | not_in | any }. */
  function answerConditionHolds(w, state) {
    const v = answerValue(state, w.q);
    const values = Array.isArray(v) ? v : v == null ? [] : [typeof v === 'object' && v.choice ? v.choice : v];
    // A condition on an unanswered question keeps the question in: asking one question too
    // many is cheaper than never asking one the founder could have answered. The exception is
    // an opt-in pick (`any`, e.g. loan terms only when a loan was picked), which stays out.
    if (!values.length) return !w.any;
    if (w.in && !values.some((x) => w.in.includes(x))) return false;
    if (w.not_in && values.every((x) => w.not_in.includes(x))) return false;
    if (w.any && !values.some((x) => w.any.includes(x))) return false;
    return true;
  }

  function visibleQuestions(bank, state, ctx) {
    return bank.questions.filter((q) => isVisible(q, state, ctx));
  }

  function questionById(bank, id) {
    return bank.questions.find((q) => q.id === id) || null;
  }

  /**
   * Where to resume: the stored position if it still applies, otherwise the first question that
   * applies and has no response yet. Null when everything has one.
   */
  function resumeQuestionId(bank, state, ctx) {
    const visible = visibleQuestions(bank, state, ctx);
    if (state.current && visible.some((q) => q.id === state.current) && !responded(state, state.current)) return state.current;
    const open = visible.find((q) => !responded(state, q.id));
    return open ? open.id : null;
  }

  /** The next applicable question after `fromId` that has no response yet, else null. */
  function nextQuestionId(bank, state, ctx, fromId) {
    const visible = visibleQuestions(bank, state, ctx);
    const start = fromId ? visible.findIndex((q) => q.id === fromId) + 1 : 0;
    for (let i = start; i < visible.length; i++) if (!responded(state, visible[i].id)) return visible[i].id;
    // Wrap once: something earlier may have been reopened.
    for (let i = 0; i < Math.min(start, visible.length); i++) if (!responded(state, visible[i].id)) return visible[i].id;
    return null;
  }

  /** The applicable question before `fromId`, answered or not, for the Back button. */
  function previousQuestionId(bank, state, ctx, fromId) {
    const visible = visibleQuestions(bank, state, ctx);
    const i = visible.findIndex((q) => q.id === fromId);
    if (i <= 0) return null;
    return visible[i - 1].id;
  }

  function chapterOf(bank, qid) {
    const q = questionById(bank, qid);
    return q ? bank.chapters.find((c) => c.id === q.chapter) || null : null;
  }

  /** Whether `qid` is the first applicable question in its chapter (the chapter intro plays there). */
  function isChapterStart(bank, state, ctx, qid) {
    const q = questionById(bank, qid);
    if (!q) return false;
    const first = visibleQuestions(bank, state, ctx).find((x) => x.chapter === q.chapter);
    return Boolean(first && first.id === qid);
  }

  // -------------------------------------------------------------------------------------------
  // Progress and time
  // -------------------------------------------------------------------------------------------

  /**
   * Progress per chapter and overall, with the estimated time left. Time left counts only the
   * applicable questions with no response; a skipped question costs nothing more.
   */
  function progress(bank, state, ctx) {
    const visible = visibleQuestions(bank, state, ctx);
    const chapters = bank.chapters.map((c) => {
      const qs = visible.filter((q) => q.chapter === c.id);
      const done = qs.filter((q) => responded(state, q.id)).length;
      const remaining = qs.filter((q) => !responded(state, q.id)).reduce((a, q) => a + (q.est_seconds || 30), 0);
      const total = qs.reduce((a, q) => a + (q.est_seconds || 30), 0);
      return { id: c.id, title: c.title, total: qs.length, done, est_total_s: total, est_remaining_s: remaining };
    }).filter((c) => c.total > 0);
    const total = visible.length;
    const done = visible.filter((q) => responded(state, q.id)).length;
    const est_total_s = chapters.reduce((a, c) => a + c.est_total_s, 0);
    const est_remaining_s = chapters.reduce((a, c) => a + c.est_remaining_s, 0);
    return {
      total,
      done,
      answered: visible.filter((q) => state.answers[q.id]?.status === STATUS.answered).length,
      percent: total ? Math.round((done / total) * 100) : 0,
      est_total_s,
      est_remaining_s,
      chapters,
    };
  }

  /** "About 45 minutes left", rounded the way a person would say it. */
  function formatRemaining(seconds) {
    const s = Math.max(0, Math.round(seconds));
    if (s === 0) return 'Nothing left';
    if (s < 90) return 'About a minute left';
    const minutes = Math.round(s / 60);
    if (minutes < 60) return `About ${minutes} minutes left`;
    const h = Math.floor(minutes / 60);
    const m = Math.round((minutes % 60) / 5) * 5;
    if (m === 0 || m === 60) return `About ${m === 60 ? h + 1 : h} hour${(m === 60 ? h + 1 : h) === 1 ? '' : 's'} left`;
    return `About ${h} hour${h === 1 ? '' : 's'} ${m} minutes left`;
  }

  // -------------------------------------------------------------------------------------------
  // Clarifying follow-ups (deterministic trigger)
  // -------------------------------------------------------------------------------------------

  const VAGUE_RE = /^(idk|i don'?t know|not sure|unsure|n\/?a|tbd|depends|various|some|a few|many|lots|maybe|not yet|nothing|none|everyone|anyone|people|customers|good|ok|okay|yes|no)\.?$/i;

  /**
   * Whether an answer is vague enough to earn one clarifying follow-up. Deterministic, so the
   * interview behaves the same with and without a model: the model may only phrase the follow-up
   * more conversationally. Only questions that carry a follow-up in the bank are ever probed, and
   * only once.
   */
  function isVague(q, value) {
    if (!q || !q.probe) return false;
    if (typeof value !== 'string') return false;
    const text = value.trim();
    if (!text) return false;
    if (VAGUE_RE.test(text)) return true;
    const words = text.split(/\s+/).filter(Boolean).length;
    return words < (q.type === 'long' ? 6 : 3);
  }

  function needsFollowup(q, state) {
    const a = state.answers[q.id];
    if (!a || a.status !== STATUS.answered || a.followup) return false;
    return isVague(q, a.value);
  }

  // -------------------------------------------------------------------------------------------
  // To-Do
  // -------------------------------------------------------------------------------------------

  /**
   * What is still open, as To-Do items: every applicable question skipped or answered "I don't
   * know yet", plus answers the bank says leave something to do (zoning "not yet").
   */
  function todos(bank, state, ctx) {
    const out = [];
    for (const q of visibleQuestions(bank, state, ctx)) {
      const a = state.answers[q.id];
      if (!a) continue;
      // Private questions (the optional Programs chapter) are voluntary: skipping one, or saying
      // "Prefer not to say", is a complete answer and never a To-Do.
      if (q.private) continue;
      const open = a.status === STATUS.unknown || a.status === STATUS.skipped;
      const flagged = a.status === STATUS.answered && Array.isArray(q.todo_when) && q.todo_when.includes(a.value);
      if (!open && !flagged) continue;
      const chapter = bank.chapters.find((c) => c.id === q.chapter);
      out.push({
        question_id: q.id,
        chapter: chapter ? chapter.title : q.chapter,
        status: flagged ? 'follow_up' : a.status,
        title: q.todo ? q.todo.title : `Answer: ${q.text}`,
        detail: q.todo ? q.todo.detail : q.help || '',
        document: q.todo ? q.todo.document : null,
        requirement_ids: (q.maps || []).filter((m) => m.to === 'req').map((m) => m.id),
      });
    }
    return out;
  }

  return {
    STATE_SCHEMA,
    STATE_VERSION,
    STATUS,
    INDUSTRY_FROM_COST_MODEL,
    industryFor,
    contextFrom,
    newState,
    migrateState,
    answer,
    markUnknown,
    skip,
    recordFollowup,
    isEmptyValue,
    responded,
    answerValue,
    isVisible,
    visibleQuestions,
    questionById,
    resumeQuestionId,
    nextQuestionId,
    previousQuestionId,
    chapterOf,
    isChapterStart,
    progress,
    formatRemaining,
    isVague,
    needsFollowup,
    todos,
  };
});
