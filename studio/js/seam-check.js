// Do the joins flow? A take is already cut and pasted before anyone hears it.
//
// The voice engine never renders a script in one pass. It calls the model once
// per phrase, trims each result's own leading and trailing silence, applies a
// 10 ms fade to both ends, appends the pause the performance plan asked for,
// and concatenates. Every take is therefore a stitch, and nothing until now
// checked the stitching.
//
// Four things go wrong at a join, and each is measurable from the audio:
//
//   level step    the phrase after the pause is louder or quieter than the one
//                 before it, so two halves of a sentence sound like two takes
//   timbre step   the voice changes character across the join - a different
//                 room, or no longer the same speaker
//   click         the fade failed and the waveform steps, which is audible as
//                 a tick even when both phrases are fine
//   pause drift   the gaps are not the gaps the direction asked for. This one
//                 has bitten before: pauses measured 913 ms on a shipped take
//                 where the plan asked for 420-800, which is most of what
//                 "slightly too slow" meant.
//
// A phrase is compared to a phrase, never an edge to an edge. Speech decays
// into a pause and ramps out of one, so measuring the 200 ms either side of a
// gap compares a fade-out against an onset and reports a 10 dB step on a take
// that is perfectly even. The comparison here is each phrase's own body, with
// its fades trimmed off.
//
// Thresholds are set from measured behaviour on real speech with known faults
// injected, not chosen; tools/validate_seams.mjs prints what a clean stitch and
// a deliberately broken one actually read.

import { spectrum } from './take-defects.js';

const HOP_SECONDS = 0.01;
/** Skipped at each end of a phrase, so a fade is never mistaken for a level. */
const EDGE_FRAMES = 6;
/** Timbre is read in frames fixed in time, so the measure does not move with sample rate. */
const CENTROID_FRAME_SECONDS = 0.05;
const CENTROID_FRAMES = 40;

/** What counts as a bad join. Each measured on real speech before it is trusted. */
export const SEAM_THRESHOLDS = Object.freeze({
  levelStepDb: 3.5,        // a step this big reads as two different takes
  // Relative shift in spectral centre across a join. Real phrases from one
  // voice differ: the same clean take reads 9-20% at 24, 44.1 and 48 kHz. An
  // injected character change reads 67-119%. 35 sits between the two with
  // margin on both sides rather than at the edge of normal speech.
  timbreStepPercent: 35,
  clickRatio: 9,           // boundary jump against the take's own typical jump
  pauseErrorFraction: 0.3, // how far the gaps may sit from the direction
  minPauseMs: 120          // shorter than this is a breath, not a join
});

const median = values => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** RMS at a 10 ms hop, the envelope the joins are found in. */
function envelope(samples, sampleRate) {
  const hop = Math.max(1, Math.round(sampleRate * HOP_SECONDS));
  const frames = Math.floor(samples.length / hop);
  const env = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) sum += samples[i] * samples[i];
    env[f] = Math.sqrt(sum / hop);
  }
  return { env, hop, frames };
}

/**
 * The take as phrases and the gaps between them. A gap with speech on both
 * sides is a join; leading and trailing silence are not, and a consonant
 * closure is too short to be one.
 */
function segmentTake(samples, sampleRate, minPauseMs) {
  const { env, hop, frames } = envelope(samples, sampleRate);
  const speaking = Array.from(env).filter(value => value > 0);
  if (!speaking.length) return { env, hop, phrases: [], joins: [] };
  // Well under a consonant closure, so a stop is never mistaken for a join.
  const quiet = median(speaking) * 0.12;

  // A phrase breaks only at a real pause. Speech dips below any sensible
  // threshold constantly, at every stop consonant, so splitting on every dip
  // produces syllable fragments and then compares one fragment's level to
  // another's - which is how a perfectly even take reported a 20 dB step.
  const minFrames = Math.max(1, Math.round(minPauseMs / (HOP_SECONDS * 1000)));
  const quietRuns = [];
  let index = 0;
  while (index < frames) {
    if (env[index] <= quiet) {
      const from = index;
      while (index < frames && env[index] <= quiet) index++;
      quietRuns.push({ fromFrame: from, toFrame: index });
    } else index++;
  }
  const gaps = quietRuns.filter(run => run.toFrame - run.fromFrame >= minFrames);

  const spans = [];
  let cursor = 0;
  for (const gap of gaps) {
    if (gap.fromFrame > cursor) spans.push({ fromFrame: cursor, toFrame: gap.fromFrame });
    cursor = gap.toFrame;
  }
  if (cursor < frames) spans.push({ fromFrame: cursor, toFrame: frames });
  const phrases = spans.filter(span => {
    for (let f = span.fromFrame; f < span.toFrame; f++) if (env[f] > quiet) return true;
    return false;
  });

  const joins = gaps
    .filter(gap => gap.fromFrame > 0 && gap.toFrame < frames)
    .map(gap => ({
      atSeconds: Number(((gap.fromFrame * hop) / sampleRate).toFixed(2)),
      pauseMs: Math.round((gap.toFrame - gap.fromFrame) * HOP_SECONDS * 1000),
      before: phrases.filter(phrase => phrase.toFrame <= gap.fromFrame).pop() || null,
      after: phrases.find(phrase => phrase.fromFrame >= gap.toFrame) || null,
      boundarySamples: [gap.fromFrame * hop, gap.toFrame * hop]
    }))
    .filter(join => join.before && join.after);

  return { env, hop, phrases, joins };
}

/** Every pause with speech on both sides. */
export function findJoins(samples, sampleRate, { minPauseMs = SEAM_THRESHOLDS.minPauseMs } = {}) {
  return segmentTake(samples, sampleRate, minPauseMs).joins
    .map(({ atSeconds, pauseMs }) => ({ atSeconds, pauseMs }));
}

/** A phrase's own frames, with its fades trimmed off. */
function body(phrase) {
  if (!phrase) return null;
  const length = phrase.toFrame - phrase.fromFrame;
  const trim = length > EDGE_FRAMES * 3 ? EDGE_FRAMES : 0;
  return { fromFrame: phrase.fromFrame + trim, toFrame: phrase.toFrame - trim };
}

/** How loud a phrase is, in dB, read from the middle of it. */
function phraseDb(env, phrase) {
  const span = body(phrase);
  if (!span || span.toFrame <= span.fromFrame) return -Infinity;
  const level = median(Array.from(env.slice(span.fromFrame, span.toFrame)));
  return level > 0 ? 20 * Math.log10(level) : -Infinity;
}

/**
 * Where a phrase's energy sits, in Hz: the cheap, stable read on timbre.
 *
 * Read as the median of many short frames spread across the phrase, rather
 * than one transform of the whole thing. A single window has to be capped
 * somewhere, and a cap in samples is a different amount of speech at every
 * sample rate - the same take measured 12% across a join at 24 kHz and 67% at
 * 48 kHz, because at the higher rate one phrase fitted inside the cap and its
 * neighbour was truncated. Frames fixed in milliseconds make the reading the
 * same audio at any rate, and the median makes it robust to where in a phrase
 * the bright syllables happen to fall.
 */
function phraseCentroidHz(samples, sampleRate, hop, phrase) {
  const span = body(phrase);
  if (!span) return 0;
  const from = span.fromFrame * hop, to = Math.min(samples.length, span.toFrame * hop);
  const frame = Math.max(256, Math.round(sampleRate * CENTROID_FRAME_SECONDS));
  if (to - from < frame * 2) return 0;
  const count = Math.min(CENTROID_FRAMES, Math.floor((to - from) / frame));
  const stride = count > 1 ? Math.floor((to - from - frame) / (count - 1)) : 0;
  const readings = [];
  for (let index = 0; index < count; index++) {
    const start = from + index * stride;
    const power = spectrum(samples.subarray(start, start + frame));
    if (!power.length) continue;
    const perBin = sampleRate / (power.length * 2);
    let weighted = 0, total = 0;
    for (let bin = 1; bin < power.length; bin++) {
      weighted += bin * perBin * power[bin];
      total += power[bin];
    }
    if (total > 0) readings.push(weighted / total);
  }
  return readings.length ? median(readings) : 0;
}

/** The take's own typical sample-to-sample jump, which a click has to beat. */
function typicalDelta(samples) {
  const stride = Math.max(1, Math.floor(samples.length / 40000));
  const deltas = [];
  for (let i = stride; i < samples.length; i += stride) deltas.push(Math.abs(samples[i] - samples[i - 1]));
  if (!deltas.length) return 0;
  const sorted = deltas.sort((a, b) => a - b);
  // The 95th percentile rather than the median: speech is mostly quiet, and a
  // click has to stand out against the loud parts, not against the pauses.
  return sorted[Math.min(sorted.length - 1, Math.round(sorted.length * 0.95))] || 0;
}

/** The largest single-sample step within a few ms of a boundary. */
function boundaryStep(samples, at, sampleRate) {
  const span = Math.max(2, Math.round(sampleRate * 0.003));
  const start = Math.max(1, Math.floor(at - span)), stop = Math.min(samples.length, Math.floor(at + span));
  let worst = 0;
  for (let i = start; i < stop; i++) worst = Math.max(worst, Math.abs(samples[i] - samples[i - 1]));
  return worst;
}

/**
 * Every join in the take, measured. `plannedPausesMs` is optional: when the
 * performance plan is available the gaps are compared to what it asked for,
 * which is the only way to catch pauses that are consistent but wrong.
 */
export function measureSeams(samples, sampleRate, { plannedPausesMs = null } = {}) {
  const { env, hop, joins } = segmentTake(samples, sampleRate, SEAM_THRESHOLDS.minPauseMs);
  const reference = typicalDelta(samples);

  const seams = joins.map(join => {
    const beforeDb = phraseDb(env, join.before);
    const afterDb = phraseDb(env, join.after);
    const beforeHz = phraseCentroidHz(samples, sampleRate, hop, join.before);
    const afterHz = phraseCentroidHz(samples, sampleRate, hop, join.after);
    const step = Math.max(
      boundaryStep(samples, join.boundarySamples[0], sampleRate),
      boundaryStep(samples, join.boundarySamples[1], sampleRate)
    );
    return {
      atSeconds: join.atSeconds,
      pauseMs: join.pauseMs,
      levelStepDb: Number.isFinite(beforeDb) && Number.isFinite(afterDb) ? Number((afterDb - beforeDb).toFixed(2)) : 0,
      timbreStepPercent: beforeHz > 0 && afterHz > 0
        ? Number((Math.abs(afterHz - beforeHz) / beforeHz * 100).toFixed(1)) : 0,
      clickRatio: reference > 0 ? Number((step / reference).toFixed(2)) : 0
    };
  });

  // The gaps are judged against the direction only when they line up one to
  // one. A planned pause can fail to become a join - two phrases butting
  // together, or a gap too short to count - and comparing ragged lists in
  // order would then measure each gap against the wrong instruction and
  // report a drift that is not there. Better to say nothing than to say that.
  const alignsToPlan = Array.isArray(plannedPausesMs)
    && plannedPausesMs.length > 0 && plannedPausesMs.length === seams.length;
  let pauseErrorFraction = 0;
  if (alignsToPlan) {
    const errors = [];
    for (let i = 0; i < seams.length; i++) {
      const planned = Number(plannedPausesMs[i]);
      if (planned > 0) errors.push((seams[i].pauseMs - planned) / planned);
    }
    pauseErrorFraction = Number(median(errors).toFixed(3));
  }

  return {
    seams,
    joinCount: seams.length,
    worstLevelStepDb: seams.length ? Math.max(...seams.map(seam => Math.abs(seam.levelStepDb))) : 0,
    worstTimbreStepPercent: seams.length ? Math.max(...seams.map(seam => seam.timbreStepPercent)) : 0,
    worstClickRatio: seams.length ? Math.max(...seams.map(seam => seam.clickRatio)) : 0,
    medianPauseMs: seams.length ? Math.round(median(seams.map(seam => seam.pauseMs))) : 0,
    pauseErrorFraction,
    comparedToPlan: alignsToPlan
  };
}

/** A bad join in the customer's terms, naming where it is and what to do. */
export function seamFlags(measured) {
  const flags = [];
  const worstOf = key => measured.seams.reduce(
    (worst, seam) => (worst === null || Math.abs(seam[key]) > Math.abs(worst[key]) ? seam : worst), null);

  if (measured.worstLevelStepDb > SEAM_THRESHOLDS.levelStepDb) {
    const seam = worstOf('levelStepDb');
    flags.push({
      id: 'seam-level', severity: 'warn',
      text: `Two phrases do not match in level at ${seam.atSeconds}s — a ${Math.abs(seam.levelStepDb).toFixed(1)} dB step across the pause.`,
      fix: 'The join sounds like two takes spliced together. Re-render that line, or even out the levels before export.'
    });
  }
  if (measured.worstTimbreStepPercent > SEAM_THRESHOLDS.timbreStepPercent) {
    const seam = worstOf('timbreStepPercent');
    flags.push({
      id: 'seam-timbre', severity: 'warn',
      text: `The voice changes character at ${seam.atSeconds}s — the tone shifts ${seam.timbreStepPercent.toFixed(0)}% across the join.`,
      fix: 'Something changed mid-take: a different voice profile, a different room, or a pitch direction pushed too far on one line.'
    });
  }
  if (measured.worstClickRatio > SEAM_THRESHOLDS.clickRatio) {
    const seam = worstOf('clickRatio');
    flags.push({
      id: 'seam-click', severity: 'bad',
      text: `There is a click at the join at ${seam.atSeconds}s — the waveform steps instead of fading.`,
      fix: 'Render the take again. If it repeats, the fade between phrases is not being applied.'
    });
  }
  if (measured.comparedToPlan && Math.abs(measured.pauseErrorFraction) > SEAM_THRESHOLDS.pauseErrorFraction) {
    const longer = measured.pauseErrorFraction > 0;
    flags.push({
      id: 'pause-drift', severity: 'warn',
      text: `The gaps are ${Math.round(Math.abs(measured.pauseErrorFraction) * 100)}% ${longer ? 'longer' : 'shorter'} than the direction asks for — ${measured.medianPauseMs} ms typical.`,
      fix: longer
        ? 'The read will feel slow. Shorten the pauses in the direction, or check that the engine is trimming its own trailing silence.'
        : 'The read will feel rushed. Lengthen the pauses in the direction so the phrases have room to land.'
    });
  }
  return flags;
}

/** Every join in one take, with the flags they raise. */
export function analyseSeams(samples, sampleRate, options = {}) {
  const measured = measureSeams(samples, sampleRate, options);
  return { ...measured, flags: seamFlags(measured) };
}
