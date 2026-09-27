'use strict';

/**
 * Paths that could work (paths.html).
 *
 * For a plan the finance model says does not work as structured, this page shows why, the
 * alternative tracks (each the founder's plan with one set of changes, re-run through the same
 * model; FoundryEngines computes them into pipeline.plan_tracks), the one-change-at-a-time levers,
 * and smaller-dollar funding sources. "Build my plan on this track" rebuilds the whole pack on this
 * device (FoundryEngines.pipeline.applyPlanTrackToPipeline), records the choice, and keeps the plan
 * it came from so "Go back to my original plan" can restore it. Nothing leaves the device.
 *
 * Touch-first: one column on a phone, full-width 44px buttons, no hover-only affordances.
 */
(function pathsPage(root) {
  const STORAGE_KEY = 'foundry.instant.context';
  const doc = root.document;
  const $ = (id) => doc.getElementById(id);
  const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
  const cov = (v) => (v == null ? 'No loan' : v > 0 ? `${v.toFixed(2)}×` : 'Not covered');
  const month = (m) => (m ? `Month ${m}` : 'After month 36');

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

  function loadPipeline() {
    try {
      const saved = JSON.parse(root.sessionStorage.getItem(STORAGE_KEY) || 'null');
      if (saved?.ok) return saved;
    } catch {
      /* ignore */
    }
    return null;
  }

  function say(text) {
    const s = $('pathsStatus');
    if (s) s.textContent = text;
  }

  function store() {
    return root.FoundryPlanStore?.shared || null;
  }

  /** Save the rebuilt plan (and its edits) in the tab and on the device, then open Documents. */
  async function saveAndOpen(next, edits, message) {
    const s = store();
    say(message);
    try {
      if (s) await Promise.race([s.savePipeline(next, { edits }), new Promise((r) => setTimeout(r, 4000))]);
      else root.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* the tab copy is written synchronously by the store; the status line reports device errors */
    }
    // Offline, the browser would show its own error page instead of Documents; the plan is saved,
    // so say so and open Documents once the connection is back.
    if (root.navigator && root.navigator.onLine === false) {
      say('Your plan is rebuilt and saved on this device. You are offline, so Documents will open as soon as your connection is back.');
      root.addEventListener('online', () => { root.location.href = './documents.html'; }, { once: true });
      return;
    }
    root.location.href = './documents.html';
  }

  async function chooseTrack(pipeline, track) {
    const ok = await root.FoundryDialog.confirm(
      `Rebuild every document on "${track.title}"? Your answers are kept and this change is added. Your current plan is kept on this device, and you can go back to it from this page.`,
      { confirmLabel: 'Build my plan on this track' },
    );
    if (!ok) return;
    const apply = root.FoundryEngines?.pipeline?.applyPlanTrackToPipeline;
    if (!apply) {
      say('This build cannot rebuild the plan on a track.');
      return;
    }
    say('Rebuilding your plan on this track…');
    const next = apply(pipeline, track.id);
    if (!next?.ok) {
      say('Could not rebuild the plan on this track. Nothing was changed.');
      return;
    }
    // Keep the original's Documents-page edits with the original, so going back restores them.
    const edits = store()?.edits ? store().edits() : {};
    if (next.track_origin && !next.track_origin.edits) next.track_origin.edits = pipeline.track_origin ? pipeline.track_origin.edits || {} : edits;
    await saveAndOpen(next, {}, 'Plan rebuilt on this track. Opening your documents…');
  }

  async function restoreOriginal(pipeline) {
    const ok = await root.FoundryDialog.confirm('Go back to your original plan? The plan built on this track is replaced by the one you started from.', { confirmLabel: 'Go back to my original plan' });
    if (!ok) return;
    const restore = root.FoundryEngines?.pipeline?.restoreOriginalPlan;
    const next = restore ? restore(pipeline) : null;
    if (!next?.ok) {
      say('Could not restore the original plan. Nothing was changed.');
      return;
    }
    await saveAndOpen(next, pipeline.track_origin?.edits || {}, 'Original plan restored. Opening your documents…');
  }

  function trackCard(pipeline, t, index) {
    const f = t.figures;
    const status = f.works ? 'Works on the model' : t.better_than_current ? 'Closer, not there yet' : 'Does not help on its own';
    const figures = el('dl', { class: 'paths-figures' }, [
      ['Capital needed', money(f.total_capital_usd)],
      ['From you', money(f.owner_usd)],
      ['Outside money', money(f.outside_usd)],
      ['Monthly cash break-even', month(f.break_even_month)],
      ['Year 2 loan coverage', cov(f.dscr_year2)],
      ['Left unfunded', money(f.unfunded_losses_after_horizon_usd)],
    ].map(([k, v]) => el('div', {}, [el('dt', { text: k }), el('dd', { text: v })])));
    const btn = el('button', { type: 'button', class: `btn ${f.works ? 'primary' : 'ghost'} paths-choose`, text: 'Build my plan on this track' });
    btn.addEventListener('click', () => chooseTrack(pipeline, t));
    const micro = (t.funding_notes || []).includes('sba_microloan') ? el('p', { class: 'hint', text: `The outside money this path needs (${money(f.outside_usd)}) is within the SBA Microloan limit of $50,000.` }) : null;
    return el('article', { class: `surface paths-card${f.works ? ' works' : ''}`, 'aria-labelledby': `pathsTrack${index}` }, [
      el('p', { class: 'eyebrow', text: status }),
      el('h3', { id: `pathsTrack${index}`, text: `${index + 1}. ${t.title}` }),
      el('ul', { class: 'paths-list' }, t.changes.map((c) => el('li', { text: c }))),
      figures,
      el('p', {}, [el('strong', { text: 'What you give up: ' }), t.gives_up]),
      t.fit_reasons.length ? el('p', { class: 'hint', text: `Fit with your answers: ${t.fit_reasons.join(' ')}` }) : null,
      micro,
      btn,
    ]);
  }

  function leverRows(fn) {
    const rows = [];
    for (const l of fn.levers || []) {
      if (l.id === 'loan_term') {
        for (const t of l.terms) rows.push([`A ${t.term_years}-year term${t.term_years > l.standard_max_years ? ' (real estate only)' : ''}`, t.works ? 'Works' : 'Not enough alone', month(t.break_even_month), cov(t.dscr_year2)]);
        continue;
      }
      const c = l.reached ? l.change : l.limit;
      let what = l.label;
      if (l.id === 'price') what = `Prices ${c.change_pct}% higher`;
      else if (l.id === 'volume') what = `Volume ${c.change_pct}% higher`;
      else if (l.id === 'rent') what = `Rent ${money(c.to_usd)} a month (from ${money(c.from_usd)})`;
      else if (l.id === 'staffing') what = `Staff payroll ${c.change_pct}% lower`;
      else if (l.id === 'owner_pay') what = c.to_usd > 0 ? `Owner's pay ${money(c.to_usd)} a month` : "No owner's pay";
      else if (l.id === 'equity') what = l.reached ? `${money(c.amount_usd)} more owner equity` : 'Equity in place of the whole loan';
      else if (l.id === 'split_line') what = l.reached ? `Start ${c.share_pct}% of "${l.tier_name}" at opening` : `Start all of "${l.tier_name}" at opening`;
      rows.push([what, l.reached ? 'Works' : 'Not enough alone', month(l.result?.break_even_month), cov(l.result?.dscr_year2)]);
    }
    return rows;
  }

  function render(pipeline) {
    const intro = $('pathsIntro');
    ['pathsProblem', 'pathsOrigin', 'pathsTracks', 'pathsLevers', 'pathsFunding'].forEach((id) => {
      if ($(id)) $(id).hidden = true;
    });
    if (!pipeline) {
      intro.textContent = 'No plan is saved on this device yet. Build one on Instant Build first.';
      return;
    }
    const fn = pipeline.finance?.funding_need;
    const pt = pipeline.plan_tracks;
    if (pipeline.track_origin) {
      $('pathsOrigin').hidden = false;
      const t = pipeline.intake?.plan_track;
      $('pathsOriginText').textContent = t ? `This plan is built on "${t.title}". Your original plan is kept on this device.` : 'Your original plan is kept on this device.';
      const btn = $('pathsRestoreBtn');
      btn.onclick = () => restoreOriginal(pipeline);
    }
    if (!fn || fn.works || !pt?.applicable) {
      intro.textContent = fn?.works
        ? 'On the model this plan works as structured: it reaches monthly cash break-even inside its funding horizon' + (fn.dscr_year2 != null ? ' and carries its loan by Year 2.' : '.') + ' There is nothing to fix here.'
        : 'This plan is not flagged, so there are no alternative paths to show.';
      return;
    }
    intro.textContent = 'On the model this plan does not work as structured yet. Below are the paths that could make it work, each computed from your own plan.';
    $('pathsProblem').hidden = false;
    const problems = [];
    if (fn.reasons.includes('break_even_beyond_horizon')) problems.push(`Monthly cash break-even ${fn.break_even_month ? `comes in month ${fn.break_even_month}` : 'does not come within 36 months'}, after the funding horizon of month ${fn.horizon_months} (${fn.horizon_months_after_opening} months after opening).`);
    if (fn.reasons.includes('coverage_below_minimum_year2')) problems.push(fn.dscr_year2 > 0 ? `Year 2 earnings cover the loan payments ${fn.dscr_year2.toFixed(2)} times; lenders look for at least ${fn.dscr_target.toFixed(2)}.` : `Year 2 earnings are negative, so they cover none of the loan payments; lenders look for at least ${fn.dscr_target.toFixed(2)} times.`);
    if (fn.reasons.includes('phase2_not_funded_from_cash') && fn.phase2) problems.push(`The second phase (${money(fn.phase2.capex_usd)} in month ${fn.phase2.month}) would leave less than the contingency reserve in hand.`);
    if (fn.unfunded_losses_after_horizon_usd > 0) problems.push(`A further ${money(fn.unfunded_losses_after_horizon_usd)} of losses after month ${fn.horizon_months} is not funded. The plan does not borrow to cover it.`);
    $('pathsProblemList').replaceChildren(...problems.map((p) => el('li', { text: p })));

    $('pathsTracks').hidden = false;
    $('pathsTrackList').replaceChildren(...pt.tracks.map((t, i) => trackCard(pipeline, t, i)));

    const rows = leverRows(fn);
    if (rows.length) {
      $('pathsLevers').hidden = false;
      $('pathsLeverTable').replaceChildren(
        el('tr', {}, ['Change', 'On its own', 'Break-even', 'Year 2 coverage'].map((h) => el('th', { text: h }))),
        ...rows.map((r) => el('tr', {}, r.map((c) => el('td', { text: c })))),
      );
    }
    $('pathsFunding').hidden = false;
    $('pathsFundingList').replaceChildren(
      ...pt.funding_sources.map((s) => el('li', {}, [el('strong', { text: `${s.title}. ` }), s.summary, s.url ? el('span', { class: 'paths-url', text: ` ${s.url}` }) : null])),
    );
    $('pathsNotModeled').textContent = (pt.not_modeled || []).map((n) => `Not modeled yet: ${n.title}. ${n.reason}`).join(' ');
  }

  function start() {
    render(loadPipeline());
    // Shown once drawn (styles.css main[data-render]), so the sections do not push the page down.
    doc.querySelector('main[data-render]')?.removeAttribute('data-render');
    root.addEventListener('foundry:plan-restored', (e) => render(e.detail?.pipeline || loadPipeline()));
    root.addEventListener('foundry:plan-cleared', () => render(null));
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
})(typeof window !== 'undefined' ? window : globalThis);
