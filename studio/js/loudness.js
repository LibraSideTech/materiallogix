// Loudness the way a delivery target is written: ITU-R BS.1770-4 / EBU R128.
//
// The Pro meter already showed peak and RMS, which is what a mixing desk
// showed in 1995. Every platform a take is actually delivered to states its
// target in LUFS with a true-peak ceiling, and the Video path in this same
// product already measures exactly that through ffmpeg's loudnorm. This is
// the same measurement for Voice, in the browser, on the decoded buffer.
//
// Every function here is pure and takes plain Float32 PCM, so the whole
// chain is testable without a DOM or an AudioContext — and is validated
// against ffmpeg on real audio by tools/validate_loudness.mjs, because a
// passing unit test proves the arithmetic, not the measurement.

/** Channel weights G_i from BS.1770-4 table 3. Surround gets +1.5 dB; LFE is excluded. */
export const CHANNEL_WEIGHTS = Object.freeze({ left: 1.0, right: 1.0, centre: 1.0, surround: 1.41 });

/** The offset in BS.1770-4 eq. 2, which puts a reference signal at its nominal level. */
const LOUDNESS_OFFSET = -0.691;

/** Absolute gate, BS.1770-4 §2.4. Blocks quieter than this never count. */
export const ABSOLUTE_GATE_LUFS = -70;

/** Relative gate, applied below the ungated loudness of the blocks that passed the absolute gate. */
const RELATIVE_GATE_LU = -10;

const BLOCK_SECONDS = 0.4;   // momentary window, also the integrated block
const BLOCK_OVERLAP = 0.75;  // 75 %, so the step is 100 ms
const SHORT_TERM_SECONDS = 3;

/**
 * Stage 1 of the K-weighting: a high shelf standing in for the head's
 * acoustic effect. BS.1770 tabulates coefficients at 48 kHz only, so they are
 * derived here from the filter's own parameters and hold at any sample rate.
 */
export function highShelfCoefficients(sampleRate) {
  const f0 = 1681.974450955533, gainDb = 3.999843853973347, q = 0.7071752369554196;
  const k = Math.tan(Math.PI * f0 / sampleRate);
  const vh = Math.pow(10, gainDb / 20);
  const vb = Math.pow(vh, 0.499666774155);
  const a0 = 1 + k / q + k * k;
  return {
    b: [(vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0],
    a: [1, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]
  };
}

/** Stage 2: the RLB high pass, which discards rumble the ear does not weigh. */
export function highPassCoefficients(sampleRate) {
  const f0 = 38.13547087602444, q = 0.5003270373238773;
  const k = Math.tan(Math.PI * f0 / sampleRate);
  const a0 = 1 + k / q + k * k;
  return {
    b: [1, -2, 1],
    a: [1, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]
  };
}

/** Direct form I biquad. Returns a new array; the input is not touched. */
export function biquad(samples, { b, a }) {
  const out = new Float64Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = b[0] * x0 + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    out[i] = y0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
  }
  return out;
}

/** Both K-weighting stages, in order. */
export function kWeight(samples, sampleRate) {
  return biquad(biquad(samples, highShelfCoefficients(sampleRate)), highPassCoefficients(sampleRate));
}

/** Loudness in LUFS from per-channel mean squares already weighted by channel. */
export function loudnessFromMeanSquares(meanSquares, weights) {
  let sum = 0;
  for (let i = 0; i < meanSquares.length; i++) sum += (weights[i] ?? 1) * meanSquares[i];
  return sum > 0 ? LOUDNESS_OFFSET + 10 * Math.log10(sum) : -Infinity;
}

/** Weights for a channel count, following the BS.1770 layout order. */
export function weightsForChannels(count) {
  if (count <= 2) return new Array(count).fill(1);
  if (count === 3) return [1, 1, 1];
  // 5.0 / 5.1 order L R C (LFE) Ls Rs — the LFE is dropped by the caller.
  return [1, 1, 1, CHANNEL_WEIGHTS.surround, CHANNEL_WEIGHTS.surround].slice(0, count);
}

/**
 * Per-block loudness over a sliding window, the series a momentary or
 * short-term meter draws. Channels are K-weighted once, then squared.
 */
export function blockLoudness(channels, sampleRate, windowSeconds = BLOCK_SECONDS, overlap = BLOCK_OVERLAP) {
  if (!channels.length) return [];
  const weighted = channels.map(channel => kWeight(channel, sampleRate));
  const weights = weightsForChannels(channels.length);
  const windowLength = Math.max(1, Math.round(windowSeconds * sampleRate));
  const step = Math.max(1, Math.round(windowLength * (1 - overlap)));
  const total = weighted[0].length;
  if (total < windowLength) return [];
  const out = [];
  for (let start = 0; start + windowLength <= total; start += step) {
    const meanSquares = weighted.map(channel => {
      let sum = 0;
      for (let i = start; i < start + windowLength; i++) sum += channel[i] * channel[i];
      return sum / windowLength;
    });
    out.push(loudnessFromMeanSquares(meanSquares, weights));
  }
  return out;
}

/**
 * Integrated loudness with both gates, BS.1770-4 §2.4. The gating is the part
 * that makes the number mean something on speech: without it, the silences
 * between sentences drag a take several LU below where it sounds.
 */
export function integratedLoudness(channels, sampleRate) {
  if (!channels.length) return -Infinity;
  const weighted = channels.map(channel => kWeight(channel, sampleRate));
  const weights = weightsForChannels(channels.length);
  const windowLength = Math.max(1, Math.round(BLOCK_SECONDS * sampleRate));
  const step = Math.max(1, Math.round(windowLength * (1 - BLOCK_OVERLAP)));
  const total = weighted[0].length;
  if (total < windowLength) return -Infinity;

  // Keep each block's per-channel mean squares: the relative gate needs to
  // re-average the survivors, not their loudness values.
  const blocks = [];
  for (let start = 0; start + windowLength <= total; start += step) {
    const meanSquares = weighted.map(channel => {
      let sum = 0;
      for (let i = start; i < start + windowLength; i++) sum += channel[i] * channel[i];
      return sum / windowLength;
    });
    blocks.push({ meanSquares, loudness: loudnessFromMeanSquares(meanSquares, weights) });
  }

  const aboveAbsolute = blocks.filter(block => block.loudness > ABSOLUTE_GATE_LUFS);
  if (!aboveAbsolute.length) return -Infinity;

  const averageOf = set => {
    const means = new Array(channels.length).fill(0);
    for (const block of set) for (let c = 0; c < means.length; c++) means[c] += block.meanSquares[c];
    return means.map(value => value / set.length);
  };

  const relativeThreshold = loudnessFromMeanSquares(averageOf(aboveAbsolute), weights) + RELATIVE_GATE_LU;
  const aboveRelative = aboveAbsolute.filter(block => block.loudness > relativeThreshold);
  if (!aboveRelative.length) return -Infinity;
  return loudnessFromMeanSquares(averageOf(aboveRelative), weights);
}

/** Loudness range (EBU Tech 3342): the spread of the short-term distribution. */
export function loudnessRange(channels, sampleRate) {
  const shortTerm = blockLoudness(channels, sampleRate, SHORT_TERM_SECONDS, 2 / 3)
    .filter(value => value > ABSOLUTE_GATE_LUFS);
  if (shortTerm.length < 2) return 0;
  const ungated = 10 * Math.log10(shortTerm.reduce((sum, l) => sum + Math.pow(10, (l - LOUDNESS_OFFSET) / 10), 0) / shortTerm.length) + LOUDNESS_OFFSET;
  const kept = shortTerm.filter(value => value > ungated - 20).sort((x, y) => x - y);
  if (kept.length < 2) return 0;
  const at = fraction => kept[Math.min(kept.length - 1, Math.max(0, Math.round(fraction * (kept.length - 1))))];
  return Math.max(0, at(0.95) - at(0.1));
}

/**
 * Polyphase 4x sinc interpolation, the oversampling BS.1770-4 Annex 2 requires
 * before a peak can be called a true peak. A sampled peak misses the real one
 * between samples, which is exactly the overshoot a limiter has to catch.
 */
export function truePeak(samples, oversample = 4, tapsPerPhase = 12) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const phases = [];
  const centre = tapsPerPhase / 2;
  for (let p = 0; p < oversample; p++) {
    const taps = new Float64Array(tapsPerPhase);
    let sum = 0;
    for (let k = 0; k < tapsPerPhase; k++) {
      const x = k - centre + 1 - p / oversample;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      // Blackman window over the tap span, which keeps the stopband down.
      const w = 0.42 - 0.5 * Math.cos(2 * Math.PI * k / (tapsPerPhase - 1)) + 0.08 * Math.cos(4 * Math.PI * k / (tapsPerPhase - 1));
      taps[k] = sinc * w;
      sum += taps[k];
    }
    if (sum !== 0) for (let k = 0; k < tapsPerPhase; k++) taps[k] /= sum;
    phases.push(taps);
  }
  if (!peak) return 0;

  // Interpolating every sample costs seconds on a full song to re-derive a
  // number only the loudest moments can change. An interpolated value is a
  // weighted sum, so it cannot exceed the largest sample under its taps times
  // the filter's L1 gain. Any window whose samples all sit below peak / L1
  // therefore cannot beat the sample peak, whatever it interpolates to — so
  // only neighbourhoods of the loud samples are evaluated, each index once.
  // The bound comes from the taps themselves rather than an assumed overshoot,
  // which keeps this exact; a brickwalled master where every sample qualifies
  // simply walks the whole buffer, as it would have anyway.
  const l1 = Math.max(...phases.map(taps => taps.reduce((sum, tap) => sum + Math.abs(tap), 0)));
  const candidateFloor = peak / l1;
  const reach = Math.ceil(tapsPerPhase / 2) + 1;
  const evaluate = i => {
    for (let p = 1; p < oversample; p++) {
      const taps = phases[p];
      let acc = 0;
      for (let k = 0; k < tapsPerPhase; k++) {
        // Hold the edge sample rather than padding with zeros: zero padding
        // invents a step from silence at each end, and the interpolator's
        // overshoot on that step reads as a true peak that is not in the audio.
        const index = Math.min(samples.length - 1, Math.max(0, i + k - centre + 1));
        acc += taps[k] * samples[index];
      }
      const magnitude = Math.abs(acc);
      if (magnitude > peak) peak = magnitude;
    }
  };
  let next = 0;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) < candidateFloor) continue;
    const to = Math.min(samples.length - 1, i + reach);
    for (let j = Math.max(next, i - reach); j <= to; j++) evaluate(j);
    next = Math.max(next, to + 1);
  }
  return peak;
}

/** True peak in dBTP across every channel. */
export function truePeakDb(channels, oversample = 4) {
  let peak = 0;
  for (const channel of channels) peak = Math.max(peak, truePeak(channel, oversample));
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

/**
 * Where a take is actually going. Each figure is the platform's published
 * delivery target; the ceiling is the true-peak limit that goes with it.
 */
export const DELIVERY_TARGETS = Object.freeze([
  { id: 'streaming', label: 'Streaming', detail: 'Spotify, YouTube, Apple Music', lufs: -14, ceilingDbtp: -1 },
  { id: 'podcast', label: 'Podcast', detail: 'Apple Podcasts', lufs: -16, ceilingDbtp: -1 },
  { id: 'broadcast', label: 'Broadcast', detail: 'EBU R128', lufs: -23, ceilingDbtp: -1 }
]);

/** Tolerance either side of a target before a take is called off-target. */
export const TARGET_TOLERANCE_LU = 1;

/** Reads a measurement against one target: on target, how far off, and whether the ceiling held. */
export function complianceAgainst(target, { integratedLufs, truePeakDbtp }) {
  const offset = Number.isFinite(integratedLufs) ? integratedLufs - target.lufs : NaN;
  const loudnessOk = Number.isFinite(offset) && Math.abs(offset) <= TARGET_TOLERANCE_LU;
  const peakOk = !Number.isFinite(truePeakDbtp) || truePeakDbtp <= target.ceilingDbtp;
  return {
    target,
    offsetLu: offset,
    loudnessOk,
    peakOk,
    pass: loudnessOk && peakOk,
    // What to actually do about it, in the customer's terms.
    advice: !Number.isFinite(offset) ? 'No measurable programme in this take.'
      : !peakOk ? `Peaks reach ${truePeakDbtp.toFixed(1)} dBTP, above the ${target.ceilingDbtp} dBTP ceiling. Lower the limiter ceiling before export.`
      : loudnessOk ? `On target for ${target.label.toLowerCase()}.`
      : `${Math.abs(offset).toFixed(1)} LU ${offset > 0 ? 'louder' : 'quieter'} than ${target.label.toLowerCase()}. Adjust output gain by ${(-offset).toFixed(1)} dB.`
  };
}

/**
 * The whole measurement for one decoded take. This is the number a delivery
 * decision is made on, taken offline on the full buffer rather than sampled
 * from an analyser, so it is exact rather than indicative.
 */
export function measureLoudness(channels, sampleRate) {
  const usable = channels.filter(channel => channel && channel.length);
  if (!usable.length) {
    return { integratedLufs: -Infinity, shortTermMaxLufs: -Infinity, momentaryMaxLufs: -Infinity, loudnessRangeLu: 0, truePeakDbtp: -Infinity, sampleRate, channels: 0 };
  }
  const momentary = blockLoudness(usable, sampleRate, BLOCK_SECONDS, BLOCK_OVERLAP);
  const shortTerm = blockLoudness(usable, sampleRate, SHORT_TERM_SECONDS, 2 / 3);
  const finiteMax = values => {
    const finite = values.filter(Number.isFinite);
    return finite.length ? Math.max(...finite) : -Infinity;
  };
  return {
    integratedLufs: integratedLoudness(usable, sampleRate),
    shortTermMaxLufs: finiteMax(shortTerm),
    momentaryMaxLufs: finiteMax(momentary),
    loudnessRangeLu: loudnessRange(usable, sampleRate),
    truePeakDbtp: truePeakDb(usable),
    sampleRate,
    channels: usable.length
  };
}

/** Every channel of a decoded AudioBuffer, for measureLoudness. */
export function channelsOf(audioBuffer) {
  const out = [];
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) out.push(audioBuffer.getChannelData(c));
  return out;
}
