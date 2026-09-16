// The physical defects in a take, measured in the browser.
//
// tools/ear.py already measures all of this and more, but it needs Praat,
// Resemblyzer, librosa and a neural MOS model, and it reaches the app only
// through a local bridge endpoint that does not exist yet. These four are the
// ones reproducible with nothing but the decoded audio, and they are the ones
// that say a take is physically broken rather than merely unflattering:
// clipping, room echo and its tail, mains hum, and mid-speech dropouts.
//
// Every definition here follows ear.py's deliberately, thresholds included, so
// the two agree on the same file. tools/validate_take_defects.mjs runs both and
// compares; the numbers in that comparison are the only reason to trust these.
// Speaker identity, pitch behaviour and the neural rating stay in the engine.

/** In-place iterative radix-2 FFT. Real input is supplied as re with im zeroed. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = -2 * Math.PI / len;
    const wRe = Math.cos(angle), wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const aRe = re[i + k], aIm = im[i + k];
        const bRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const bIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = aRe + bRe; im[i + k] = aIm + bIm;
        re[i + k + len / 2] = aRe - bRe; im[i + k + len / 2] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

const nextPowerOfTwo = value => { let n = 1; while (n < value) n <<= 1; return n; };

/**
 * Clipping: a meaningful share of samples pinned at the file's own extreme
 * only happens when the waveform was flattened against a ceiling.
 */
export function clippingRatio(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) { const v = Math.abs(samples[i]); if (v > peak) peak = v; }
  if (!peak) return 0;
  const limit = peak * 0.995;
  let pinned = 0;
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) >= limit) pinned++;
  return pinned / samples.length;
}

/** RMS energy at a 10 ms hop, the envelope both time-domain measurements read. */
function envelope(samples, sampleRate) {
  const hop = Math.max(1, Math.floor(sampleRate / 100));
  const frames = Math.floor(samples.length / hop);
  const env = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) sum += samples[i] * samples[i];
    env[f] = Math.sqrt(sum / hop);
  }
  return { env, hop, frames };
}

const median = values => {
  if (!values.length) return 0;
  const sorted = Float64Array.from(values).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Which frames carry speech, by ear.py's rule: above 35 % of the median non-silent frame. */
function activeFrames(env) {
  const nonZero = Array.from(env).filter(value => value > 0);
  const threshold = nonZero.length ? median(nonZero) * 0.35 : 0;
  return Array.from(env, value => value > threshold);
}

/**
 * Echo: a delayed copy of the signal shows up as a spike in the waveform's own
 * autocorrelation at exactly the delay. Real speech decorrelates within tens of
 * milliseconds, so anything substantial between 60 and 350 ms is a copy.
 */
export function echoCorrelation(samples, sampleRate) {
  const n = Math.min(samples.length, sampleRate * 10);
  if (n < sampleRate * 0.4) return 0;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += samples[i];
  mean /= n;
  const size = nextPowerOfTwo(2 * n);
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let i = 0; i < n; i++) re[i] = samples[i] - mean;
  fft(re, im);
  // Power spectrum, then back: the Wiener-Khinchin route to autocorrelation.
  for (let i = 0; i < size; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
  fft(re, im);
  const zero = re[0];
  if (!zero) return 0;
  const lo = Math.floor(0.06 * sampleRate);
  const hi = Math.min(Math.floor(0.35 * sampleRate), n - 1);
  let peak = 0;
  for (let lag = lo; lag < hi; lag++) {
    const value = Math.abs(re[lag] / zero);
    if (value > peak) peak = value;
  }
  return peak;
}

/**
 * Reverb tail: once speech stops, how long energy takes to fall to a tenth of
 * its active level. A dry take dies in well under 200 ms.
 */
export function reverbDecayMs(samples, sampleRate) {
  const { env, frames } = envelope(samples, sampleRate);
  const active = activeFrames(env);
  const activeLevels = Array.from(env).filter((_, index) => active[index]);
  if (!activeLevels.length) return 0;
  const floor = median(activeLevels) * 0.1;
  const decays = [];
  let i = 1;
  while (i < frames - 1) {
    if (active[i - 1] && !active[i]) {
      let j = i;
      while (j < frames && env[j] > floor && (j - i) * 10 < 900) j++;
      if (j < frames) decays.push((j - i) * 10);
      i = j;
    }
    i++;
  }
  return decays.length ? Math.round(median(decays)) : 0;
}

/**
 * The power spectrum of a stretch of audio, Hann-windowed, first half only.
 * Exported because the seam check reads timbre from it and duplicating an FFT
 * to answer a second question about the same audio is how two answers drift.
 */
export function spectrum(samples) {
  const n = Math.min(samples.length, 1 << 16);
  if (n < 64) return new Float64Array(0);
  const size = nextPowerOfTwo(n);
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let i = 0; i < n; i++) re[i] = samples[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
  fft(re, im);
  const bins = size / 2;
  const power = new Float64Array(bins);
  for (let i = 0; i < bins; i++) power[i] = re[i] * re[i] + im[i] * im[i];
  return power;
}

/**
 * Mains hum: electrical hum is a narrow, stable spectral line standing out
 * against its own neighbourhood. Comparing it to the distant speech band would
 * confuse a bass voice with a bad mic chain, so each candidate is measured
 * against the 16 Hz either side of it, which is register-invariant.
 */
export function mainsHum(samples, sampleRate) {
  const n = Math.min(samples.length, sampleRate * 10);
  if (n < sampleRate) return { humHz: 60, humDb: 0 };
  const size = nextPowerOfTwo(n);
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let i = 0; i < n; i++) re[i] = samples[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
  fft(re, im);
  const bins = size / 2;
  const power = new Float64Array(bins);
  for (let i = 0; i < bins; i++) power[i] = re[i] * re[i] + im[i] * im[i];
  const perHz = size / sampleRate;
  const band = (lo, hi) => {
    let sum = 0;
    const from = Math.max(0, Math.ceil(lo * perHz)), to = Math.min(bins - 1, Math.floor(hi * perHz));
    for (let i = from; i <= to; i++) sum += power[i];
    return sum;
  };
  let best = { humHz: 60, humDb: -Infinity };
  for (const f of [50, 60, 100, 120]) {
    const core = band(f - 2, f + 2) / 4;
    const ring = (band(Math.max(0.1, f - 20), f - 4) + band(f + 4, f + 20)) / 32;
    const prominence = 10 * Math.log10(Math.max(core, 1e-15) / Math.max(ring, 1e-15));
    if (prominence > best.humDb) best = { humHz: f, humDb: prominence };
  }
  return { humHz: best.humHz, humDb: Math.round(best.humDb * 10) / 10 };
}

/**
 * Dropouts: a 20-150 ms collapse with speech on both sides. Fluent speech dips
 * quiet constantly at stop consonants, so quiet alone cannot mean broken — a
 * genuine dropout is near bit-exact digital silence where speech should be.
 */
export function dropouts(samples, sampleRate) {
  const { env, hop, frames } = envelope(samples, sampleRate);
  const active = activeFrames(env);
  const activeLevels = Array.from(env).filter((_, index) => active[index]);
  if (!activeLevels.length) return 0;
  const level = median(activeLevels);
  const silenceEpsilon = 12 / 32767; // 12 LSB at 16-bit: above dither, far below the quietest real consonant closure.
  let count = 0, i = 0;
  while (i < frames) {
    if (env[i] < level * 0.06) {
      let j = i;
      while (j < frames && env[j] < level * 0.06) j++;
      const before = active.slice(Math.max(0, i - 2), i).some(Boolean);
      const after = active.slice(j, j + 2).some(Boolean);
      let loudest = 0;
      for (let s = i * hop; s < Math.min(samples.length, j * hop); s++) {
        const v = Math.abs(samples[s]);
        if (v > loudest) loudest = v;
      }
      if ((j - i) >= 2 && (j - i) <= 15 && before && after && loudest < silenceEpsilon) count++;
      i = j;
    } else i++;
  }
  return count;
}

/** The thresholds ear.py flags on, so the same take reads the same either side. */
export const DEFECT_THRESHOLDS = Object.freeze({
  clipRatio: 0.001,
  echoCorrelation: 0.18,
  decayMs: 280,
  humDb: 10,
  dropouts: 0
});

/** Each defect in the customer's terms, and what to do about it. */
export function defectFlags(measured) {
  const flags = [];
  if (measured.clipRatio > DEFECT_THRESHOLDS.clipRatio) {
    flags.push({ id: 'clipping', severity: 'bad', text: `Clipping on ${(measured.clipRatio * 100).toFixed(2)}% of samples — the peaks are flattened and distorted.`, fix: 'Lower the input or the limiter ceiling and record the take again.' });
  }
  if (measured.echoCorrelation > DEFECT_THRESHOLDS.echoCorrelation) {
    flags.push({ id: 'echo', severity: 'bad', text: `A delayed copy of the voice is audible (correlation ${measured.echoCorrelation.toFixed(3)}).`, fix: 'Move away from hard walls, or turn off any room or processing echo.' });
  }
  if (measured.decayMs > DEFECT_THRESHOLDS.decayMs) {
    flags.push({ id: 'reverb', severity: 'warn', text: `The room rings for ${measured.decayMs} ms after speech stops.`, fix: 'Record somewhere softer — curtains, a rug, a wardrobe. A dry take dies inside 200 ms.' });
  }
  if (measured.humDb > DEFECT_THRESHOLDS.humDb) {
    flags.push({ id: 'hum', severity: 'bad', text: `Mains hum at ${measured.humHz} Hz, ${measured.humDb} dB above its neighbours.`, fix: 'Change the cable or the socket, and keep the mic away from power supplies.' });
  }
  if (measured.dropouts > DEFECT_THRESHOLDS.dropouts) {
    flags.push({ id: 'dropouts', severity: 'bad', text: `${measured.dropouts} dropout${measured.dropouts === 1 ? '' : 's'} mid-speech — audio is missing, not just quiet.`, fix: 'Render the take again; if it repeats, the buffer or the engine dropped output.' });
  }
  return flags;
}

/** Every browser-measurable defect for one take, with the flags they raise. */
export function analyseTakeDefects(samples, sampleRate) {
  const hum = mainsHum(samples, sampleRate);
  const measured = {
    clipRatio: Math.round(clippingRatio(samples) * 1e5) / 1e5,
    echoCorrelation: Math.round(echoCorrelation(samples, sampleRate) * 1000) / 1000,
    decayMs: reverbDecayMs(samples, sampleRate),
    humHz: hum.humHz,
    humDb: hum.humDb,
    dropouts: dropouts(samples, sampleRate)
  };
  return { ...measured, flags: defectFlags(measured) };
}
