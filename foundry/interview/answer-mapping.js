/**
 * Guided Interview answers → the plan's intake, and a rebuilt pipeline.
 *
 * Each question in the bank declares where its answer goes (`maps`):
 *   { to: 'req', id }          a Business Plan requirement (plan-requirements.js). Several questions
 *                              may feed one requirement; their answers are joined in bank order,
 *                              each under its label, so "Competitors", "Their prices" and "Where
 *                              they fall short" read as one paragraph in Market Analysis.
 *   { to: 'intake', path }     a field in the intake (interview_deepen.*, plan_detail.operating.*).
 *   { to: 'override', key }    a founder cost that replaces a benchmark in the cost model
 *                              (plan_detail.financials.cost_overrides: rent, insurance, marketing).
 *   { to: 'setup_items' }      equipment and build-out lines, replacing the benchmark setup split.
 *   { to: 'buildup' }          the revenue build-up (price × volume per product).
 *   { to: 'capital' }          personal capital (the Instant answer, refined).
 *   { to: 'funding' }          outside-money intent and kinds.
 *   { to: 'opening' }          the opening date (real calendar dates for the timeline).
 *
 * Requirement answers are written through the pipeline's own applyPlanAnswersToPipeline, so they
 * land on exactly the paths the documents read and are recorded as FOUNDER facts. Nothing here
 * estimates or invents a value: an unanswered question writes nothing, and the gap it leaves is
 * reported by the documents and the To-Do list as before.
 *
 * UMD; in the page it is window.FoundryInterviewMapping.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FoundryInterviewMapping = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const clone = (v) => JSON.parse(JSON.stringify(v == null ? {} : v));

  function setPath(obj, path, value) {
    const keys = String(path).split('.');
    let node = obj;
    for (const key of keys.slice(0, -1)) {
      if (node[key] == null || typeof node[key] !== 'object' || Array.isArray(node[key])) node[key] = {};
      node = node[key];
    }
    node[keys[keys.length - 1]] = value;
  }

  function money(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '';
    return `$${(Math.round(v * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: v % 1 ? 2 : 0 })}`;
  }

  function optionLabel(q, value) {
    const opt = (q.options || []).find((o) => o.value === value);
    return opt ? opt.label : String(value);
  }

  function amountOf(value) {
    if (value && typeof value === 'object' && 'amount' in value) {
      const n = Number(value.amount);
      return Number.isFinite(n) && n >= 0 ? n : null;
    }
    const n = Number(String(value ?? '').replace(/[$,\s]/g, ''));
    return String(value ?? '').trim() && Number.isFinite(n) && n >= 0 ? n : null;
  }

  /** An answer as prose, for a requirement. */
  function asText(q, value, fmt) {
    let text;
    if (q.type === 'choice') text = optionLabel(q, value);
    else if (q.type === 'multi') text = (Array.isArray(value) ? value : [value]).map((v) => optionLabel(q, v)).join(', ');
    else if (q.type === 'money') text = value && value.special ? optionLabel({ options: SPECIAL_LABELS }, value.special) : money(amountOf(value));
    else if (q.type === 'number') text = Number(value).toLocaleString('en-US');
    else if (q.type === 'items') text = (value.items || []).map((i) => `${i.label}${i.amount_usd != null ? ` (${money(i.amount_usd)}${i.quoted ? ', quoted' : ''})` : ''}`).join('; ');
    else text = String(value).trim();
    if (fmt && text) {
      text = fmt.replace('{value}', text).replace('{money}', money(amountOf(value)));
    }
    return text;
  }

  const SPECIAL_LABELS = [
    { value: 'zero', label: '$0' },
    { value: 'prefer_not', label: 'Prefer not to say' },
    { value: 'work_it_out', label: 'Work it out for me' },
  ];

  const FUNDING = Object.freeze({
    sba_loan: { kind: 'debt', interest: 'loans' },
    bank_loan: { kind: 'debt', interest: 'loans' },
    microloan: { kind: 'debt', interest: 'loans' },
    grant: { kind: 'grant', interest: 'grants' },
    friends_family: { kind: 'other', interest: null },
    investors: { kind: 'equity', interest: 'equity' },
  });

  /** Certifications the founder said the business already holds, by name (never any other answer). */
  function heldCertificationsText(bank, state) {
    const q = bank.questions.find((x) => x.id === 'programs_certs_held');
    const a = state.answers.programs_certs_held;
    if (!q || !a || a.status !== 'answered' || !Array.isArray(a.value)) return '';
    return a.value
      .filter((v) => v !== 'none' && v !== 'prefer_not' && (q.options || []).some((o) => o.value === v))
      .map((v) => optionLabel(q, v))
      .join(', ');
  }

  /** The Business Plan's space-type code from where the site stands (and, for food, its prior use). */
  function spaceType(state) {
    const site = state.answers.location_site_status;
    const status = site && site.status === 'answered' ? site.value : null;
    if (status === 'home') return 'home';
    if (status === 'online_only') return 'online_only';
    const prior = state.answers.location_food_prior_use;
    if (prior && prior.status === 'answered') {
      if (prior.value === 'no') return 'full_buildout';
      return 'light_buildout';
    }
    return null;
  }

  /**
   * Work out every change the interview makes to the intake.
   *
   * @param {object} bank the question bank
   * @param {object} state interview state
   * @param {object} ctx { industry, stage } for branch visibility
   * @param {object} engine FoundryInterviewEngine (for visibility)
   * @param {{ resolveOpening?: Function, planDate?: string }} [deps]
   * @returns {{ answers: Record<string,string>, patches: Array<[string, any]>, overrides: object, setupItems: any[]|null, buildup: object|null, capital: object|null, funding: object|null, opening: object|null, followups: any[], extracted: object }}
   */
  function mapInterview(bank, state, ctx, engine, deps = {}) {
    const reqParts = {};
    const patches = [];
    const overrides = {};
    let setupItems = null;
    let buildup = null;
    let capital = null;
    let funding = null;
    let opening = null;
    const extracted = {};

    for (const q of engine.visibleQuestions(bank, state, ctx)) {
      const a = state.answers[q.id];
      if (!a || a.status !== 'answered') continue;
      const value = a.value;
      if (a.extracted && a.extracted_confirmed) extracted[q.id] = a.extracted;
      for (const m of q.maps || []) {
        if (m.to === 'req' && m.transform === 'certifications_opt_in') {
          // The one way anything from the optional Programs chapter reaches a lender document:
          // the names of certifications the business already holds, only when the founder said
          // "Yes, list them", in the competition section beside their own answer about competitors.
          // With no competitor named yet it still reaches the plan the founder opted into (as a
          // competitive advantage); it used to be dropped without a word.
          if (value !== 'yes') continue;
          const text = heldCertificationsText(bank, state);
          if (text) (reqParts[m.id] = reqParts[m.id] || []).push({ label: m.label || null, text });
        } else if (m.to === 'req') {
          let text = asText(q, value, m.format);
          if (a.followup && typeof a.followup.answer === 'string' && a.followup.answer.trim()) {
            text = `${text.replace(/[.\s]+$/, '')}. ${a.followup.answer.trim()}`;
          }
          if (!text) continue;
          (reqParts[m.id] = reqParts[m.id] || []).push({ label: m.label || null, text });
        } else if (m.to === 'intake') {
          let v = value;
          if (m.transform === 'space_type') {
            v = spaceType(state);
            if (!v) continue;
          } else if (m.transform === 'amount') {
            v = amountOf(value);
            if (v == null) continue;
          } else if (q.type === 'money') {
            v = value && value.special ? value.special : amountOf(value);
          } else if (typeof v === 'string') v = v.trim();
          patches.push([m.path, v]);
        } else if (m.to === 'override') {
          const amt = amountOf(value);
          if (amt == null) continue;
          overrides[m.key] = (m.period || q.period) === 'year' ? Math.round((amt / 12) * 100) / 100 : amt;
        } else if (m.to === 'setup_items') {
          const items = (value.items || [])
            .map((i) => ({ label: String(i.label || '').trim().slice(0, 120), amount_usd: amountOf(i.amount_usd), quoted: Boolean(i.quoted) }))
            .filter((i) => i.label && i.amount_usd != null && i.amount_usd > 0);
          if (items.length) setupItems = items;
        } else if (m.to === 'buildup') {
          if (value && Array.isArray(value.tiers) && value.tiers.length) buildup = clone(value);
        } else if (m.to === 'capital') {
          if (value && value.special === 'zero') capital = { disclosure: 'zero' };
          else if (value && value.special === 'prefer_not') capital = { disclosure: 'prefer_not' };
          else {
            const amt = amountOf(value);
            if (amt != null) capital = amt === 0 ? { disclosure: 'zero' } : { disclosure: 'amount', amount_usd: amt };
          }
        } else if (m.to === 'funding') {
          const picks = Array.isArray(value) ? value : [value];
          funding = { picks };
        } else if (m.to === 'opening') {
          if (deps.resolveOpening) {
            const choice = value && typeof value === 'object' ? value.choice : value;
            const date = value && typeof value === 'object' ? value.date : null;
            opening = deps.resolveOpening({ choice, date }, deps.planDate);
          }
        }
      }
    }

    const answers = {};
    for (const [id, parts] of Object.entries(reqParts)) {
      answers[id] =
        parts.length === 1 && !parts[0].label
          ? parts[0].text
          : parts.map((p) => (p.label ? `${p.label}: ${p.text.replace(/[.\s]+$/, '')}.` : `${p.text.replace(/[.\s]+$/, '')}.`)).join(' ');
    }

    // The market the founder can reach, from their own count, joins the revenue build-up.
    const reach = extracted.customers_count;
    if (buildup && reach) {
      if (Number.isFinite(Number(reach.serviceable_customers)) && buildup.serviceable_customers == null) {
        buildup.serviceable_customers = Number(reach.serviceable_customers);
      }
      if (reach.market_basis && !buildup.market_basis) buildup.market_basis = String(reach.market_basis);
    }

    // To-Do items for the To-Do List document: every open question with a To-Do of its own in the
    // bank (a rent figure, quotes, an insurance quote, zoning), except the few the Business Plan's
    // own gaps already put there (todo_in_documents: false; those reach the To-Do List through
    // plan-gaps.js), so nothing is listed twice.
    const followups = engine
      .todos(bank, state, ctx)
      .filter((t) => {
        const q = engine.questionById(bank, t.question_id);
        return Boolean(q && q.todo && q.todo_in_documents !== false);
      })
      .map((t, i) => ({ question_id: t.question_id, title: t.title, detail: t.detail, document: t.document || 'Business Plan', priority: 2, order: i }));

    return { answers, patches, overrides, setupItems, buildup, capital, funding, opening, followups, extracted };
  }

  /** Outside money from the founder's picks, in the shape the intake and fundingKinds() read. */
  function fundingIntake(existing, picks, bank) {
    const q = bank.questions.find((x) => x.id === 'money_sources');
    const chosen = picks.filter((p) => p !== 'none');
    const om = { ...(existing || {}) };
    if (!chosen.length) {
      return { outside_money: { intent: 'none', raw: 'None' }, interest: [] };
    }
    const labels = chosen.map((p) => optionLabel(q || {}, p));
    om.intent = 'yes';
    om.raw = labels.join(', ');
    om.types = labels;
    const interest = [...new Set(chosen.map((p) => FUNDING[p]?.interest).filter(Boolean))];
    return { outside_money: om, interest };
  }

  /**
   * The intake the interview produces: the plan's current intake with every mapped answer
   * applied. Requirement answers are returned separately; the pipeline writes those itself.
   */
  function buildInterviewIntake(bank, state, ctx, engine, intake, deps = {}) {
    const mapped = mapInterview(bank, state, ctx, engine, deps);
    const next = clone(intake);
    for (const [path, value] of mapped.patches) setPath(next, path, value);

    next.plan_detail = next.plan_detail && typeof next.plan_detail === 'object' ? next.plan_detail : {};
    const financials = { ...(next.plan_detail.financials || {}) };
    const costOverrides = { ...(financials.cost_overrides || {}), ...mapped.overrides };
    if (mapped.setupItems) costOverrides.setup_items = mapped.setupItems;
    if (Object.keys(costOverrides).length) financials.cost_overrides = costOverrides;
    if (mapped.buildup) financials.revenue_buildup = mapped.buildup;
    next.plan_detail.financials = financials;
    if (Object.keys(mapped.extracted).length) {
      next.plan_detail.operating = { ...(next.plan_detail.operating || {}), confirmed_details: mapped.extracted };
    }

    if (mapped.capital) next.personal_capital = mapped.capital;

    if (mapped.funding) {
      const f = fundingIntake(next.outside_money, mapped.funding.picks, bank);
      next.outside_money = f.outside_money;
      next.interview_deepen = next.interview_deepen || {};
      if (f.interest.length) {
        const merged = new Set([...(next.interview_deepen.funding_path_interest || []).filter((x) => x !== 'skip_for_now'), ...f.interest]);
        next.interview_deepen.funding_path_interest = [...merged];
      }
    }
    // A stated total need, less the founder's own money, is the outside amount; "Work it out for
    // me" clears any amount so the model sizes it.
    const need = state.answers.money_need;
    if (need && need.status === 'answered' && next.outside_money && next.outside_money.intent === 'yes') {
      if (need.value && need.value.special === 'work_it_out') delete next.outside_money.approximate_amount_usd;
      else {
        const total = amountOf(need.value);
        const own = next.personal_capital && next.personal_capital.disclosure === 'amount' ? next.personal_capital.amount_usd : 0;
        if (total != null && total > own) next.outside_money.approximate_amount_usd = Math.round(total - own);
      }
    }

    if (mapped.opening) next.opening = mapped.opening;
    next.interview_followups = mapped.followups;
    // "Programs you may qualify for": the matched programs (FoundryEligibility.matchPrograms),
    // computed by the page on this device. Only Founder's Notes and the To-Do List read it.
    if (deps.programs !== undefined) next.eligibility_programs = deps.programs;
    return { intake: next, answers: mapped.answers, mapped };
  }

  /**
   * Rebuild the plan from the interview: the intake with every answer applied, run through the
   * full pipeline again (so capital, funding, team, costs and the opening date all move the
   * numbers), then the requirement answers written and recorded as founder facts.
   *
   * @param {object} pipeline the current plan (a runInstantPipeline result)
   * @param {object} state interview state
   * @param {{ bank: object, engine: object, pipelineApi: { runInstantPipeline: Function, applyPlanAnswersToPipeline: Function, resolveOpening?: Function }, now?: Date }} deps
   */
  function applyInterviewToPipeline(pipeline, state, deps) {
    if (!pipeline || !pipeline.ok) return { ok: false, errors: ['A built plan is required first.'] };
    const { bank, engine, pipelineApi } = deps;
    const ctx = engine.contextFrom(pipeline, state.context || {});
    const planDate = (deps.now ? new Date(deps.now) : new Date()).toISOString().slice(0, 10);
    const built = buildInterviewIntake(bank, state, ctx, engine, pipeline.intake || {}, {
      resolveOpening: pipelineApi.resolveOpening,
      planDate: pipeline.intake?.opening?.plan_date || planDate,
      programs: deps.programs,
    });
    const exportFormats = pipeline.document_pack?.export_formats || ['html'];
    let next = pipelineApi.runInstantPipeline(built.intake, { alreadyStructured: true, export_formats: exportFormats });
    if (!next || !next.ok) {
      return { ok: false, errors: (next && (next.errors || next.validation?.errors)) || ['The plan could not be rebuilt from these answers.'] };
    }
    next = pipelineApi.applyPlanAnswersToPipeline(next, built.answers);
    if (!next || !next.ok) return { ok: false, errors: ['The plan could not be rebuilt from these answers.'] };
    const prog = engine.progress(bank, state, ctx);
    next.interview = {
      bank_version: bank.version,
      applied_at: (deps.now ? new Date(deps.now) : new Date()).toISOString(),
      answered: prog.answered,
      responded: prog.done,
      applicable: prog.total,
      requirement_answers: Object.keys(built.answers),
      open_items: engine.todos(bank, state, ctx).length,
    };
    // Earlier plan-question answers the founder gave on Documents stay in the intake (they were
    // carried over), so their record carries over too.
    if (pipeline.plan_answers) next.plan_answers = { ...pipeline.plan_answers, ...(next.plan_answers || {}) };
    return next;
  }

  return { mapInterview, buildInterviewIntake, applyInterviewToPipeline, fundingIntake, asText, amountOf, spaceType };
});
