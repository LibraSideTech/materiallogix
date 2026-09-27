'use strict';

/**
 * In-page confirmation dialog: window.FoundryDialog.confirm(message, options) → Promise<boolean>.
 *
 * Replaces window.confirm()/alert() in customer flows. Those block the page thread, cannot be
 * styled or read in the founder's context, are suppressed by some embedded browsers, and inside
 * the store app's native WebView they are rendered (or not) by the host shell rather than by
 * Foundry. This uses the platform <dialog> element (focus moves in, Escape cancels, focus returns
 * to what was focused before), so it works the same with a keyboard, a screen reader and touch.
 *
 * options: { confirmLabel = 'Continue', cancelLabel = 'Cancel', danger = false }
 *
 * window.FoundryDialog.acknowledge(message, checkboxLabel, options) → Promise<boolean>: the same
 * dialog with a checkbox the founder must tick before Continue is enabled. Used once, before the
 * first export, for the planning-purposes notice.
 */
(function foundryDialog(root) {
  let open = null;

  /**
   * A double or triple tap on the button that opens a dialog lands its second tap on the dialog,
   * which opens under the finger: it ticked the export acknowledgment, and could confirm a delete.
   * A tap in the first moments after the dialog opens, at the same spot as the tap that opened it,
   * is ignored. A deliberate tap elsewhere in the dialog, and the keyboard, work at once.
   */
  const GHOST_TAP_MS = 450;
  const GHOST_TAP_PX = 32;
  let lastPointer = null;
  if (root.document) {
    root.document.addEventListener('pointerdown', (e) => { lastPointer = { x: e.clientX, y: e.clientY }; }, true);
  }
  function pointOf(event) {
    const t = event.changedTouches && event.changedTouches[0];
    if (t) return { x: t.clientX, y: t.clientY };
    return typeof event.clientX === 'number' ? { x: event.clientX, y: event.clientY } : null;
  }
  function ignoreGhostTaps(dialog) {
    const until = Date.now() + GHOST_TAP_MS;
    const opener = lastPointer;
    const stop = (event) => {
      if (Date.now() >= until || !opener) return;
      // A click the keyboard made (Space on the checkbox) is deliberate, not a stray tap.
      if (event.type === 'click' && event.detail === 0) return;
      const p = pointOf(event);
      if (!p || Math.hypot(p.x - opener.x, p.y - opener.y) > GHOST_TAP_PX) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    for (const type of ['click', 'pointerup', 'touchend']) dialog.addEventListener(type, stop, true);
  }

  function build(message, options) {
    const dialog = document.createElement('dialog');
    dialog.className = 'foundry-dialog';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    const id = `foundryDialogMsg${Date.now().toString(36)}`;
    dialog.setAttribute('aria-describedby', id);

    const text = document.createElement('p');
    text.id = id;
    text.className = 'foundry-dialog-message';
    text.textContent = message;

    const actions = document.createElement('div');
    actions.className = 'foundry-dialog-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn ghost';
    cancel.textContent = options.cancelLabel || 'Cancel';
    cancel.value = 'cancel';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = options.danger ? 'btn primary danger' : 'btn primary';
    ok.textContent = options.confirmLabel || 'Continue';
    ok.value = 'ok';
    actions.append(cancel, ok);
    // The dialog itself has no padding, so a click whose target is the dialog is on the backdrop.
    const body = document.createElement('div');
    body.className = 'foundry-dialog-body';
    body.append(text, actions);
    dialog.append(body);
    return { dialog, ok, cancel };
  }

  function acknowledge(message, checkboxLabel, options = {}) {
    if (open) open.settle(false);
    const doc = root.document;
    if (!doc || !doc.body || typeof root.HTMLDialogElement !== 'function') {
      return Promise.resolve(typeof root.confirm === 'function' ? root.confirm(`${message}\n\n${checkboxLabel}`) : false);
    }
    const previous = doc.activeElement;
    const { dialog, ok, cancel } = build(String(message || ''), { confirmLabel: options.confirmLabel || 'Continue', cancelLabel: options.cancelLabel || 'Cancel' });
    const label = doc.createElement('label');
    label.className = 'foundry-dialog-check';
    const box = doc.createElement('input');
    box.type = 'checkbox';
    box.id = `foundryAck${Date.now().toString(36)}`;
    const span = doc.createElement('span');
    span.textContent = checkboxLabel;
    label.append(box, span);
    const actions = dialog.querySelector('.foundry-dialog-actions');
    actions.parentNode.insertBefore(label, actions);
    ok.disabled = true;
    box.addEventListener('change', () => {
      ok.disabled = !box.checked;
    });
    doc.body.appendChild(dialog);
    return new Promise((resolve) => {
      let done = false;
      const settle = (answer) => {
        if (done) return;
        done = true;
        open = null;
        try {
          if (dialog.open) dialog.close();
        } catch {
          /* already closed */
        }
        dialog.remove();
        if (previous && typeof previous.focus === 'function' && doc.contains(previous)) previous.focus();
        resolve(answer);
      };
      open = { settle };
      ok.addEventListener('click', () => settle(Boolean(box.checked)));
      cancel.addEventListener('click', () => settle(false));
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        settle(false);
      });
      ignoreGhostTaps(dialog);
      dialog.showModal();
      box.focus();
    });
  }

  function confirm(message, options = {}) {
    if (open) open.settle(false);
    const doc = root.document;
    if (!doc || !doc.body || typeof root.HTMLDialogElement !== 'function') {
      // No <dialog> support (very old browsers only). Proceeding silently would be worse than the
      // platform prompt, so fall back to it rather than guess the founder's answer.
      return Promise.resolve(typeof root.confirm === 'function' ? root.confirm(message) : true);
    }
    const previous = doc.activeElement;
    const { dialog, ok, cancel } = build(String(message || ''), options);
    doc.body.appendChild(dialog);

    return new Promise((resolve) => {
      let done = false;
      const settle = (answer) => {
        if (done) return;
        done = true;
        open = null;
        try {
          if (dialog.open) dialog.close();
        } catch {
          /* already closed */
        }
        dialog.remove();
        if (previous && typeof previous.focus === 'function' && doc.contains(previous)) previous.focus();
        resolve(answer);
      };
      open = { settle };
      ok.addEventListener('click', () => settle(true));
      cancel.addEventListener('click', () => settle(false));
      // Escape (and the Android back gesture inside a WebView) fires 'cancel' on a modal dialog.
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        settle(false);
      });
      // A tap on the backdrop is a cancel, as on every native sheet.
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) settle(false);
      });
      ignoreGhostTaps(dialog);
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute('open', '');
      }
      // The safe choice has focus, so a stray Enter never destroys anything.
      cancel.focus();
    });
  }

  root.FoundryDialog = { confirm, acknowledge };
})(window);
