/**
 * Plays the interviewer's pre-rendered house-voice lines (bundled audio; nothing is fetched from
 * anywhere but this app's own files).
 *
 *  - Voice is a preference the founder can turn off at any time; captions are always on screen,
 *    whatever this does.
 *  - Nothing plays until the founder has tapped something (browsers, and iOS in particular, refuse
 *    sound before a gesture). If a play is refused anyway, the replay button says "Play" and
 *    waits for a tap instead of retrying.
 *  - Audio is only used when the manifest was rendered from this exact question bank version, so
 *    a changed question can never play the old wording.
 *  - Opus (WebM) where the browser plays it, AAC (M4A) otherwise (Safari, iOS).
 *  - A line the interviewer phrased on the fly has no bundled audio. On desktop, when the
 *    MaterialLogix voice runtime is installed, it is rendered locally through the desktop bridge;
 *    everywhere else it stays text only. Never a cloud voice.
 *
 * UMD; in the page it is window.FoundryInterviewVoice.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FoundryInterviewVoice = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const PREF_KEY = 'foundry.interview.voice';

  function readPref(storage) {
    try {
      const v = storage && storage.getItem(PREF_KEY);
      return v == null ? true : v === 'on';
    } catch {
      return true;
    }
  }

  /**
   * @param {{ manifest: object|null, bank: object, audio: HTMLAudioElement|null, storage?: Storage|null, desktop?: object|null, basePath?: string }} opts
   */
  function createVoicePlayer(opts) {
    const manifest = opts.manifest || null;
    const bank = opts.bank || {};
    const audio = opts.audio || null;
    const storage = opts.storage || null;
    const desktop = opts.desktop || null;
    const basePath = opts.basePath || './interview/';
    const listeners = new Set();
    let enabled = readPref(storage);
    let unlocked = false;
    let playing = false;
    let queue = [];
    let token = 0;
    let objectUrl = null;

    const usable = Boolean(manifest && manifest.entries && manifest.bank_version === bank.version && audio);
    const format = (() => {
      if (!audio || typeof audio.canPlayType !== 'function') return 'aac';
      return audio.canPlayType('audio/webm; codecs="opus"') ? 'opus' : 'aac';
    })();

    const emit = () => {
      const s = { enabled, unlocked, playing, available: usable };
      for (const fn of listeners) {
        try {
          fn(s);
        } catch {
          /* a listener's problem */
        }
      }
    };

    function hasAudio(key) {
      return usable && Boolean(manifest.entries[key]);
    }

    function stop() {
      token += 1;
      queue = [];
      if (audio) {
        try {
          audio.pause();
        } catch {
          /* ignore */
        }
      }
      if (objectUrl && typeof URL !== 'undefined') {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
      if (playing) {
        playing = false;
        emit();
      }
    }

    function playSrc(src, my) {
      return new Promise((resolve) => {
        if (!audio || my !== token) return resolve(false);
        const done = (ok) => {
          audio.onended = null;
          audio.onerror = null;
          resolve(ok);
        };
        audio.onended = () => done(true);
        audio.onerror = () => done(false);
        audio.src = src;
        const p = audio.play();
        if (p && typeof p.catch === 'function') {
          p.catch((error) => {
            // Refused before a gesture (NotAllowedError): wait for a tap rather than retrying.
            if (error && error.name === 'NotAllowedError') unlocked = false;
            done(false);
          });
        }
      });
    }

    /** Play fixed lines in order (e.g. a chapter intro, then the question). */
    async function play(keys) {
      stop();
      if (!enabled || !usable || !unlocked) return false;
      const my = token;
      queue = [].concat(keys).filter(hasAudio);
      if (!queue.length) return false;
      playing = true;
      emit();
      let ok = true;
      while (queue.length && my === token) {
        const e = manifest.entries[queue.shift()];
        ok = (await playSrc(basePath + (format === 'opus' ? e.opus : e.aac), my)) && ok;
        if (!unlocked) break;
      }
      if (my === token) {
        playing = false;
        emit();
      }
      return ok;
    }

    /** Whether a line with no bundled audio can be spoken locally (desktop voice runtime). */
    async function canSpeakDynamic() {
      if (!desktop || typeof desktop.interviewVoiceAvailable !== 'function') return false;
      try {
        const r = await desktop.interviewVoiceAvailable();
        return Boolean(r && r.available);
      } catch {
        return false;
      }
    }

    /** Speak a line phrased on the fly, locally on desktop. Resolves false everywhere else. */
    async function speakDynamic(text) {
      stop();
      if (!enabled || !unlocked || !desktop || typeof desktop.interviewVoiceSpeak !== 'function') return false;
      const my = token;
      let r;
      try {
        r = await desktop.interviewVoiceSpeak(String(text).slice(0, 600));
      } catch {
        return false;
      }
      if (!r || !r.ok || !r.wav || my !== token || typeof Blob === 'undefined') return false;
      const bytes = r.wav instanceof Uint8Array ? r.wav : new Uint8Array(r.wav);
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
      playing = true;
      emit();
      const ok = await playSrc(objectUrl, my);
      if (my === token) {
        playing = false;
        emit();
      }
      return ok;
    }

    return {
      get enabled() {
        return enabled;
      },
      get unlocked() {
        return unlocked;
      },
      get available() {
        return usable;
      },
      get format() {
        return format;
      },
      hasAudio,
      /** Call from inside a tap or key handler: permission to make sound from now on. */
      unlock() {
        // Only a change is announced. Announcing on every tap repainted the voice checkboxes from the
        // old setting in the middle of the founder's own click on one of them.
        if (unlocked) return;
        unlocked = true;
        emit();
      },
      setEnabled(v) {
        enabled = Boolean(v);
        try {
          if (storage) storage.setItem(PREF_KEY, enabled ? 'on' : 'off');
        } catch {
          /* a preference only */
        }
        if (!enabled) stop();
        emit();
      },
      play,
      stop,
      speakDynamic,
      canSpeakDynamic,
      onChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };
  }

  /**
   * The change handler for a "Read questions aloud" checkbox. The box's new value is read before
   * anything else runs: unlock() can repaint every voice checkbox from the previous setting, and a
   * handler that read e.target.checked after it always turned the voice back to what it was.
   */
  function voiceToggleHandler(getVoice) {
    return (e) => {
      const want = Boolean(e && e.target && e.target.checked);
      const voice = typeof getVoice === 'function' ? getVoice() : getVoice;
      if (!voice) return;
      voice.unlock();
      voice.setEnabled(want);
    };
  }

  return { createVoicePlayer, voiceToggleHandler, PREF_KEY };
});
