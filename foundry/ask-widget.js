'use strict';

/**
 * "Ask about this plan" — a small chat widget answering questions from the founder's own
 * already-generated numbers, via a model running on this device (see @foundry/local-ai). This
 * file only wires the DOM; all of the actual model-calling and tool logic lives in the bundled
 * FoundryEngines.localAi, so this stays a thin UI layer like the rest of this page's scripts.
 */

const ASK_STORAGE_KEY = 'foundry.instant.context';
const ASK_SETTINGS_KEY = 'foundry.ask.settings';
const DEFAULT_ASK_SETTINGS = { baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:3b', apiKey: '' };

function loadAskPipeline() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(ASK_STORAGE_KEY) || 'null');
    if (saved?.ok) return saved;
  } catch {
    /* ignore */
  }
  return null;
}

function loadAskSettings() {
  try {
    return { ...DEFAULT_ASK_SETTINGS, ...JSON.parse(localStorage.getItem(ASK_SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_ASK_SETTINGS };
  }
}

function saveAskSettings(settings) {
  localStorage.setItem(ASK_SETTINGS_KEY, JSON.stringify(settings));
}

const askHistory = [];

/**
 * In the desktop app, model calls go through the main process instead of the page. That is not
 * a performance choice — a page asking localhost is subject to the browser's cross-origin rules,
 * and whether a local model server answers depends on how that server was configured. From the
 * main process there is no such negotiation, so the desktop build just works.
 *
 * Returns undefined in the browser, which leaves the library on its own default fetch.
 */
function desktopFetch() {
  const bridge = window.foundryDesktop;
  if (!bridge || typeof bridge.askLocalModel !== 'function') return undefined;
  return async (url, init) => {
    const result = await bridge.askLocalModel(url, {
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
    });
    return {
      ok: result.ok,
      status: result.status,
      json: async () => JSON.parse(result.body),
      text: async () => result.body,
    };
  };
}

function renderAskMessage(role, text, pending) {
  const log = document.getElementById('askLog');
  if (!log) return null;
  const bubble = document.createElement('div');
  bubble.className = `ask-msg ${role}${pending ? ' pending' : ''}`;
  bubble.textContent = text;
  log.appendChild(bubble);
  log.scrollTop = log.scrollHeight;
  return bubble;
}

function openAskPanel() {
  const panel = document.getElementById('askPanel');
  if (!panel) return;
  panel.hidden = false;
  const settings = loadAskSettings();
  const baseUrlInput = document.getElementById('askBaseUrl');
  const modelInput = document.getElementById('askModel');
  if (baseUrlInput && !baseUrlInput.value) baseUrlInput.value = settings.baseUrl;
  if (modelInput && !modelInput.value) modelInput.value = settings.model;
  // The panel sits after the document, which on a phone is several screens below the button that
  // opened it. Bring it into view first; focusing without scrolling left the keyboard open over a
  // panel the founder could not see. preventScroll keeps focus from fighting the scroll.
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  panel.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  document.getElementById('askInput')?.focus({ preventScroll: true });
}

/** Closing returns focus, and the founder, to the button that opened the panel. */
function closeAskPanel() {
  const panel = document.getElementById('askPanel');
  if (!panel) return;
  panel.hidden = true;
  document.getElementById('askBtn')?.focus();
}

document.getElementById('askBtn')?.addEventListener('click', () => {
  const panel = document.getElementById('askPanel');
  if (!panel) return;
  if (panel.hidden) openAskPanel();
  else panel.hidden = true;
});

document.getElementById('askCloseBtn')?.addEventListener('click', closeAskPanel);

document.getElementById('askSettingsBtn')?.addEventListener('click', () => {
  const form = document.getElementById('askSettingsForm');
  if (!form) return;
  form.hidden = false;
  document.getElementById('askBaseUrl')?.focus();
});

document.getElementById('askSaveSettingsBtn')?.addEventListener('click', () => {
  const baseUrl = document.getElementById('askBaseUrl').value.trim() || DEFAULT_ASK_SETTINGS.baseUrl;
  const model = document.getElementById('askModel').value.trim() || DEFAULT_ASK_SETTINGS.model;
  saveAskSettings({ ...loadAskSettings(), baseUrl, model });
  document.getElementById('askSettingsForm').hidden = true;
  renderAskMessage('assistant', `Settings saved. Using ${model} at ${baseUrl}.`);
});

document.getElementById('askForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.getElementById('askInput');
  const question = input.value.trim();
  if (!question) return;
  input.value = '';

  const pipeline = loadAskPipeline();
  if (!pipeline) {
    renderAskMessage('assistant', 'Build a plan on Instant Build first — there is nothing generated yet to ask about.');
    return;
  }
  if (!window.FoundryEngines?.localAi?.askAboutPlan) {
    renderAskMessage('assistant', 'The local assistant is not available in this build.');
    return;
  }

  renderAskMessage('user', question);
  askHistory.push({ role: 'user', content: question });
  const pending = renderAskMessage('assistant', 'Thinking…', true);

  const settings = loadAskSettings();
  try {
    const result = await window.FoundryEngines.localAi.askAboutPlan(
      settings,
      pipeline,
      askHistory,
      desktopFetch(),
    );
    pending?.remove();
    renderAskMessage('assistant', result.reply);
    askHistory.push({ role: 'assistant', content: result.reply });
    // Either never set up, or set up and pointing at nothing — both are fixed in the same place.
    if (!result.configured || result.show_settings) {
      document.getElementById('askSettingsForm').hidden = false;
    }
  } catch {
    pending?.remove();
    renderAskMessage('assistant', "Something went wrong asking that. Check Settings and try again.");
  }
});
