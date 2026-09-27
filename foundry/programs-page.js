'use strict';

/**
 * Programs you may qualify for (programs.html).
 *
 * Lists the special programs, certifications and free help matched on this device from the
 * optional "Programs you may qualify for" interview chapter and the plan's ZIP code
 * (FoundryProgramsCompute -> FoundryEligibility over the bundled, cited program data, with the
 * nearest offices from the signed resources pack). The founder can add any program to their
 * To-Do List and choose whether certifications they already hold are listed in the Business Plan;
 * "Update my documents" rebuilds the pack through the same path the Guided Interview uses.
 * Nothing leaves the device; links open each program's own site.
 *
 * Touch-first: one column on a phone, full-width 44px buttons, no hover-only affordances.
 */
(function programsPage(root) {
  const STORAGE_KEY = 'foundry.instant.context';
  const doc = root.document;
  const $ = (id) => doc.getElementById(id);
  const GROUPS = [
    ['certification', 'Certifications'],
    ['contracting', 'Selling to government'],
    ['funding', 'Loans and lenders'],
    ['free_help', 'Free help'],
    ['training', 'Training'],
  ];

  let pipeline = null;
  let state = null;
  let result = null;
  let interest = [];
  let dirty = false;

  function el(tag, attrs = {}, children = []) {
    const node = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of [].concat(children)) if (c) node.append(c);
    return node;
  }

  function say(text) {
    const s = $('progStatus');
    if (s) s.textContent = text;
  }

  function store() {
    return root.FoundryPlanStore?.shared || null;
  }

  function loadPipeline() {
    try {
      const saved = JSON.parse(root.sessionStorage.getItem(STORAGE_KEY) || 'null');
      if (saved?.ok) return saved;
    } catch {
      /* ignore */
    }
    return null;
  }

  function link(url, text) {
    return url ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'paths-url', text: text || url }) : null;
  }

  function officeNode(o) {
    if (!o) return null;
    if (o.locator_only) return el('p', {}, [el('strong', { text: 'Find the nearest office: ' }), link(o.website, o.name) || o.name]);
    const where = [o.city, o.state].filter(Boolean).join(', ');
    return el('p', {}, [
      el('strong', { text: 'Nearest office: ' }),
      `${o.name}${where ? `, ${where}` : ''}${o.distance_miles != null ? ` (about ${o.distance_miles} miles)` : ''}. `,
      o.phone ? el('a', { href: `tel:${o.phone.replace(/[^0-9+]/g, '')}`, text: o.phone }) : null,
      o.phone && o.website ? ' · ' : null,
      link(o.website),
    ]);
  }

  function card(m) {
    const picked = m.held ? false : m.interested || interest.includes(m.id);
    // Interest that comes from the founder's own answers (selling to government, a microloan
    // pick) is shown as such; only programs added here can be taken off again here.
    const fromAnswers = m.interested && !interest.includes(m.id);
    const btn = m.held
      ? null
      : fromAnswers
      ? el('p', { class: 'hint', text: 'On your To-Do list, from your answers in the interview.' })
      : el('button', { type: 'button', class: `btn ${picked ? 'primary' : 'ghost'} paths-choose prog-todo`, 'aria-pressed': picked ? 'true' : 'false', 'data-program': m.id, text: picked ? 'On my To-Do list' : 'Add to my To-Do list' });
    if (btn && !fromAnswers) {
      btn.addEventListener('click', () => {
        const on = btn.getAttribute('aria-pressed') !== 'true';
        interest = on ? [...new Set([...interest, m.id])] : interest.filter((x) => x !== m.id);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.className = `btn ${on ? 'primary' : 'ghost'} paths-choose prog-todo`;
        btn.textContent = on ? 'On my To-Do list' : 'Add to my To-Do list';
        markDirty();
      });
    }
    const rules = m.rules_to_verify && m.rules_to_verify.length ? el('details', { class: 'prog-rules' }, [el('summary', { text: 'Rules to check with the program' }), el('ul', { class: 'paths-list' }, m.rules_to_verify.map((r) => el('li', { text: r })))]) : null;
    return el('article', { class: 'surface paths-card prog-card', 'data-program': m.id }, [
      m.held ? el('p', { class: 'eyebrow', text: 'You already hold this' }) : null,
      el('h3', { text: m.name }),
      el('p', {}, [el('strong', { text: 'Why it may apply: ' }), m.why.join(' ')]),
      el('p', {}, [el('strong', { text: 'What it offers: ' }), m.offers]),
      rules,
      m.time_to_decide ? el('p', { class: 'hint', text: `Timing: ${m.time_to_decide}.` }) : null,
      el('p', {}, [el('strong', { text: 'How to apply: ' }), m.how_to_apply ? `${m.how_to_apply} ` : '', link(m.apply_url, 'Official site') || link(m.locator_url, 'Find an office') || 'Contact the program.']),
      m.map_url ? el('p', {}, [el('strong', { text: 'Official map: ' }), link(m.map_url, 'Check the map')]) : null,
      officeNode(m.local_office),
      el('p', { class: 'hint', text: `${m.disclaimer} Source retrieved ${m.source.retrieved}.` }),
      btn,
    ]);
  }

  function markDirty() {
    dirty = true;
    $('progActions').hidden = false;
  }

  function render() {
    for (const id of ['progAsk', 'progRural', 'progMatches', 'progCerts', 'progNotes', 'progActions']) $(id).hidden = true;
    if (!pipeline) {
      $('progIntro').textContent = 'No plan is saved on this device yet. Build one on Instant Build first; the programs are matched to its ZIP code.';
      return;
    }
    if (!result) {
      $('progIntro').textContent = 'The program list could not be loaded in this build.';
      return;
    }
    const where = [result.place.county, result.place.state].filter(Boolean).join(', ');
    $('progIntro').textContent = result.general_only
      ? `Programs open to everyone${where ? ` near ${where}` : ''}. ${result.prefer_not ? 'You chose not to share details, so nothing else is shown.' : ''}`.trim()
      : `${result.matches.length} programs you may qualify for${where ? `, near ${where}` : ''}, from what you shared.`;
    if (result.general_only && !result.prefer_not) $('progAsk').hidden = false;
    $('progRural').hidden = false;
    $('progRuralText').replaceChildren(result.rural.text, ' ', link(result.rural.check_url, 'Official USDA eligibility map') || '');
    $('progMatches').hidden = false;
    $('progGroups').replaceChildren(
      ...GROUPS.map(([cat, title]) => {
        const ms = result.matches.filter((m) => m.category === cat);
        if (!ms.length) return null;
        return el('div', { class: 'prog-group' }, [el('h3', { class: 'prog-group-title', text: title }), el('div', { class: 'paths-cards' }, ms.map(card))]);
      }).filter(Boolean),
    );
    const held = window.FoundryEligibility ? window.FoundryEligibility.normalizeAnswers(state || { answers: {} }).certs_held : [];
    if (held.length) {
      $('progCerts').hidden = false;
      $('progCertsInPlan').checked = Boolean(state?.answers?.programs_certs_in_plan?.value === 'yes');
      $('progCertsList').textContent = `You said the business holds: ${held.map((c) => window.FoundryEligibility.CERT_LABELS[c]).join('; ')}.`;
    }
    const notes = [];
    for (const n of result.not_now || []) notes.push(`${n.name}: ${n.reason}`);
    for (const g of result.state_gaps || []) notes.push(`State ${g.key === 'dbe' ? 'DBE' : g.key === 'veteran' ? 'veteran' : 'minority- or women-owned'} certification (${g.state}): ${g.reason}`);
    if ((result.no_specific_program || []).length) notes.push('No program in this list is specific to some of what you checked (immigrant or first-generation owners, or an owner’s age). The free help above is open to everyone.');
    if (notes.length) {
      $('progNotes').hidden = false;
      $('progNotesList').replaceChildren(...notes.map((t) => el('li', { text: t })));
    }
    if (dirty) $('progActions').hidden = false;
  }

  async function recompute() {
    result = root.FoundryProgramsCompute ? await root.FoundryProgramsCompute.compute(pipeline, state, { interest }) : null;
  }

  async function applyChanges() {
    const Engine = root.FoundryInterviewEngine;
    const Mapping = root.FoundryInterviewMapping;
    const bank = root.FoundryInterviewBank;
    const api = root.FoundryEngines?.pipeline;
    if (!Engine || !Mapping || !bank || !api || !pipeline) {
      say('This build cannot update the documents from here.');
      return;
    }
    const btn = $('progApplyBtn');
    btn.disabled = true;
    say('Updating your documents on this device…');
    const base = state || Engine.newState(bank, Engine.contextFrom(pipeline));
    state = { ...base, programs_interest: interest.slice() };
    await recompute();
    try {
      await root.FoundryEngines?.prepareLocation?.(pipeline);
    } catch {
      /* a plan without a ZIP needs nothing */
    }
    let next;
    try {
      next = Mapping.applyInterviewToPipeline(pipeline, state, {
        bank,
        engine: Engine,
        programs: result,
        pipelineApi: {
          runInstantPipeline: api.runInstantPipeline,
          applyPlanAnswersToPipeline: api.applyPlanAnswersToPipeline,
          resolveOpening: api.resolveOpening || root.FoundryEngines.intake?.resolveOpening,
        },
      });
    } catch (error) {
      next = { ok: false, errors: [String(error?.message || error)] };
    }
    btn.disabled = false;
    if (!next?.ok) {
      say(`Your documents could not be updated, and nothing was changed. ${(next?.errors || [])[0] || ''}`.trim());
      return;
    }
    const s = store();
    try {
      if (s) {
        s.saveInterview(state);
        s.savePipeline(next);
        await s.settled();
      } else root.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* the tab copy is written synchronously; the status line reports device errors */
    }
    pipeline = next;
    dirty = false;
    render();
    say('Documents updated. Your To-Do List and Founder’s Notes now include these programs.');
  }

  async function start() {
    if (root.FoundryPlanStore?.ready) {
      try {
        await root.FoundryPlanStore.ready;
      } catch {
        /* the tab copy is still read below */
      }
    }
    pipeline = loadPipeline();
    const s = store();
    if (s?.loadInterview) {
      try {
        state = await s.loadInterview();
      } catch {
        state = null;
      }
    }
    if (state && root.FoundryInterviewEngine && root.FoundryInterviewBank) state = root.FoundryInterviewEngine.migrateState(state, root.FoundryInterviewBank);
    interest = Array.isArray(state?.programs_interest) ? state.programs_interest.slice() : [];
    await recompute();
    render();
    // Shown once matched (styles.css main[data-render]): the sections arriving one by one pushed
    // the page down.
    doc.querySelector('main[data-render]')?.removeAttribute('data-render');
    $('progApplyBtn').addEventListener('click', applyChanges);
    $('progCertsInPlan').addEventListener('change', (e) => {
      const Engine = root.FoundryInterviewEngine;
      if (!Engine || !state) return;
      state = Engine.answer(state, 'programs_certs_in_plan', e.target.checked ? 'yes' : 'no');
      markDirty();
    });
    root.addEventListener('foundry:plan-restored', async (e) => {
      pipeline = e.detail?.pipeline || loadPipeline();
      await recompute();
      render();
    });
    root.addEventListener('foundry:plan-cleared', () => {
      pipeline = null;
      result = null;
      render();
    });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
})(typeof window !== 'undefined' ? window : globalThis);
