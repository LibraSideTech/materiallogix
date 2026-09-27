/**
 * "Answer the questions yourself" — a Word-form-like alternative to the Guided Interview, over the
 * exact same versioned question bank, engine, mapping and plan-store record. Nothing about the
 * questions, their order, their branching, or where an answer goes is decided here: this file is
 * DOM wiring only, the same division as interview/interview-ui.js.
 *
 * Every question the bank says applies is on screen at once (grouped into collapsible chapters),
 * answerable in any order, with its own Skip / "I don't know yet". Typing autosaves, debounced, to
 * the same interview record the Guided Interview reads and writes (FoundryPlanStore.shared
 * .loadInterview / .saveInterview), so switching between the two pages mid-plan keeps every answer.
 *
 * No voice, no on-device model and no microphone on this page: it is a form. The one optional
 * exception is "Read aloud" per question, which plays the same pre-rendered house-voice clip the
 * interview page plays — bundled audio, nothing generated, nothing sent anywhere.
 */
(function questionsPage() {
  'use strict';

  const Engine = window.FoundryInterviewEngine;
  const Mapping = window.FoundryInterviewMapping;
  const bank = window.FoundryInterviewBank;
  const $ = (id) => document.getElementById(id);
  if (!Engine || !Mapping || !bank) return;

  const PLAN_KEY = 'foundry.instant.context';
  const APPLIED_KEY = 'foundry.interview.applied';
  const store = window.FoundryPlanStore && window.FoundryPlanStore.shared;
  const SPECIALS = { zero: '$0', prefer_not: 'Prefer not to say', work_it_out: 'Work it out for me' };
  const SAVE_DEBOUNCE_MS = 600;

  let pipeline = null;
  let ctx = null;
  let state = null;
  /** One live control per question id, so autosave can read every field without re-querying the DOM. */
  const controls = new Map();
  let saveTimer = null;
  let savingCount = 0;

  // ------------------------------------------------------------------------------------------
  // Small DOM helpers (same shape as interview-ui.js, kept local: this page's layout differs too
  // much from the interview's one-question-at-a-time screen to share the builders directly).
  // ------------------------------------------------------------------------------------------

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
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
      const p = JSON.parse(sessionStorage.getItem(PLAN_KEY) || 'null');
      return p && p.ok ? p : null;
    } catch {
      return null;
    }
  }

  function reduceMotion() {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // ------------------------------------------------------------------------------------------
  // Optional "Read aloud" — reuses the interview's bundled voice clips. Never on by default here,
  // and there is no microphone and no local-model helper on this page at all.
  // ------------------------------------------------------------------------------------------

  const voice = window.FoundryInterviewVoice
    ? window.FoundryInterviewVoice.createVoicePlayer({
        manifest: window.FoundryInterviewVoiceManifest || null,
        bank,
        audio: $('qfAudio'),
        storage: (() => {
          try {
            return window.localStorage;
          } catch {
            return null;
          }
        })(),
        desktop: window.foundryDesktop || null,
      })
    : null;

  // ------------------------------------------------------------------------------------------
  // Answer controls, one per question type. Each returns { node, read(), setValue() }. Debounced
  // autosave is wired once, uniformly, in mountQuestion() below — a control only has to know how to
  // read and draw its own value.
  // ------------------------------------------------------------------------------------------

  function fieldWrap(input, labelText, extra) {
    const wrap = el('div', { class: 'field' }, [el('label', { for: input.id, text: labelText }), input]);
    if (extra) wrap.append(extra);
    return wrap;
  }

  function textControl(q, id, value) {
    const long = q.type === 'long' || q.type == null;
    const input = long
      ? el('textarea', { id, rows: '3', placeholder: q.example ? `For example: ${q.example}` : '' })
      : el('input', { id, type: 'text', autocomplete: 'off', placeholder: q.example ? `For example: ${q.example}` : '' });
    input.value = typeof value === 'string' ? value : '';
    return {
      node: fieldWrap(input, 'Your answer'),
      read: () => input.value.trim(),
      setValue: (v) => {
        input.value = typeof v === 'string' ? v : '';
      },
      events: [[input, 'input']],
      focus: () => input.focus({ preventScroll: true }),
    };
  }

  function numberControl(q, id, value) {
    const input = el('input', { id, type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: q.example ? `For example: ${q.example}` : '' });
    if (value != null && value !== '') input.value = String(value);
    const row = el('div', { class: 'qf-money' }, [
      el('span'),
      fieldWrap(input, 'Your answer'),
      q.unit ? el('span', { class: 'qf-suffix', text: q.unit }) : el('span'),
    ]);
    return {
      node: row,
      read: () => {
        const n = Number(input.value.replace(/[,\s]/g, ''));
        return input.value.trim() && Number.isFinite(n) ? n : null;
      },
      setValue: (v) => {
        input.value = v != null ? String(v) : '';
      },
      events: [[input, 'input']],
      focus: () => input.focus({ preventScroll: true }),
    };
  }

  function moneyControl(q, id, value) {
    const input = el('input', { id, type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: q.example ? `For example: ${Number(q.example).toLocaleString('en-US')}` : '' });
    if (value && value.amount != null) input.value = Number(value.amount).toLocaleString('en-US');
    const suffix = q.period === 'month' ? 'a month' : q.period === 'year' ? 'a year' : '';
    const row = el('div', { class: 'qf-money' }, [
      el('span', { class: 'qf-prefix', text: '$' }),
      fieldWrap(input, 'Amount'),
      el('span', { class: 'qf-suffix', text: suffix }),
    ]);
    const wrap = el('div', {}, [row]);
    let special = value && value.special ? value.special : null;
    let chips = null;
    if (Array.isArray(q.specials) && q.specials.length) {
      chips = el('div', { class: 'chips', role: 'group', 'aria-label': 'Or choose' });
      for (const s of q.specials) {
        const b = el('button', { type: 'button', class: 'chip', 'data-value': s, 'aria-pressed': special === s ? 'true' : 'false', text: SPECIALS[s] || s });
        chips.append(b);
      }
      wrap.append(chips);
    }
    const control = {
      node: wrap,
      read: () => {
        if (special) return { special };
        const n = Number(input.value.replace(/[$,\s]/g, ''));
        return input.value.trim() && Number.isFinite(n) && n >= 0 ? { amount: n } : null;
      },
      setValue: (v) => {
        special = v && v.special ? v.special : null;
        input.value = v && v.amount != null ? Number(v.amount).toLocaleString('en-US') : '';
        if (chips) chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', c.dataset.value === special ? 'true' : 'false'));
      },
      events: [[input, 'input']],
      focus: () => input.focus({ preventScroll: true }),
    };
    if (chips) {
      for (const b of chips.querySelectorAll('.chip')) {
        b.addEventListener('click', () => {
          const on = b.getAttribute('aria-pressed') !== 'true';
          chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
          special = on ? b.dataset.value : null;
          if (on) input.value = '';
          commit(q.id);
        });
      }
      input.addEventListener('input', () => {
        if (input.value.trim() && special) {
          special = null;
          chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
        }
      });
    }
    return control;
  }

  /** Choice (single) and multi-select, rendered as a touch-sized chip group — generic over
   * whatever options the bank lists, so a new question with new options (or a "Prefer not to say"
   * choice among them) needs no change here. */
  function chipGroup(q, value, multi) {
    const group = el('div', { class: 'chips', role: 'group', 'aria-label': q.text });
    const chosen = new Set(multi ? (Array.isArray(value) ? value : []) : value != null ? [value] : []);
    for (const o of q.options || []) {
      const b = el('button', { type: 'button', class: 'chip', 'data-value': o.value, 'aria-pressed': chosen.has(o.value) ? 'true' : 'false', text: o.label });
      group.append(b);
    }
    const readFn = () => {
      const on = [...group.querySelectorAll('.chip[aria-pressed="true"]')].map((c) => c.dataset.value);
      return multi ? on : on[0] ?? null;
    };
    for (const b of group.querySelectorAll('.chip')) {
      b.addEventListener('click', () => {
        if (multi) {
          const on = b.getAttribute('aria-pressed') !== 'true';
          // "None" and any option the bank marks exclusive (e.g. "Prefer not to say") clear every
          // other pick when chosen, and are themselves cleared by picking anything else — the same
          // rule the Guided Interview applies, generic over whichever option carries the flag.
          const exclusive = (v) => v === 'none' || Boolean((q.options || []).find((x) => x.value === v)?.exclusive);
          if (exclusive(b.dataset.value) && on) group.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
          if (!exclusive(b.dataset.value) && on) group.querySelectorAll('.chip').forEach((c) => { if (exclusive(c.dataset.value)) c.setAttribute('aria-pressed', 'false'); });
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        } else {
          group.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
          b.setAttribute('aria-pressed', 'true');
        }
        commit(q.id);
      });
    }
    return {
      node: group,
      read: readFn,
      setValue: (v) => {
        const set = new Set(multi ? (Array.isArray(v) ? v : []) : v != null ? [v] : []);
        group.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', set.has(c.dataset.value) ? 'true' : 'false'));
      },
      events: [],
      focus: () => group.querySelector('.chip')?.focus({ preventScroll: true }),
    };
  }

  function openingControl(q, id, value) {
    const current = value && typeof value === 'object' ? value : { choice: value || (pipeline && pipeline.intake && pipeline.intake.opening && pipeline.intake.opening.choice) || q.default };
    const chips = chipGroup(q, current.choice, false);
    const dateId = `${id}_date`;
    const date = el('input', { id: dateId, type: 'date', min: new Date().toISOString().slice(0, 10) });
    if (current.date && current.choice === 'date') date.value = current.date;
    const dateField = fieldWrap(date, 'Opening date');
    const sync = () => {
      dateField.hidden = chips.read() !== 'date';
    };
    chips.node.addEventListener('click', () => setTimeout(sync, 0));
    date.addEventListener('input', () => commit(q.id));
    sync();
    return {
      node: el('div', {}, [chips.node, dateField]),
      read: () => {
        const choice = chips.read();
        if (!choice) return null;
        return choice === 'date' ? { choice, date: date.value || null } : { choice };
      },
      setValue: (v) => {
        chips.setValue(v && v.choice);
        date.value = v && v.date ? v.date : '';
        sync();
      },
      events: [],
      focus: chips.focus,
    };
  }

  function tiersControl(q, id, value) {
    const box = el('div', { id: `${id}_box` });
    const initial = value || (pipeline && pipeline.intake && pipeline.intake.plan_detail && pipeline.intake.plan_detail.financials && pipeline.intake.plan_detail.financials.revenue_buildup) || null;
    const editor = window.FoundryRevenueBuildup ? window.FoundryRevenueBuildup.mount(box, { initial, idPrefix: `qf_${id}` }) : null;
    if (editor) box.addEventListener('input', () => commit(q.id));
    box.addEventListener('change', () => commit(q.id));
    return {
      node: box,
      read: () => (editor ? editor.value() : null),
      setValue: (v) => editor && editor.setValue(v),
      events: [],
      focus: () => box.querySelector('input')?.focus({ preventScroll: true }),
    };
  }

  /** Equipment / build-out lines: repeatable rows of label, cost and "quoted", add/remove. */
  function itemsControl(q, id, value) {
    const list = el('div', { class: 'qf-items' });
    let seq = 0;
    const add = (item = {}) => {
      const n = ++seq;
      const rowId = `${id}_${n}`;
      const label = el('input', { id: `${rowId}_label`, type: 'text', autocomplete: 'off', placeholder: 'e.g. Espresso machine' });
      label.value = item.label || '';
      const cost = el('input', { id: `${rowId}_cost`, type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '$' });
      if (item.amount_usd != null) cost.value = Number(item.amount_usd).toLocaleString('en-US');
      const quoted = el('input', { id: `${rowId}_quoted`, type: 'checkbox' });
      quoted.checked = Boolean(item.quoted);
      const remove = el('button', { type: 'button', class: 'qf-item-remove', 'aria-label': 'Remove this line', text: '×' });
      const row = el('div', { class: 'qf-item-row' }, [
        fieldWrap(label, 'Item'),
        fieldWrap(cost, 'Cost'),
        el('label', { class: 'qf-quoted', for: quoted.id }, [quoted, el('span', { text: 'Quoted' })]),
        remove,
      ]);
      row.addEventListener('input', () => commit(q.id));
      row.addEventListener('change', () => commit(q.id));
      remove.addEventListener('click', () => {
        row.remove();
        commit(q.id);
      });
      list.append(row);
      return row;
    };
    const items = value && Array.isArray(value.items) && value.items.length ? value.items : [{}];
    items.forEach((i) => add(i));
    const addBtn = el('button', { type: 'button', class: 'btn ghost', text: 'Add a line' });
    addBtn.addEventListener('click', () => add().querySelector('input')?.focus());
    return {
      node: el('div', {}, [list, addBtn]),
      read: () => {
        const out = [];
        for (const row of list.querySelectorAll('.qf-item-row')) {
          const inputs = row.querySelectorAll('input');
          const labelInput = inputs[0];
          const costInput = inputs[1];
          const quotedInput = inputs[2];
          const labelVal = labelInput.value.trim();
          if (!labelVal) continue;
          const amt = Number(costInput.value.replace(/[$,\s]/g, ''));
          out.push({ label: labelVal, amount_usd: Number.isFinite(amt) && costInput.value.trim() ? amt : null, quoted: quotedInput.checked });
        }
        return out.length ? { items: out } : null;
      },
      setValue: (v) => {
        list.replaceChildren();
        const rows = v && Array.isArray(v.items) && v.items.length ? v.items : [{}];
        rows.forEach((i) => add(i));
      },
      events: [],
      focus: () => list.querySelector('input')?.focus({ preventScroll: true }),
    };
  }

  /** Unknown/future question types fall back to a plain text field rather than breaking the page,
   * so a bank update that adds a type this file has not learned yet still renders something
   * answerable. */
  function controlFor(q, id, value) {
    switch (q.type) {
      case 'text':
        return textControl(q, id, value);
      case 'long':
        return textControl(q, id, value);
      case 'number':
        return numberControl(q, id, value);
      case 'money':
        return moneyControl(q, id, value);
      case 'choice':
        return chipGroup(q, value, false);
      case 'multi':
        return chipGroup(q, value, true);
      case 'opening':
        return openingControl(q, id, value);
      case 'tiers':
        return tiersControl(q, id, value);
      case 'items':
        return itemsControl(q, id, value);
      default:
        return textControl(q, id, value);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Autosave (debounced) — one path, used by every control's events and by the explicit
  // Skip / "I don't know yet" buttons, so the state and the store never disagree about what is
  // currently on screen.
  // ------------------------------------------------------------------------------------------

  function setSavedStatus(text, saving) {
    const line = $('qfSavedStatus');
    if (!line) return;
    line.textContent = text;
    line.dataset.saving = saving ? 'true' : 'false';
  }

  function persist() {
    state = { ...state, current: null };
    const p = store && store.saveInterview ? store.saveInterview(state) : Promise.resolve();
    savingCount++;
    setSavedStatus('Saving…', true);
    Promise.resolve(p).then(() => {
      savingCount--;
      if (savingCount <= 0) {
        savingCount = 0;
        const when = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        setSavedStatus(
          store && store.keepsOnDevice && !store.keepsOnDevice()
            ? `Saved in this tab only at ${when} · not kept on this device.`
            : `Saved on this device at ${when}.`,
          false,
        );
      }
    });
    if (!store) {
      try {
        sessionStorage.setItem('foundry.interview.state', JSON.stringify(state));
      } catch {
        /* best effort */
      }
    }
  }

  /** Reads the control for `qid` right now and writes it into state. Empty stays a no-op answer
   * (Engine.answer routes an empty value to skip(), which never erases an existing answer), exactly
   * the same rule the Guided Interview follows, so debounced typing can never wipe out a saved
   * answer mid-keystroke. */
  function commit(qid) {
    const c = controls.get(qid);
    if (!c) return;
    const value = c.read();
    state = Engine.answer(state, qid, value);
    paintQuestionStatus(qid);
    paintProgress();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, SAVE_DEBOUNCE_MS);
  }

  function commitNow(qid) {
    clearTimeout(saveTimer);
    const c = controls.get(qid);
    if (c) {
      const value = c.read();
      state = Engine.answer(state, qid, value);
    }
    persist();
  }

  // ------------------------------------------------------------------------------------------
  // Rendering: chapters as <details>, one qf-question block per visible question.
  // ------------------------------------------------------------------------------------------

  function answerStatusLine(q, qid) {
    const a = state.answers[qid];
    if (!a) return null;
    // Private questions (the optional Programs chapter) are voluntary: skipping one is a complete
    // answer, not an open item, and never becomes a To-Do — the engine's todos() already leaves
    // them off the list (q.private), so the status line says so instead of pointing at a list the
    // question was never added to.
    if (q.private) {
      if (a.status === 'skipped') return { cls: 'open', text: 'Skipped.' };
      if (a.status === 'unknown') return { cls: 'open', text: 'Not answered.' };
      return { cls: 'answered', text: 'Answered.' };
    }
    if (a.status === 'unknown') return { cls: 'open', text: 'You said you don’t know yet. On your To-Do list.' };
    if (a.status === 'skipped') return { cls: 'open', text: 'Skipped. On your To-Do list.' };
    return { cls: 'answered', text: 'Answered.' };
  }

  function mountQuestion(q) {
    const qid = q.id;
    const controlId = `qf_${qid}`;
    const a = state.answers[qid];
    const value = a && a.status === 'answered' ? a.value : undefined;
    const control = controlFor(q, controlId, value);
    controls.set(qid, control);
    for (const [node, evt] of control.events || []) {
      node.addEventListener(evt, () => commit(qid));
    }

    const head = el('div', { class: 'qf-question-head' }, [el('p', { class: 'qf-question-text', id: `${controlId}_label` }, [])]);
    head.querySelector('.qf-question-text').textContent = q.text;
    if (voice && voice.available) {
      const play = el('button', { type: 'button', class: 'qf-play', text: 'Play' });
      play.setAttribute('aria-label', `Play the question "${q.text}" aloud`);
      play.addEventListener('click', () => {
        if (!voice.enabled) voice.setEnabled(true);
        voice.unlock();
        voice.play([`q.${qid}`]);
      });
      head.append(play);
    }

    const help = q.help ? el('p', { class: 'qf-question-help', text: q.help }) : null;
    const answerBox = el('div', { class: 'qf-answer' }, [control.node]);
    const statusLine = el('p', { class: 'qf-status-line', 'aria-live': 'polite' });

    const skipBtn = el('button', { type: 'button', class: 'btn ghost', text: 'Skip' });
    skipBtn.addEventListener('click', () => {
      state = Engine.skip(state, qid);
      paintQuestionStatus(qid);
      paintProgress();
      persist();
    });
    // Private questions (the optional Programs chapter) already carry their own "Prefer not to
    // say" option and are voluntary end to end, so there is no separate "I don't know yet" here
    // and skipping one never lands on the To-Do list (Engine.todos() excludes q.private) — the same
    // rule the Guided Interview follows for this chapter.
    const idkBtn = q.private
      ? null
      : el('button', { type: 'button', class: 'btn ghost', text: 'I don’t know yet' });
    if (idkBtn) {
      idkBtn.addEventListener('click', () => {
        state = Engine.markUnknown(state, qid);
        paintQuestionStatus(qid);
        paintProgress();
        persist();
      });
    }
    const actions = el('div', { class: 'qf-row-actions' }, [skipBtn, idkBtn]);

    const wrap = el('div', { class: 'qf-question', id: `q_${qid}` }, [head, help, answerBox, actions, statusLine]);
    // Committing on blur too, so a value typed and then left (tab away, close the section) is never
    // lost to the debounce window.
    wrap.addEventListener('focusout', (e) => {
      if (!wrap.contains(e.relatedTarget)) commitNow(qid);
    });
    return { node: wrap, paintStatus: () => paintStatusFor(qid, statusLine, q) };
  }

  const questionPainters = new Map();
  function paintStatusFor(qid, node, q) {
    const line = answerStatusLine(q, qid);
    node.className = `qf-status-line${line ? ` ${line.cls}` : ''}`;
    node.textContent = line ? line.text : '';
  }
  function paintQuestionStatus(qid) {
    const fn = questionPainters.get(qid);
    if (fn) fn();
  }

  function chapterNotice(chapter) {
    // Forward-compatible: a chapter may carry sensitive-question framing under any of these names
    // (a later question-bank update can add one without this page needing a matching change). Only
    // the first one present is shown, right under the chapter's regular intro.
    const text = chapter.sensitive_note || chapter.notice || chapter.disclosure || (chapter.sensitive ? bank.prompts.privacy : null);
    return text ? el('p', { class: 'qf-chapter-notice', text }) : null;
  }

  function mountChapter(chapter, openByDefault) {
    const qs = Engine.visibleQuestions(bank, state, ctx).filter((q) => q.chapter === chapter.id);
    if (!qs.length) return null;
    const details = el('details', { class: 'qf-chapter', id: `chapter_${chapter.id}` });
    if (openByDefault) details.open = true;
    const badge = el('span', { class: 'qf-chapter-badge' });
    const summary = el('summary', {}, [el('span', { class: 'qf-chapter-title', text: chapter.title }), badge]);
    const body = el('div', { class: 'qf-chapter-body' });
    if (chapter.intro) body.append(el('p', { class: 'qf-chapter-intro', text: chapter.intro }));
    const notice = chapterNotice(chapter);
    if (notice) body.append(notice);
    for (const q of qs) {
      const mounted = mountQuestion(q);
      questionPainters.set(q.id, mounted.paintStatus);
      mounted.paintStatus();
      body.append(mounted.node);
    }
    details.append(summary, body);
    const paintBadge = () => {
      const done = qs.filter((q) => Engine.responded(state, q.id)).length;
      badge.textContent = `${done} of ${qs.length}`;
      badge.dataset.done = done === qs.length ? 'true' : 'false';
    };
    paintBadge();
    chapterBadgePainters.push(paintBadge);
    return details;
  }

  const chapterBadgePainters = [];

  function paintProgress() {
    const p = Engine.progress(bank, state, ctx);
    const bar = $('qfProgressBar');
    if (bar) bar.style.width = `${p.percent}%`;
    $('qfProgressTrack')?.setAttribute('aria-valuenow', String(p.percent));
    const count = $('qfProgressCount');
    if (count) count.textContent = `${p.done} of ${p.total} answered · ${Engine.formatRemaining(p.est_remaining_s)}`;
    for (const fn of chapterBadgePainters) fn();
    const tocLinks = document.querySelectorAll('#qfToc a[data-chapter]');
    for (const a of tocLinks) {
      const cid = a.dataset.chapter;
      const c = p.chapters.find((x) => x.id === cid);
      if (!c) continue;
      a.querySelector('.qf-count').textContent = `${c.done}/${c.total}`;
      a.dataset.done = c.done === c.total ? 'true' : 'false';
    }
  }

  function renderToc() {
    const ol = $('qfTocList');
    if (!ol) return;
    ol.replaceChildren();
    for (const c of bank.chapters) {
      const qs = Engine.visibleQuestions(bank, state, ctx).filter((q) => q.chapter === c.id);
      if (!qs.length) continue;
      const a = el('a', { href: `#chapter_${c.id}`, 'data-chapter': c.id }, [el('span', { text: c.title }), el('span', { class: 'qf-count' })]);
      a.addEventListener('click', () => {
        const details = $(`chapter_${c.id}`);
        if (details) details.open = true;
      });
      ol.append(el('li', {}, [a]));
    }
  }

  function renderChapters() {
    const list = $('qfChapters');
    if (!list) return;
    list.replaceChildren();
    chapterBadgePainters.length = 0;
    const firstIncomplete = Engine.resumeQuestionId(bank, state, ctx);
    const firstIncompleteChapter = firstIncomplete ? Engine.questionById(bank, firstIncomplete).chapter : null;
    for (const c of bank.chapters) {
      const details = mountChapter(c, c.id === firstIncompleteChapter || !firstIncompleteChapter);
      if (details) list.append(details);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Industry (branching) — same context object the interview reads and writes, kept in state so
  // either page sees the other's choice.
  // ------------------------------------------------------------------------------------------

  function renderIndustryPicker() {
    const sel = $('qfIndustry');
    if (!sel) return;
    sel.replaceChildren();
    for (const [id, label] of Object.entries(bank.industries)) sel.append(el('option', { value: id, text: label }));
    sel.value = ctx.industry;
    sel.addEventListener('change', () => {
      ctx = { ...ctx, industry: sel.value };
      state = { ...state, context: { ...state.context, industry: sel.value } };
      persist();
      renderToc();
      renderChapters();
      paintProgress();
    });
  }

  // ------------------------------------------------------------------------------------------
  // Rebuild the documents — the exact same call the Guided Interview's review screen makes, so
  // either page can finish the plan.
  // ------------------------------------------------------------------------------------------

  function completenessPercent(p) {
    const pq = window.FoundryEngines && window.FoundryEngines.planQuestions;
    if (!pq || !p) return null;
    return pq.assessPlanForIntake(p.intake || {}).percent;
  }

  async function rebuildDocuments() {
    const btn = $('qfRebuildBtn');
    const status = $('qfFooterStatus');
    const current = loadPipeline();
    const api = window.FoundryEngines && window.FoundryEngines.pipeline;
    if (!current || !api) {
      status.textContent = 'There is no plan on this device to rebuild. Open Instant Build first.';
      return;
    }
    commitNow(document.activeElement && document.activeElement.closest('.qf-question')?.id?.replace('q_', ''));
    btn.disabled = true;
    status.textContent = 'Rebuilding your documents from your answers…';
    await new Promise((r) => setTimeout(r, 30));
    let next;
    try {
      next = Mapping.applyInterviewToPipeline(current, state, {
        bank,
        engine: Engine,
        pipelineApi: {
          runInstantPipeline: api.runInstantPipeline,
          applyPlanAnswersToPipeline: api.applyPlanAnswersToPipeline,
          resolveOpening: api.resolveOpening || (window.FoundryEngines.intake && window.FoundryEngines.intake.resolveOpening),
        },
      });
    } catch (error) {
      next = { ok: false, errors: [String(error && error.message ? error.message : error)] };
    }
    btn.disabled = false;
    if (!next || !next.ok) {
      status.textContent = `Your documents could not be rebuilt, and nothing was changed. ${(next && next.errors && next.errors[0]) || ''}`.trim();
      return;
    }
    const before = completenessPercent(current);
    const after = completenessPercent(next);
    if (store) {
      store.savePipeline(next);
      await store.settled();
    } else {
      try {
        sessionStorage.setItem(PLAN_KEY, JSON.stringify(next));
      } catch {
        /* best effort */
      }
    }
    state = { ...state, applied_at: new Date().toISOString() };
    persist();
    try {
      sessionStorage.setItem(
        APPLIED_KEY,
        JSON.stringify({ at: state.applied_at, before, after, answered: next.interview && next.interview.answered, open: next.intake && Array.isArray(next.intake.interview_followups) ? next.intake.interview_followups.length : 0 }),
      );
    } catch {
      /* the documents still rebuilt */
    }
    status.textContent = bank.prompts.rebuilt;
    // Offline, the browser cannot load Documents and shows its own error page; the rebuilt plan is
    // saved (above), so say so and open Documents once the connection is back.
    if (navigator.onLine === false) {
      status.textContent = 'Your documents are rebuilt and saved on this device. You are offline, so Documents will open as soon as your connection is back.';
      window.addEventListener('online', () => { window.location.href = './documents.html#business_plan'; }, { once: true });
      return;
    }
    window.location.href = './documents.html#business_plan';
  }

  // ------------------------------------------------------------------------------------------
  // Delete answers, and the "no plan yet" state.
  // ------------------------------------------------------------------------------------------

  function show(id) {
    for (const s of ['qfNoPlan', 'qfMain']) {
      const node = $(s);
      if (node) node.hidden = s !== id;
    }
  }

  function wire() {
    $('qfRebuildBtn')?.addEventListener('click', rebuildDocuments);
    $('qfDeleteBtn')?.addEventListener('click', async () => {
      const ok = window.FoundryDialog
        ? await window.FoundryDialog.confirm('Delete your answers from this device? Your plan and documents stay as they are.', { confirmLabel: 'Delete answers', danger: true })
        : true;
      if (!ok) return;
      if (store && store.clearInterview) await store.clearInterview();
      state = Engine.newState(bank, ctx);
      controls.clear();
      questionPainters.clear();
      renderToc();
      renderChapters();
      paintProgress();
      setSavedStatus('No answers saved on this device yet.', false);
    });
    // Leaving the page mid-keystroke still saves what was typed (the same rule the interview uses).
    window.addEventListener('pagehide', () => {
      clearTimeout(saveTimer);
      persist();
    });
  }

  async function init() {
    if (window.FoundryPlanStore && window.FoundryPlanStore.ready) {
      try {
        await window.FoundryPlanStore.ready;
      } catch {
        /* the tab copy is still read below */
      }
    }
    pipeline = loadPipeline();
    if (!pipeline) {
      show('qfNoPlan');
      return;
    }
    let saved = null;
    if (store && store.loadInterview) {
      try {
        saved = await store.loadInterview();
      } catch {
        saved = null;
      }
    }
    const baseCtx = Engine.contextFrom(pipeline);
    state = Engine.migrateState(saved, bank) || Engine.newState(bank, baseCtx);
    ctx = { ...baseCtx, industry: (state.context && state.context.industry) || baseCtx.industry, stage: baseCtx.stage };
    state = { ...state, context: { ...state.context, industry: ctx.industry, stage: ctx.stage } };
    show('qfMain');
    renderIndustryPicker();
    renderToc();
    renderChapters();
    paintProgress();
    const p = Engine.progress(bank, state, ctx);
    setSavedStatus(
      p.done > 0
        ? store && store.keepsOnDevice && !store.keepsOnDevice()
          ? 'Kept in this tab only. Not saved on this device.'
          : 'Your answers are saved on this device.'
        : 'Nothing answered yet. Every field saves automatically as you type.',
      false,
    );
    wire();
    if (voice) voice.onChange(() => {});
    // A jump-link target that arrived in the URL (from the interview's "Answer the rest yourself"
    // or a bookmark) opens its chapter and brings it into view.
    if (window.location.hash) {
      const target = document.querySelector(window.location.hash);
      if (target && target.tagName === 'DETAILS') {
        target.open = true;
        target.scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' });
      }
    }
  }

  window.addEventListener('foundry:plan-cleared', () => show('qfNoPlan'));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
