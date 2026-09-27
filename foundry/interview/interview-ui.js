/**
 * The Guided Interview page. DOM wiring only: the flow is FoundryInterviewEngine, the mapping into
 * the plan is FoundryInterviewMapping, the optional conversational help is FoundryInterviewAssist,
 * voice is FoundryInterviewVoice, spoken answers are FoundrySpeechInput, storage is
 * FoundryPlanStore.shared (loadInterview / saveInterview / clearInterview).
 *
 * Every answer is saved as it is given, so closing the tab, or coming back days later, resumes
 * where the founder stopped.
 */
(function interviewPage() {
  'use strict';

  const Engine = window.FoundryInterviewEngine;
  const Mapping = window.FoundryInterviewMapping;
  const bank = window.FoundryInterviewBank;
  const $ = (id) => document.getElementById(id);
  if (!Engine || !Mapping || !bank) return;

  const PLAN_KEY = 'foundry.instant.context';
  const APPLIED_KEY = 'foundry.interview.applied';
  const HELPER_KEY = 'foundry.interview.helper';
  const ASK_SETTINGS_KEY = 'foundry.ask.settings';
  const DEFAULT_ASK = { baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:3b' };

  const store = window.FoundryPlanStore && window.FoundryPlanStore.shared;
  const reduceMotion = () => Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  let pipeline = null;
  let ctx = null;
  let state = null;
  let currentId = null;
  /** Set when the founder went back or jumped: Continue then walks forward one question at a time. */
  let revisiting = false;
  let returnToReview = false;
  let introPlayedFor = new Set();
  let pendingBridge = null;
  let currentControl = null;
  let shownValue = 'null';
  let micAvailable = false;

  // ------------------------------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------------------------------

  function show(id) {
    for (const s of ['ivNoPlan', 'ivIntro', 'ivMain', 'ivPaused', 'ivReview', 'ivSettings']) {
      const el = $(s);
      if (el) el.hidden = s !== id;
    }
  }

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

  function setStatus(text) {
    const s = $('ivStatus');
    if (s) s.textContent = text || '';
  }

  function scrollTop(node) {
    if (node && node.scrollIntoView) node.scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' });
  }

  function save() {
    if (!state) return Promise.resolve();
    state = { ...state, current: currentId };
    if (store && store.saveInterview) return store.saveInterview(state);
    try {
      sessionStorage.setItem('foundry.interview.state', JSON.stringify(state));
    } catch {
      /* nothing more to do */
    }
    return Promise.resolve();
  }

  function readPref(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : v === 'on';
    } catch {
      return fallback;
    }
  }
  function writePref(key, on) {
    try {
      localStorage.setItem(key, on ? 'on' : 'off');
    } catch {
      /* a preference only */
    }
  }

  // ------------------------------------------------------------------------------------------
  // Voice and the optional helper
  // ------------------------------------------------------------------------------------------

  const voice = window.FoundryInterviewVoice
    ? window.FoundryInterviewVoice.createVoicePlayer({
        manifest: window.FoundryInterviewVoiceManifest || null,
        bank,
        audio: $('ivAudio'),
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

  function paintVoice(s) {
    const btn = $('ivReplay');
    const say = $('ivSay');
    if (btn) {
      btn.hidden = !(s && s.available);
      btn.setAttribute('aria-pressed', s && s.playing ? 'true' : 'false');
      btn.textContent = s && s.playing ? 'Stop' : s && !s.unlocked && s.enabled ? 'Play' : 'Replay';
      btn.setAttribute('aria-label', s && s.playing ? 'Stop reading the question' : 'Play the question aloud');
    }
    if (say) say.classList.toggle('iv-speaking', Boolean(s && s.playing));
    for (const id of ['ivVoiceIntro', 'ivVoiceToggle']) {
      const box = $(id);
      if (box) {
        box.checked = Boolean(s && s.enabled);
        box.disabled = !(s && s.available);
      }
    }
  }
  if (voice) {
    voice.onChange(paintVoice);
    paintVoice({ enabled: voice.enabled, unlocked: false, playing: false, available: voice.available });
  }

  function desktopFetch() {
    const bridge = window.foundryDesktop;
    if (!bridge || typeof bridge.askLocalModel !== 'function') return null;
    return async (url, init) => {
      const r = await bridge.askLocalModel(url, { method: init && init.method, headers: init && init.headers, body: init && init.body });
      return { ok: r.ok, status: r.status, json: async () => JSON.parse(r.body) };
    };
  }

  function makeTransport() {
    const A = window.FoundryInterviewAssist;
    if (!A) return null;
    const plugin = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins ? window.Capacitor.Plugins.FoundryLocalAI : null;
    if (plugin) return A.nativeTransport(plugin);
    let settings = DEFAULT_ASK;
    try {
      settings = { ...DEFAULT_ASK, ...JSON.parse(localStorage.getItem(ASK_SETTINGS_KEY) || '{}') };
    } catch {
      /* defaults */
    }
    return A.loopbackTransport(settings, desktopFetch() || A.pageTransportFetch());
  }

  const assist = window.FoundryInterviewAssist
    ? window.FoundryInterviewAssist.createAssist({ transport: makeTransport(), enabled: readPref(HELPER_KEY, false) })
    : null;

  // ------------------------------------------------------------------------------------------
  // Answer controls, one per question type
  // ------------------------------------------------------------------------------------------

  const SPECIALS = { zero: '$0', prefer_not: 'Prefer not to say', work_it_out: 'Work it out for me' };

  function chipGroup(q, value, multi) {
    const group = el('div', { class: 'chips', role: 'group', 'aria-labelledby': 'ivQuestion' });
    const chosen = new Set(multi ? (Array.isArray(value) ? value : []) : value != null ? [value] : []);
    for (const o of q.options || []) {
      const b = el('button', { type: 'button', class: 'chip', 'data-value': o.value, 'aria-pressed': chosen.has(o.value) ? 'true' : 'false', text: o.label });
      b.addEventListener('click', () => {
        if (multi) {
          const on = b.getAttribute('aria-pressed') !== 'true';
          // "None" (and any option marked exclusive, like "Prefer not to say") and the other
          // picks exclude each other.
          const exclusive = (v) => v === 'none' || Boolean((q.options || []).find((x) => x.value === v)?.exclusive);
          if (exclusive(o.value) && on) group.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
          if (!exclusive(o.value) && on) group.querySelectorAll('.chip').forEach((c) => { if (exclusive(c.dataset.value)) c.setAttribute('aria-pressed', 'false'); });
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        } else {
          group.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
          b.setAttribute('aria-pressed', 'true');
        }
        group.dispatchEvent(new Event('change', { bubbles: true }));
      });
      group.append(b);
    }
    return {
      node: group,
      read: () => {
        const on = [...group.querySelectorAll('.chip[aria-pressed="true"]')].map((c) => c.dataset.value);
        return multi ? on : on[0] ?? null;
      },
      focus: () => group.querySelector('.chip')?.focus(),
    };
  }

  function micButton(target) {
    if (!micAvailable || !window.FoundrySpeechInput) return null;
    const b = el('button', { type: 'button', class: 'btn ghost', 'aria-label': 'Answer by speaking (recognized on this device)', text: 'Speak' });
    b.addEventListener('click', async () => {
      b.disabled = true;
      b.textContent = 'Listening…';
      const text = await window.FoundrySpeechInput.listen({ onPartial: (t) => setStatus(t) });
      b.disabled = false;
      b.textContent = 'Speak';
      setStatus('');
      if (text) {
        target.value = target.value ? `${target.value.trim()} ${text}` : text;
        target.dispatchEvent(new Event('input'));
        target.focus();
      }
    });
    return b;
  }

  function textControl(q, value, long) {
    const id = 'ivInput';
    const input = long ? el('textarea', { id, rows: '3', placeholder: q.example ? `For example: ${q.example}` : '' }) : el('input', { id, type: 'text', autocomplete: 'off', placeholder: q.example ? `For example: ${q.example}` : '' });
    input.value = typeof value === 'string' ? value : '';
    if (long && !(window.CSS && CSS.supports && CSS.supports('field-sizing', 'content'))) {
      const fit = () => {
        input.style.height = 'auto';
        input.style.height = `${input.scrollHeight + 2}px`;
      };
      input.addEventListener('input', fit);
      setTimeout(fit, 0);
    }
    if (!long) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onContinue();
        }
      });
    }
    const field = el('div', { class: 'field' }, [el('label', { for: id, text: 'Your answer' }), input]);
    const mic = long ? micButton(input) : null;
    if (mic) field.append(mic);
    return { node: field, read: () => input.value.trim(), focus: () => input.focus({ preventScroll: true }) };
  }

  function numberControl(q, value) {
    const input = el('input', { id: 'ivInput', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: q.example ? `For example: ${q.example}` : '' });
    if (value != null && value !== '') input.value = String(value);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onContinue();
      }
    });
    const row = el('div', { class: 'iv-money' }, [el('span'), el('div', { class: 'field' }, [el('label', { for: 'ivInput', text: 'Your answer' }), input]), q.unit ? el('span', { class: 'iv-suffix', text: q.unit }) : el('span')]);
    return {
      node: row,
      read: () => {
        const n = Number(input.value.replace(/[,\s]/g, ''));
        return input.value.trim() && Number.isFinite(n) ? n : null;
      },
      focus: () => input.focus({ preventScroll: true }),
    };
  }

  function moneyControl(q, value) {
    const input = el('input', { id: 'ivInput', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: q.example ? `For example: ${Number(q.example).toLocaleString('en-US')}` : '' });
    if (value && value.amount != null) input.value = Number(value.amount).toLocaleString('en-US');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onContinue();
      }
    });
    const suffix = q.period === 'month' ? 'a month' : q.period === 'year' ? 'a year' : '';
    const row = el('div', { class: 'iv-money' }, [el('span', { class: 'iv-prefix', text: '$' }), el('div', { class: 'field' }, [el('label', { for: 'ivInput', text: 'Amount' }), input]), el('span', { class: 'iv-suffix', text: suffix })]);
    const wrap = el('div', {}, [row]);
    let special = value && value.special ? value.special : null;
    let chips = null;
    if (Array.isArray(q.specials) && q.specials.length) {
      chips = el('div', { class: 'chips', role: 'group', 'aria-label': 'Or choose' });
      for (const s of q.specials) {
        const b = el('button', { type: 'button', class: 'chip', 'data-value': s, 'aria-pressed': special === s ? 'true' : 'false', text: SPECIALS[s] || s });
        b.addEventListener('click', () => {
          const on = b.getAttribute('aria-pressed') !== 'true';
          chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
          special = on ? s : null;
          if (on) input.value = '';
        });
        chips.append(b);
      }
      input.addEventListener('input', () => {
        if (input.value.trim()) {
          special = null;
          chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
        }
      });
      wrap.append(chips);
    }
    return {
      node: wrap,
      read: () => {
        if (special) return { special };
        const n = Number(input.value.replace(/[$,\s]/g, ''));
        return input.value.trim() && Number.isFinite(n) && n >= 0 ? { amount: n } : null;
      },
      focus: () => input.focus({ preventScroll: true }),
    };
  }

  function openingControl(q, value) {
    const current = value && typeof value === 'object' ? value : { choice: value || pipeline?.intake?.opening?.choice || q.default };
    const chips = chipGroup(q, current.choice, false);
    const date = el('input', { id: 'ivOpeningDate', type: 'date', min: new Date().toISOString().slice(0, 10) });
    if (current.date && current.choice === 'date') date.value = current.date;
    const dateField = el('div', { class: 'field' }, [el('label', { for: 'ivOpeningDate', text: 'Opening date' }), date]);
    const sync = () => {
      dateField.hidden = chips.read() !== 'date';
    };
    chips.node.addEventListener('change', () => {
      sync();
      if (chips.read() === 'date') date.focus();
    });
    sync();
    return {
      node: el('div', {}, [chips.node, dateField]),
      read: () => {
        const choice = chips.read();
        if (!choice) return null;
        return choice === 'date' ? { choice, date: date.value || null } : { choice };
      },
      focus: chips.focus,
    };
  }

  function tiersControl(q, value) {
    const box = el('div', { id: 'ivTiers' });
    const initial = value || pipeline?.intake?.plan_detail?.financials?.revenue_buildup || null;
    const editor = window.FoundryRevenueBuildup ? window.FoundryRevenueBuildup.mount(box, { initial, idPrefix: 'rbInterview' }) : null;
    return {
      node: box,
      read: () => (editor ? editor.value() : null),
      focus: () => box.querySelector('input')?.focus({ preventScroll: true }),
    };
  }

  function itemsControl(q, value) {
    const list = el('div', { class: 'iv-items' });
    let seq = 0;
    const add = (item = {}) => {
      const n = ++seq;
      const label = el('input', { id: `ivItemLabel${n}`, type: 'text', autocomplete: 'off', placeholder: 'e.g. Espresso machine', 'data-item': 'label' });
      label.value = item.label || '';
      const cost = el('input', { id: `ivItemCost${n}`, type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '$', 'data-item': 'cost' });
      if (item.amount_usd != null) cost.value = Number(item.amount_usd).toLocaleString('en-US');
      const quoted = el('input', { id: `ivItemQuoted${n}`, type: 'checkbox', 'data-item': 'quoted' });
      quoted.checked = Boolean(item.quoted);
      const remove = el('button', { type: 'button', class: 'iv-remove', 'aria-label': 'Remove this line', text: '×' });
      const row = el('div', { class: 'iv-item' }, [
        el('div', { class: 'field' }, [el('label', { for: label.id, text: 'Item' }), label]),
        el('div', { class: 'field' }, [el('label', { for: cost.id, text: 'Cost' }), cost]),
        el('label', { class: 'iv-quoted', for: quoted.id }, [quoted, el('span', { text: 'Quoted' })]),
        remove,
      ]);
      remove.addEventListener('click', () => {
        row.remove();
        list.querySelector('input')?.focus();
      });
      list.append(row);
      return label;
    };
    const items = value && Array.isArray(value.items) && value.items.length ? value.items : [{}];
    items.forEach((i) => add(i));
    const addBtn = el('button', { type: 'button', class: 'btn ghost', text: 'Add a line' });
    addBtn.addEventListener('click', () => add().focus());
    return {
      node: el('div', {}, [list, addBtn]),
      read: () => {
        const out = [];
        for (const row of list.querySelectorAll('.iv-item')) {
          const label = row.querySelector('[data-item="label"]').value.trim();
          const amt = Number(row.querySelector('[data-item="cost"]').value.replace(/[$,\s]/g, ''));
          if (!label) continue;
          out.push({ label, amount_usd: Number.isFinite(amt) && row.querySelector('[data-item="cost"]').value.trim() ? amt : null, quoted: row.querySelector('[data-item="quoted"]').checked });
        }
        return out.length ? { items: out } : null;
      },
      focus: () => list.querySelector('input')?.focus({ preventScroll: true }),
    };
  }

  function controlFor(q, value) {
    switch (q.type) {
      case 'long':
        return textControl(q, value, true);
      case 'number':
        return numberControl(q, value);
      case 'money':
        return moneyControl(q, value);
      case 'choice':
        return chipGroup(q, value, false);
      case 'multi':
        return chipGroup(q, value, true);
      case 'opening':
        return openingControl(q, value);
      case 'tiers':
        return tiersControl(q, value);
      case 'items':
        return itemsControl(q, value);
      default:
        return textControl(q, value, false);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------------------------------

  function paintProgress() {
    const p = Engine.progress(bank, state, ctx);
    const bar = $('ivProgressBar');
    if (bar) bar.style.width = `${p.percent}%`;
    $('ivProgressTrack')?.setAttribute('aria-valuenow', String(p.percent));
    const count = $('ivProgressCount');
    if (count) count.textContent = `${p.done} of ${p.total} questions`;
    const left = $('ivTimeLeft');
    if (left) left.textContent = Engine.formatRemaining(p.est_remaining_s);
    const list = $('ivChapters');
    if (list) {
      list.replaceChildren();
      const currentChapter = currentId ? Engine.questionById(bank, currentId)?.chapter : null;
      for (const c of p.chapters) {
        const btn = el('button', { type: 'button', class: `iv-chapter-btn${c.done === c.total ? ' done' : ''}`, 'aria-current': c.id === currentChapter ? 'step' : null }, [
          el('span', { text: c.title }),
          el('span', { class: 'iv-count', text: `${c.done}/${c.total}` }),
        ]);
        btn.setAttribute('aria-label', `${c.title}: ${c.done} of ${c.total} answered`);
        btn.addEventListener('click', () => {
          const first = Engine.visibleQuestions(bank, state, ctx).find((q) => q.chapter === c.id && !Engine.responded(state, q.id)) || Engine.visibleQuestions(bank, state, ctx).find((q) => q.chapter === c.id);
          if (first) {
            revisiting = true;
            renderQuestion(first.id, { focusQuestion: true });
          }
          if (window.matchMedia && window.matchMedia('(max-width: 900px)').matches) $('ivRailDetails').open = false;
        });
        list.append(el('li', {}, [btn]));
      }
    }
  }

  function renderQuestion(qid, opts = {}) {
    const q = Engine.questionById(bank, qid);
    if (!q) return showReview();
    currentId = qid;
    // Moving to any other question settles where a paused, typed answer would resume.
    if (state.resume_at && state.resume_at !== qid) state = { ...state, resume_at: null };
    show('ivMain');
    const chapter = bank.chapters.find((c) => c.id === q.chapter);
    const chapterStart = Engine.isChapterStart(bank, state, ctx, qid);
    const showIntro = chapterStart && !introPlayedFor.has(q.chapter);
    $('ivChapterEyebrow').textContent = `Chapter ${bank.chapters.indexOf(chapter) + 1} of ${bank.chapters.length}`;
    $('ivChapterTitle').textContent = chapter ? chapter.title : '';
    const intro = $('ivChapterIntro');
    intro.hidden = !chapterStart;
    intro.textContent = chapter ? chapter.intro : '';

    const bridge = $('ivBridge');
    bridge.hidden = !pendingBridge;
    bridge.textContent = pendingBridge || '';
    pendingBridge = null;

    $('ivQuestion').textContent = q.text;
    $('ivQuestion').dataset.questionId = q.id;
    $('ivQuestion').dataset.type = q.type;
    $('ivHelp').textContent = q.help || '';
    $('ivFollowup').hidden = true;
    $('ivFollowupInput').value = '';
    $('ivExtract').hidden = true;
    $('ivNextBtn').textContent = 'Continue';
    // Private (optional Programs chapter) questions offer "Prefer not to say" and Skip instead of
    // "I don't know yet", and never become To-Dos.
    $('ivUnknownBtn').hidden = Boolean(q.private);
    $('ivBackBtn').disabled = !Engine.previousQuestionId(bank, state, ctx, qid);
    setStatus('');

    const answerBox = $('ivAnswer');
    answerBox.replaceChildren();
    const a = state.answers[qid];
    currentControl = controlFor(q, a && a.status === 'answered' ? a.value : undefined);
    // What the control showed when drawn (a preselected choice, a saved answer), so leaving the
    // page only saves what the founder actually changed.
    shownValue = JSON.stringify(currentControl.read() ?? null);
    answerBox.append(currentControl.node);
    if (a && a.status !== 'answered') {
      answerBox.append(el('p', { class: 'hint', text: a.status === 'unknown' ? 'You said you don’t know yet. It’s on your To-Do list; answer any time.' : 'You skipped this one. Answer any time.' }));
    }

    paintProgress();
    save();

    // Screen readers hear the question; sighted keyboard users land in the answer.
    if (opts.focusQuestion) $('ivQuestion').focus({ preventScroll: true });
    else currentControl.focus();
    if (opts.scroll !== false) scrollTop($('ivChapterEyebrow'));

    if (voice) {
      const keys = [];
      if (showIntro) keys.push(`chapter.${q.chapter}`);
      keys.push(`q.${q.id}`);
      voice.play(keys);
    }
    if (showIntro) introPlayedFor.add(q.chapter);
  }

  function goNext(fromId) {
    let next = null;
    if (state.resume_at) state = { ...state, resume_at: null };
    if (returnToReview) {
      returnToReview = false;
      revisiting = false;
      return showReview();
    }
    if (revisiting) {
      const visible = Engine.visibleQuestions(bank, state, ctx);
      const i = visible.findIndex((q) => q.id === fromId);
      next = i >= 0 && visible[i + 1] ? visible[i + 1].id : null;
      if (next && !Engine.responded(state, next)) revisiting = false;
    } else {
      next = Engine.nextQuestionId(bank, state, ctx, fromId);
    }
    if (!next) {
      state = { ...state, completed_at: state.completed_at || new Date().toISOString() };
      save();
      return showReview({ finished: true });
    }
    renderQuestion(next);
  }

  // ------------------------------------------------------------------------------------------
  // Continue: answer, optional follow-up, optional extraction, then the next question
  // ------------------------------------------------------------------------------------------

  let stage = 'answer'; // 'answer' | 'followup' | 'extract'
  let extractValues = null;

  /**
   * One step at a time: a second tap on Continue (or I don't know yet, or Skip) while the first is
   * still saving, or waiting on the optional helper, must not answer the next question too.
   */
  let busy = false;
  // A double tap lands its second tap on the next question's buttons a moment after the first one
  // finished, and skipped two questions; taps in that moment are ignored.
  let settledAt = 0;
  const SETTLE_MS = 250;
  function once(fn) {
    return async (...args) => {
      if (busy || Date.now() - settledAt < SETTLE_MS) return;
      busy = true;
      $('ivControls')?.setAttribute('aria-busy', 'true');
      try {
        await fn(...args);
      } finally {
        busy = false;
        settledAt = Date.now();
        $('ivControls')?.removeAttribute('aria-busy');
      }
    };
  }

  const onContinue = once(continueStep);

  async function continueStep() {
    const q = Engine.questionById(bank, currentId);
    if (!q) return;
    if (voice) voice.stop();

    if (stage === 'followup') {
      const reply = $('ivFollowupInput').value.trim();
      state = Engine.recordFollowup(state, q.id, { question: $('ivFollowupText').textContent, answer: reply, phrased_by: $('ivFollowupText').dataset.by || 'bank' });
      await save();
      stage = 'answer';
      return afterAnswer(q);
    }
    if (stage === 'extract') {
      const confirmed = {};
      for (const f of q.extract.fields) {
        const input = $(`ivExtract_${f.key}`);
        if (!input) continue;
        const raw = input.value.trim();
        if (!raw) continue;
        if (f.type === 'number' || f.type === 'money') {
          const n = Number(raw.replace(/[$,\s]/g, ''));
          if (Number.isFinite(n)) confirmed[f.key] = n;
        } else if (f.type === 'list') confirmed[f.key] = raw.split(/[;\n]|,(?!\d)/).map((s) => s.trim()).filter(Boolean);
        else confirmed[f.key] = raw;
      }
      const prev = state.answers[q.id];
      state = Engine.answer(state, q.id, prev.value, undefined, { extracted: confirmed, extracted_confirmed: Object.keys(confirmed).length > 0 });
      await save();
      stage = 'answer';
      $('ivExtract').hidden = true;
      return finishAnswer(q);
    }

    const value = currentControl ? currentControl.read() : null;
    if (Engine.isEmptyValue(value)) {
      state = Engine.skip(state, q.id);
      await save();
      setStatus('Skipped. It’s on your To-Do list.');
      return goNext(q.id);
    }
    state = Engine.answer(state, q.id, value);
    await save();

    // One clarifying follow-up when the answer is vague. The decision is the bank's; the
    // interviewer may only phrase it around the founder's words.
    if (Engine.needsFollowup(q, state)) {
      stage = 'followup';
      const box = $('ivFollowup');
      const text = $('ivFollowupText');
      box.hidden = false;
      text.dataset.by = 'bank';
      text.textContent = q.probe;
      $('ivNextBtn').textContent = 'Continue';
      let spokenByBank = true;
      if (assist && assist.enabled) {
        setStatus('One moment…');
        const phrased = await assist.probe(q, value);
        setStatus('');
        if (phrased) {
          text.textContent = phrased;
          text.dataset.by = 'interviewer';
          spokenByBank = false;
        }
      }
      if (voice) {
        if (spokenByBank) voice.play([`probe.${q.id}`]);
        else voice.speakDynamic(text.textContent);
      }
      $('ivFollowupInput').focus({ preventScroll: true });
      return;
    }
    return afterAnswer(q);
  }

  async function afterAnswer(q) {
    const a = state.answers[q.id];
    // Values picked out of a free-text answer, for the founder to confirm. Nothing is used unconfirmed.
    if (q.extract && assist && assist.enabled && a && a.status === 'answered' && typeof a.value === 'string') {
      setStatus('One moment…');
      extractValues = await assist.extract(q, [a.value, a.followup && a.followup.answer].filter(Boolean).join(' '));
      setStatus('');
      if (extractValues) {
        stage = 'extract';
        $('ivFollowup').hidden = true;
        $('ivExtractTitle').textContent = bank.prompts.confirm_extracted;
        const box = $('ivExtractFields');
        box.replaceChildren();
        for (const f of q.extract.fields) {
          const v = extractValues[f.key];
          const input = el('input', { id: `ivExtract_${f.key}`, type: 'text', inputmode: f.type === 'number' || f.type === 'money' ? 'decimal' : null, autocomplete: 'off' });
          input.value = v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v);
          box.append(el('div', { class: 'field' }, [el('label', { for: input.id, text: f.label }), input]));
        }
        $('ivExtract').hidden = false;
        $('ivNextBtn').textContent = 'Confirm';
        if (voice) voice.play(['prompt.confirm_extracted']);
        box.querySelector('input')?.focus({ preventScroll: true });
        return;
      }
    }
    return finishAnswer(q);
  }

  async function finishAnswer(q) {
    const a = state.answers[q.id];
    if (assist && assist.enabled && a && typeof a.value === 'string' && q.type === 'long') {
      pendingBridge = await assist.bridge(q, a.value);
    }
    goNext(q.id);
  }

  // ------------------------------------------------------------------------------------------
  // Review, To-Do, and rebuilding the documents
  // ------------------------------------------------------------------------------------------

  function answerText(q, a) {
    if (!a) return null;
    if (a.status === 'unknown') return { open: true, text: 'I don’t know yet. On your To-Do list.' };
    if (a.status === 'skipped') return { open: true, text: 'Skipped.' };
    if (q.type === 'opening') {
      const v = a.value || {};
      const label = (q.options.find((o) => o.value === v.choice) || {}).label || '';
      return { open: false, text: v.choice === 'date' && v.date ? `${label}: ${v.date}` : label };
    }
    if (q.type === 'tiers') {
      const n = (a.value && a.value.tiers && a.value.tiers.length) || 0;
      return { open: false, text: `${n} product${n === 1 ? '' : 's'} with price, cost and volume` };
    }
    let text = Mapping.asText(q, a.value);
    if (a.followup && a.followup.answer) text += ` ${a.followup.answer}`;
    return { open: false, text };
  }

  function showReview(opts = {}) {
    if (voice) voice.stop();
    show('ivReview');
    const p = Engine.progress(bank, state, ctx);
    $('ivReviewLine').textContent = opts.finished
      ? bank.prompts.finish
      : `${p.answered} answered, ${p.done - p.answered} marked for later, ${p.total - p.done} still to go (${Engine.formatRemaining(p.est_remaining_s).toLowerCase()}). You can rebuild your documents now and come back for the rest.`;
    if (opts.finished && voice) voice.play(['prompt.finish']);

    const todos = Engine.todos(bank, state, ctx);
    const todoList = $('ivTodoList');
    todoList.replaceChildren();
    for (const t of todos) todoList.append(el('li', {}, [el('strong', { text: t.title }), el('span', { class: 'doc-muted', text: ` · ${t.chapter}` })]));
    $('ivTodoBox').hidden = !todos.length;

    const listBox = $('ivReviewList');
    listBox.replaceChildren();
    for (const c of bank.chapters) {
      const qs = Engine.visibleQuestions(bank, state, ctx).filter((q) => q.chapter === c.id);
      if (!qs.length) continue;
      const ul = el('ul', { class: 'iv-review-list' });
      for (const q of qs) {
        const a = answerText(q, state.answers[q.id]);
        const edit = el('button', { type: 'button', class: 'btn ghost iv-edit', text: a ? 'Edit' : 'Answer', 'aria-label': `${a ? 'Edit' : 'Answer'}: ${q.text}` });
        edit.addEventListener('click', () => {
          revisiting = true;
          returnToReview = true;
          renderQuestion(q.id, { focusQuestion: true });
        });
        ul.append(el('li', { class: 'iv-review-item' }, [
          el('div', {}, [el('p', { class: 'iv-review-q', text: q.text }), el('p', { class: `iv-review-a${!a || a.open ? ' open' : ''}`, text: a ? a.text : 'Not answered yet.' })]),
          edit,
        ]));
      }
      listBox.append(el('section', { class: 'iv-review-chapter' }, [el('h3', { text: c.title }), ul]));
    }
    $('ivReviewTitle').focus({ preventScroll: true });
    scrollTop($('ivReview'));
  }

  function completenessPercent(p) {
    const pq = window.FoundryEngines && window.FoundryEngines.planQuestions;
    if (!pq || !p) return null;
    // The same reading as the Plan readiness card on Documents, so the two figures always agree.
    return pq.assessPlanForIntake(p.intake || {}).percent;
  }

  async function applyToPlan() {
    const btn = $('ivApplyBtn');
    const status = $('ivApplyStatus');
    const current = loadPipeline();
    const api = window.FoundryEngines && window.FoundryEngines.pipeline;
    if (!current || !api) {
      status.textContent = 'There is no plan on this device to rebuild. Open Instant Build first.';
      return;
    }
    btn.disabled = true;
    status.textContent = 'Rebuilding your documents from your answers…';
    await new Promise((r) => setTimeout(r, 30));
    let next;
    // Programs you may qualify for, matched on this device (Founder's Notes and To-Do List only).
    let programs;
    try {
      if (window.FoundryProgramsCompute) programs = await window.FoundryProgramsCompute.compute(current, state);
    } catch {
      programs = undefined; // the documents still rebuild; the previous match is kept
    }
    try {
      await window.FoundryEngines.prepareLocation?.(current);
    } catch {
      /* a plan without a ZIP needs nothing */
    }
    try {
      next = Mapping.applyInterviewToPipeline(current, state, {
        bank,
        engine: Engine,
        programs: programs === null ? undefined : programs,
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
    } else sessionStorage.setItem(PLAN_KEY, JSON.stringify(next));
    state = { ...state, applied_at: new Date().toISOString() };
    await save();
    try {
      sessionStorage.setItem(APPLIED_KEY, JSON.stringify({ at: state.applied_at, before, after, answered: next.interview && next.interview.answered, open: (next.intake && Array.isArray(next.intake.interview_followups) ? next.intake.interview_followups.length : 0) }));
    } catch {
      /* the documents still rebuilt */
    }
    status.textContent = bank.prompts.rebuilt;
    // Offline, the browser cannot load Documents and shows its own error page, which reads as "my
    // plan is gone". The rebuilt plan is saved (above); say so and open Documents once back online.
    if (navigator.onLine === false) {
      status.textContent = 'Your documents are rebuilt and saved on this device. You are offline, so Documents will open as soon as your connection is back.';
      window.addEventListener('online', () => { window.location.href = './documents.html#business_plan'; }, { once: true });
      return;
    }
    window.location.href = './documents.html#business_plan';
  }

  // ------------------------------------------------------------------------------------------
  // Settings
  // ------------------------------------------------------------------------------------------

  let settingsReturn = null;
  function openSettings(from) {
    settingsReturn = from;
    if (voice) voice.stop();
    const helper = $('ivHelperToggle');
    helper.checked = Boolean(assist && assist.enabled);
    helper.disabled = !assist;
    const sel = $('ivIndustry');
    sel.replaceChildren();
    for (const [id, label] of Object.entries(bank.industries)) sel.append(el('option', { value: id, text: label }));
    sel.value = ctx.industry;
    $('ivHelperNote').textContent = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() ? 'Uses the on-device model built into your phone, where it is available.' : 'Uses the local model address from Ask about this plan. Nothing is sent anywhere else.';
    $('ivMicNote').textContent = micAvailable
      ? 'You can also answer by speaking. Speech is recognized on this device.'
      : 'Spoken answers appear only where speech can be recognized on this device; here, type your answers.';
    show('ivSettings');
    $('ivSettingsTitle').focus({ preventScroll: true });
    scrollTop($('ivSettings'));
  }

  function closeSettings() {
    if (settingsReturn === 'main' && currentId) renderQuestion(currentId, { focusQuestion: true });
    else if (settingsReturn === 'review') showReview();
    else showIntro();
  }

  // ------------------------------------------------------------------------------------------
  // Start, resume, pause
  // ------------------------------------------------------------------------------------------

  function showIntro() {
    show('ivIntro');
    const p = Engine.progress(bank, state, ctx);
    const resuming = p.done > 0;
    $('ivIntroEyebrow').textContent = resuming ? 'Welcome back' : 'Before we start';
    $('ivWelcome').textContent = resuming ? bank.prompts.resume : bank.prompts.welcome;
    $('ivHowItWorks').textContent = bank.prompts.how_it_works;
    const industry = bank.industries[ctx.industry] || bank.industries.generic;
    $('ivIntroMeta').textContent = resuming
      ? `${p.done} of ${p.total} questions done · ${Engine.formatRemaining(p.est_remaining_s).toLowerCase()} · tailored to ${industry.toLowerCase()}`
      : `${p.total} questions in ${p.chapters.length} chapters · about ${Math.round(p.est_total_s / 60)} minutes · tailored to ${industry.toLowerCase()}`;
    $('ivStartBtn').textContent = resuming ? 'Resume the interview' : 'Start the interview';
    $('ivReviewFromIntro').hidden = !resuming;
  }

  function start() {
    // The tap that starts the interview is what lets the voice play (browsers and iOS require one).
    if (voice) voice.unlock();
    const p = Engine.progress(bank, state, ctx);
    const pending = state.resume_at && Engine.visibleQuestions(bank, state, ctx).some((q) => q.id === state.resume_at) ? state.resume_at : null;
    const first = pending || Engine.resumeQuestionId(bank, state, ctx);
    if (!first) return showReview({ finished: p.done === p.total });
    if (p.done === 0 && voice && voice.enabled) {
      // The welcome and the privacy promise, read once, before the first question.
      renderQuestion(first, { focusQuestion: true });
      voice.play(['prompt.welcome', 'prompt.privacy', `chapter.${Engine.questionById(bank, first).chapter}`, `q.${first}`]);
      introPlayedFor.add(Engine.questionById(bank, first).chapter);
      return;
    }
    renderQuestion(first, { focusQuestion: true });
  }

  /**
   * What the founder typed into the open question but has not continued from yet. Pause used to
   * save only what had been continued, so an answer typed, then paused and the tab closed (or the
   * page reloaded), was gone on resume. Same rule as leaving the page: only a value the founder
   * changed is recorded, never an untouched preselected choice.
   */
  function keepTypedAnswer() {
    if (!state || !currentId || stage !== 'answer' || $('ivMain').hidden) return;
    const value = currentControl ? currentControl.read() : null;
    if (JSON.stringify(value ?? null) === shownValue || Engine.isEmptyValue(value)) return;
    // Kept as the answer, and the interview resumes on this question (resume_at), with the text
    // in place, rather than skipping past it as if the founder had continued.
    state = { ...Engine.answer(state, currentId, value), resume_at: currentId };
    shownValue = JSON.stringify(value);
  }

  function pause() {
    if (voice) voice.stop();
    keepTypedAnswer();
    save();
    show('ivPaused');
    $('ivPausedText').textContent = bank.prompts.paused;
    $('ivResumeBtn').focus();
  }

  function wire() {
    $('ivStartBtn').addEventListener('click', start);
    $('ivResumeBtn').addEventListener('click', () => {
      if (voice) voice.unlock();
      if (currentId) renderQuestion(currentId, { focusQuestion: true });
      else start();
    });
    $('ivNextBtn').addEventListener('click', () => {
      if (voice) voice.unlock();
      onContinue();
    });
    $('ivUnknownBtn').addEventListener('click', once(async () => {
      if (voice) voice.unlock();
      stage = 'answer';
      state = Engine.markUnknown(state, currentId);
      await save();
      setStatus('Noted. It’s on your To-Do list.');
      goNext(currentId);
    }));
    $('ivSkipBtn').addEventListener('click', once(async () => {
      if (voice) voice.unlock();
      if (stage !== 'answer') {
        // Skipping a follow-up or the confirmation keeps the main answer and moves on.
        const q = Engine.questionById(bank, currentId);
        const was = stage;
        stage = 'answer';
        $('ivExtract').hidden = true;
        $('ivFollowup').hidden = true;
        if (was === 'followup') return afterAnswer(q);
        return finishAnswer(q);
      }
      state = Engine.skip(state, currentId);
      await save();
      setStatus('Skipped. It’s on your To-Do list.');
      goNext(currentId);
    }));
    $('ivBackBtn').addEventListener('click', () => {
      stage = 'answer';
      const prev = Engine.previousQuestionId(bank, state, ctx, currentId);
      if (prev) {
        revisiting = true;
        renderQuestion(prev, { focusQuestion: true });
      }
    });
    $('ivReplay').addEventListener('click', () => {
      if (!voice) return;
      if (voice.unlocked && document.querySelector('.iv-speaking')) return voice.stop();
      voice.unlock();
      const keys = [];
      if (stage === 'followup' && $('ivFollowupText').dataset.by === 'bank') keys.push(`probe.${currentId}`);
      else keys.push(`q.${currentId}`);
      if (!voice.enabled) voice.setEnabled(true);
      voice.play(keys);
    });
    $('ivPauseBtn').addEventListener('click', pause);
    // Stepping out to the review or the settings keeps what is typed in the open question.
    $('ivReviewBtn').addEventListener('click', () => {
      keepTypedAnswer();
      save();
      showReview();
    });
    $('ivReviewFromIntro').addEventListener('click', () => showReview());
    $('ivBackToInterview').addEventListener('click', () => {
      if (voice) voice.unlock();
      const next = Engine.resumeQuestionId(bank, state, ctx) || currentId || bank.questions[0].id;
      revisiting = false;
      renderQuestion(next, { focusQuestion: true });
    });
    $('ivApplyBtn').addEventListener('click', applyToPlan);
    $('ivSettingsBtn').addEventListener('click', () => {
      keepTypedAnswer();
      save();
      openSettings('main');
    });
    $('ivSettingsFromIntro').addEventListener('click', () => openSettings('intro'));
    $('ivSettingsDone').addEventListener('click', closeSettings);
    // The box's new value is read before unlock() can repaint it (voiceToggleHandler).
    for (const id of ['ivVoiceIntro', 'ivVoiceToggle']) {
      if (window.FoundryInterviewVoice) $(id).addEventListener('change', window.FoundryInterviewVoice.voiceToggleHandler(() => voice));
    }
    $('ivHelperToggle').addEventListener('change', (e) => {
      if (!assist) return;
      assist.setTransport(makeTransport());
      assist.setEnabled(e.target.checked);
      writePref(HELPER_KEY, e.target.checked);
    });
    $('ivIndustry').addEventListener('change', async (e) => {
      ctx = { ...ctx, industry: e.target.value };
      state = { ...state, context: { ...state.context, industry: e.target.value } };
      await save();
    });
    $('ivDeleteBtn').addEventListener('click', async () => {
      const ok = window.FoundryDialog
        ? await window.FoundryDialog.confirm('Delete your interview answers from this device? Your plan and documents stay as they are.', { confirmLabel: 'Delete answers', danger: true })
        : true;
      if (!ok) return;
      if (store && store.clearInterview) await store.clearInterview();
      state = Engine.newState(bank, ctx);
      currentId = null;
      introPlayedFor = new Set();
      showIntro();
    });
    // Keyboard: Ctrl/Cmd+Enter continues from a long answer.
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !$('ivMain').hidden) {
        e.preventDefault();
        onContinue();
      }
    });
    // Leaving mid-answer keeps what was typed — and only that: a preselected choice the founder
    // never touched is not recorded as their answer.
    window.addEventListener('pagehide', () => {
      if (!state || !currentId || $('ivMain').hidden || stage !== 'answer') return;
      const value = currentControl ? currentControl.read() : null;
      if (JSON.stringify(value ?? null) === shownValue) return;
      if (!Engine.isEmptyValue(value)) {
        state = { ...Engine.answer(state, currentId, value), resume_at: currentId };
        save();
      }
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
      show('ivNoPlan');
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
    currentId = state.current || null;
    if (window.FoundrySpeechInput) {
      try {
        micAvailable = (await window.FoundrySpeechInput.availability()).available;
      } catch {
        micAvailable = false;
      }
    }
    wire();
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'review') showReview();
    else showIntro();
  }

  // A plan deleted from another control on this page (or expired) ends the interview view.
  window.addEventListener('foundry:plan-cleared', () => show('ivNoPlan'));

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
