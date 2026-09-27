const STORAGE_KEY = 'foundry.instant.context';
const EDITS_KEY = 'foundry.document.edits';

function loadPipeline() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
    if (saved?.ok) return saved;
  } catch {
    /* ignore */
  }
  return null;
}

function loadEdits() {
  // A plan kept in this tab only keeps its edits there too; the store knows which.
  const store = window.FoundryPlanStore?.shared;
  if (store?.edits) return store.edits();
  try {
    return JSON.parse(localStorage.getItem(EDITS_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveEdits(map) {
  const store = window.FoundryPlanStore?.shared;
  // The plan store writes the edits synchronously (localStorage, or the tab alone for a tab-only
  // plan) and the device copy in order after it.
  if (store) store.saveEdits(map);
  else localStorage.setItem(EDITS_KEY, JSON.stringify(map));
}

/** Keep the pipeline in this tab and on this device (plan-store.js), or in the tab alone. */
function storePipeline(pipeline) {
  const store = window.FoundryPlanStore?.shared;
  if (store) return store.savePipeline(pipeline);
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pipeline));
  return Promise.resolve({ ok: false, error: 'unavailable' });
}


function plainTextFromHtml(html) {
  const el = document.createElement('div');
  el.innerHTML = html || '';
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

function setStatus(message) {
  const status = document.getElementById('docSaveStatus');
  if (status) status.textContent = message;
}

/**
 * Quiet re-process after edits.
 */
function reprocessAfterEdits(source) {
  if (!state.pipeline || !window.FoundryEngines?.pipeline?.refreshAfterFounderEdits) {
    return false;
  }
  persistCurrentPaper();
  const notesHtml = state.edits.draft_notes?.html || '';
  const clarification = plainTextFromHtml(notesHtml).slice(0, 4000);
  setStatus('Updating documents…');

  const next = window.FoundryEngines.pipeline.refreshAfterFounderEdits(state.pipeline, {
    clarification,
    source,
  });
  if (!next?.ok) {
    setStatus('Could not update. Your edits are still saved on this device.');
    return false;
  }

  state.pipeline = next;
  storePipeline(next);
  state.pack = ensurePack(next);
  // Save is the founder keeping their text: their edits now stand on this regenerated pack, so
  // they are not reported as "rebuilt after you edited it" on the next view.
  rebaseEdits();

  // Keep every edit. Save used to drop all but the notes here, so the paper the founder had just
  // edited was redrawn from the regenerated pack and the edit vanished right after "Saved." An
  // edited document is the founder's text: it stays, across reloads and in every export.
  saveEdits(state.edits);
  return true;
}

function ensurePack(pipeline) {
  if (pipeline.document_pack?.ok) return pipeline.document_pack;
  return window.FoundryEngines.pipeline.buildDocumentPack(pipeline);
}

const state = {
  pipeline: loadPipeline(),
  pack: null,
  activeId: null,
  edits: loadEdits(),
};

function adoptPipeline(pipeline) {
  state.pipeline = pipeline;
  state.pack = ensurePack(pipeline);
  const hash = (location.hash || '').replace(/^#/, '');
  state.activeId =
    hash ||
    state.pack.documents.find((d) => d.id === 'business_plan')?.id ||
    state.pack.documents.find((d) => d.tier === 'recommended')?.id ||
    state.pack.documents[0]?.id ||
    'business_plan';
}

if (state.pipeline) adoptPipeline(state.pipeline);

function activeDoc() {
  if (!state.pack) return null;
  return (
    state.pack.documents.find((d) => d.id === state.activeId) || state.pack.documents[0]
  );
}

function renderEmpty() {
  const intro = document.getElementById('documentsIntro');
  if (intro) {
    intro.textContent =
      'No plan on this device yet. Build one on Instant Build, or open a plan file saved from another device.';
  }
  const list = document.getElementById('docLibrary');
  if (list) {
    list.innerHTML =
      '<li class="file-rail-note">Waiting on Instant Build.</li>';
  }
  const title = document.getElementById('activeDocTitle');
  const purpose = document.getElementById('activeDocPurpose');
  const paper = document.getElementById('docPaper');
  if (title) title.textContent = 'No documents yet';
  if (purpose) purpose.textContent = '';
  if (paper) {
    paper.contentEditable = 'false';
    paper.innerHTML =
      '<p><a href="./index.html">Open Instant Build</a> and answer the nine questions.</p>';
  }
  for (const id of ['saveDocBtn', 'exportEditableBtn', 'exportDocxBtn', 'exportArchiveBtn', 'exportPdfBtn']) {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = true;
  }
}

/** Undo renderEmpty when a plan arrives after the page first drew without one. */
function renderFilled() {
  const intro = document.getElementById('documentsIntro');
  if (intro) {
    intro.textContent =
      'Instant built this pack from your answers. Use Adjust notes only if something needs clarifying.';
  }
  const paper = document.getElementById('docPaper');
  if (paper) paper.contentEditable = 'true';
  for (const id of ['saveDocBtn', 'exportEditableBtn', 'exportDocxBtn', 'exportArchiveBtn', 'exportPdfBtn']) {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = false;
  }
}

function sectionsToHtml(doc) {
  const edited = state.edits[doc.id];
  if (edited?.html) return edited.html;
  return generatedSectionsHtml(doc);
}

/** The generated document as the browser serialises it, so it compares with the paper's HTML. */
function generatedSerialized(doc) {
  const box = document.createElement('div');
  box.innerHTML = generatedSectionsHtml(doc);
  return box.innerHTML;
}

function hashText(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * An edit whose document has since been rebuilt from new answers (the Guided Interview, the form,
 * Programs, a path): the founder's text is still shown, but they are told, and can switch to the
 * rebuilt version. `base` is the fingerprint of the generated document the edit was made on; an
 * edit from before fingerprints existed has none.
 */
function staleEdit(doc) {
  const edit = state.edits[doc.id];
  if (!edit?.html) return false;
  return edit.base ? edit.base !== hashText(generatedSerialized(doc)) : edit.html !== generatedSerialized(doc);
}

function rebaseEdits() {
  for (const doc of state.pack?.documents || []) {
    const edit = state.edits[doc.id];
    if (edit?.html) edit.base = hashText(generatedSerialized(doc));
  }
}

function renderEditNotice(doc) {
  const box = document.getElementById('docEditNotice');
  if (!box) return;
  box.hidden = !staleEdit(doc);
}

function generatedSectionsHtml(doc) {
  return (doc.sections || [])
    .map(
      (s) => `<section data-section="${s.id}">
<h2>${s.heading}</h2>
<div class="section-body">${s.body_html}</div>
</section>`,
    )
    .join('\n');
}

let lastRailTap = null;
const RAIL_TAP_SETTLE_MS = 500;

function renderLibrary() {
  const list = document.getElementById('docLibrary');
  list.innerHTML = '';
  const recommended = state.pack.documents.filter((d) => (d.tier || 'recommended') === 'recommended');
  const optional = state.pack.documents.filter((d) => d.tier === 'optional');

  function addHeading(label) {
    const li = document.createElement('li');
    li.className = 'file-rail-heading';
    li.textContent = label;
    list.appendChild(li);
  }

  function addDoc(d) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'file-rail-item' + (d.id === state.activeId ? ' is-active' : '');
    const tier =
      d.tier === 'optional'
        ? '<em class="tier-tag">Optional</em>'
        : d.tier === 'front_matter'
          ? '<em class="tier-tag">Page 1</em>'
          : d.tier === 'working_notes'
            ? '<em class="tier-tag">Notes</em>'
            : '';
    btn.innerHTML = `<strong>${d.name}</strong>${tier}<span>${d.snippet}</span>`;
    btn.addEventListener('click', (event) => {
      // Opening a document scrolls it into view; the second tap of a double tap then landed on
      // whichever entry had moved under the finger and opened that instead. A tap at the same spot
      // a moment after the last one is that second tap, and is ignored.
      const at = { x: event.clientX, y: event.clientY, t: Date.now() };
      const ghost = event.detail !== 0 && lastRailTap && at.t - lastRailTap.t < RAIL_TAP_SETTLE_MS && Math.hypot(at.x - lastRailTap.x, at.y - lastRailTap.y) < 32;
      if (event.detail !== 0) lastRailTap = at;
      if (ghost) return;
      persistCurrentPaper();
      state.activeId = d.id;
      history.replaceState(null, '', `#${d.id}`);
      render();
      revealStageOnNarrowScreens();
    });
    li.appendChild(btn);
    list.appendChild(li);
  }

  const front = state.pack.documents.filter((d) => d.tier === 'front_matter');
  const notes = state.pack.documents.filter((d) => d.tier === 'working_notes');
  if (front.length) {
    addHeading('Start here');
    front.forEach(addDoc);
  }
  if (notes.length) {
    addHeading('Optional · adjust if needed');
    notes.forEach(addDoc);
  }
  addHeading('Core documents');
  recommended.forEach(addDoc);
  if (optional.length) {
    addHeading('Optional (from Instant)');
    optional.forEach(addDoc);
  } else if (state.pack.optional_catalog?.length) {
    const li = document.createElement('li');
    li.className = 'file-rail-note';
    li.textContent =
      'No optional extras selected.';
    list.appendChild(li);
  }
}

/**
 * Below 900px the library stacks above the document, so on a phone the list is ten entries long
 * and the document it opens is a screen or two further down. Tapping an entry changed a page the
 * founder could not see; it now scrolls there. On wider screens the two sit side by side and
 * nothing moves.
 */
function revealStageOnNarrowScreens() {
  const stage = document.querySelector('.file-stage');
  if (!stage) return;
  // Side by side, the document only needs bringing back when the founder has scrolled down the
  // library far enough that its top (the title, the start of the text) has gone off screen: the
  // new document then appeared mid-page with nothing to say it had changed.
  if (!window.matchMedia?.('(max-width: 900px)').matches && stage.getBoundingClientRect().top >= 0) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  stage.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

function renderPaper() {
  const doc = activeDoc();
  document.getElementById('activeDocTitle').textContent = doc.name;
  document.getElementById('activeDocPurpose').textContent = doc.purpose || '';
  document.getElementById('docPaper').innerHTML = sectionsToHtml(doc);
  renderEditNotice(doc);
  const intro = document.getElementById('documentsIntro');
  if (intro) {
    const desc = state.pipeline.intake?.business_description || '';
    const core =
      'Built from your Instant answers.';
    intro.innerHTML = desc
      ? `For “${desc.length > 64 ? `${desc.slice(0, 61)}…` : desc}”. ${core}`
      : core;
  }
  syncNotesToggleBtn();
}

function syncNotesToggleBtn() {
  const btn = document.getElementById('adjustNotesBtn');
  if (!btn) return;
  const onNotes = state.activeId === 'draft_notes';
  btn.hidden = !state.pipeline;
  btn.textContent = onNotes ? 'Back to documents' : 'Adjust notes';
  btn.setAttribute('aria-label', onNotes ? 'Return to Business Plan' : 'Review or clarify draft notes');
}

function toggleNotesView() {
  if (!state.pipeline || !state.pack) return;
  const leavingNotes = state.activeId === 'draft_notes';
  persistCurrentPaper();
  if (leavingNotes) {
    // Edits land back in documents only after the quiet re-process.
    reprocessAfterEdits('notes');
    const plan = state.pack.documents.find((d) => d.id === 'business_plan');
    state.activeId = plan?.id || 'business_plan';
    history.replaceState(null, '', `#${state.activeId}`);
    render();
    setStatus('Saved.');
    return;
  }
  const notes = state.pack.documents.find((d) => d.id === 'draft_notes');
  state.activeId = notes?.id || 'draft_notes';
  history.replaceState(null, '', `#${state.activeId}`);
  render();
  setStatus('Clarify anything that looks off, then return to your documents.');
}

/**
 * Keep what the founder typed. A paper nobody typed on is not an edit: storing every viewed
 * document's HTML used to freeze it, so a plan rebuilt from the Guided Interview still showed the
 * old text (the cover kept the business description after the business was named). Only a paper
 * that differs from what was generated is kept, with the fingerprint of the version it was made on.
 */
function persistCurrentPaper() {
  const paper = document.getElementById('docPaper');
  const doc = activeDoc();
  if (!paper || !doc || paper.contentEditable === 'false') return;
  const html = paper.innerHTML;
  const generated = generatedSerialized(doc);
  const previous = state.edits[state.activeId];
  if (html === generated) {
    if (previous) {
      delete state.edits[state.activeId];
      saveEdits(state.edits);
    }
    return;
  }
  if (previous?.html === html) return;
  state.edits[state.activeId] = {
    html,
    saved_at: new Date().toISOString(),
    base: previous?.html && previous.base ? previous.base : hashText(generated),
  };
  saveEdits(state.edits);
}

function downloadHtml(filename, html) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * What this runtime can actually do. The desktop shell's bridge is what distinguishes it.
 *
 * Guarded because a browser may still be holding an older cached copy of the engine bundle that
 * predates this module. Falling back to the browser-build answer is right either way: without
 * the bundle there is certainly no desktop bridge to use.
 */
function runtimeCapabilities() {
  const caps = baseCapabilities();
  // Outside the desktop app, web-pdf.js picks the best PDF route this runtime has: the store
  // app's on-device renderer or the browser's print dialog (there is no hosted renderer). The
  // desktop descriptor passes through untouched. A route that just failed drops to printing.
  const web = window.FoundryWebPdf;
  if (!web?.withPdfRoute) return caps;
  const routed = web.withPdfRoute(caps, window);
  if (state.pdfRouteFailed && routed.pdf_export.via !== 'desktop') {
    return web.withPdfRoute(caps, { navigator: window.navigator });
  }
  return routed;
}

function baseCapabilities() {
  const detect = window.FoundryEngines?.capabilities?.detectCapabilities;
  if (typeof detect !== 'function') {
    return {
      runtime: 'web',
      pdf_export: { available: true, full: false, label: 'Print / Save as PDF', note: '' },
      local_model: { available: true, full: false, label: 'Ask about this plan', note: '' },
      file_save: { available: true, full: false, label: 'Download', note: '' },
    };
  }
  return detect({ desktopBridge: window.foundryDesktop });
}

/**
 * The document as it will be exported, with any founder edits folded in.
 *
 * persistCurrentPaper() stores the paper's HTML whether or not anything was typed, so "has a
 * stored copy" is not "was edited". Treating every stored copy as an edit flattened the export to
 * one section — no cover, no contents page, no page numbers — even for an untouched plan. An
 * edit is only an edit when the paper differs from what was generated (compared after the same
 * browser serialisation, so formatting noise does not count).
 */
function docForExport() {
  persistCurrentPaper();
  const doc = activeDoc();
  const edited = state.edits[doc.id]?.html;
  if (!edited) return doc;
  const generated = document.createElement('div');
  generated.innerHTML = generatedSectionsHtml(doc);
  if (generated.innerHTML === edited) return doc;
  return editedDoc(doc, edited);
}

/**
 * The document with the founder's edits, section by section: each edited <section data-section>
 * keeps its id and heading, so an export still has its cover and contents. Paper that no longer
 * has the section structure (everything deleted and retyped) exports as one section.
 */
function editedDoc(doc, editedHtml) {
  const box = document.createElement('div');
  box.innerHTML = editedHtml;
  const parts = [...box.querySelectorAll('section[data-section]')];
  if (!parts.length) return { ...doc, sections: [{ id: 'edited', heading: doc.name, body_html: editedHtml }] };
  const byId = new Map((doc.sections || []).map((s) => [s.id, s]));
  const sections = parts.map((el) => {
    const id = el.getAttribute('data-section');
    const h = el.querySelector('h2');
    const body = el.querySelector('.section-body');
    const heading = (h ? h.textContent : '').trim() || byId.get(id)?.heading || doc.name;
    return { ...(byId.get(id) || {}), id, heading, body_html: body ? body.innerHTML : el.innerHTML };
  });
  return { ...doc, sections };
}

/**
 * A real PDF. The desktop app renders it properly — two passes, so the table of contents
 * carries the page numbers sections actually landed on. The store app (native plugin) does the
 * same two passes on the device through web-pdf.js. A plain
 * browser cannot, so rather than quietly producing something lesser under the same button, it
 * opens the finished document on its own, hands it to the browser's print dialog, and says what
 * the difference is.
 */
async function exportPdf() {
  const caps = runtimeCapabilities();
  const route = caps.pdf_export;
  const doc = docForExport();
  const opts = {
    mode: 'archive',
    company_title: state.pack.company_title,
    generated_at: state.pack.generated_at,
  };
  const filename = doc.filename.replace('.html', '.pdf');

  // `full`, not `available` — the browser can produce a PDF, just not a paginated one with
  // measured page numbers, so this is the branch between two real routes rather than a
  // feature being missing.
  if (!route.full) {
    printDocument(doc, opts, route.note);
    return;
  }

  if (route.via !== 'desktop') {
    await exportPdfOutsideDesktop(route, doc, opts, filename);
    return;
  }

  setStatus('Building PDF…');
  try {
    const bytes = await window.foundryDesktop.printToPdf(doc, opts);
    const result = await window.foundryDesktop.saveFile(filename, bytes);
    setStatus(result.saved ? `Saved to ${result.path}` : 'Save cancelled.');
  } catch {
    setStatus('Could not build the PDF. Try again, or export the editable file instead.');
  }
}

/** The browser's own print dialog: Save as PDF on a computer, Share → Save to Files on iOS. */
function printDocument(doc, opts, note) {
  let html = window.FoundryEngines.pipeline.renderDocumentHtml(doc, opts);
  if (window.FoundryWebPdf?.printReadyHtml) html = window.FoundryWebPdf.printReadyHtml(html);
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    setStatus('Allow pop-ups for this page to print, or use the desktop app.');
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  // Give the new document a tick to lay out before the print dialog measures it.
  setTimeout(() => printWindow.print(), 250);
  setStatus(note);
}

/** Store app (on-device): same two passes as desktop, then save or share. */
async function exportPdfOutsideDesktop(route, doc, opts, filename) {
  const web = window.FoundryWebPdf;
  const htmlToPdf = web.htmlToPdfFor(route, window);
  setStatus('Building PDF…');
  let result;
  try {
    result = await web.renderTwoPass({
      htmlToPdf,
      renderHtml: window.FoundryEngines.pipeline.renderDocumentHtml,
      doc,
      opts,
    });
  } catch {
    // The print dialog cannot be opened from here — the tap that started this has expired — so
    // the next tap prints instead, and the button says so.
    state.pdfRouteFailed = true;
    renderDesktopUpgrade();
    setStatus('Could not build the PDF on this device. Tap Print / Save as PDF to use the print view instead.');
    return;
  }
  const delivery = await web.deliverPdf(result.bytes, filename, { win: window });
  // An edited document is one section with no contents page, so there is nothing to number.
  const hasToc = (doc.sections || []).length > 1;
  const numbered = result.tocPageNumbers || !hasToc ? '' : ' (contents page without page numbers)';
  if (delivery.delivered === 'needs_tap') {
    setStatus(`Your PDF is ready${numbered}.`);
    const status = document.getElementById('docSaveStatus');
    if (status) web.offerReadyPdf(window, status, { ...delivery, filename });
  } else if (delivery.delivered === 'cancelled') {
    setStatus('Share cancelled. Tap Save as PDF to try again.');
  } else {
    setStatus(delivery.delivered === 'downloaded' ? `Downloaded ${filename}${numbered}.` : `PDF ready${numbered}.`);
  }
}

/** On the browser build, say plainly what the download would add. Silent on desktop. */
function renderDesktopUpgrade() {
  const box = document.getElementById('desktopUpgrade');
  const list = document.getElementById('desktopUpgradeNotes');
  if (!box || !list) return;
  const caps = runtimeCapabilities();
  const notes = window.FoundryEngines.capabilities.upgradeNotes(caps);
  if (!notes.length) {
    box.hidden = true;
    return;
  }
  list.textContent = ` The desktop app adds: ${notes.join(' ')}`;
  box.hidden = false;

  const pdfBtn = document.getElementById('exportPdfBtn');
  if (pdfBtn) pdfBtn.textContent = caps.pdf_export.label;
}

/**
 * The one-time acknowledgment before the first export, print or share of any document. Kept on
 * this device with the notice version (plan-store); a new notice version asks again. Nothing is
 * sent anywhere.
 */
const DISCLAIMER_ACK_LABEL = 'I understand these documents are not financial, legal, tax, or investment advice.';
async function ensureDisclaimerAck() {
  const store = window.FoundryPlanStore?.shared;
  const version = window.FoundryEngines?.documents?.DISCLAIMER_VERSION || '1';
  if (store?.disclaimerAckNeeded && !store.disclaimerAckNeeded(version)) return true;
  const message =
    'These documents are for planning purposes only. They are not financial, legal, tax, or investment advice, and the projections in them are estimates, not guarantees. Verify the figures and consult a qualified financial advisor, accountant, and attorney before relying on them or submitting them to a lender or investor.';
  const dialog = window.FoundryDialog;
  const ok = dialog?.acknowledge
    ? await dialog.acknowledge(message, DISCLAIMER_ACK_LABEL, { confirmLabel: 'Continue' })
    : window.confirm(`${message}\n\n${DISCLAIMER_ACK_LABEL}`);
  if (ok && store?.recordDisclaimerAck) store.recordDisclaimerAck(version);
  if (!ok) setStatus('Export cancelled. Tick the box to confirm you have read the notice.');
  return Boolean(ok);
}

/** Word (.docx) export: an editable copy styled like the PDF. */
async function exportDocx() {
  const doc = docForExport();
  const bytes = window.FoundryEngines.documents.renderDocumentDocx(doc, {
    company_title: state.pack.company_title,
    generated_at: state.pack.generated_at,
  });
  const filename = doc.filename.replace('.html', '.docx');
  if (window.foundryDesktop?.saveFile) {
    try {
      const result = await window.foundryDesktop.saveFile(filename, bytes);
      setStatus(result.saved ? `Saved to ${result.path}` : 'Save cancelled.');
      return;
    } catch {
      // Fall through to a browser download.
    }
  }
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus(`Downloaded ${filename}.`);
}

function exportDoc(mode) {
  // Same rule as the PDF route: a stored copy of an untouched paper is not an edit, so an
  // untouched plan keeps its cover and contents page in the editable file and the archive too.
  const doc = docForExport();
  const base = window.FoundryEngines.pipeline.renderDocumentHtml(
    doc,
    {
      mode,
      company_title: state.pack.company_title,
      generated_at: state.pack.generated_at,
    },
  );
  const suffix = mode === 'archive' ? ' - Archive' : '';
  downloadHtml(doc.filename.replace('.html', `${suffix}.html`), base);
  document.getElementById('docSaveStatus').textContent =
    mode === 'archive'
      ? 'Archive downloaded.'
      : 'Editable file downloaded.';
}

/**
 * The plan check under the header: when the finance model says the plan does not work as structured
 * (or it was rebuilt on a track), a link to Paths that could work (paths.html). Hidden otherwise.
 */
function renderPathsBanner() {
  const banner = document.getElementById('pathsBanner');
  const text = document.getElementById('pathsBannerText');
  const link = document.getElementById('pathsBannerLink');
  if (!banner || !text || !link) return;
  const p = state.pipeline;
  const fn = p?.finance?.funding_need;
  const flagged = Boolean(fn && !fn.works && p?.plan_tracks?.applicable);
  const onTrack = Boolean(p?.track_origin);
  banner.hidden = !(flagged || onTrack);
  if (flagged) {
    const works = p.plan_tracks.tracks.filter((t) => t.figures.works).length;
    text.textContent = `On the numbers, this plan does not work as structured yet: it is not cash-positive within ${fn.horizon_months_after_opening} months of opening${fn.reasons.includes('coverage_below_minimum_year2') ? ', and it cannot carry its loan by Year 2' : ''}. ${works ? `${works} of the paths Foundry worked out ${works === 1 ? 'works' : 'work'} on the model.` : 'Foundry worked out the changes that would help.'}`;
    link.textContent = 'See paths that could work';
  } else if (onTrack) {
    const t = p.intake?.plan_track;
    text.textContent = `This plan is built on the track "${t?.title || 'chosen'}". Your original plan is kept on this device.`;
    link.textContent = 'Paths and your original plan';
  }
}

function render() {
  renderDesktopUpgrade();
  renderPathsBanner();
  if (!state.pipeline || !state.pack) {
    renderEmpty();
    return;
  }
  renderFilled();
  renderLibrary();
  renderPaper();
}

document.getElementById('docUseRebuiltBtn')?.addEventListener('click', async () => {
  const doc = activeDoc();
  if (!doc || !state.edits[doc.id]) return;
  const ok = window.FoundryDialog
    ? await window.FoundryDialog.confirm(`Show the rebuilt ${doc.name}? Your edits to this document are replaced by the version rebuilt from your latest answers.`, { confirmLabel: 'Show the rebuilt version' })
    : true;
  if (!ok) return;
  delete state.edits[doc.id];
  saveEdits(state.edits);
  renderPaper();
  setStatus('Showing the rebuilt version.');
});

document.getElementById('adjustNotesBtn')?.addEventListener('click', () => {
  toggleNotesView();
});

document.getElementById('saveDocBtn')?.addEventListener('click', () => {
  if (!state.pipeline) return;
  const ok = reprocessAfterEdits('save');
  if (ok) {
    render();
    setStatus('Saved.');
  }
});

document.getElementById('exportEditableBtn')?.addEventListener('click', async () => {
  if (!state.pipeline || !(await ensureDisclaimerAck())) return;
  exportDoc('editable');
});
document.getElementById('exportDocxBtn')?.addEventListener('click', async () => {
  if (!state.pipeline || !(await ensureDisclaimerAck())) return;
  exportDocx();
});
document.getElementById('exportArchiveBtn')?.addEventListener('click', async () => {
  if (!state.pipeline || !(await ensureDisclaimerAck())) return;
  exportDoc('archive');
});
document.getElementById('exportPdfBtn')?.addEventListener('click', async () => {
  if (!state.pipeline || !(await ensureDisclaimerAck())) return;
  exportPdf();
});

/**
 * The plan-completion panel rebuilds the pipeline when answers are added. It owns the answers;
 * this file owns what is on screen, so it hands the new pipeline over rather than redrawing the
 * document itself.
 *
 * Generated documents are replaced outright — the point of answering is that they change — but
 * the founder's own note edits are kept, the same way a save after editing does.
 */
window.addEventListener('foundry:pipeline-updated', (event) => {
  const next = event.detail?.pipeline;
  if (!next?.ok) return;
  state.pipeline = next;
  state.pack = ensurePack(next);
  const keepNotes = state.edits.draft_notes;
  state.edits = keepNotes ? { draft_notes: keepNotes } : {};
  saveEdits(state.edits);
  if (!state.pack.documents.some((d) => d.id === state.activeId)) {
    state.activeId = state.pack.documents[0]?.id || state.activeId;
  }
  render();
});

/**
 * A plan arrived after the page drew: from this device on load (the tab had been closed), or from
 * a plan file the founder opened. Either way it replaces what is on screen, edits included.
 */
window.addEventListener('foundry:plan-restored', (event) => {
  const next = event.detail?.pipeline;
  if (!next?.ok) return;
  state.edits = loadEdits();
  adoptPipeline(next);
  render();
});

window.addEventListener('foundry:plan-cleared', () => {
  state.pipeline = null;
  state.pack = null;
  state.edits = {};
  state.activeId = null;
  render();
});

// Save plan file asks for the open paper first, so the file carries what is on screen.
window.addEventListener('foundry:plan-flush', () => {
  if (state.pipeline) persistCurrentPaper();
});

window.addEventListener('beforeunload', () => {
  if (state.pipeline) persistCurrentPaper();
});
window.addEventListener('hashchange', () => {
  if (!state.pack) return;
  const id = (location.hash || '').replace(/^#/, '');
  if (id && state.pack.documents.some((d) => d.id === id)) {
    persistCurrentPaper();
    state.activeId = id;
    render();
  }
});

render();
