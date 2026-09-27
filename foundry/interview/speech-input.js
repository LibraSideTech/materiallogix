/**
 * Optional spoken answers — on-device speech recognition only.
 *
 * The microphone button appears only when the device can turn speech into text without sending
 * audio anywhere:
 *   - Store app, iOS: SFSpeechRecognizer with requiresOnDeviceRecognition = true
 *     (apps/foundry-mobile/plugins/speech-recognition, plugin name FoundrySpeech).
 *   - Store app, Android: SpeechRecognizer.createOnDeviceSpeechRecognizer (Android 12+), or
 *     EXTRA_PREFER_OFFLINE only where the on-device recognizer is confirmed available.
 *   - Desktop and web: hidden. The browser Web Speech API is deliberately not used — in Chrome it
 *     sends the audio to Google's servers. If the desktop app ever gains an on-device path, it
 *     appears as window.foundryDesktop.speechOnDevice and is used the same way.
 *
 * If the plugin reports that recognition would not be on-device, the mic stays hidden.
 *
 * UMD; in the page it is window.FoundrySpeechInput.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FoundrySpeechInput = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  function nativePlugin(win) {
    try {
      const cap = win && win.Capacitor;
      if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return null;
      const p = cap.Plugins && cap.Plugins.FoundrySpeech;
      return p && typeof p.isAvailable === 'function' && typeof p.start === 'function' ? p : null;
    } catch {
      return null;
    }
  }

  function desktopPath(win) {
    const d = win && win.foundryDesktop && win.foundryDesktop.speechOnDevice;
    return d && typeof d.isAvailable === 'function' && typeof d.start === 'function' ? d : null;
  }

  /** The on-device recognizer to use, or null. Never the browser's Web Speech API. */
  function recognizer(win = root) {
    return nativePlugin(win) || desktopPath(win) || null;
  }

  /**
   * @returns {Promise<{ available: boolean, reason?: string }>}
   */
  async function availability(win = root) {
    const r = recognizer(win);
    if (!r) return { available: false, reason: 'no_on_device_recognizer' };
    try {
      const a = await r.isAvailable({ requiresOnDevice: true });
      if (!a || a.available !== true) return { available: false, reason: (a && a.reason) || 'unavailable' };
      // The plugin must state the recognition is on-device; anything else keeps the mic hidden.
      if (a.onDevice !== true) return { available: false, reason: 'not_on_device' };
      return { available: true };
    } catch {
      return { available: false, reason: 'error' };
    }
  }

  /**
   * Listen once. Resolves with the final text ('' if nothing was heard or it was refused).
   * @param {{ onPartial?: (text: string) => void, locale?: string }} [opts]
   */
  async function listen(opts = {}, win = root) {
    const r = recognizer(win);
    if (!r) return '';
    let handle = null;
    try {
      if (typeof r.addListener === 'function' && opts.onPartial) {
        handle = await r.addListener('partialResult', (e) => opts.onPartial(String((e && e.text) || '')));
      }
      const result = await r.start({ requiresOnDevice: true, partialResults: Boolean(opts.onPartial), locale: opts.locale || 'en-US' });
      if (!result || result.onDevice !== true) return '';
      return String(result.text || '').trim();
    } catch {
      return '';
    } finally {
      if (handle && typeof handle.remove === 'function') handle.remove();
    }
  }

  async function stop(win = root) {
    const r = recognizer(win);
    if (r && typeof r.stop === 'function') {
      try {
        await r.stop();
      } catch {
        /* already stopped */
      }
    }
  }

  return { availability, listen, stop, recognizer };
});
