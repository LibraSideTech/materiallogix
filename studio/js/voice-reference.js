// This check only decides whether it is reasonable to ask the browser decoder
// to try the file. The decoder remains the source of truth: browsers expose
// valid audio using more MIME variants and extensions than a static allowlist
// can keep up with.
const AUDIO_EXTENSION_FALLBACKS = new Set([
  'aac', 'aif', 'aiff', 'caf', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'opus',
  'wav', 'wave', 'weba', 'webm'
]);
const GENERIC_AUDIO_CONTAINERS = new Set(['application/ogg', 'application/x-ogg', 'video/webm']);
const UNSAFE_FILE_EXTENSIONS = new Set(['bat', 'cmd', 'com', 'exe', 'html', 'htm', 'js', 'mjs', 'svg']);

function fileExtension(name) {
  const match = String(name).trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || '';
}

export function supportedVoiceReference({ name = '', type = '' } = {}) {
  const extension = fileExtension(name);
  if (UNSAFE_FILE_EXTENSIONS.has(extension)) return false;
  const mime = String(type).trim().toLowerCase().split(';', 1)[0];
  if (mime.startsWith('audio/')) return true;
  if (GENERIC_AUDIO_CONTAINERS.has(mime)) return AUDIO_EXTENSION_FALLBACKS.has(extension);
  if (!mime || mime === 'application/octet-stream') return AUDIO_EXTENSION_FALLBACKS.has(extension);
  return false;
}

export function validateVoiceProfileName(value, existingNames = []) {
  const name = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(name)) {
    return { ok: false, name, reason: 'invalid_name' };
  }
  const duplicate = existingNames.some(existing => String(existing).toLowerCase() === name.toLowerCase());
  return duplicate
    ? { ok: false, name, reason: 'duplicate_name' }
    : { ok: true, name, reason: null };
}

export function validVoiceConsentReceipt(value) {
  return value?.recorded === true && /^[a-f0-9]{64}$/i.test(String(value.noticeSha256 || ''));
}

export function validVoiceProfileDeletion(value, expectedName) {
  return typeof expectedName === 'string' && expectedName.length > 0 && value?.deleted === expectedName;
}

// How much audio a plan may submit, and what is done with it. A real
// fine-tune needs thirty minutes; below that the reference is prompted, not
// trained, so Starter is honestly zero-shot.
const FINE_TUNE_MINIMUM_SECONDS = 30 * 60;

const VOICE_PLANS = Object.freeze({
  voice_starter: {
    method: 'prompt',
    minimumSeconds: 10,
    recommendedSeconds: 120,
    maximumSeconds: 300
  },
  single: {
    method: 'train',
    minimumSeconds: 10,
    recommendedSeconds: FINE_TUNE_MINIMUM_SECONDS,
    maximumSeconds: 3600
  },
  singlePro: {
    method: 'train',
    minimumSeconds: 10,
    recommendedSeconds: FINE_TUNE_MINIMUM_SECONDS,
    maximumSeconds: 3600
  },
  payg: {
    method: 'train',
    minimumSeconds: 10,
    recommendedSeconds: FINE_TUNE_MINIMUM_SECONDS,
    maximumSeconds: 3600
  },
  full: {
    method: 'train',
    minimumSeconds: 10,
    recommendedSeconds: 2 * 3600,
    maximumSeconds: 2 * 3600
  },
  fullPro: {
    method: 'train',
    minimumSeconds: 10,
    recommendedSeconds: 2 * 3600,
    maximumSeconds: 2 * 3600
  }
});

export function voiceSampleLimits(plan) {
  return VOICE_PLANS[plan] || VOICE_PLANS.voice_starter;
}

/**
 * Prompting or training, for this plan and this much audio. A train-capable
 * plan still prompts until enough audio exists to train on.
 */
export function voiceMethod(plan, seconds) {
  const limits = voiceSampleLimits(plan);
  if (limits.method !== 'train') return 'prompt';
  const usable = Math.min(Number(seconds) || 0, limits.maximumSeconds);
  return usable >= FINE_TUNE_MINIMUM_SECONDS ? 'train' : 'prompt';
}

export { FINE_TUNE_MINIMUM_SECONDS };

// One set of thresholds for both the live meter and the take that gets stored.
// They must never disagree: telling someone their room sounds fine while they
// record, then rejecting the take afterwards, is worse than saying nothing.
export const CAPTURE_THRESHOLDS = Object.freeze({
  windowSeconds: 0.02,
  activeWindowRms: 0.012,   // a 20ms window with at least this much energy counts as speech
  clipSample: 0.995,
  minActiveFraction: 0.35,
  maxClippedFraction: 0.005,
  minSpeechRms: 0.018,
  minSeparationDb: 10,
  minQuietWindows: 5      // fewer than this and the room simply cannot be measured
});

/**
 * Turn measured capture numbers into one plain sentence, worst problem first.
 *
 * The stored assessment returns machine reason codes, which are right for a
 * contract and useless to a person mid-take. This is the same judgement in
 * words, and both the recorder and the post-take review read it, so a user is
 * never told two different things about the same recording.
 *
 * `phase` is 'room' before speaking (there should be silence) or 'take' during
 * and after (there should be speech).
 */
export function captureAdvice({ activeFraction = 0, clippedFraction = 0, separationDb = 0,
  speechRms = 0, noiseRms = 0, seconds = 0, phase = 'take' } = {}) {
  const t = CAPTURE_THRESHOLDS;
  if (phase === 'room') {
    // Judge the room on its own floor, before any speech exists to compare to.
    if (noiseRms >= 0.02) return { severity: 'blocked', message: 'This room is too loud to record in. Turn off fans or air conditioning, close a window, and try again.' };
    if (noiseRms >= 0.008) return { severity: 'warn', message: 'There is a steady hum or hiss here. It will end up underneath your voice.' };
    return { severity: 'ok', message: 'Your room is quiet enough. Start when you are ready.' };
  }
  if (clippedFraction > t.maxClippedFraction) {
    return { severity: 'blocked', message: 'You are too close to the microphone, or its gain is too high. The loud parts are being cut off.' };
  }
  if (speechRms && speechRms < t.minSpeechRms) {
    return { severity: 'blocked', message: 'Your voice is very quiet. Move closer to the microphone or raise its input level.' };
  }
  if (separationDb < t.minSeparationDb) {
    return { severity: 'blocked', message: 'Your background is too loud compared to your voice. Move somewhere quieter or closer to the microphone.' };
  }
  if (seconds && activeFraction < t.minActiveFraction) {
    return { severity: 'warn', message: 'There is more silence than speech so far. Keep talking, and leave shorter gaps.' };
  }
  if (separationDb < t.minSeparationDb + 6) {
    return { severity: 'warn', message: 'Usable, but your background is audible. Somewhere quieter would clone better.' };
  }
  return { severity: 'ok', message: 'Sounding good. Keep going.' };
}

/**
 * Rolling meter for a live capture stream. Fed 20ms frames, it reports the same
 * numbers assessVoiceReference computes over a whole file, so the advice a
 * person sees while recording matches the verdict on the take.
 */
export class CaptureMonitor {
  constructor({ phase = 'take' } = {}) {
    this.phase = phase;
    this.windows = [];
    this.clipped = 0;
    this.samples = 0;
    this.sampleRate = 0;
  }

  /** One frame of mono samples. Returns the current advice. */
  push(frame, sampleRate = 0) {
    if (sampleRate) this.sampleRate = sampleRate;
    let energy = 0;
    for (let i = 0; i < frame.length; i++) {
      const s = frame[i];
      energy += s * s;
      if (Math.abs(s) >= CAPTURE_THRESHOLDS.clipSample) this.clipped++;
    }
    this.samples += frame.length;
    if (frame.length) this.windows.push(Math.sqrt(energy / frame.length));
    return this.advice();
  }

  metrics() {
    const t = CAPTURE_THRESHOLDS;
    const active = this.windows.filter(v => v >= t.activeWindowRms);
    // Same rule as the stored assessment: the floor comes from silence only.
    const noiseRms = estimateNoiseFloor(this.windows) ?? 0;
    const speechRms = [...active].sort((a, b) => a - b)[Math.floor(active.length / 2)] || 0;
    return {
      seconds: this.sampleRate ? +(this.samples / this.sampleRate).toFixed(2) : 0,
      level: this.windows.length ? this.windows[this.windows.length - 1] : 0,
      activeFraction: active.length / Math.max(1, this.windows.length),
      clippedFraction: this.clipped / Math.max(1, this.samples),
      noiseRms,
      speechRms,
      separationDb: this.windows.length
        ? 20 * Math.log10((speechRms + 1e-8) / (noiseRms + 1e-8))
        : Infinity   // nothing recorded yet; do not cry wolf
    };
  }

  advice() {
    return { ...captureAdvice({ ...this.metrics(), phase: this.phase }), metrics: this.metrics() };
  }
}

/**
 * The level of the room when nobody is speaking.
 *
 * Prefer the windows that actually are silence. Two cases break that, and both
 * used to be wrong in opposite directions:
 *
 *  - A fluent reader who barely pauses leaves few silent windows. Taking a
 *    fixed percentile of ALL windows then measures their own voice as the room,
 *    which rejected a 40 dB-quiet take as "noisy" for being read well.
 *  - A uniformly loud room pushes even its silence above the speech threshold,
 *    leaving no silent windows at all. Calling that unmeasurable would let the
 *    noisiest rooms through, so fall back to the quietest 2% of everything,
 *    which in that case is the noise itself.
 */
function estimateNoiseFloor(windows) {
  if (!windows.length) return null;
  const t = CAPTURE_THRESHOLDS;
  const quiet = windows.filter(value => value < t.activeWindowRms).sort((a, b) => a - b);
  if (quiet.length >= t.minQuietWindows) return quiet[Math.floor(quiet.length / 2)];
  const all = [...windows].sort((a, b) => a - b);
  return all[Math.floor(all.length * 0.02)];
}

export function assessVoiceReference(buffer, options = {}) {
  const limits = voiceSampleLimits(options.plan);
  const minimumSeconds = options.minimumSeconds ?? limits.minimumSeconds;
  const recommendedSeconds = options.recommendedSeconds ?? limits.recommendedSeconds;
  const maximumSeconds = options.maximumSeconds ?? limits.maximumSeconds;
  if (!buffer || !Number.isFinite(buffer.duration) || buffer.duration < minimumSeconds) {
    return { status: 'blocked', reasons: ['reference_too_short'], advisories: [] };
  }
  const channel = buffer.getChannelData(0);
  const windowSize = Math.max(1, Math.round(buffer.sampleRate * 0.02));
  const windows = [];
  let clipped = 0;
  for (let offset = 0; offset < channel.length; offset += windowSize) {
    let energy = 0;
    const end = Math.min(channel.length, offset + windowSize);
    for (let index = offset; index < end; index++) {
      const sample = channel[index];
      energy += sample * sample;
      if (Math.abs(sample) >= 0.995) clipped++;
    }
    windows.push(Math.sqrt(energy / Math.max(1, end - offset)));
  }
  const active = windows.filter(value => value >= CAPTURE_THRESHOLDS.activeWindowRms);
  const activeFraction = active.length / Math.max(1, windows.length);
  const clippedFraction = clipped / Math.max(1, channel.length);
  // The noise floor is the level when nobody is talking, so measure it on the
  // windows where nobody is talking. This used to be the 20th percentile of ALL
  // windows, which silently became a speech level whenever someone paused for
  // less than a fifth of the take: a 40dB-quiet room measured as 0dB and the
  // take was rejected as "noisy" for the crime of being read fluently.
  const noiseFloor = estimateNoiseFloor(windows);
  const activeMedian = [...active].sort((a, b) => a - b)[Math.floor(active.length / 2)] || 0;
  const separationDb = noiseFloor === null ? null
    : 20 * Math.log10((activeMedian + 1e-8) / (noiseFloor + 1e-8));
  const reasons = [];
  if (activeFraction < CAPTURE_THRESHOLDS.minActiveFraction) reasons.push('reference_mostly_silent');
  if (clippedFraction > CAPTURE_THRESHOLDS.maxClippedFraction) reasons.push('reference_clipped');
  if (activeMedian < CAPTURE_THRESHOLDS.minSpeechRms
    || (separationDb !== null && separationDb < CAPTURE_THRESHOLDS.minSeparationDb)) reasons.push('reference_noisy_or_unclear');
  // Over the plan limit is trimmed, never rejected.
  const usableSeconds = Math.min(buffer.duration, maximumSeconds);
  const advisories = [];
  if (usableSeconds < recommendedSeconds) advisories.push('longer_sample_recommended');
  if (buffer.duration > maximumSeconds) advisories.push('sample_capped_at_plan_limit');
  return {
    status: reasons.length ? 'blocked' : 'pass', reasons, advisories,
    // The same judgement in words, so the review screen and the live meter
    // never tell a person two different things about one recording.
    advice: captureAdvice({ activeFraction, clippedFraction,
      separationDb: separationDb === null ? Infinity : separationDb,
      speechRms: activeMedian, noiseRms: noiseFloor, seconds: buffer.duration, phase: 'take' }),
    limits: { minimumSeconds, recommendedSeconds, maximumSeconds },
    metrics: {
      durationSeconds: +buffer.duration.toFixed(2), usableSeconds: +usableSeconds.toFixed(2),
      activeFraction: +activeFraction.toFixed(3),
      clippedPercent: +(clippedFraction * 100).toFixed(3),
      separationDb: separationDb === null ? null : +separationDb.toFixed(1)
    }
  };
}

export function audioBufferToWav(buffer) {
  const length = buffer.length;
  const bytes = new ArrayBuffer(44 + length * 2);
  const view = new DataView(bytes);
  const write = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); write(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data');
  view.setUint32(40, length * 2, true);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i])) * 32767, true);
  return new Blob([bytes], { type: 'audio/wav' });
}
