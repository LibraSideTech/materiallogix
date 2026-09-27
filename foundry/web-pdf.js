/**
 * Business-plan PDF delivery for every runtime that is not the desktop app.
 *
 * The desktop app already renders a real two-pass PDF (desktop/render-pdf.cjs through
 * renderDocumentPdfWith in @foundry/document-pack). This file gives the same result to everyone
 * else, by whichever route this runtime can honestly offer, cheapest first:
 *
 *   1. desktop       — untouched. The Electron bridge keeps its existing path.
 *   2. native        — the store app (Capacitor). A native plugin supplies the one HTML→PDF step
 *                      using the device's own WebView printer; this file does the two passes.
 *                      Free to run: nothing leaves the device.
 *   3. browser_print — the default on the web. The finished document opens in the browser's print
 *                      view (Save as PDF / Share → Save to Files). Free, private, and honest about
 *                      what it cannot do: a browser cannot measure where a page break fell, so the
 *                      contents page lists sections without page numbers.
 *
 * There is no hosted route. A Cloudflare PDF Worker once existed as an optional fourth route; the
 * owner retired it (it sent the whole document off the device), and it is gone from this build.
 * Nothing in this file makes a network request.
 *
 * Route 2 shares one contract with the desktop and Node paths: `(html) => PDF bytes`. The
 * two-pass table-of-contents logic here mirrors renderDocumentPdfWith, except that it finds each
 * section's page from the PDF's own named destinations (every TOC entry is an internal link, so
 * Chromium records which page each section landed on) instead of parsing the text, which would
 * need a full PDF text engine in the page. Both read Chromium's own layout; neither guesses.
 *
 * UMD so the Node tests can require it; in the page it is window.FoundryWebPdf.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FoundryWebPdf = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const ROUTES = Object.freeze({
    DESKTOP: 'desktop',
    NATIVE: 'native',
    BROWSER_PRINT: 'browser_print',
  });

  // ---------------------------------------------------------------------------------------------
  // Reading page numbers out of a Chromium PDF
  // ---------------------------------------------------------------------------------------------

  function bytesToLatin1(bytes) {
    let out = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return out;
  }

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    throw new TypeError('expected PDF bytes (Uint8Array or ArrayBuffer)');
  }

  function decodePdfName(name) {
    return name.replace(/#([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }

  function decodePdfString(s) {
    return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, e) => {
      const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
      return map[e] != null ? map[e] : String.fromCharCode(parseInt(e, 8));
    });
  }

  /**
   * Object number → body text (up to `endobj`, or up to `stream` for stream objects).
   * Uses the classic xref table Skia writes; falls back to a scan for anything else.
   */
  function indexObjects(text) {
    const objects = new Map();
    const bodyAt = (offset) => {
      const end = text.indexOf('endobj', offset);
      let body = text.slice(offset, end < 0 ? undefined : end);
      const streamAt = body.search(/\bstream\r?\n/);
      if (streamAt >= 0) body = body.slice(0, streamAt);
      return body;
    };

    const startxref = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text.slice(-1024));
    if (startxref) {
      let at = Number(startxref[1]);
      if (text.startsWith('xref', at)) {
        const re = /(\d+)\s+(\d+)\s*\r?\n/y;
        let pos = at + 4;
        while (/\s/.test(text[pos])) pos += 1;
        for (;;) {
          re.lastIndex = pos;
          const head = re.exec(text);
          if (!head) break;
          const first = Number(head[1]);
          const count = Number(head[2]);
          pos = re.lastIndex;
          for (let i = 0; i < count; i++) {
            const entry = text.slice(pos, pos + 20);
            const m = /^(\d{10}) (\d{5}) ([nf])/.exec(entry);
            if (!m) break;
            if (m[3] === 'n') objects.set(first + i, bodyAt(Number(m[1])));
            pos += 20;
          }
          while (/\s/.test(text[pos])) pos += 1;
          if (text.startsWith('trailer', pos)) break;
        }
      }
    }
    if (!objects.size) {
      const re = /(?:^|[\r\n])(\d+)\s+0\s+obj\b/g;
      let m;
      while ((m = re.exec(text))) objects.set(Number(m[1]), bodyAt(m.index));
    }
    return objects;
  }

  const REF = /(\d+)\s+\d+\s+R/;

  /**
   * Named destination → 1-based page number, for a PDF Chromium produced from a Foundry document.
   * Returns {} rather than throwing on anything it cannot read — the caller then ships the PDF
   * without TOC page numbers, which is the honest outcome, not a broken export.
   * @param {Uint8Array|ArrayBuffer} pdf
   * @returns {Record<string, number>}
   */
  function pageMapFromPdf(pdf) {
    try {
      const text = bytesToLatin1(toBytes(pdf));
      const objects = indexObjects(text);
      const trailer = text.lastIndexOf('trailer');
      const rootRef = REF.exec(text.slice(trailer).match(/\/Root\s+\d+\s+\d+\s+R/)?.[0] || '');
      let catalog = rootRef ? objects.get(Number(rootRef[1])) : null;
      if (!catalog) {
        for (const body of objects.values()) {
          if (/\/Type\s*\/Catalog\b/.test(body)) { catalog = body; break; }
        }
      }
      if (!catalog) return {};

      // Page order: walk the page tree depth-first.
      const pageOrder = new Map();
      const walk = (num, depth) => {
        if (depth > 32) return;
        const body = objects.get(num);
        if (!body) return;
        if (/\/Type\s*\/Pages\b/.test(body)) {
          const kids = /\/Kids\s*\[([^\]]*)\]/.exec(body);
          if (!kids) return;
          for (const k of kids[1].matchAll(/(\d+)\s+\d+\s+R/g)) walk(Number(k[1]), depth + 1);
        } else if (/\/Type\s*\/Page\b/.test(body)) {
          pageOrder.set(num, pageOrder.size + 1);
        }
      };
      const pagesRef = /\/Pages\s+(\d+)\s+\d+\s+R/.exec(catalog);
      if (pagesRef) walk(Number(pagesRef[1]), 0);
      if (!pageOrder.size) return {};

      const result = {};
      const record = (name, destBody) => {
        const ref = /^\s*\[\s*(\d+)\s+\d+\s+R/.exec(destBody);
        if (ref && pageOrder.has(Number(ref[1]))) result[name] = pageOrder.get(Number(ref[1]));
      };

      // PDF 1.1 style: /Dests dictionary on the catalog (what Skia writes).
      const destsRef = /\/Dests\s+(\d+)\s+\d+\s+R/.exec(catalog);
      const destsInline = /\/Dests\s*<<([\s\S]*?)>>/.exec(catalog);
      const destsBody = destsRef ? objects.get(Number(destsRef[1])) : destsInline ? destsInline[1] : '';
      if (destsBody) {
        for (const m of destsBody.matchAll(/\/([^\s/\[\]<>()]+)\s*(\[[^\]]*\])/g)) {
          record(decodePdfName(m[1]), m[2]);
        }
      }

      // PDF 1.2 style: /Names << /Dests name-tree >> (other producers).
      const namesRef = /\/Names\s+(\d+)\s+\d+\s+R/.exec(catalog);
      const namesInline = /\/Names\s*<<([\s\S]*?)>>/.exec(catalog);
      const namesBody = namesRef ? objects.get(Number(namesRef[1])) : namesInline ? namesInline[1] : '';
      const treeRef = namesBody ? /\/Dests\s+(\d+)\s+\d+\s+R/.exec(namesBody) : null;
      const visit = (num, depth) => {
        if (depth > 32) return;
        const body = objects.get(num);
        if (!body) return;
        const names = /\/Names\s*\[([\s\S]*)\]/.exec(body);
        if (names) {
          for (const m of names[1].matchAll(/\(((?:\\.|[^\\)])*)\)\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/g)) {
            let dest = m[2];
            const indirect = /^(\d+)\s+\d+\s+R$/.exec(dest);
            if (indirect) dest = (objects.get(Number(indirect[1])) || '').replace(/^[\s\S]*?(\[)/, '$1');
            record(decodePdfString(m[1]), dest);
          }
        }
        const kids = /\/Kids\s*\[([^\]]*)\]/.exec(body);
        if (kids) for (const k of kids[1].matchAll(/(\d+)\s+\d+\s+R/g)) visit(Number(k[1]), depth + 1);
      };
      if (treeRef) visit(Number(treeRef[1]), 0);

      return result;
    } catch {
      return {};
    }
  }

  // ---------------------------------------------------------------------------------------------
  // The two passes
  // ---------------------------------------------------------------------------------------------

  function contentSectionsOf(doc) {
    const isCover = (s) => s.id === 'cover' || /_cover$/.test(s.id);
    return ((doc && doc.sections) || []).filter((s) => !isCover(s));
  }

  /**
   * Same job as renderDocumentPdfWith: render, find where each section landed, render again with
   * those numbers in the contents page. A document with no contents page (an edited document is
   * one section) needs no second pass, and a PDF whose destinations cannot be read ships as-is.
   *
   * @param {{ htmlToPdf: (html: string) => Promise<Uint8Array|ArrayBuffer>,
   *           renderHtml: (doc: object, opts: object) => string,
   *           doc: object, opts?: object }} args
   * @returns {Promise<{ bytes: Uint8Array, tocPageNumbers: boolean, sectionPageNumbers: Record<string, number> }>}
   */
  async function renderTwoPass({ htmlToPdf, renderHtml, doc, opts = {} }) {
    const pass1 = toBytes(await htmlToPdf(renderHtml(doc, opts)));
    const map = pageMapFromPdf(pass1);
    const sectionPageNumbers = {};
    for (const s of contentSectionsOf(doc)) {
      if (map[s.id] != null) sectionPageNumbers[s.id] = map[s.id];
    }
    if (!Object.keys(sectionPageNumbers).length) {
      return { bytes: pass1, tocPageNumbers: false, sectionPageNumbers };
    }
    const pass2 = toBytes(await htmlToPdf(renderHtml(doc, { ...opts, sectionPageNumbers })));
    return { bytes: pass2, tocPageNumbers: true, sectionPageNumbers };
  }

  // ---------------------------------------------------------------------------------------------
  // HTML → PDF adapters
  // ---------------------------------------------------------------------------------------------

  class PdfRouteError extends Error {
    constructor(code, message) {
      super(message || code);
      this.name = 'PdfRouteError';
      this.code = code;
    }
  }

  function base64ToBytes(b64) {
    const clean = String(b64 || '').replace(/^data:[^,]*,/, '');
    const bin = typeof atob === 'function' ? atob(clean) : Buffer.from(clean, 'base64').toString('latin1');
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToBase64(bytes) {
    const bin = bytesToLatin1(toBytes(bytes));
    return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'latin1').toString('base64');
  }

  function assertPdf(bytes, code) {
    if (!bytes || bytes.length < 5 || bytesToLatin1(bytes.subarray(0, 5)) !== '%PDF-') {
      throw new PdfRouteError(code, 'the renderer did not return a PDF');
    }
    return bytes;
  }

  /**
   * The Capacitor plugin contract a future store-app build must implement, as `FoundryPdf`:
   *
   *   htmlToPdf({ html, pageSize: 'letter', preferCSSPageSize: true, printBackground: true })
   *     → Promise<{ data: string }>   // base64 PDF, paginated by the device's WebView printer
   *       iOS:     WKWebView + UIPrintPageRenderer (viewPrintFormatter), paper = CSS @page size,
   *                or WKWebView.pdf(configuration:) per page. Must paginate, not one long page.
   *       Android: WebView.createPrintDocumentAdapter → PdfDocument via PrintDocumentAdapter
   *                (Chromium's printer, so named destinations and TOC page numbers work).
   *   sharePdf({ data, filename, mimeType: 'application/pdf' }) → Promise<{ shared: boolean }>
   *       Optional. Opens the native share sheet (UIActivityViewController / ACTION_SEND).
   *       A WKWebView cannot follow a download link, so without this the app falls back to the
   *       Web Share API.
   *
   * The html passed in is the finished, self-contained document (fonts are data URIs; there are
   * no external requests), so the plugin must not add headers, footers or margins of its own.
   */
  function nativePdfPlugin(win) {
    const plugin = win && win.Capacitor && win.Capacitor.Plugins && win.Capacitor.Plugins.FoundryPdf;
    return plugin && typeof plugin.htmlToPdf === 'function' ? plugin : null;
  }

  function createNativeHtmlToPdf(plugin) {
    return async (html) => {
      let result;
      try {
        result = await plugin.htmlToPdf({ html, pageSize: 'letter', preferCSSPageSize: true, printBackground: true });
      } catch (error) {
        throw new PdfRouteError('native_failed', error && error.message);
      }
      return assertPdf(base64ToBytes(result && result.data), 'native_failed');
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Choosing a route
  // ---------------------------------------------------------------------------------------------

  function platformOf(win) {
    const nav = (win && win.navigator) || {};
    const ua = String(nav.userAgent || '');
    // iPadOS reports itself as a Mac; touch points give it away.
    if (/iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    return 'other';
  }

  const PRINT_NOTES = {
    ios: 'This opens the print view. Tap Share (or Print), then Save to Files to keep a PDF. The contents page lists every section, but without page numbers — the desktop app adds them.',
    android: 'This opens the print view. Choose Save as PDF as the printer, then Download. The contents page lists every section, but without page numbers — the desktop app adds them.',
    other: 'Your browser\'s print dialog opens — choose Save as PDF. The contents page lists every section, but without page numbers — the desktop app adds them.',
  };

  /**
   * The best PDF route this runtime has, in the shape @foundry/runtime-capabilities uses for
   * pdf_export ({ available, full, via, label, note }). Desktop is passed through untouched.
   * @param {{ pdf_export?: object }} caps  from detectCapabilities
   * @param {Window|object} win
   */
  function selectPdfRoute(caps, win) {
    const current = caps && caps.pdf_export;
    if (current && current.via === ROUTES.DESKTOP) return current;
    if (nativePdfPlugin(win)) {
      return {
        available: true,
        full: true,
        via: ROUTES.NATIVE,
        label: 'Save as PDF',
        note: 'Built on this device, with page numbers in the table of contents. Nothing leaves your phone.',
      };
    }
    return {
      available: true,
      full: false,
      via: ROUTES.BROWSER_PRINT,
      label: 'Print / Save as PDF',
      note: PRINT_NOTES[platformOf(win)],
    };
  }

  /** detectCapabilities' answer with pdf_export replaced by the selected route. */
  function withPdfRoute(caps, win) {
    if (!caps) return caps;
    return { ...caps, pdf_export: selectPdfRoute(caps, win) };
  }

  /** The HTML→PDF function for a route, or null for routes that do not produce bytes here. */
  function htmlToPdfFor(route, win) {
    if (!route) return null;
    if (route.via === ROUTES.NATIVE) {
      const plugin = nativePdfPlugin(win);
      return plugin ? createNativeHtmlToPdf(plugin) : null;
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------------
  // Handing the file to the customer
  // ---------------------------------------------------------------------------------------------

  function isTouchDevice(win) {
    try {
      return Boolean(win.matchMedia && win.matchMedia('(pointer: coarse)').matches);
    } catch {
      return false;
    }
  }

  function downloadBlob(win, blob, filename) {
    const doc = win.document;
    const url = win.URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    doc.body.appendChild(a);
    a.click();
    a.remove();
    // Long enough for iOS Safari's download sheet to pick it up.
    win.setTimeout(() => win.URL.revokeObjectURL(url), 60000);
  }

  /**
   * Save or share the finished PDF.
   *
   * Phones and tablets get the share sheet (Save to Files, AirDrop, Mail, Drive…) when the
   * browser can share files; everything else gets a normal download. Sharing needs a recent tap,
   * and the render may have taken long enough for that to lapse — especially in Safari — so a
   * refused share is reported as `needs_tap` and the page offers buttons instead of failing.
   *
   * @returns {Promise<{ delivered: 'native_shared'|'shared'|'downloaded'|'cancelled'|'needs_tap' }>}
   */
  async function deliverPdf(bytes, filename, env) {
    const win = env.win;
    const plugin = env.nativePlugin || nativePdfPlugin(win);
    if (plugin && typeof plugin.sharePdf === 'function') {
      await plugin.sharePdf({ data: bytesToBase64(bytes), filename, mimeType: 'application/pdf' });
      return { delivered: 'native_shared' };
    }
    const blob = new win.Blob([bytes], { type: 'application/pdf' });
    const nav = win.navigator || {};
    const preferShare = env.preferShare != null ? env.preferShare : isTouchDevice(win) || Boolean(plugin);
    if (preferShare && typeof nav.share === 'function' && typeof nav.canShare === 'function' && win.File) {
      const file = new win.File([blob], filename, { type: 'application/pdf' });
      if (nav.canShare({ files: [file] })) {
        try {
          await nav.share({ files: [file], title: filename.replace(/\.pdf$/i, '') });
          return { delivered: 'shared' };
        } catch (error) {
          if (error && error.name === 'AbortError') return { delivered: 'cancelled' };
          return { delivered: 'needs_tap', file, blob };
        }
      }
    }
    downloadBlob(win, blob, filename);
    return { delivered: 'downloaded' };
  }

  /**
   * When the share sheet needed a fresh tap: put a Share and a Save button next to the status
   * line. Both are real user gestures, which is what Safari requires.
   */
  function offerReadyPdf(win, container, { file, blob, filename }) {
    const doc = win.document;
    const box = doc.createElement('span');
    box.className = 'file-action-group web-pdf-ready';
    const share = doc.createElement('button');
    share.type = 'button';
    share.className = 'btn primary';
    share.textContent = 'Share PDF';
    share.addEventListener('click', () => {
      win.navigator.share({ files: [file], title: filename.replace(/\.pdf$/i, '') }).catch(() => {});
    });
    const save = doc.createElement('button');
    save.type = 'button';
    save.className = 'btn ghost';
    save.textContent = 'Save PDF';
    save.addEventListener('click', () => downloadBlob(win, blob, filename));
    box.append(share, save);
    const existing = container.querySelector('.web-pdf-ready');
    if (existing) existing.remove();
    container.appendChild(box);
    return box;
  }

  // ---------------------------------------------------------------------------------------------
  // The browser print route
  // ---------------------------------------------------------------------------------------------

  /**
   * Browsers drop background colours when printing unless told otherwise, which would blank the
   * table header bands and the chart legend swatches. Added to the printed copy only — the
   * document itself is unchanged.
   */
  function printReadyHtml(html) {
    const style = '<style>html{-webkit-print-color-adjust:exact;print-color-adjust:exact;}</style>';
    return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${style}</head>`) : style + html;
  }

  return {
    ROUTES,
    PdfRouteError,
    pageMapFromPdf,
    renderTwoPass,
    nativePdfPlugin,
    createNativeHtmlToPdf,
    selectPdfRoute,
    withPdfRoute,
    htmlToPdfFor,
    platformOf,
    deliverPdf,
    offerReadyPdf,
    printReadyHtml,
    base64ToBytes,
    bytesToBase64,
  };
});
