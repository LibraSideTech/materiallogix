const STORAGE_KEY = 'foundry.instant.context';

function loadPipeline() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
    if (saved?.ok) return saved;
  } catch {
    /* ignore */
  }
  return null;
}

function savePipeline(pipeline) {
  const store = window.FoundryPlanStore?.shared;
  if (store) return store.savePipeline(pipeline);
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pipeline));
  return Promise.resolve({ ok: false });
}

function listItems(pipeline) {
  const api = window.FoundryEngines?.pipeline;
  if (api?.listAssumptionReviewItems) return api.listAssumptionReviewItems(pipeline);
  return [];
}

function applyReview(pipeline, opts) {
  const api = window.FoundryEngines?.pipeline;
  if (api?.applyAssumptionReview) return api.applyAssumptionReview(pipeline, opts);
  return {
    ...pipeline,
    assumption_review: {
      completed: true,
      completed_at: new Date().toISOString(),
      confirmed_ids: opts.confirmed_ids || [],
      notes: opts.notes || null,
    },
    finance: { ...pipeline.finance, assumption_review_required: false },
    graph: { ...pipeline.graph, assumptionReviewRequired: false },
  };
}

const state = {
  pipeline: loadPipeline(),
  items: [],
};

function renderEmpty() {
  const list = document.getElementById('reviewList');
  const intro = document.getElementById('reviewIntro');
  if (intro) {
    intro.textContent =
      'No plan on this device yet. Complete Instant first.';
  }
  if (list) {
    list.innerHTML =
      '<li class="review-empty">Waiting on Instant Build. <a href="./index.html">Open Instant</a>.</li>';
  }
  const btn = document.getElementById('confirmReviewBtn');
  if (btn) btn.disabled = true;
}

function renderList() {
  const list = document.getElementById('reviewList');
  const aside = document.getElementById('reviewAside');
  const title = document.getElementById('reviewTitle');
  if (!list) return;

  const desc = state.pipeline?.intake?.business_description || '';
  if (title) {
    title.textContent = desc
      ? `Review for “${desc.length > 56 ? `${desc.slice(0, 53)}…` : desc}”`
      : 'Review items';
  }
  if (aside) {
    const attention = state.items.filter((i) => i.needs_attention).length;
    aside.textContent =
      attention > 0
        ? `${attention} item(s) still need a closer look.`
        : 'Ready to open Documents. Replace assumed figures with quotes later.';
  }

  list.innerHTML = '';
  for (const item of state.items) {
    const li = document.createElement('li');
    li.className = 'review-item' + (item.needs_attention ? ' needs-attention' : '');
    li.innerHTML = `
      <label class="review-check">
        <input type="checkbox" data-review-id="${item.id}" checked />
        <span class="review-check-body">
          <span class="review-meta">
            <span class="review-category">${item.category}</span>
            <span class="review-origin">${item.origin}</span>
          </span>
          <strong class="review-label">${item.label}</strong>
          <span class="review-value">${item.value}</span>
          <span class="review-note">${item.note || ''}</span>
        </span>
      </label>`;
    list.appendChild(li);
  }
}

function render() {
  if (!state.pipeline) {
    renderEmpty();
    return;
  }
  if (state.pipeline.assumption_review?.completed) {
    const status = document.getElementById('reviewStatus');
    if (status) {
      status.innerHTML =
        'Already confirmed for this plan. <a href="./documents.html#business_plan">Open Documents</a>.';
    }
  }
  state.items = listItems(state.pipeline);
  renderList();
}

// A plan kept on this device arrives after the page first drew (the tab had been closed).
window.addEventListener('foundry:plan-restored', (event) => {
  const next = event.detail?.pipeline;
  if (!next?.ok) return;
  state.pipeline = next;
  const btn = document.getElementById('confirmReviewBtn');
  if (btn) btn.disabled = false;
  const intro = document.getElementById('reviewIntro');
  if (intro) intro.textContent = 'Restored from this device.';
  render();
});

document.getElementById('confirmReviewBtn')?.addEventListener('click', () => {
  if (!state.pipeline) return;
  const checked = [...document.querySelectorAll('[data-review-id]:checked')].map(
    (el) => el.getAttribute('data-review-id'),
  );
  const notes = document.getElementById('reviewNotes')?.value.trim() || '';
  const next = applyReview(state.pipeline, {
    confirmed_ids: checked,
    notes,
  });
  if (!next || next.ok === false) {
    const box = document.getElementById('reviewError');
    if (box) {
      box.textContent = (next && next.errors && next.errors[0]) || 'Could not save the review. Try again.';
      box.hidden = false;
      box.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }
    return;
  }
  savePipeline(next);
  window.location.href = './documents.html#business_plan';
});

render();
