const STORAGE_KEY = 'foundry.instant.context';

function selected(group) {
  const el = document.querySelector(`[data-group="${group}"][aria-pressed="true"]`);
  return el ? el.dataset.value : null;
}

function selectedMulti(name) {
  return [...document.querySelectorAll(`[data-multi="${name}"][aria-pressed="true"]`)].map(
    (el) => el.dataset.value,
  );
}

function wireGroup(group) {
  document.querySelectorAll(`[data-group="${group}"]`).forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll(`[data-group="${group}"]`).forEach((b) =>
        b.setAttribute('aria-pressed', 'false'),
      );
      btn.setAttribute('aria-pressed', 'true');
      if (group === 'stage') syncDeepen();
      if (group === 'opening') syncOpening(true);
    });
  });
}

function wireMulti(name) {
  document.querySelectorAll(`button.chip[data-multi="${name}"]`).forEach((btn) => {
    btn.addEventListener('click', () => {
      const value = btn.dataset.value;
      const pressing = btn.getAttribute('aria-pressed') !== 'true';
      if (name === 'funding' && value === 'skip_for_now' && pressing) {
        document.querySelectorAll(`button.chip[data-multi="funding"]`).forEach((b) =>
          b.setAttribute('aria-pressed', 'false'),
        );
        btn.setAttribute('aria-pressed', 'true');
        return;
      }
      if (name === 'funding' && value !== 'skip_for_now' && pressing) {
        const skip = document.querySelector(
          `button.chip[data-multi="funding"][data-value="skip_for_now"]`,
        );
        if (skip) skip.setAttribute('aria-pressed', 'false');
      }
      btn.setAttribute('aria-pressed', pressing ? 'true' : 'false');
    });
  });
}

function syncDeepen() {
  const stage = selected('stage');
  const el = document.getElementById('existingDeepen');
  if (el) el.style.display = stage === 'launched' || stage === 'existing' ? 'block' : 'none';
  // Question 9 is for a business that has not opened yet.
  const opening = document.getElementById('openingField');
  if (opening) opening.hidden = stage === 'launched' || stage === 'existing';
}

/** "Pick a date" shows the date field; the other two choices hide it. */
function syncOpening(focus) {
  const wrap = document.getElementById('openingDateWrap');
  const input = document.getElementById('openingDate');
  if (!wrap || !input) return;
  const picking = selected('opening') === 'date';
  wrap.hidden = !picking;
  if (!input.min) input.min = new Date().toISOString().slice(0, 10);
  if (picking && focus) input.focus();
}

function syncFormation() {
  const extras = document.getElementById('formationExtras');
  const formed = document.getElementById('formed');
  if (extras && formed) extras.style.display = formed.value === 'yes' ? 'block' : 'none';
}

function collectInterviewDeepen() {
  const funding_path_interest = selectedMulti('funding');
  const document_extras = selectedMulti('docs');
  const financial = {};
  const must = document.getElementById('mustHaveSpend')?.value.trim();
  const defer = document.getElementById('canDeferSpend')?.value.trim();
  const burn = document.getElementById('burnComfort')?.value.trim();
  const firstRevenue = document.getElementById('firstRevenue')?.value;
  if (must) financial.must_have_spend = must;
  if (defer) financial.can_defer_spend = defer;
  if (burn) {
    const n = Number(burn.replace(/[$,\s]/g, ''));
    if (Number.isFinite(n) && n >= 0) financial.monthly_burn_comfort_usd = n;
  }
  if (firstRevenue) financial.first_revenue_timing = firstRevenue;

  const operational = {};
  const space = document.getElementById('spaceType')?.value;
  const team = document.getElementById('teamNow')?.value;
  const hours = document.getElementById('weeklyHours')?.value;
  const path = document.getElementById('firstCustomerPath')?.value.trim();
  if (space) operational.space_type = space;
  if (team) operational.team_now = team;
  if (hours) operational.weekly_hours = hours;
  if (path) operational.first_customer_path = path;

  const strategic = {};
  const goal = document.getElementById('ninetyDayGoal')?.value.trim();
  const edge = document.getElementById('edgeOneLiner')?.value.trim();
  const risk = document.getElementById('biggestRisk')?.value.trim();
  if (goal) strategic.ninety_day_goal = goal;
  if (edge) strategic.edge_one_liner = edge;
  if (risk) strategic.biggest_risk = risk;

  const deepen = {};
  if (funding_path_interest.length) deepen.funding_path_interest = funding_path_interest;
  if (document_extras.length) deepen.document_extras = document_extras;
  if (Object.keys(financial).length) deepen.financial = financial;
  if (Object.keys(operational).length) deepen.operational = operational;
  if (Object.keys(strategic).length) deepen.strategic = strategic;
  return Object.keys(deepen).length ? deepen : undefined;
}

/**
 * Long answers grow the box instead of scrolling inside it. CSS field-sizing does this where it is
 * supported; this is the same behaviour for browsers that do not have it yet (Safari, Firefox).
 */
function autoGrow(el) {
  if (!el || (window.CSS && CSS.supports('field-sizing', 'content'))) return;
  const fit = () => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  };
  el.addEventListener('input', fit);
  fit();
}
document.querySelectorAll('#instantForm textarea').forEach(autoGrow);

/**
 * The line under the location answer: which place Instant Build read and whose wage figures the
 * plan will use ("Atlanta, GA: we'll use national median wages with Georgia payroll-tax rates…"),
 * or, only for an answer it cannot place, what to type instead. Never a dialog.
 */
function previewLocation() {
  const input = document.getElementById('location');
  const line = document.getElementById('locationPreview');
  if (!input || !line) return { kind: 'empty' };
  // A ZIP not loaded yet: show the preview now, and again once its ZIP data is in.
  const pending = window.FoundryEngines?.prepareLocation?.(input.value);
  if (pending && typeof pending.then === 'function' && !previewLocation.waiting) {
    previewLocation.waiting = true;
    pending.then((zips) => {
      previewLocation.waiting = false;
      if (zips && zips.length) {
        const again = window.FoundryEngines?.pipeline?.previewLocationAnswer?.(input.value);
        if (again) {
          line.textContent = again.message || '';
          line.dataset.kind = again.kind;
        }
      }
    });
  }
  const preview = window.FoundryEngines?.pipeline?.previewLocationAnswer?.(input.value) || { kind: 'empty', message: '' };
  line.textContent = preview.message || '';
  line.dataset.kind = preview.kind;
  if (preview.kind === 'error') input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
  return preview;
}
let locationPreviewTimer = null;
document.getElementById('location')?.addEventListener('input', () => {
  clearTimeout(locationPreviewTimer);
  // Wait for a pause in typing, so "Atl" is not reported as unplaceable mid-word.
  locationPreviewTimer = setTimeout(previewLocation, 450);
});
document.getElementById('location')?.addEventListener('blur', previewLocation);

const revenueEditor = window.FoundryRevenueBuildup?.mount(document.getElementById('revenueBuildupEditor'), { idPrefix: 'rbInstant' }) || null;

wireGroup('stage');
wireGroup('brand');
wireGroup('opening');
syncOpening(false);
wireMulti('funding');
wireMulti('docs');
document.getElementById('formed')?.addEventListener('change', syncFormation);
syncDeepen();

document.getElementById('uploadBtn')?.addEventListener('click', () => {
  document.getElementById('fileInput').click();
});

document.getElementById('fileInput')?.addEventListener('change', (e) => {
  const files = [...(e.target.files || [])].map((f) => ({
    name: f.name,
    size: f.size,
    type: f.type,
  }));
  sessionStorage.setItem(
    'foundry.upload',
    JSON.stringify({ skipped: files.length === 0, files }),
  );
  const box = document.getElementById('uploadSummary');
  box.hidden = false;
  box.textContent = files.length
    ? `${files.length} file(s) noted on this device. Instant still uses your typed answers. Document parse is not wired yet.`
    : 'No files selected.';
  document.getElementById('skipUpload').setAttribute('aria-pressed', 'false');
});

document.getElementById('skipUpload')?.addEventListener('click', () => {
  sessionStorage.setItem('foundry.upload', JSON.stringify({ skipped: true, files: [] }));
  document.getElementById('skipUpload').setAttribute('aria-pressed', 'true');
  const box = document.getElementById('uploadSummary');
  box.hidden = false;
  box.textContent = 'Upload skipped. You can add files later.';
});

/**
 * A problem with the answers, said under the form (never a blocking dialog), with the field that
 * needs fixing focused. Cleared on the next attempt.
 */
function showFormError(message, fieldId) {
  const box = document.getElementById('instantFormError');
  if (box) {
    box.textContent = message;
    box.classList.remove('form-note');
    box.hidden = !message;
  }
  if (!message) return;
  const field = fieldId ? document.getElementById(fieldId) : box;
  if (field) {
    if (fieldId) field.setAttribute('aria-invalid', 'true');
    field.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    if (fieldId && typeof field.focus === 'function') field.focus({ preventScroll: true });
  }
}

document.getElementById('instantForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  showFormError('');
  // An answer that cannot be placed is shown under the field, and the build waits for it.
  if (previewLocation().kind === 'error') {
    const input = document.getElementById('location');
    input?.focus();
    input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  const stage = selected('stage');
  const form = {
    business_description: document.getElementById('business').value.trim(),
    stage,
    location_text: document.getElementById('location').value.trim(),
    customer: document.getElementById('customer').value.trim(),
    revenue_model: document.getElementById('revenue').value.trim(),
    personal_capital: document.getElementById('capital').value.trim(),
    outside_money_raw: document.getElementById('outside').value.trim(),
    brand_preference: selected('brand'),
    // Question 9. "Pick a date" with no date is treated as skipped: three months after the plan date.
    opening_choice: selected('opening') || null,
    opening_date: selected('opening') === 'date' ? document.getElementById('openingDate')?.value || null : null,
    upload: JSON.parse(
      sessionStorage.getItem('foundry.upload') || '{"skipped":true,"files":[]}',
    ),
  };

  if (stage === 'launched' || stage === 'existing') {
    form.existing_company_deepen = {
      legal_or_public_name: document.getElementById('legalName').value.trim(),
      already_formed: document.getElementById('formed').value,
      entity_type: document.getElementById('entityType').value.trim() || undefined,
      formation_jurisdiction:
        document.getElementById('formationJurisdiction').value.trim() || undefined,
    };
    if (!form.existing_company_deepen.legal_or_public_name) {
      showFormError('For a launched or existing company, add its legal or public name.', 'legalName');
      return;
    }
    if (
      form.existing_company_deepen.already_formed === 'yes' &&
      (!form.existing_company_deepen.entity_type ||
        !form.existing_company_deepen.formation_jurisdiction)
    ) {
      showFormError(
        'If the company is already formed, add its entity type and formation state before legal documents can be built.',
        form.existing_company_deepen.entity_type ? 'formationJurisdiction' : 'entityType',
      );
      return;
    }

    const parseMoney = (raw) => {
      if (!raw) return null;
      const n = Number(raw.replace(/[$,\s]/g, ''));
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const currentRevenueRaw = document.getElementById('currentRevenue').value.trim();
    const currentCostsRaw = document.getElementById('currentCosts').value.trim();
    if (currentRevenueRaw || currentCostsRaw) {
      const monthly_revenue_usd = parseMoney(currentRevenueRaw);
      const monthly_costs_usd = parseMoney(currentCostsRaw);
      if (monthly_revenue_usd == null || monthly_costs_usd == null) {
        showFormError(
          'To build this plan from your current numbers, enter both current monthly revenue and current monthly operating costs — or leave both blank to skip this.',
          monthly_revenue_usd == null ? 'currentRevenue' : 'currentCosts',
        );
        return;
      }
      const position = { monthly_revenue_usd, monthly_costs_usd };
      const cashOnHand = parseMoney(document.getElementById('cashOnHand').value.trim());
      if (cashOnHand != null) position.cash_on_hand_usd = cashOnHand;
      const targetRevenue = parseMoney(document.getElementById('targetRevenue').value.trim());
      if (targetRevenue != null) position.target_monthly_revenue_usd = targetRevenue;
      const targetCosts = parseMoney(document.getElementById('targetCosts').value.trim());
      if (targetCosts != null) position.target_monthly_costs_usd = targetCosts;
      form.existing_company_deepen.current_financial_position = position;
      const updateGoal = document.getElementById('updateGoal').value;
      if (updateGoal) form.existing_company_deepen.update_goal = updateGoal;
    }
  }

  const deepen = collectInterviewDeepen();
  if (deepen) form.interview_deepen = deepen;

  // The optional revenue build-up. Instant Build works the same without it.
  const buildup = revenueEditor?.value();
  if (buildup) form.plan_detail = { financials: { revenue_buildup: buildup } };

  // Tell the readiness review what this runtime can actually hand a founder.
  //
  // runInstantPipeline defaults export_formats to ['html'] when the caller says nothing, and
  // nothing said anything — so the credit seat blocked every package with "exports as a web page
  // only; no paginated PDF or Word file is produced yet", including in the desktop app that
  // demonstrably produces one. Two high-severity blocks, on every pack, for a gap that had been
  // closed.
  //
  // Only `full` counts. A browser's print dialog is `available` but produces a document whose
  // contents page carries no measured page numbers, which is not what a lender is being promised
  // here — claiming 'pdf' for it would trade one wrong answer for another.
  //
  // The option is `desktopBridge` — detectCapabilities reads nothing else. This passed `bridge`,
  // so even the desktop app was reported as a browser here and every desktop pack was built as
  // html-only, bringing back the exact credit-seat block described above.
  const caps = window.FoundryEngines?.capabilities?.detectCapabilities?.({
    desktopBridge: window.foundryDesktop,
  });
  const exportFormats = caps?.pdf_export?.full ? ['html', 'pdf'] : ['html'];

  // A ZIP's county and metro come from the app's own ZIP data, read one small file at a time:
  // load the one this answer needs before the (synchronous) build.
  await window.FoundryEngines.prepareLocation?.(form);
  const pipeline = window.FoundryEngines.pipeline.runInstantPipeline(form, { export_formats: exportFormats });
  if (!pipeline.ok) {
    showFormError((pipeline.errors || pipeline.validation?.errors || ['Some answers could not be read. Check them and try again.']).join('\n'));
    return;
  }

  // A fresh intake starts a new company file, so do not apply document edits
  // saved for an earlier intake to the newly generated document pack.
  const store = window.FoundryPlanStore?.shared;
  // The plan now outlives the tab, so a second build is no longer a harmless restart: say what
  // it replaces before it does.
  const hasSavedPlan = Boolean(sessionStorage.getItem(STORAGE_KEY)) || store?.status().state === 'saved';
  if (
    hasSavedPlan &&
    !(await window.FoundryDialog.confirm(
      'Build a new plan? It replaces the plan saved on this device, including edits and Guided Interview answers. To keep the current one, choose Keep current plan and use Save plan file on the Documents page first.',
      { confirmLabel: 'Build new plan', cancelLabel: 'Keep current plan' },
    ))
  ) {
    return;
  }
  if (store) {
    // "Don't keep this plan on this device": the plan goes to this tab only and any device copy is
    // purged before the new plan is saved.
    const keepOff = Boolean(document.getElementById('keepOffDevice')?.checked);
    if (store.keepsOnDevice() === keepOff) await store.setKeepOnDevice(!keepOff);
    // Wait for the device copy before leaving the page, so closing the next tab cannot lose it.
    // settled() gives up after a few seconds; the tab copy is already written either way.
    store.savePipeline(pipeline, { edits: {} });
    // Guided Interview answers belong to the plan they were given for; a new plan starts fresh.
    if (typeof store.clearInterview === 'function') store.clearInterview();
    await store.settled();
  } else {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pipeline));
    localStorage.removeItem('foundry.document.edits');
  }
  // Auto-process into the document pack. Review and Draft Notes stay optional.
  const goToDocuments = () => {
    window.location.href = './documents.html#business_plan';
  };
  // Offline, the browser cannot load the Documents page and shows its own error screen, which
  // reads as "my plan is gone". The plan is already built and saved (above); say so here and open
  // Documents by itself as soon as the connection is back.
  if (navigator.onLine === false) {
    const box = document.getElementById('instantFormError');
    if (box) {
      box.textContent = 'Your plan is built and saved. You are offline, so Documents will open as soon as your connection is back.';
      box.classList.add('form-note');
      box.hidden = false;
      box.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }
    window.addEventListener('online', goToDocuments, { once: true });
    return;
  }
  goToDocuments();
});
