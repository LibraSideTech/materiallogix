/**
 * The founder's plan, kept on this device.
 *
 * Until now the built pack lived only in sessionStorage, which the browser throws away when the
 * tab closes — so a founder who closed the tab lost the plan they had just built. This keeps one
 * durable copy per device in IndexedDB (the intake answers, the generated pipeline and document
 * pack, and any edits made on the Documents page) and hands it back to the tab on the next visit.
 *
 * Local-first: nothing here touches the network. Moving a plan between devices is done with a
 * plan file (JSON) the founder saves and opens themselves.
 *
 * How it fits the existing pages: every page script reads the pipeline synchronously from
 * sessionStorage ('foundry.instant.context'). That stays the tab's working copy. This module
 *   - on load, fills an empty tab from the device copy and fires 'foundry:plan-restored';
 *   - on load, copies an older sessionStorage-only plan into the device store (migration);
 *   - on every save, writes the tab copy and the device copy together.
 *
 * Shared computers: a saved plan is removed automatically once it has gone EXPIRE_AFTER_DAYS
 * without being opened (checked whenever a Foundry page loads, since nothing runs in between), and
 * a founder can choose "Don't keep this on this device": the plan then lives in this tab alone
 * (sessionStorage, gone when the tab closes), edits included, and any device copy is purged.
 *
 * Schema: one IndexedDB database ('foundry-local', version 1) with one object store ('plans',
 * keyPath 'id'); the plan is the record with id 'current'. Each record carries schema_version,
 * and migrateRecord() lifts older records to the current shape. A record from a newer build is
 * never overwritten by an older one: it is reported, not guessed at.
 *
 * UMD so the Node tests can require it; in the page it is window.FoundryPlanStore, with a shared
 * store already created and restoring (window.FoundryPlanStore.shared).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.FoundryPlanStore = api;
    api.startInPage(root);
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const DB_NAME = 'foundry-local';
  const DB_VERSION = 1;
  const STORE = 'plans';
  const CURRENT_ID = 'current';
  const SCHEMA_VERSION = 1;
  const SESSION_KEY = 'foundry.instant.context';
  const EDITS_KEY = 'foundry.document.edits';
  const FILE_FORMAT = 'materiallogix-foundry-plan';
  /** A plan file is a few hundred KB; anything this large is not one. */
  const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
  /** How long a page waits for the device copy before navigating away anyway. */
  const SAVE_WAIT_MS = 4000;
  /**
   * A saved plan nobody has opened for this many days is deleted from the device the next time
   * any Foundry page loads. The one setting for automatic expiry; the status line quotes it.
   */
  const EXPIRE_AFTER_DAYS = 30;
  const DAY_MS = 24 * 60 * 60 * 1000;
  /** sessionStorage flag: 'tab' means "Don't keep this on this device" for this tab. */
  const KEEP_KEY = 'foundry.plan.keep';
  /**
   * The founder's one-time acknowledgment that the documents are not professional advice, kept on
   * this device with the notice version it was given for. A new notice version asks again.
   */
  const DISCLAIMER_ACK_KEY = 'foundry.disclaimer.ack';

  /** The stored acknowledgment, or null. Never throws: blocked storage reads as "not given". */
  function readDisclaimerAck(storage) {
    try {
      const raw = storage && storage.getItem(DISCLAIMER_ACK_KEY);
      const rec = raw ? JSON.parse(raw) : null;
      return rec && typeof rec === 'object' && rec.version && rec.acknowledged_at ? rec : null;
    } catch {
      return null;
    }
  }

  /** Whether an export must ask first: no acknowledgment, or one given for an older notice. */
  function disclaimerAckNeeded(storage, version) {
    const rec = readDisclaimerAck(storage);
    return !rec || rec.version !== version;
  }

  /** Record the acknowledgment with its time. Returns the record, or null if storage refused it. */
  function recordDisclaimerAck(storage, version, nowIso) {
    const rec = { version, acknowledged_at: nowIso };
    try {
      storage.setItem(DISCLAIMER_ACK_KEY, JSON.stringify(rec));
      return rec;
    } catch {
      return null;
    }
  }

  /**
   * The Guided Interview's answers in progress: a second record beside the plan ('interview'),
   * under the same rules — removed after EXPIRE_AFTER_DAYS unopened, kept in the tab alone under
   * "Don't keep this on this device", and deleted with the plan.
   */
  const INTERVIEW_ID = 'interview';
  const INTERVIEW_SESSION_KEY = 'foundry.interview.state';

  class PlanStoreError extends Error {
    constructor(code, message) {
      super(message || code);
      this.name = 'PlanStoreError';
      this.code = code;
    }
  }

  function isQuotaError(error) {
    if (!error) return false;
    return (
      error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22 ||
      error.code === 1014 ||
      error.code === 'quota'
    );
  }

  function errorCode(error) {
    if (isQuotaError(error)) return 'quota';
    if (error && error.code === 'newer_schema') return 'newer_schema';
    return 'unavailable';
  }

  // -------------------------------------------------------------------------------------------
  // Record shape and migration
  // -------------------------------------------------------------------------------------------

  function isPipeline(p) {
    return Boolean(p && typeof p === 'object' && p.ok === true);
  }

  function makeRecord(pipeline, edits, previous, nowIso) {
    return {
      id: CURRENT_ID,
      schema_version: SCHEMA_VERSION,
      created_at: (previous && previous.created_at) || nowIso,
      saved_at: nowIso,
      last_opened_at: nowIso,
      company_title: (pipeline.document_pack && pipeline.document_pack.company_title) || null,
      intake: pipeline.intake || null,
      pipeline,
      edits: edits && typeof edits === 'object' ? edits : {},
    };
  }

  /**
   * Lift any stored record to the current schema.
   *   schema 0: what the tab used to hold — a bare pipeline object (sessionStorage), possibly with
   *             edits kept separately in localStorage. Recognised by `ok` and no schema_version.
   *   schema 1: { id, schema_version: 1, created_at, saved_at, company_title, intake, pipeline, edits }
   */
  /**
   * Whether a record has gone EXPIRE_AFTER_DAYS without being opened. Records from before expiry
   * existed have no last_opened_at, so their last save stands in for it.
   */
  function isExpired(rec, nowMs) {
    if (!rec) return false;
    const last = Date.parse(rec.last_opened_at || rec.saved_at || rec.created_at || '');
    if (!Number.isFinite(last)) return false;
    return nowMs - last > EXPIRE_AFTER_DAYS * DAY_MS;
  }

  function migrateRecord(raw, nowIso) {
    if (!raw || typeof raw !== 'object') return null;
    let rec = raw;
    const version = rec.schema_version == null ? 0 : Number(rec.schema_version);
    if (!Number.isInteger(version) || version < 0) return null;
    if (version > SCHEMA_VERSION) {
      throw new PlanStoreError('newer_schema', 'This plan was saved by a newer version of Foundry.');
    }
    if (version === 0) {
      if (!isPipeline(rec)) return null;
      rec = makeRecord(rec, {}, null, nowIso);
    }
    // Future: if (rec.schema_version === 1) { rec = liftTo2(rec) } ...
    if (!isPipeline(rec.pipeline)) return null;
    return { ...rec, id: CURRENT_ID };
  }

  // -------------------------------------------------------------------------------------------
  // Backends: IndexedDB in the page, memory in tests
  // -------------------------------------------------------------------------------------------

  function promisify(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /** A tiny get/put/delete over one IndexedDB object store. */
  function idbBackend(indexedDB) {
    if (!indexedDB || typeof indexedDB.open !== 'function') return null;
    let dbPromise = null;
    const open = () => {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        let req;
        try {
          req = indexedDB.open(DB_NAME, DB_VERSION);
        } catch (error) {
          reject(error);
          return;
        }
        req.onupgradeneeded = (event) => {
          const db = req.result;
          const from = event.oldVersion || 0;
          // Each step upgrades one version, so a device several versions behind walks forward.
          if (from < 1) db.createObjectStore(STORE, { keyPath: 'id' });
        };
        req.onsuccess = () => {
          const db = req.result;
          // Another tab opening a newer schema asks us to step aside rather than block it.
          db.onversionchange = () => db.close();
          resolve(db);
        };
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new PlanStoreError('unavailable', 'Storage is blocked by another tab.'));
      });
      dbPromise.catch(() => {
        dbPromise = null;
      });
      return dbPromise;
    };
    const run = async (mode, fn) => {
      const db = await open();
      return new Promise((resolve, reject) => {
        let tx;
        try {
          tx = db.transaction(STORE, mode);
        } catch (error) {
          reject(error);
          return;
        }
        let result;
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => {
          result = req.result;
        };
        tx.oncomplete = () => resolve(result);
        // A quota failure surfaces on the transaction (abort), not always on the request.
        tx.onabort = () => reject(tx.error || req.error);
        tx.onerror = () => reject(tx.error || req.error);
      });
    };
    return {
      kind: 'indexeddb',
      get: (id) => run('readonly', (s) => s.get(id)),
      put: (rec) => run('readwrite', (s) => s.put(rec)),
      delete: (id) => run('readwrite', (s) => s.delete(id)),
    };
  }

  /** Test double with the same surface; `failWith` makes put() throw (e.g. a quota error). */
  function memoryBackend(initial) {
    const rows = new Map();
    if (initial) rows.set(initial.id || CURRENT_ID, JSON.parse(JSON.stringify(initial)));
    const backend = {
      kind: 'memory',
      failWith: null,
      rows,
      async get(id) {
        const row = rows.get(id);
        return row ? JSON.parse(JSON.stringify(row)) : undefined;
      },
      async put(rec) {
        if (backend.failWith) throw backend.failWith;
        rows.set(rec.id, JSON.parse(JSON.stringify(rec)));
      },
      async delete(id) {
        rows.delete(id);
      },
    };
    return backend;
  }

  function safeGet(storage, key) {
    try {
      return storage ? storage.getItem(key) : null;
    } catch {
      return null;
    }
  }

  function parseJson(raw, fallback) {
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function withTimeout(promise, ms) {
    let timer;
    return Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), ms);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  // -------------------------------------------------------------------------------------------
  // The store
  // -------------------------------------------------------------------------------------------

  /**
   * @param {{ backend?: object|null, legacyBackend?: object|null, session?: Storage, local?: Storage,
   *           storageManager?: StorageManager, now?: () => Date, onChange?: (status) => void }} deps
   *
   * legacyBackend: where an earlier build of this same app kept the plan (the store app's WebView
   * IndexedDB, before it moved to the app's own files). It is never written. A plan found only
   * there is moved into `backend` on load — subject to the same expiry and "Don't keep this on this
   * device" rules — and every purge (expiry, tab-only, delete) clears it too, so no copy of the plan
   * outlives the founder's choice in a store nobody reads any more.
   */
  function createPlanStore(deps = {}) {
    const backend = deps.backend || null;
    const legacyBackend = deps.legacyBackend && deps.legacyBackend !== backend ? deps.legacyBackend : null;
    const session = deps.session || null;
    const local = deps.local || null;
    const storageManager = deps.storageManager || null;
    const now = deps.now || (() => new Date());
    const listeners = new Set();
    if (deps.onChange) listeners.add(deps.onChange);

    let queue = Promise.resolve();
    const serial = (fn) => {
      const next = queue.then(fn, fn);
      queue = next.catch(() => {});
      return next;
    };

    const status = {
      /** 'unknown' until restore finishes, then 'saved' | 'none' | 'unavailable' | 'quota' | 'newer_schema' */
      state: 'unknown',
      persisted: null,
      saved_at: null,
      company_title: null,
      backend: backend ? backend.kind : 'none',
      sessionError: null,
      expire_after_days: EXPIRE_AFTER_DAYS,
    };
    const emit = () => {
      const snapshot = { ...status };
      for (const fn of listeners) {
        try {
          fn(snapshot);
        } catch {
          /* a listener's bug is not the store's */
        }
      }
    };
    const set = (patch) => {
      Object.assign(status, patch);
      emit();
    };

    const readSessionPipeline = () => {
      const p = parseJson(safeGet(session, SESSION_KEY), null);
      return isPipeline(p) ? p : null;
    };
    /** "Don't keep this on this device" is chosen per tab and lives only as long as the tab. */
    const sessionOnly = () => safeGet(session, KEEP_KEY) === 'tab';
    const readEditsFrom = (storage) => {
      const e = parseJson(safeGet(storage, EDITS_KEY), null);
      return e && typeof e === 'object' && !Array.isArray(e) ? e : null;
    };
    // Edits follow the plan: on the device normally, in the tab alone when the plan is.
    const readLocalEdits = () => readEditsFrom(sessionOnly() ? session : local);
    const removeItem = (storage, key) => {
      try {
        if (storage) storage.removeItem(key);
      } catch {
        /* ignore */
      }
    };
    /** Delete the device copy (record and localStorage edits), ignoring a missing backend. */
    const purgeDevice = async () => {
      removeItem(local, EDITS_KEY);
      await purgeLegacy();
      if (!backend) return;
      try {
        await backend.delete(CURRENT_ID);
      } catch {
        /* nothing more can be done here; the status says what is kept */
      }
      await purgeInterviewDevice();
    };
    /** The interview's device copy (and any legacy one), never the tab copy. */
    async function purgeInterviewDevice() {
      for (const b of [backend, legacyBackend]) {
        if (!b) continue;
        try {
          await b.delete(INTERVIEW_ID);
        } catch {
          /* best effort */
        }
      }
    }
    async function purgeLegacy() {
      if (!legacyBackend) return;
      try {
        await legacyBackend.delete(CURRENT_ID);
      } catch {
        /* best effort: the legacy store may not even open */
      }
    }
    /**
     * A plan an earlier build left in legacyBackend, moved into `backend`. Returns the raw record
     * (still to be migrated and expiry-checked by the caller), or undefined. The legacy copy is only
     * deleted once `backend` holds it, so a failed write never loses the plan.
     */
    async function adoptLegacy() {
      if (!legacyBackend) return undefined;
      let raw;
      try {
        raw = await legacyBackend.get(CURRENT_ID);
      } catch {
        return undefined;
      }
      if (!raw) return undefined;
      let rec;
      try {
        rec = migrateRecord(raw, now().toISOString());
      } catch {
        return raw; // newer schema: reported by the caller, left where it is
      }
      if (!rec) {
        await purgeLegacy();
        return undefined;
      }
      if (isExpired(rec, now().getTime())) return rec; // the caller purges it
      try {
        await backend.put(rec);
        await purgeLegacy();
      } catch {
        /* keep the legacy copy; the tab still gets the plan below */
      }
      return rec;
    }
    /** Record that the plan was opened now, which restarts the expiry clock. */
    const touch = async (rec) => {
      const next = { ...rec, last_opened_at: now().toISOString() };
      try {
        await backend.put(next);
      } catch {
        /* still usable as read */
      }
      return next;
    };

    /** The tab copy. A full sessionStorage must not stop the device copy from being written. */
    const writeSession = (pipeline) => {
      if (!session) return null;
      // Load the plan's ZIP data now, so a rebuild on this page finds it (see FoundryEngines.prepareLocation).
      try {
        const engines = globalThis.FoundryEngines;
        if (engines && typeof engines.prepareLocation === 'function') engines.prepareLocation(pipeline);
      } catch {
        /* a plan without a ZIP needs nothing */
      }
      try {
        session.setItem(SESSION_KEY, JSON.stringify(pipeline));
        return null;
      } catch (error) {
        return errorCode(error);
      }
    };
    const writeLocalEdits = (edits) => {
      const target = sessionOnly() ? session : local;
      if (!target) return;
      try {
        if (edits && Object.keys(edits).length) target.setItem(EDITS_KEY, JSON.stringify(edits));
        else target.removeItem(EDITS_KEY);
      } catch {
        /* edits also travel inside the device record */
      }
    };

    let persistAsked = false;
    async function requestPersistence() {
      if (!storageManager || sessionOnly()) return null;
      try {
        if (typeof storageManager.persisted === 'function' && (await storageManager.persisted())) {
          set({ persisted: true });
          return true;
        }
        if (persistAsked || typeof storageManager.persist !== 'function') return status.persisted;
        persistAsked = true;
        const granted = Boolean(await storageManager.persist());
        set({ persisted: granted });
        return granted;
      } catch {
        return null;
      }
    }

    async function putRecord(pipeline, edits) {
      if (!backend) throw new PlanStoreError('unavailable');
      let previous = null;
      try {
        previous = await backend.get(CURRENT_ID);
      } catch {
        previous = null;
      }
      if (previous && Number(previous.schema_version) > SCHEMA_VERSION) {
        throw new PlanStoreError('newer_schema');
      }
      const rec = makeRecord(pipeline, edits, previous, now().toISOString());
      await backend.put(rec);
      return rec;
    }

    /**
     * Fill the tab from the device, or the device from the tab.
     * @returns {Promise<{ source: 'session'|'device'|'none', pipeline: object|null, migrated: boolean, error?: string }>}
     */
    function restore() {
      return serial(async () => {
        const sessionPipeline = readSessionPipeline();
        if (sessionOnly()) {
          // This tab keeps its plan to itself. A device copy left from before the choice (another
          // tab, an older build) is not this tab's to restore, and would outlive the tab: purge it.
          await purgeDevice();
          set({ state: 'session_only', saved_at: null, company_title: null });
          return { source: sessionPipeline ? 'session' : 'none', pipeline: sessionPipeline, migrated: false };
        }
        if (!backend) {
          set({ state: 'unavailable' });
          return { source: sessionPipeline ? 'session' : 'none', pipeline: sessionPipeline, migrated: false, error: 'unavailable' };
        }
        let raw;
        try {
          raw = await backend.get(CURRENT_ID);
        } catch (error) {
          set({ state: 'unavailable' });
          return { source: sessionPipeline ? 'session' : 'none', pipeline: sessionPipeline, migrated: false, error: errorCode(error) };
        }
        if (!raw) raw = await adoptLegacy();
        else await purgeLegacy();
        let rec = null;
        try {
          rec = migrateRecord(raw, now().toISOString());
        } catch (error) {
          set({ state: 'newer_schema' });
          return { source: sessionPipeline ? 'session' : 'none', pipeline: sessionPipeline, migrated: false, error: errorCode(error) };
        }

        // Unused for EXPIRE_AFTER_DAYS: delete it before anyone sees it. A tab that still holds the
        // plan is in use right now, so it is not expired; it is rewritten below with a fresh clock.
        if (rec && !sessionPipeline && isExpired(rec, now().getTime())) {
          await purgeDevice();
          set({ state: 'expired', saved_at: null, company_title: null });
          return { source: 'none', pipeline: null, migrated: false, expired: true };
        }

        if (sessionPipeline) {
          // This tab is already working on a plan: it is the newest thing this founder did here.
          // A plan that only ever lived in sessionStorage (every build before this one) is copied
          // to the device now, so closing the tab no longer loses it.
          const needsCopy = !rec || JSON.stringify(rec.pipeline) !== JSON.stringify(sessionPipeline);
          if (!needsCopy) {
            await touch(rec);
            set({ state: 'saved', saved_at: rec.saved_at, company_title: rec.company_title });
            requestPersistence();
            return { source: 'session', pipeline: sessionPipeline, migrated: false };
          }
          try {
            const written = await putRecord(sessionPipeline, readLocalEdits() || {});
            set({ state: 'saved', saved_at: written.saved_at, company_title: written.company_title });
            requestPersistence();
            return { source: 'session', pipeline: sessionPipeline, migrated: !rec };
          } catch (error) {
            set({ state: errorCode(error) });
            return { source: 'session', pipeline: sessionPipeline, migrated: false, error: errorCode(error) };
          }
        }

        if (rec) {
          const sessionError = writeSession(rec.pipeline);
          // localStorage edits are written synchronously on every change, so when present they are
          // at least as new as the record's copy.
          if (!readLocalEdits()) writeLocalEdits(rec.edits || {});
          // Opening restarts the expiry clock; the same write rewrites an older record in the
          // current shape.
          await touch(rec);
          set({ state: 'saved', saved_at: rec.saved_at, company_title: rec.company_title, sessionError });
          requestPersistence();
          return { source: 'device', pipeline: rec.pipeline, migrated: false };
        }

        set({ state: 'none', saved_at: null, company_title: null });
        return { source: 'none', pipeline: null, migrated: false };
      });
    }

    /** Save a new or updated pipeline (tab copy immediately, device copy in order). */
    function savePipeline(pipeline, opts = {}) {
      if (!isPipeline(pipeline)) return Promise.resolve({ ok: false, error: 'invalid' });
      const sessionError = writeSession(pipeline);
      if (opts.edits !== undefined) writeLocalEdits(opts.edits);
      return serial(async () => {
        if (sessionOnly()) {
          await purgeDevice();
          set({ state: 'session_only', saved_at: null, company_title: null, sessionError });
          return { ok: !sessionError, sessionOnly: true, sessionError, error: sessionError || undefined };
        }
        const edits = opts.edits !== undefined ? opts.edits || {} : readLocalEdits() || {};
        try {
          const rec = await putRecord(pipeline, edits);
          set({ state: 'saved', saved_at: rec.saved_at, company_title: rec.company_title, sessionError });
          const persisted = await requestPersistence();
          return { ok: true, persisted, sessionError };
        } catch (error) {
          const code = errorCode(error);
          set({ state: code, sessionError });
          return { ok: false, error: code, sessionError };
        }
      });
    }

    /** Save Documents-page edits alongside the plan they belong to. */
    function saveEdits(edits) {
      writeLocalEdits(edits);
      return serial(async () => {
        if (sessionOnly()) return { ok: true, sessionOnly: true };
        if (!backend) return { ok: false, error: 'unavailable' };
        try {
          const rec = migrateRecord(await backend.get(CURRENT_ID), now().toISOString());
          if (!rec) return { ok: false, error: 'no_plan' };
          const next = { ...rec, edits: edits || {}, saved_at: now().toISOString() };
          await backend.put(next);
          set({ state: 'saved', saved_at: next.saved_at });
          return { ok: true };
        } catch (error) {
          const code = errorCode(error);
          set({ state: code });
          return { ok: false, error: code };
        }
      });
    }

    /** Remove the plan from this device: tab copy, edits, interview answers and device record. */
    function clear() {
      removeItem(session, SESSION_KEY);
      removeItem(session, EDITS_KEY);
      removeItem(local, EDITS_KEY);
      removeItem(session, INTERVIEW_SESSION_KEY);
      return serial(async () => {
        await purgeLegacy();
        await purgeInterviewDevice();
        if (sessionOnly()) {
          await purgeDevice();
          set({ state: 'session_only', saved_at: null, company_title: null });
          return { ok: true };
        }
        if (!backend) {
          set({ state: 'unavailable', saved_at: null, company_title: null });
          return { ok: true };
        }
        try {
          await backend.delete(CURRENT_ID);
          set({ state: 'none', saved_at: null, company_title: null });
          return { ok: true };
        } catch (error) {
          set({ state: errorCode(error) });
          return { ok: false, error: errorCode(error) };
        }
      });
    }

    /**
     * "Don't keep this on this device" (keep = false): the plan and its edits move into this tab
     * alone and the device copy is deleted. keep = true puts them back on the device.
     */
    function setKeepOnDevice(keep) {
      if (!keep) {
        if (!session) return Promise.resolve({ ok: false, error: 'unavailable' });
        const edits = readEditsFrom(local);
        try {
          session.setItem(KEEP_KEY, 'tab');
          if (edits && Object.keys(edits).length) session.setItem(EDITS_KEY, JSON.stringify(edits));
        } catch (error) {
          return Promise.resolve({ ok: false, error: errorCode(error) });
        }
        return serial(async () => {
          // Interview answers move into the tab with the plan before the device copy goes.
          if (backend) {
            try {
              const rec = await backend.get(INTERVIEW_ID);
              if (rec && rec.state && !safeGet(session, INTERVIEW_SESSION_KEY)) session.setItem(INTERVIEW_SESSION_KEY, JSON.stringify(rec.state));
            } catch {
              /* nothing to move */
            }
          }
          await purgeDevice();
          set({ state: 'session_only', saved_at: null, company_title: null });
          return { ok: true, sessionOnly: true };
        });
      }
      const edits = readEditsFrom(session);
      removeItem(session, KEEP_KEY);
      removeItem(session, EDITS_KEY);
      if (edits) writeLocalEdits(edits);
      // Interview answers kept in the tab go back on the device with the plan.
      const tabInterview = parseJson(safeGet(session, INTERVIEW_SESSION_KEY), null);
      if (tabInterview) saveInterview(tabInterview);
      const pipeline = readSessionPipeline();
      if (!pipeline) {
        return serial(async () => {
          set({ state: backend ? 'none' : 'unavailable', saved_at: null, company_title: null });
          return { ok: true, sessionOnly: false };
        });
      }
      return savePipeline(pipeline).then((r) => ({ ...r, sessionOnly: false }));
    }

    /** The plan as a file the founder can keep or move to another device. */
    function exportPlan() {
      const pipeline = readSessionPipeline();
      if (!pipeline) return null;
      const title = (pipeline.document_pack && pipeline.document_pack.company_title) || 'Foundry plan';
      const file = {
        format: FILE_FORMAT,
        schema_version: SCHEMA_VERSION,
        exported_at: now().toISOString(),
        company_title: title,
        plan: { pipeline, edits: readLocalEdits() || {} },
      };
      const slug = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'foundry';
      return { filename: `${slug}-foundry-plan.json`, text: JSON.stringify(file, null, 2), mime: 'application/json' };
    }

    /** Read a plan file, check it, and make it this device's plan. */
    function parsePlanFile(text) {
      if (typeof text !== 'string' || !text.trim()) throw new PlanStoreError('not_a_plan', 'The file is empty.');
      if (text.length > MAX_IMPORT_BYTES) throw new PlanStoreError('too_large', 'The file is too large to be a Foundry plan.');
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new PlanStoreError('not_a_plan', 'This is not a Foundry plan file.');
      }
      if (!data || data.format !== FILE_FORMAT || !data.plan) {
        throw new PlanStoreError('not_a_plan', 'This is not a Foundry plan file.');
      }
      if (Number(data.schema_version) > SCHEMA_VERSION) {
        throw new PlanStoreError('newer_schema', 'This plan file was saved by a newer version of Foundry.');
      }
      const pipeline = data.plan.pipeline;
      if (!isPipeline(pipeline) || !pipeline.intake) {
        throw new PlanStoreError('not_a_plan', 'The plan file is incomplete.');
      }
      const edits = data.plan.edits && typeof data.plan.edits === 'object' && !Array.isArray(data.plan.edits) ? data.plan.edits : {};
      return { pipeline, edits, company_title: data.company_title || null };
    }

    async function importPlan(text) {
      let parsed;
      try {
        parsed = parsePlanFile(text);
      } catch (error) {
        return { ok: false, error: error.code || 'not_a_plan', message: error.message };
      }
      const result = await savePipeline(parsed.pipeline, { edits: parsed.edits });
      return { ...result, pipeline: parsed.pipeline, company_title: parsed.company_title };
    }

    // ---- Guided Interview answers ------------------------------------------------------------

    const writeInterviewSession = (state) => {
      if (!session) return;
      try {
        if (state) session.setItem(INTERVIEW_SESSION_KEY, JSON.stringify(state));
        else session.removeItem(INTERVIEW_SESSION_KEY);
      } catch {
        /* the device copy still holds it */
      }
    };

    /**
     * The saved interview, or null. Opening it restarts its expiry clock; one unopened for
     * EXPIRE_AFTER_DAYS is deleted instead of returned.
     */
    function loadInterview() {
      return serial(async () => {
        const tab = parseJson(safeGet(session, INTERVIEW_SESSION_KEY), null);
        if (sessionOnly() || !backend) return tab;
        let rec;
        try {
          rec = await backend.get(INTERVIEW_ID);
        } catch {
          return tab;
        }
        if (!rec || !rec.state) return tab;
        if (isExpired(rec, now().getTime())) {
          await purgeInterviewDevice();
          writeInterviewSession(null);
          return null;
        }
        const nowIso = now().toISOString();
        try {
          await backend.put({ ...rec, last_opened_at: nowIso });
        } catch {
          /* still usable as read */
        }
        // The newer of the tab and device copies wins; they only differ if a write was cut short.
        const state = tab && String(tab.updated_at || '') > String(rec.state.updated_at || '') ? tab : rec.state;
        writeInterviewSession(state);
        return state;
      });
    }

    /** Save interview answers: tab copy now, device copy in order (unless kept in the tab only). */
    function saveInterview(state) {
      if (!state || typeof state !== 'object') return Promise.resolve({ ok: false, error: 'invalid' });
      writeInterviewSession(state);
      return serial(async () => {
        if (sessionOnly()) {
          await purgeInterviewDevice();
          return { ok: true, sessionOnly: true };
        }
        if (!backend) return { ok: false, error: 'unavailable' };
        const nowIso = now().toISOString();
        try {
          let previous = null;
          try {
            previous = await backend.get(INTERVIEW_ID);
          } catch {
            previous = null;
          }
          await backend.put({
            id: INTERVIEW_ID,
            kind: 'guided_interview',
            schema_version: 1,
            created_at: (previous && previous.created_at) || nowIso,
            saved_at: nowIso,
            last_opened_at: nowIso,
            state,
          });
          return { ok: true };
        } catch (error) {
          return { ok: false, error: errorCode(error) };
        }
      });
    }

    /** Delete the interview answers from the tab and the device. The plan is left alone. */
    function clearInterview() {
      writeInterviewSession(null);
      return serial(async () => {
        await purgeInterviewDevice();
        return { ok: true };
      });
    }

    return {
      restore,
      savePipeline,
      loadInterview,
      saveInterview,
      clearInterview,
      saveEdits,
      clear,
      exportPlan,
      parsePlanFile,
      importPlan,
      requestPersistence,
      setKeepOnDevice,
      keepsOnDevice: () => !sessionOnly(),
      /** The Documents-page edits, from wherever this tab keeps them. */
      edits: () => readLocalEdits() || {},
      status: () => ({ ...status }),
      onChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      /** Resolve when every queued write has landed (or SAVE_WAIT_MS passed). */
      settled: (ms = SAVE_WAIT_MS) => withTimeout(queue.then(() => ({ ok: true })), ms),
      /** The notice acknowledgment: device storage, or this tab when device storage is blocked. */
      disclaimerAck: () => readDisclaimerAck(local) || readDisclaimerAck(session),
      disclaimerAckNeeded: (version) => disclaimerAckNeeded(local, version) && disclaimerAckNeeded(session, version),
      recordDisclaimerAck: (version) =>
        recordDisclaimerAck(local, version, now().toISOString()) || recordDisclaimerAck(session, version, now().toISOString()),
    };
  }

  /** Words for the status line. Plain, and honest about what the browser may do. */
  function statusMessage(s) {
    switch (s && s.state) {
      case 'saved': {
        const line = `Your plan is saved on this device · removed automatically after ${EXPIRE_AFTER_DAYS} days of no use.`;
        return s.persisted === false
          ? `${line} Your browser may clear saved sites when space runs low, so save a plan file too.`
          : line;
      }
      case 'session_only':
        return 'Kept in this tab only · not saved on this device, and gone when you close the tab. Save a plan file to keep it.';
      case 'expired':
        return `The plan saved on this device was removed automatically after ${EXPIRE_AFTER_DAYS} days of no use.`;
      case 'none':
        return 'No plan saved on this device yet.';
      case 'quota':
        return 'This device is out of storage space, so your latest changes are not saved here. Save a plan file to keep them.';
      case 'newer_schema':
        return 'The plan on this device was saved by a newer version of Foundry. Update Foundry to open it.';
      case 'unavailable':
        return 'This browser is not letting Foundry save on this device (private browsing or blocked storage). Save a plan file before you close this tab.';
      default:
        return 'Checking this device for your plan…';
    }
  }

  function startInPage(win) {
    if (!win || !win.document) return;
    let idb = null;
    try {
      idb = win.indexedDB || null;
    } catch {
      idb = null;
    }
    let session = null;
    let local = null;
    try {
      session = win.sessionStorage;
    } catch {
      session = null;
    }
    try {
      local = win.localStorage;
    } catch {
      local = null;
    }
    // --- BEGIN foundry-mobile hook (apps/foundry-mobile/www-hooks/native-plan-backend.js) --------
    // On a Capacitor native build, WKWebView's IndexedDB is evictable under iOS storage pressure.
    // native-plan-backend.js (loaded only in that build, never in the web or desktop build) sets
    // window.FoundryNativePlanBackend to a @capacitor/filesystem-backed object with the exact same
    // { kind, get(id), put(record), delete(id) } shape as idbBackend()/memoryBackend() above, so
    // every other line in this file (restore, savePipeline, saveEdits, clear, migration, exportPlan,
    // importPlan) is unchanged. This is a no-op — the global is never set — outside that build.
    //
    // The native bundle must load before this file (build-www.mjs injects it at the end of <head>);
    // when it does, the WebView's IndexedDB becomes the legacy store: read once to move an older
    // build's plan across, and purged with every expiry, tab-only choice and delete.
    const nativeBackend =
      win.Capacitor && win.Capacitor.isNativePlatform && win.Capacitor.isNativePlatform()
        ? win.FoundryNativePlanBackend || null
        : null;
    // --- END foundry-mobile hook -------------------------------------------------------------
    const store = createPlanStore({
      backend: nativeBackend || idbBackend(idb),
      legacyBackend: nativeBackend ? idbBackend(idb) : null,
      session,
      local,
      storageManager: (win.navigator && win.navigator.storage) || null,
    });
    api.shared = store;
    store.onChange((s) => {
      try {
        win.dispatchEvent(new win.CustomEvent('foundry:plan-status', { detail: s }));
      } catch {
        /* old browser */
      }
    });
    api.ready = store.restore().then((result) => {
      if (result.source === 'device' && result.pipeline) {
        win.dispatchEvent(new win.CustomEvent('foundry:plan-restored', { detail: { pipeline: result.pipeline } }));
      }
      return result;
    });
  }

  const api = {
    DB_NAME,
    DB_VERSION,
    STORE,
    SCHEMA_VERSION,
    SESSION_KEY,
    KEEP_KEY,
    INTERVIEW_ID,
    INTERVIEW_SESSION_KEY,
    EXPIRE_AFTER_DAYS,
    isExpired,
    EDITS_KEY,
    FILE_FORMAT,
    PlanStoreError,
    DISCLAIMER_ACK_KEY,
    readDisclaimerAck,
    disclaimerAckNeeded,
    recordDisclaimerAck,
    isQuotaError,
    migrateRecord,
    idbBackend,
    memoryBackend,
    createPlanStore,
    statusMessage,
    startInPage,
    shared: null,
    ready: null,
  };
  return api;
});
