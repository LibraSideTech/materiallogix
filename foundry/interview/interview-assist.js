/**
 * Optional conversational help for the Guided Interview, from a model running on this device.
 *
 * The interview never needs this. Question text, order and branches come from the question bank;
 * this only ever does three small things, and every output is checked before it is shown:
 *
 *   bridge(q, answer)   one short acknowledgment line before the next (fixed) question
 *                       ("A corner spot by the station sounds promising."). Text only.
 *   probe(q, answer)    the bank's clarifying follow-up, phrased around the founder's own words.
 *                       The decision to ask is deterministic (engine.isVague); the model only
 *                       phrases it. The bank's own wording is the fallback.
 *   extract(q, answer)  structured values from a free-text answer (years of experience, customers
 *                       within reach, competitor names). Shown to the founder to confirm or fix;
 *                       nothing extracted is used until they confirm it.
 *
 * Where the model runs: Ollama (or any OpenAI-compatible server) on loopback on desktop and in a
 * browser, reached through the desktop app's main process when it is present; Apple Foundation
 * Models or Android Gemini Nano through the FoundryLocalAI plugin in the store app. A non-loopback
 * address is refused outright, so nothing the founder types can leave the device this way. When no
 * model answers, every call resolves to null and the interview carries on exactly as it would have.
 *
 * UMD; in the page it is window.FoundryInterviewAssist.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FoundryInterviewAssist = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const TIMEOUT_MS = 8000;

  function isLoopbackUrl(value) {
    let url;
    try {
      url = new URL(String(value));
    } catch {
      return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
  }

  const SYSTEM = [
    'You help run a friendly business-planning interview inside Foundry.',
    'The founder is answering fixed questions about their own business.',
    'Write plain, warm, brief English. No markdown, no emoji, no exclamation marks.',
    'Never invent facts, numbers, names or dates. Never give advice. Never mention being a model or a program.',
  ].join(' ');

  function withTimeout(promise, ms) {
    let timer;
    return Promise.race([
      promise.finally(() => clearTimeout(timer)),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), ms);
      }),
    ]);
  }

  /**
   * A transport over an OpenAI-compatible chat endpoint on loopback.
   * @param {{ baseUrl: string, model: string }} settings
   * @param {(url: string, init: object) => Promise<{ ok: boolean, json: () => Promise<any> }>} fetchImpl
   */
  /**
   * The page's own fetch, for the loopback model server only: loopbackTransport refuses any base
   * URL that is not this machine, and redirects are refused so a local server cannot bounce the
   * request elsewhere. This module is an approved egress gate (test/egress-static.test.js).
   */
  function pageTransportFetch() {
    const g = typeof window !== 'undefined' ? window : globalThis;
    if (typeof g.fetch !== 'function') return null;
    const f = g.fetch.bind(g);
    return (url, init) => (isLoopbackUrl(url) ? f(url, { ...(init || {}), redirect: 'error' }) : Promise.reject(new Error('not_loopback')));
  }

  function loopbackTransport(settings, fetchImpl) {
    const baseUrl = String((settings && settings.baseUrl) || '').replace(/\/$/, '');
    const model = (settings && settings.model) || '';
    if (!baseUrl || !model || !isLoopbackUrl(baseUrl) || typeof fetchImpl !== 'function') return null;
    return async ({ system, prompt, json }) => {
      try {
        const res = await fetchImpl(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: prompt },
            ],
            ...(json ? { response_format: { type: 'json_object' } } : {}),
          }),
        });
        if (!res || !res.ok) return { ok: false, reason: 'server_error' };
        const data = await res.json();
        const text = data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content || '' : '';
        return { ok: true, text: String(text) };
      } catch {
        return { ok: false, reason: 'unreachable' };
      }
    };
  }

  /** A transport over the store app's on-device plugin (Apple Foundation Models / Gemini Nano). */
  function nativeTransport(plugin) {
    if (!plugin || typeof plugin.ask !== 'function') return null;
    return async ({ system, prompt }) => {
      try {
        if (typeof plugin.isAvailable === 'function') {
          const a = await plugin.isAvailable();
          if (!a || a.available !== true) return { ok: false, reason: 'unavailable' };
        }
        const r = await plugin.ask({ system, context: '', question: prompt });
        if (!r || r.available === false) return { ok: false, reason: 'unavailable' };
        return { ok: true, text: String(r.reply || '') };
      } catch {
        return { ok: false, reason: 'unavailable' };
      }
    };
  }

  // "9,400" and "9400" are the same number; a trailing full stop is punctuation.
  const digits = (s) => (String(s).match(/\d[\d,.]*/g) || []).map((d) => d.replace(/[,.]+$/, '').replace(/,/g, ''));

  // "Eight years" said in words is still the founder's 8.
  const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
  const wordNumbers = (s) => (String(s).toLowerCase().match(/[a-z]+/g) || []).map((w) => NUMBER_WORDS.indexOf(w)).filter((n) => n >= 0).map(String);

  /** A number in the model's line that the founder did not say is an invented fact. */
  function introducesNumbers(line, ...sources) {
    const allowed = new Set(sources.flatMap((s) => [...digits(s), ...wordNumbers(s)]));
    return digits(line).some((d) => !allowed.has(d));
  }

  function cleanLine(text) {
    return String(text || '')
      .replace(/[*_#`>]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^["'“”]+|["'“”]+$/g, '')
      .trim();
  }

  const BANNED = /\b(ai|a\.i\.|artificial intelligence|language model|chatbot|as an assistant)\b/i;
  // The interviewer has not been to the founder's street: a line claiming to have seen, known or
  // felt something is invented, and so is an opinion.
  const FIRST_PERSON_CLAIM = /\bI(?:'ve| have|'m| am)?\s+(?:also\s+)?(?:seen|observed|noticed|been|visited|know|knew|heard|experienced|agree|think|believe|love)\b|\btoo\.?$/i;

  function validBridge(line, answer) {
    if (!line || line.length > 160 || line.length < 4) return false;
    if (/[?!]/.test(line)) return false;
    if (BANNED.test(line)) return false;
    if (FIRST_PERSON_CLAIM.test(line)) return false;
    if (introducesNumbers(line, answer)) return false;
    // One sentence.
    return (line.match(/[.]\s+\S/g) || []).length === 0;
  }

  function validProbe(line, answer, canonical) {
    if (!line || line.length > 220 || !line.endsWith('?')) return false;
    if (BANNED.test(line)) return false;
    if (introducesNumbers(line, answer, canonical)) return false;
    return true;
  }

  function coerce(field, value) {
    if (value == null || value === '') return null;
    if (field.type === 'number' || field.type === 'money') {
      const n = Number(String(value).replace(/[$,\s]/g, ''));
      return Number.isFinite(n) && n >= 0 ? n : null;
    }
    if (field.type === 'list') {
      const arr = Array.isArray(value) ? value : String(value).split(/[;,\n]/);
      const items = arr.map((x) => String(x).trim()).filter(Boolean).slice(0, 12);
      return items.length ? items : null;
    }
    const t = String(value).trim();
    return t ? t.slice(0, 300) : null;
  }

  /**
   * Values the model found, checked against the question's declared fields. A number the founder
   * never wrote is dropped rather than shown for confirmation.
   */
  function validExtraction(q, raw, answer) {
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    for (const f of (q.extract && q.extract.fields) || []) {
      const v = coerce(f, raw[f.key]);
      if (v == null) continue;
      if ((f.type === 'number' || f.type === 'money') && introducesNumbers(String(v), answer)) continue;
      out[f.key] = v;
    }
    return Object.keys(out).length ? out : null;
  }

  function parseJsonObject(text) {
    const m = String(text || '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }

  /**
   * @param {{ transport: Function|null, enabled?: boolean, timeoutMs?: number }} opts
   */
  function createAssist(opts = {}) {
    let transport = opts.transport || null;
    let enabled = opts.enabled !== false && Boolean(transport);
    let failures = 0;
    const timeoutMs = opts.timeoutMs || TIMEOUT_MS;

    async function call(args) {
      if (!enabled || !transport) return null;
      const r = await withTimeout(Promise.resolve(transport({ system: SYSTEM, ...args })), timeoutMs);
      if (!r || !r.ok) {
        // Two misses in a row: stop trying for this visit, silently. The interview works the same.
        failures += 1;
        if (failures >= 2) enabled = false;
        return null;
      }
      failures = 0;
      return r.text;
    }

    return {
      get enabled() {
        return enabled;
      },
      setEnabled(v) {
        enabled = Boolean(v) && Boolean(transport);
      },
      setTransport(t) {
        transport = t || null;
        enabled = Boolean(transport);
        failures = 0;
      },
      async bridge(q, answer) {
        if (typeof answer !== 'string' || !answer.trim()) return null;
        const text = await call({
          prompt: `Question: ${q.text}\nFounder's answer: ${answer}\n\nWrite ONE short sentence (under 20 words) acknowledging the answer in a warm, natural way, using the founder's own words. Do not ask anything. Do not add facts or numbers. Do not claim to have seen, known or experienced anything yourself, and give no opinion.`,
        });
        const line = cleanLine(text);
        return validBridge(line, answer) ? line : null;
      },
      async probe(q, answer) {
        if (!q.probe) return null;
        const text = await call({
          prompt: `Question: ${q.text}\nFounder's answer: ${answer}\nFollow-up to ask: ${q.probe}\n\nRewrite the follow-up as ONE friendly question that refers to what the founder said. Keep its meaning. Under 35 words. Do not add facts or numbers.`,
        });
        const line = cleanLine(text);
        return validProbe(line, answer, q.probe) ? line : null;
      },
      async extract(q, answer) {
        if (!q.extract || typeof answer !== 'string' || !answer.trim()) return null;
        const fields = q.extract.fields.map((f) => `"${f.key}": ${f.type === 'list' ? 'array of strings' : f.type === 'text' ? 'string' : 'number'} (${f.label})`).join(', ');
        const text = await call({
          json: true,
          prompt: `Question: ${q.text}\nFounder's answer: ${answer}\n\nReturn a JSON object with only these keys: {${fields}}. Use null for anything the answer does not state. Copy numbers exactly as written; never estimate.`,
        });
        return validExtraction(q, parseJsonObject(text), answer);
      },
    };
  }

  return { createAssist, loopbackTransport, pageTransportFetch, nativeTransport, isLoopbackUrl, validBridge, validProbe, validExtraction, introducesNumbers };
});
