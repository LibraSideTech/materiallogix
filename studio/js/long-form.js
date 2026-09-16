// Long-form drift: the thing people actually complain about in generated speech.
//
// The recurring complaint across text-to-speech tools in 2026 is not that a
// sentence sounds wrong. It is that a take "sounds fine on short phrases but
// starts accumulating weirdness around the two-minute mark: rushed transitions,
// flat emphasis, missing beats". Short samples hide it, so a demo passes and a
// twenty-minute narration does not.
//
// Each of those three is measurable from the audio alone, and this reads them
// over the length of the take rather than across the whole of it at once:
//
//   flat emphasis      the short-term loudness stops varying - the read goes
//                      monotone even though nothing is technically wrong
//   missing beats      the pauses disappear, so sentences run together
//   rushed transitions the speech gets faster toward the end
//
// A whole-take number cannot see any of these, because every one of them is a
// change over time that averages away. Thresholds here are set from measured
// behaviour on real speech, not chosen; tools/validate_long_form.mjs prints
// what a clean take and a deliberately drifting one actually read.

import { ABSOLUTE_GATE_LUFS, blockLoudness } from './loudness.js';

/** Below this a take is a phrase, not long form, and the complaint does not apply. */
export const LONG_FORM_SECONDS = 60;

const WINDOW_SECONDS = 10;

/** What counts as drift. Each is measured on real speech before it is trusted; see the validator. */
export const DRIFT_THRESHOLDS = Object.freeze({
  levelDriftLu: 2,        // quieter or louder by the end than at the start
  variationDropLu: 1.5,   // how much the short-term spread may collapse
  variationRatio: 0.6,    // and how far it may fall relative to where it started
  paceDriftFraction: 0.15 // relative change in how much of the time is speech
});

const median = values => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const spread = values => {
  const finite = values.filter(value => Number.isFinite(value) && value > ABSOLUTE_GATE_LUFS);
  if (finite.length < 2) return 0;
  const sorted = [...finite].sort((a, b) => a - b);
  const at = fraction => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))))];
  return Math.max(0, at(0.9) - at(0.1));
};

/** The fraction of a stretch that carries speech, which is how pauses are counted. */
function speechFraction(samples, from, to, sampleRate) {
  const hop = Math.max(1, Math.floor(sampleRate / 100));
  const levels = [];
  for (let start = from; start + hop <= to; start += hop) {
    let sum = 0;
    for (let i = start; i < start + hop; i++) sum += samples[i] * samples[i];
    levels.push(Math.sqrt(sum / hop));
  }
  if (!levels.length) return 0;
  const active = median(levels.filter(value => value > 0)) * 0.35;
  return levels.filter(value => value > active).length / levels.length;
}

/**
 * The take in windows: how loud each stretch is, how much the delivery varies
 * inside it, and how much of it is speech rather than pause.
 */
export function windowedProfile(samples, sampleRate, windowSeconds = WINDOW_SECONDS) {
  const length = Math.max(1, Math.round(windowSeconds * sampleRate));
  const windows = [];
  for (let start = 0; start + length <= samples.length; start += length) {
    const slice = samples.subarray(start, start + length);
    const momentary = blockLoudness([slice], sampleRate).filter(value => Number.isFinite(value) && value > ABSOLUTE_GATE_LUFS);
    windows.push({
      atSeconds: Math.round(start / sampleRate),
      loudnessLufs: momentary.length ? median(momentary) : -Infinity,
      variationLu: spread(momentary),
      speechFraction: speechFraction(samples, start, start + length, sampleRate)
    });
  }
  return windows;
}

/**
 * Drift across the take: the difference between how it starts and how it ends.
 * Reported whether or not it crosses a threshold, so the numbers are readable
 * before anything is flagged.
 */
export function measureDrift(samples, sampleRate) {
  const seconds = samples.length / sampleRate;
  if (seconds < LONG_FORM_SECONDS) {
    return { longForm: false, seconds, windows: [] };
  }
  const windows = windowedProfile(samples, sampleRate);
  if (windows.length < 3) return { longForm: false, seconds, windows };

  const third = Math.max(1, Math.floor(windows.length / 3));
  const first = windows.slice(0, third);
  const last = windows.slice(-third);
  const half = Math.max(1, Math.floor(windows.length / 2));
  const firstHalf = windows.slice(0, half);
  const secondHalf = windows.slice(-half);

  const loudnessOf = set => median(set.map(w => w.loudnessLufs).filter(value => Number.isFinite(value) && value > ABSOLUTE_GATE_LUFS));
  const startLoudness = loudnessOf(first);
  const endLoudness = loudnessOf(last);
  const startVariation = median(firstHalf.map(w => w.variationLu));
  const endVariation = median(secondHalf.map(w => w.variationLu));
  const startPace = median(first.map(w => w.speechFraction));
  const endPace = median(last.map(w => w.speechFraction));

  return {
    longForm: true,
    seconds,
    windows,
    levelDriftLu: Number.isFinite(startLoudness) && Number.isFinite(endLoudness) ? endLoudness - startLoudness : 0,
    startVariationLu: startVariation,
    endVariationLu: endVariation,
    variationDropLu: startVariation - endVariation,
    startSpeechFraction: startPace,
    endSpeechFraction: endPace,
    paceDriftFraction: startPace > 0 ? (endPace - startPace) / startPace : 0
  };
}

/** Drift in the customer's terms, with where it starts and what to do. */
export function driftFlags(drift) {
  if (!drift.longForm) return [];
  const flags = [];
  const at = () => {
    // Name the point the take starts to go, so the fix has somewhere to begin.
    const half = Math.floor(drift.windows.length / 2);
    return drift.windows[half]?.atSeconds ?? 0;
  };

  if (Math.abs(drift.levelDriftLu) > DRIFT_THRESHOLDS.levelDriftLu) {
    const quieter = drift.levelDriftLu < 0;
    flags.push({
      id: 'level-drift', severity: 'warn',
      text: `The read gets ${quieter ? 'quieter' : 'louder'} as it goes — ${Math.abs(drift.levelDriftLu).toFixed(1)} LU ${quieter ? 'down' : 'up'} by the end.`,
      fix: 'Split the script and render it in shorter passages, then join them. Level drift builds up over a long single pass.'
    });
  }

  if (drift.variationDropLu > DRIFT_THRESHOLDS.variationDropLu
      && drift.endVariationLu < drift.startVariationLu * DRIFT_THRESHOLDS.variationRatio) {
    flags.push({
      id: 'flat-emphasis', severity: 'warn',
      text: `The delivery flattens after about ${at()} seconds — the emphasis range falls from ${drift.startVariationLu.toFixed(1)} to ${drift.endVariationLu.toFixed(1)} LU.`,
      fix: 'This is the long-form monotone. Render in passages of a minute or two, or add explicit emphasis direction to the later part of the script.'
    });
  }

  if (Math.abs(drift.paceDriftFraction) > DRIFT_THRESHOLDS.paceDriftFraction) {
    const faster = drift.paceDriftFraction > 0;
    flags.push({
      id: faster ? 'rushing' : 'dragging', severity: 'warn',
      text: faster
        ? `The pace tightens toward the end — ${Math.round(Math.abs(drift.paceDriftFraction) * 100)}% less pause than at the start, so sentences run together.`
        : `The pace loosens toward the end — ${Math.round(Math.abs(drift.paceDriftFraction) * 100)}% more pause than at the start.`,
      fix: faster
        ? 'Punctuation is being read more lightly as the take goes on. Break the script at paragraph boundaries and render each separately.'
        : 'Check for stray line breaks or ellipses late in the script; they lengthen the pauses the engine takes.'
    });
  }
  return flags;
}

/** Drift and its flags for one take. */
export function analyseLongForm(samples, sampleRate) {
  const drift = measureDrift(samples, sampleRate);
  return { ...drift, flags: driftFlags(drift) };
}
