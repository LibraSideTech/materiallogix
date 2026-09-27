'use strict';

/**
 * "Your plan is saved on this device" — the status line and the controls around it: save or open
 * a plan file, start a new plan, delete the plan from this device.
 *
 * Storage itself is in plan-store.js (window.FoundryPlanStore). This file only wires whichever of
 * these elements the page has, so Instant Build and Documents share it:
 *   [data-plan-status]   any number of status lines
 *   #exportPlanBtn        Save plan file (JSON)
 *   #importPlanBtn        Open plan file (with #importPlanInput, a hidden file input)
 *   #newPlanBtn           Start a new plan
 *   #deletePlanBtn        Delete this plan from this device
 *   [data-plan-when="saved"|"none"]  shown only in that state
 *   #sessionOnlyToggle    "Don't keep this on this device" (applies at once)
 *   #keepOffDevice        the same choice on Instant Build, applied by app.js when the plan is built
 *
 * Pages learn about changes through window events: 'foundry:plan-restored' (a plan arrived — from
 * this device on load, or from an opened file) and 'foundry:plan-cleared'.
 */
(function planStorageUi() {
  const api = window.FoundryPlanStore;
  const store = api?.shared;
  revealWhenDrawn(api);
  if (!store) return;

  const $ = (id) => document.getElementById(id);
  let lastStatus = store.status();

  function hasPlan() {
    try {
      const p = JSON.parse(sessionStorage.getItem(api.SESSION_KEY) || 'null');
      return Boolean(p?.ok);
    } catch {
      return false;
    }
  }

  function paint(s) {
    lastStatus = s || store.status();
    const message = api.statusMessage(lastStatus);
    for (const el of document.querySelectorAll('[data-plan-status]')) {
      el.textContent = message;
      el.dataset.state = lastStatus.state;
    }
    const present = hasPlan();
    for (const el of document.querySelectorAll('[data-plan-when]')) {
      el.hidden = el.dataset.planWhen === 'saved' ? !present : present;
    }
    for (const id of ['exportPlanBtn', 'newPlanBtn', 'deletePlanBtn']) {
      const btn = $(id);
      if (btn) btn.disabled = !present;
    }
    for (const id of ['sessionOnlyToggle', 'keepOffDevice']) {
      const box = $(id);
      if (box) box.checked = !store.keepsOnDevice();
    }
  }

  function say(text) {
    const line = $('planStorageNote');
    if (line) line.textContent = text;
  }

  window.addEventListener('foundry:plan-status', (e) => paint(e.detail));
  window.addEventListener('foundry:plan-restored', () => paint());
  window.addEventListener('foundry:plan-cleared', () => paint());
  paint(lastStatus);

  // ---- Don't keep this on this device --------------------------------------------------------
  $('sessionOnlyToggle')?.addEventListener('change', async (e) => {
    const box = e.currentTarget;
    const result = await store.setKeepOnDevice(!box.checked);
    if (!result.ok && box.checked) {
      box.checked = false;
      say('This browser will not keep a tab-only copy, so the plan stays saved on this device. Delete it when you are done.');
      paint();
      return;
    }
    say(
      box.checked
        ? 'Removed from this device. The plan stays in this tab until you close it; save a plan file to keep a copy.'
        : result.ok
          ? 'Saved on this device again.'
          : api.statusMessage(store.status()),
    );
    paint();
  });

  // ---- Save plan file -----------------------------------------------------------------------
  $('exportPlanBtn')?.addEventListener('click', async () => {
    // Documents writes the open paper into the edits on blur/unload; make sure the file has it.
    window.dispatchEvent(new CustomEvent('foundry:plan-flush'));
    const file = store.exportPlan();
    if (!file) {
      say('There is no plan on this device to save yet.');
      return;
    }
    const bytes = new TextEncoder().encode(file.text);
    if (window.foundryDesktop?.saveFile) {
      try {
        const result = await window.foundryDesktop.saveFile(file.filename, bytes);
        say(result.saved ? `Plan file saved to ${result.path}. Open it in Foundry on any device.` : 'Save cancelled.');
      } catch {
        say('Could not save the plan file. Try again.');
      }
      return;
    }
    const blob = new Blob([bytes], { type: file.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say(`Downloaded ${file.filename}. Open it in Foundry on any device with Open plan file.`);
  });

  // ---- Open plan file -----------------------------------------------------------------------
  const input = $('importPlanInput');
  $('importPlanBtn')?.addEventListener('click', () => input?.click());
  input?.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (
      hasPlan() &&
      !(await window.FoundryDialog.confirm('Open this plan file? It replaces the plan saved on this device. Save a plan file first if you want to keep the current one.', {
        confirmLabel: 'Open plan file',
      }))
    ) {
      return;
    }
    let text;
    try {
      text = await file.text();
    } catch {
      say('Could not read that file.');
      return;
    }
    const result = await store.importPlan(text);
    if (!result.pipeline) {
      say(result.message || 'That is not a Foundry plan file.');
      return;
    }
    window.dispatchEvent(new CustomEvent('foundry:plan-restored', { detail: { pipeline: result.pipeline, source: 'file' } }));
    const name = result.company_title ? `“${result.company_title}”` : 'Your plan';
    say(
      result.sessionOnly
        ? `${name} is open in this tab only, not saved on this device.`
        : result.ok
          ? `${name} is open and saved on this device.`
          : `${name} is open in this tab, but could not be saved on this device. ${api.statusMessage(store.status())}`,
    );
    if (document.body.dataset.planOpenGoes) goWhenOnline(document.body.dataset.planOpenGoes, 'The plan is open and saved. You are offline, so Documents will open as soon as your connection is back.');
  });

  // ---- Start a new plan / Delete ------------------------------------------------------------
  $('newPlanBtn')?.addEventListener('click', async () => {
    const start = await window.FoundryDialog.confirm('Start a new plan? This removes the current plan from this device. Save a plan file first if you want to keep it.', {
      confirmLabel: 'Start new plan',
      danger: true,
    });
    if (!start) return;
    await store.clear();
    window.dispatchEvent(new CustomEvent('foundry:plan-cleared'));
    goWhenOnline('./index.html', 'The plan is removed from this device. You are offline, so Instant Build will open as soon as your connection is back.');
  });

  /** Offline, the browser shows its own error page instead of the next page: say so and wait. */
  function goWhenOnline(url, offlineMessage) {
    if (navigator.onLine === false) {
      say(offlineMessage);
      window.addEventListener('online', () => { window.location.href = url; }, { once: true });
      return;
    }
    window.location.href = url;
  }

  $('deletePlanBtn')?.addEventListener('click', async () => {
    const remove = await window.FoundryDialog.confirm('Delete this plan from this device? Your answers, documents and edits are removed here. A plan file you saved is not affected.', {
      confirmLabel: 'Delete plan',
      danger: true,
    });
    if (!remove) return;
    const result = await store.clear();
    window.dispatchEvent(new CustomEvent('foundry:plan-cleared'));
    say(result.ok ? 'Plan deleted from this device.' : 'The plan was removed from this tab, but this device’s storage could not be cleared. Try again.');
  });

  /**
   * A page that marks its body data-render="pending" (styles.css) paints only its navigation until
   * every script has run and this device's saved plan has been read, then shows the body in one
   * go: the plan status, "Open your plan", the banners and the Guided Interview entry used to
   * arrive one after another, each pushing the page down. Reading the device copy is capped, so a
   * slow browser store never keeps the page hidden.
   */
  function revealWhenDrawn(planApi) {
    const main = document.querySelector('main[data-render]');
    if (!main) return;
    const domReady = document.readyState === 'loading' ? new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true })) : Promise.resolve();
    const restored = Promise.race([Promise.resolve(planApi?.ready).catch(() => null), new Promise((r) => setTimeout(r, 3000))]);
    Promise.all([domReady, restored]).then(() => requestAnimationFrame(() => main.removeAttribute('data-render')));
  }
})();
