// Deterministic, local-only Voice Pro mix engine.
//
// This module deliberately has no storage or network dependency. Callers pass
// decoded PCM in and receive PCM/WAV bytes back. Preview is handled separately
// with Web Audio so imported recordings never leave the browser session.

export const VOICE_MIX_SCHEMA = 'materiallogix.voice-pro-mix.v1';
const VOICE_MIX_SAMPLE_RATE = 48000;
export const VOICE_MIX_MAX_TRACKS = 24;
export const VOICE_MIX_MAX_SECONDS = 20 * 60;

export const VOICE_MIX_ROLES = Object.freeze([
  Object.freeze({ id: 'voice', label: 'Voice' }),
  Object.freeze({ id: 'bed', label: 'Music bed' }),
  Object.freeze({ id: 'sfx', label: 'SFX' })
]);

const ROLE_IDS = new Set(VOICE_MIX_ROLES.map(role => role.id));
const finite = value => value !== null && value !== '' && Number.isFinite(Number(value));
const clamp = (value, min, max, fallback = min) => {
  const numeric = finite(value) ? Number(value) : fallback;
  return Math.min(max, Math.max(min, numeric));
};
const dbToGain = value => 10 ** (Number(value) / 20);
const gainToDb = value => value > 0 ? 20 * Math.log10(value) : -Infinity;

export function defaultVoiceMixSettings() {
  return {
    schema: VOICE_MIX_SCHEMA,
    sampleRate: VOICE_MIX_SAMPLE_RATE,
    bypassProcessing: false,
    voiceStrip: {
      bypass: false,
      highPassHz: 80,
      lowEqDb: 0,
      midEqDb: 1,
      highEqDb: -1,
      gateThresholdDb: -55,
      compressorThresholdDb: -18,
      compressorRatio: 3,
      deEsserAmount: 0.35
    },
    // A bed sits under speech, so the bed follows the voice instead of the
    // operator riding a fader for the length of the read. The defaults are how
    // a broadcast bed is normally cut: down 12 dB while anyone is talking, and
    // opened again a beat after the last word rather than the instant it ends.
    ducking: { enabled: true, depthDb: -12, thresholdDb: -38, attackMs: 18, holdMs: 220, releaseMs: 420 },
    reverb: { returnDb: -18, roomSize: 0.45 },
    master: { gainDb: 0, limiterBypass: false, truePeakCeilingDb: -1 }
  };
}

export function sanitizeVoiceMixSettings(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const defaults = defaultVoiceMixSettings();
  const strip = raw.voiceStrip && typeof raw.voiceStrip === 'object' ? raw.voiceStrip : {};
  const reverb = raw.reverb && typeof raw.reverb === 'object' ? raw.reverb : {};
  const master = raw.master && typeof raw.master === 'object' ? raw.master : {};
  const ducking = raw.ducking && typeof raw.ducking === 'object' ? raw.ducking : {};
  return {
    schema: VOICE_MIX_SCHEMA,
    sampleRate: VOICE_MIX_SAMPLE_RATE,
    bypassProcessing: raw.bypassProcessing === true,
    voiceStrip: {
      bypass: strip.bypass === true,
      highPassHz: clamp(strip.highPassHz, 20, 180, defaults.voiceStrip.highPassHz),
      lowEqDb: clamp(strip.lowEqDb, -12, 12, defaults.voiceStrip.lowEqDb),
      midEqDb: clamp(strip.midEqDb, -12, 12, defaults.voiceStrip.midEqDb),
      highEqDb: clamp(strip.highEqDb, -12, 12, defaults.voiceStrip.highEqDb),
      gateThresholdDb: clamp(strip.gateThresholdDb, -80, -20, defaults.voiceStrip.gateThresholdDb),
      compressorThresholdDb: clamp(strip.compressorThresholdDb, -40, 0, defaults.voiceStrip.compressorThresholdDb),
      compressorRatio: clamp(strip.compressorRatio, 1, 12, defaults.voiceStrip.compressorRatio),
      deEsserAmount: clamp(strip.deEsserAmount, 0, 1, defaults.voiceStrip.deEsserAmount)
    },
    ducking: {
      enabled: ducking.enabled !== false,
      depthDb: clamp(ducking.depthDb, -40, 0, defaults.ducking.depthDb),
      thresholdDb: clamp(ducking.thresholdDb, -70, -10, defaults.ducking.thresholdDb),
      attackMs: clamp(ducking.attackMs, 1, 400, defaults.ducking.attackMs),
      holdMs: clamp(ducking.holdMs, 0, 2000, defaults.ducking.holdMs),
      releaseMs: clamp(ducking.releaseMs, 20, 4000, defaults.ducking.releaseMs)
    },
    reverb: {
      returnDb: clamp(reverb.returnDb, -40, 0, defaults.reverb.returnDb),
      roomSize: clamp(reverb.roomSize, 0, 1, defaults.reverb.roomSize)
    },
    master: {
      gainDb: clamp(master.gainDb, -18, 6, defaults.master.gainDb),
      limiterBypass: master.limiterBypass === true,
      truePeakCeilingDb: clamp(master.truePeakCeilingDb, -3, -0.1, defaults.master.truePeakCeilingDb)
    }
  };
}

export function defaultVoiceMixTrack(role = 'voice') {
  const normalizedRole = ROLE_IDS.has(role) ? role : 'voice';
  return {
    role: normalizedRole,
    mute: false,
    solo: false,
    gainDb: normalizedRole === 'bed' ? -12 : 0,
    pan: 0,
    startSeconds: 0,
    reverbSend: normalizedRole === 'voice' ? 0.12 : normalizedRole === 'sfx' ? 0.18 : 0.05
  };
}

export function sanitizeVoiceMixTrack(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const defaults = defaultVoiceMixTrack(raw.role);
  return {
    role: defaults.role,
    mute: raw.mute === true,
    solo: raw.solo === true,
    gainDb: clamp(raw.gainDb, -60, 12, defaults.gainDb),
    pan: clamp(raw.pan, -1, 1, 0),
    startSeconds: clamp(raw.startSeconds, 0, VOICE_MIX_MAX_SECONDS, 0),
    reverbSend: clamp(raw.reverbSend, 0, 1, defaults.reverbSend)
  };
}

function resampleChannel(input, sourceRate, targetRate) {
  if (!(input instanceof Float32Array)) return new Float32Array(0);
  if (sourceRate === targetRate) return new Float32Array(input);
  const length = Math.max(1, Math.round(input.length * targetRate / sourceRate));
  const output = new Float32Array(length);
  const scale = sourceRate / targetRate;
  for (let index = 0; index < length; index++) {
    const source = index * scale;
    const left = Math.min(input.length - 1, Math.floor(source));
    const right = Math.min(input.length - 1, left + 1);
    const amount = source - left;
    output[index] = input[left] * (1 - amount) + input[right] * amount;
  }
  return output;
}

// Two identical one-poles in series, so the corner the control names is still
// the corner: each section is 3 dB down at its own pole, and the pair is 3 dB
// down at 1.5538 times it.
const CASCADED_ONE_POLE_CORNER = 1.5538;
// A gate that opens and shuts at one level chatters on anything that sits at
// that level, which on a voice is the room between two words. It closes 6 dB
// below where it opens, and not until it has been quiet for the hold.
const GATE_HYSTERESIS_DB = -6;
const GATE_HOLD_SECONDS = 0.045;

function processVoiceChannel(input, sampleRate, strip) {
  const output = new Float32Array(input.length);
  const highPassRc = 1 / (2 * Math.PI * (strip.highPassHz / CASCADED_ONE_POLE_CORNER));
  const highPassAlpha = highPassRc / (highPassRc + 1 / sampleRate);
  const lowAlpha = 1 - Math.exp(-2 * Math.PI * 250 / sampleRate);
  const highAlpha = 1 - Math.exp(-2 * Math.PI * 4000 / sampleRate);
  const deEssAlpha = 1 - Math.exp(-2 * Math.PI * 5200 / sampleRate);
  const lowGain = dbToGain(strip.lowEqDb);
  const midGain = dbToGain(strip.midEqDb);
  const highGain = dbToGain(strip.highEqDb);
  const gateThreshold = dbToGain(strip.gateThresholdDb);
  const gateCloseThreshold = dbToGain(strip.gateThresholdDb + GATE_HYSTERESIS_DB);
  const gateHoldSamples = Math.round(GATE_HOLD_SECONDS * sampleRate);
  const gateOpen = 1 - Math.exp(-1 / (0.004 * sampleRate));
  const gateClose = 1 - Math.exp(-1 / (0.08 * sampleRate));
  // Sibilance is a syllable, not a sample. Riding the band off its own
  // envelope reduces it smoothly; scaling it by the instantaneous magnitude
  // reshaped every cycle of it instead, which is distortion, not de-essing.
  const deEssAttack = 1 - Math.exp(-1 / (0.0015 * sampleRate));
  const deEssRelease = 1 - Math.exp(-1 / (0.045 * sampleRate));
  const envelopeAttack = 1 - Math.exp(-1 / (0.008 * sampleRate));
  const envelopeRelease = 1 - Math.exp(-1 / (0.14 * sampleRate));
  const compAttack = 1 - Math.exp(-1 / (0.012 * sampleRate));
  const compRelease = 1 - Math.exp(-1 / (0.18 * sampleRate));
  let previousInput = 0;
  let previousHighPass = 0;
  let secondInput = 0;
  let secondHighPass = 0;
  let lowState = 0;
  let highLowPass = 0;
  let deEssLowPass = 0;
  let deEssEnvelope = 0;
  let gateEnvelope = 0;
  let gateHold = 0;
  let gateIsOpen = false;
  let gateGain = 0;
  let compressorEnvelope = 0;
  let compressorGain = 1;

  for (let index = 0; index < input.length; index++) {
    const source = Number.isFinite(input[index]) ? input[index] : 0;
    const firstStage = highPassAlpha * (previousHighPass + source - previousInput);
    previousInput = source;
    previousHighPass = firstStage;
    const highPassed = highPassAlpha * (secondHighPass + firstStage - secondInput);
    secondInput = firstStage;
    secondHighPass = highPassed;

    lowState += lowAlpha * (highPassed - lowState);
    highLowPass += highAlpha * (highPassed - highLowPass);
    const high = highPassed - highLowPass;
    const mid = highPassed - lowState - high;
    let sample = lowState * lowGain + mid * midGain + high * highGain;

    deEssLowPass += deEssAlpha * (sample - deEssLowPass);
    const sibilant = sample - deEssLowPass;
    const sibilance = Math.abs(sibilant);
    deEssEnvelope += (sibilance > deEssEnvelope ? deEssAttack : deEssRelease) * (sibilance - deEssEnvelope);
    const deEssDrive = Math.min(1, Math.max(0, (deEssEnvelope - 0.018) / 0.12));
    sample -= sibilant * strip.deEsserAmount * deEssDrive * 0.82;

    const absolute = Math.abs(sample);
    gateEnvelope += (absolute > gateEnvelope ? envelopeAttack : envelopeRelease) * (absolute - gateEnvelope);
    if (gateEnvelope >= gateThreshold) { gateIsOpen = true; gateHold = gateHoldSamples; }
    else if (gateHold > 0) gateHold--;
    else if (gateEnvelope < gateCloseThreshold) gateIsOpen = false;
    const gateTarget = gateIsOpen ? 1 : 0;
    gateGain += (gateTarget > gateGain ? gateOpen : gateClose) * (gateTarget - gateGain);
    sample *= gateGain;

    const compressedAbsolute = Math.abs(sample);
    compressorEnvelope += (compressedAbsolute > compressorEnvelope ? envelopeAttack : envelopeRelease)
      * (compressedAbsolute - compressorEnvelope);
    const envelopeDb = gainToDb(compressorEnvelope);
    const overDb = Number.isFinite(envelopeDb) ? Math.max(0, envelopeDb - strip.compressorThresholdDb) : 0;
    const reductionDb = -overDb * (1 - 1 / strip.compressorRatio);
    const targetGain = dbToGain(reductionDb);
    compressorGain += (targetGain < compressorGain ? compAttack : compRelease) * (targetGain - compressorGain);
    output[index] = sample * compressorGain;
  }
  return output;
}

function channelPair(track, sampleRate, applyStrip, strip) {
  const rawChannels = Array.isArray(track.channels) ? track.channels.filter(channel => channel instanceof Float32Array) : [];
  if (!rawChannels.length) return null;
  const sourceRate = Number.isInteger(track.sampleRate) && track.sampleRate >= 8000 && track.sampleRate <= 192000
    ? track.sampleRate : sampleRate;
  const left = resampleChannel(rawChannels[0], sourceRate, sampleRate);
  const right = rawChannels[1] ? resampleChannel(rawChannels[1], sourceRate, sampleRate) : null;
  return {
    left: applyStrip ? processVoiceChannel(left, sampleRate, strip) : left,
    right: right ? (applyStrip ? processVoiceChannel(right, sampleRate, strip) : right) : null
  };
}

function samplePeak(channels) {
  let peak = 0;
  for (const channel of channels) for (let index = 0; index < channel.length; index++) {
    if (Number.isFinite(channel[index])) peak = Math.max(peak, Math.abs(channel[index]));
  }
  return peak;
}

// Summed magnitude of the Catmull-Rom basis at the three points sampled below;
// it maxes at the half-sample position. An interpolated value can therefore
// never exceed this multiple of the largest of its four source samples, which
// is what makes the gate in estimateTruePeak exact rather than a heuristic.
const CATMULL_ROM_GAIN_BOUND = 1.25;

const interpolatedMagnitude = (p0, p1, p2, p3, amount) => {
  const amount2 = amount * amount;
  const amount3 = amount2 * amount;
  return Math.abs(0.5 * ((2 * p1) + (-p0 + p2) * amount
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * amount2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * amount3));
};

/**
 * Four-times Catmull-Rom interpolation catches inter-sample overs for safety.
 *
 * Interpolating every sample of a long mix is minutes of arithmetic nobody
 * waits for, and almost all of it is spent proving that quiet passages are
 * quiet. Because the interpolator's gain is bounded, any window whose loudest
 * source sample is under peak/bound cannot reach the sample peak, let alone
 * beat it — so those windows are skipped without changing the answer.
 */
export function estimateTruePeak(channels) {
  let peak = samplePeak(channels);
  if (!(peak > 0)) return peak;
  const threshold = peak / CATMULL_ROM_GAIN_BOUND;
  for (const channel of channels) {
    const last = channel.length - 1;
    let evaluated = -1;
    for (let index = 0; index <= last; index++) {
      const value = channel[index];
      if (!(Math.abs(value) >= threshold)) continue;
      // This sample takes part in the four windows starting at index-2..index+1.
      const from = Math.max(evaluated + 1, index - 2);
      const to = Math.min(last - 1, index + 1);
      for (let window = from; window <= to; window++) {
        const before = channel[Math.max(0, window - 1)];
        const after = channel[Math.min(last, window + 2)];
        const p0 = Number.isFinite(before) ? before : 0;
        const p1 = Number.isFinite(channel[window]) ? channel[window] : 0;
        const p2 = Number.isFinite(channel[window + 1]) ? channel[window + 1] : 0;
        const p3 = Number.isFinite(after) ? after : 0;
        peak = Math.max(peak,
          interpolatedMagnitude(p0, p1, p2, p3, 0.25),
          interpolatedMagnitude(p0, p1, p2, p3, 0.5),
          interpolatedMagnitude(p0, p1, p2, p3, 0.75));
      }
      if (to >= from) evaluated = to;
    }
  }
  return peak;
}

// Eight combs and four allpasses: the density a tail needs before it stops
// sounding like a metal box. The comb delays are spread unevenly across a
// narrow band so their repeats fall between one another instead of stacking
// into a pitch, and the allpasses are shorter so they scatter arrivals into
// the gaps rather than adding any of their own.
const REVERB_COMB_SECONDS = [0.0253, 0.0269, 0.0290, 0.0307, 0.0322, 0.0338, 0.0353, 0.0367];
const REVERB_ALLPASS_SECONDS = [0.0126, 0.0100, 0.0077, 0.0051];
// The two ears do not receive the same room. Offsetting one side's delays by
// under a millisecond is what puts the tail across the image instead of down
// the middle of it.
const REVERB_STEREO_OFFSET_SECONDS = 0.00052;
// The first few arrivals, before the tail has any density: these are what say
// how big the room is. Seconds and gain, from the geometry of a small studio.
const REVERB_EARLY_TAPS = [[0.0071, 0.62], [0.0113, -0.48], [0.0179, 0.37], [0.0241, -0.29]];
// Level the send is dropped to before the comb bank, whose own recirculation
// puts most of it back. Set so a room return of 0 dB lands a first reflection
// at roughly the height the tap bank used to, and the control keeps its meaning.
const REVERB_INPUT_SCALE = 0.055;

// What "room size" means in time: a treated booth at 0, a hall at 1.
const reverbDecaySeconds = roomSize => 0.32 + roomSize * 1.55;

/**
 * One comb: the same delay fed back through a one-pole lowpass, summed into
 * `output`. The feedback is solved from the decay time, so every comb in the
 * bank fades out together however long its own delay is; the lowpass is what
 * makes the top of the tail die before the bottom of it does, as a room does.
 */
function addComb(input, output, sampleRate, delaySeconds, decaySeconds, damping) {
  const delay = Math.max(1, Math.round(delaySeconds * sampleRate));
  const feedback = 10 ** (-3 * delay / (decaySeconds * sampleRate));
  const line = new Float64Array(delay);
  let cursor = 0;
  let damped = 0;
  for (let index = 0; index < input.length; index++) {
    const delayed = line[cursor];
    output[index] += delayed;
    damped = delayed * (1 - damping) + damped * damping;
    line[cursor] = input[index] + damped * feedback;
    cursor = cursor + 1 === delay ? 0 : cursor + 1;
  }
}

/** One allpass, in place: density without colour, since its magnitude is flat. */
function applyAllpass(signal, sampleRate, delaySeconds, feedback = 0.5) {
  const delay = Math.max(1, Math.round(delaySeconds * sampleRate));
  const line = new Float64Array(delay);
  let cursor = 0;
  for (let index = 0; index < signal.length; index++) {
    const delayed = line[cursor];
    const source = signal[index];
    line[cursor] = source + delayed * feedback;
    signal[index] = delayed - source;
    cursor = cursor + 1 === delay ? 0 : cursor + 1;
  }
}

/**
 * A room, rather than a row of echoes.
 *
 * This used to be twelve fixed taps about 17 ms apart. The ear resolves
 * arrivals that far apart as separate repeats, so what it produced was
 * slapback, and it stopped dead after the twelfth: twelve clicks, no tail. A
 * room does the opposite - reflection density climbs until no single arrival
 * can be picked out, and the energy decays smoothly to nothing over a time the
 * size of the room sets.
 *
 * So the send now runs through the comb-and-allpass network Schroeder set out
 * in "Natural Sounding Artificial Reverberation" (JAES 10(3), 1962), with
 * Moorer's early reflections in front of it (Computer Music Journal 3(2),
 * 1979): eight parallel combs whose feedback is solved from the decay time,
 * then four allpasses in series that scatter what leaves them without
 * colouring it. Four taps ahead of the tail give the room its size before the
 * tail has built any density.
 */
function addAmbience(sendLeft, sendRight, outputLeft, outputRight, sampleRate, roomSize, returnDb) {
  const returnGain = dbToGain(returnDb);
  if (!(returnGain > 0)) return;
  const decaySeconds = reverbDecaySeconds(roomSize);
  // A bigger room has more air and more soft surfaces between reflections, so
  // it loses its top faster over the same number of bounces.
  const damping = 0.16 + roomSize * 0.3;
  const spread = 0.72 + roomSize * 0.72;
  const sides = [[sendLeft, outputLeft, 0], [sendRight, outputRight, REVERB_STEREO_OFFSET_SECONDS]];
  for (const [send, output, offset] of sides) {
    const length = send.length;
    const driven = new Float64Array(length);
    for (let index = 0; index < length; index++) driven[index] = send[index] * REVERB_INPUT_SCALE;
    const wet = new Float64Array(length);
    for (const seconds of REVERB_COMB_SECONDS) {
      addComb(driven, wet, sampleRate, (seconds + offset) * spread, decaySeconds, damping);
    }
    for (const seconds of REVERB_ALLPASS_SECONDS) applyAllpass(wet, sampleRate, seconds + offset);
    for (const [seconds, gain] of REVERB_EARLY_TAPS) {
      const delay = Math.max(1, Math.round((seconds + offset) * spread * sampleRate));
      for (let index = 0; index + delay < length; index++) wet[index + delay] += driven[index] * gain;
    }
    for (let index = 0; index < length; index++) output[index] += wet[index] * returnGain;
  }
}

/**
 * The gain a bed rides at, sample by sample, so speech stays on top of it.
 *
 * The key is the voice bus, not any one track: two people talking hold the bed
 * down between them instead of it surfacing in the handover. Hold is what keeps
 * it from pumping between words — the bed only starts coming back once the
 * voice has been quiet for the whole hold, so a comma does not lift it.
 */
function duckingGain(key, sampleRate, ducking) {
  const gain = new Float32Array(key.length).fill(1);
  const depth = dbToGain(ducking.depthDb);
  const threshold = dbToGain(ducking.thresholdDb);
  const detectorAttack = 1 - Math.exp(-1 / (0.005 * sampleRate));
  const detectorRelease = 1 - Math.exp(-1 / (0.06 * sampleRate));
  const attack = 1 - Math.exp(-1 / (Math.max(0.001, ducking.attackMs / 1000) * sampleRate));
  const release = 1 - Math.exp(-1 / (Math.max(0.001, ducking.releaseMs / 1000) * sampleRate));
  const holdSamples = Math.round(ducking.holdMs / 1000 * sampleRate);
  let detector = 0;
  let current = 1;
  let holding = 0;
  for (let index = 0; index < key.length; index++) {
    const level = Math.abs(key[index]);
    detector += (level > detector ? detectorAttack : detectorRelease) * (level - detector);
    if (detector >= threshold) holding = holdSamples;
    else if (holding > 0) holding--;
    const target = detector >= threshold || holding > 0 ? depth : 1;
    current += (target < current ? attack : release) * (target - current);
    gain[index] = current;
  }
  return gain;
}

// How far ahead the limiter sees, and how long it takes to let go. Far enough
// that the reduction is in place before a transient arrives, short enough that
// it is not heard as a duck; a release long enough that it does not snap back
// between two syllables of the same word.
const LIMITER_LOOKAHEAD_SECONDS = 0.0015;
const LIMITER_RELEASE_SECONDS = 0.12;

/** Minimum of `values` over [index, index + window], in one pass. */
function slidingMinimum(values, window) {
  const length = values.length;
  const output = new Float32Array(length);
  const queue = new Int32Array(length);
  let head = 0;
  let tail = 0;
  let write = 0;
  for (let right = 0; right < length; right++) {
    while (tail > head && values[queue[tail - 1]] >= values[right]) tail--;
    queue[tail++] = right;
    if (right >= window) {
      while (queue[head] < write) head++;
      output[write++] = values[queue[head]];
    }
  }
  for (; write < length; write++) {
    while (queue[head] < write) head++;
    output[write] = values[queue[head]];
  }
  return output;
}

/**
 * The gain curve that holds a true-peak ceiling, or null if nothing exceeds it.
 *
 * Scaling the whole render by ceiling/peak holds the ceiling too, and that is
 * what this stage used to do — but that is a normaliser, not a limiter. One
 * sting three seconds into a six-minute read pulled the entire read down with
 * it, and the gain reduction reported on export described something that had
 * happened to every second of the file rather than to the sting.
 *
 * The curve is built in three passes and no pass can raise it, so the ceiling
 * is held by construction rather than by hope. First the gain each sample
 * needs, extended forward by the release so it does not jump back the instant
 * a peak is past. Then a sliding minimum over the look-ahead window, so the
 * reduction is already there when the peak arrives. Then a moving average over
 * that same window, which is what makes the curve smooth instead of stepped:
 * every term of it was a minimum over a window containing this sample, so the
 * average is still never above what this sample needs.
 *
 * Only material near the ceiling is interpolated at all. The interpolator's
 * gain is bounded, so four samples all under ceiling/bound cannot reach the
 * ceiling between them, and the arithmetic is skipped over everything quiet —
 * which on a normal read is nearly all of it.
 */
function limiterGainCurve(channels, ceiling, sampleRate) {
  const length = channels[0].length;
  const required = new Float32Array(length).fill(1);
  const gate = ceiling / CATMULL_ROM_GAIN_BOUND;
  let limiting = false;
  for (const channel of channels) {
    const last = channel.length - 1;
    for (let index = 0; index <= last; index++) {
      if (!(Math.abs(channel[index]) >= gate)) continue;
      for (let window = Math.max(0, index - 2); window <= Math.min(last, index + 1); window++) {
        const p1 = channel[window];
        const p2 = channel[Math.min(last, window + 1)];
        const p0 = channel[Math.max(0, window - 1)];
        const p3 = channel[Math.min(last, window + 2)];
        const local = Math.max(Math.abs(p1), Math.abs(p2),
          interpolatedMagnitude(p0, p1, p2, p3, 0.25),
          interpolatedMagnitude(p0, p1, p2, p3, 0.5),
          interpolatedMagnitude(p0, p1, p2, p3, 0.75));
        if (!(local > ceiling)) continue;
        const needed = ceiling / local;
        // The over sits between two samples, so both of them have to come down.
        const next = Math.min(last, window + 1);
        if (needed < required[window]) required[window] = needed;
        if (needed < required[next]) required[next] = needed;
        limiting = true;
      }
    }
  }
  if (!limiting) return null;
  const release = 1 - Math.exp(-1 / (LIMITER_RELEASE_SECONDS * sampleRate));
  let held = 1;
  for (let index = 0; index < length; index++) {
    held = Math.min(required[index], held + (1 - held) * release);
    required[index] = held;
  }
  const window = Math.max(1, Math.round(LIMITER_LOOKAHEAD_SECONDS * sampleRate));
  const ahead = slidingMinimum(required, window);
  const curve = new Float32Array(length);
  let sum = 0;
  for (let index = 0; index < length; index++) {
    sum += ahead[index];
    if (index > window) sum -= ahead[index - window - 1];
    curve[index] = sum / Math.min(index + 1, window + 1);
  }
  return curve;
}

/**
 * Render every audible track into deterministic stereo PCM.
 * Track arrays are never mutated and nothing is read from outside `tracks`.
 */
export function renderVoiceMix(tracks = [], value = {}) {
  if (!Array.isArray(tracks)) throw new TypeError('Voice mix tracks must be an array.');
  if (tracks.length > VOICE_MIX_MAX_TRACKS) throw new Error(`The desk holds ${VOICE_MIX_MAX_TRACKS} tracks.`);
  const settings = sanitizeVoiceMixSettings(value);
  const sampleRate = settings.sampleRate;
  const anySolo = tracks.some(track => sanitizeVoiceMixTrack(track).solo && !sanitizeVoiceMixTrack(track).mute);
  const prepared = [];
  let baseLength = 0;
  let hasDecodedSource = false;
  for (const track of tracks) {
    const controls = sanitizeVoiceMixTrack(track);
    const rawChannels = Array.isArray(track?.channels)
      ? track.channels.filter(channel => channel instanceof Float32Array && channel.length)
      : [];
    const offset = Math.round(controls.startSeconds * sampleRate);
    if (rawChannels.length) {
      hasDecodedSource = true;
      const sourceRate = Number.isInteger(track.sampleRate) && track.sampleRate >= 8000 && track.sampleRate <= 192000
        ? track.sampleRate : sampleRate;
      const sourceFrames = Math.max(...rawChannels.slice(0, 2).map(channel => channel.length));
      baseLength = Math.max(baseLength, offset + Math.max(1, Math.round(sourceFrames * sampleRate / sourceRate)));
    }
    if (controls.mute || (anySolo && !controls.solo)) continue;
    const pair = channelPair(track, sampleRate,
      !settings.bypassProcessing && !settings.voiceStrip.bypass && controls.role === 'voice', settings.voiceStrip);
    if (!pair) continue;
    baseLength = Math.max(baseLength, offset + Math.max(pair.left.length, pair.right?.length || 0));
    prepared.push({ pair, controls, offset });
  }
  if (!hasDecodedSource) throw new Error('Add at least one track before rendering.');
  if (baseLength > sampleRate * VOICE_MIX_MAX_SECONDS) {
    throw new Error(`The desk holds ${VOICE_MIX_MAX_SECONDS / 60} minutes. This mix runs past that.`);
  }
  const roomActive = !settings.bypassProcessing && prepared.some(track => track.controls.reverbSend > 0);
  // Room enough for the tail the reverb will actually produce. Cutting it at a
  // fixed length would chop the decay off square, which is the one artefact a
  // reverb must never have.
  const tailLength = roomActive
    ? Math.round(sampleRate * (reverbDecaySeconds(settings.reverb.roomSize) + 0.12))
    : 0;
  const totalLength = baseLength + tailLength;
  const inputLeft = new Float64Array(totalLength);
  const inputRight = new Float64Array(totalLength);
  const roomLeft = roomActive ? new Float64Array(totalLength) : null;
  const roomRight = roomActive ? new Float64Array(totalLength) : null;

  // The bed rides the voice, so the voice bus has to be complete before any bed
  // is summed. Voice and SFX go down first; the key is built from the voice
  // tracks alone, and the beds follow it.
  const duckingActive = !settings.bypassProcessing && settings.ducking.enabled
    && settings.ducking.depthDb < 0
    && prepared.some(track => track.controls.role === 'bed')
    && prepared.some(track => track.controls.role === 'voice');
  const duckKey = duckingActive ? new Float64Array(totalLength) : null;

  const layTrack = ({ pair, controls, offset }, gainCurve) => {
    const trackGain = dbToGain(controls.gainDb);
    const mono = !pair.right;
    const monoAngle = (controls.pan + 1) * Math.PI / 4;
    const leftPan = mono ? Math.cos(monoAngle) : controls.pan > 0 ? Math.cos(controls.pan * Math.PI / 2) : 1;
    const rightPan = mono ? Math.sin(monoAngle) : controls.pan < 0 ? Math.cos(-controls.pan * Math.PI / 2) : 1;
    const length = Math.min(Math.max(pair.left.length, pair.right?.length || 0), totalLength - offset);
    const send = roomActive && controls.reverbSend > 0 ? controls.reverbSend : 0;
    const isVoice = controls.role === 'voice';
    for (let index = 0; index < length; index++) {
      const at = index + offset;
      const sourceLeft = Number.isFinite(pair.left[index]) ? pair.left[index] : 0;
      const sourceRight = pair.right && Number.isFinite(pair.right[index]) ? pair.right[index] : sourceLeft;
      const ride = gainCurve ? gainCurve[at] : 1;
      const left = sourceLeft * trackGain * leftPan * ride;
      const right = sourceRight * trackGain * rightPan * ride;
      inputLeft[at] += left;
      inputRight[at] += right;
      if (duckKey && isVoice) duckKey[at] += (left + right) * 0.5;
      if (send) {
        roomLeft[at] += left * send;
        roomRight[at] += right * send;
      }
    }
  };

  const beds = [];
  for (const track of prepared) {
    if (duckingActive && track.controls.role === 'bed') beds.push(track);
    else layTrack(track, null);
  }
  let duckGain = null;
  if (beds.length) {
    duckGain = duckingGain(duckKey, sampleRate, settings.ducking);
    for (const track of beds) layTrack(track, duckGain);
  }
  if (roomActive) {
    addAmbience(roomLeft, roomRight, inputLeft, inputRight, sampleRate,
      settings.reverb.roomSize, settings.reverb.returnDb);
  }

  const preMasterLeft = Float32Array.from(inputLeft);
  const preMasterRight = Float32Array.from(inputRight);
  const masterGain = dbToGain(settings.master.gainDb);
  const outputLeft = new Float32Array(totalLength);
  const outputRight = new Float32Array(totalLength);
  for (let index = 0; index < totalLength; index++) {
    outputLeft[index] = preMasterLeft[index] * masterGain;
    outputRight[index] = preMasterRight[index] * masterGain;
  }

  const beforeLimitTruePeak = estimateTruePeak([outputLeft, outputRight]);
  const limiterEnabled = !settings.bypassProcessing && !settings.master.limiterBypass;
  const ceiling = dbToGain(settings.master.truePeakCeilingDb);
  const curve = limiterEnabled && beforeLimitTruePeak > ceiling
    ? limiterGainCurve([outputLeft, outputRight], ceiling, sampleRate) : null;
  let deepestLimiterGain = 1;
  if (curve) {
    for (let index = 0; index < totalLength; index++) {
      outputLeft[index] *= curve[index];
      outputRight[index] *= curve[index];
      if (curve[index] < deepestLimiterGain) deepestLimiterGain = curve[index];
    }
  }
  let outputTruePeak = estimateTruePeak([outputLeft, outputRight]);
  // A gain that moves is not a gain that can be multiplied through the
  // interpolator, so the ceiling is verified on the finished signal rather
  // than assumed. The residue is a fraction of a decibel where the curve was
  // steepest; it is trimmed off flat rather than left to be somebody's
  // rejected delivery.
  if (curve && outputTruePeak > ceiling) {
    const trim = ceiling / outputTruePeak;
    for (let index = 0; index < totalLength; index++) {
      outputLeft[index] *= trim;
      outputRight[index] *= trim;
    }
    outputTruePeak = ceiling;
    deepestLimiterGain *= trim;
  }
  let deepestDuckDb = 0;
  if (duckGain) {
    let deepest = 1;
    for (let index = 0; index < duckGain.length; index++) if (duckGain[index] < deepest) deepest = duckGain[index];
    deepestDuckDb = gainToDb(deepest);
  }
  return {
    schema: VOICE_MIX_SCHEMA,
    sampleRate,
    channels: [outputLeft, outputRight],
    preMasterChannels: [preMasterLeft, preMasterRight],
    duration: totalLength / sampleRate,
    audibleTrackCount: prepared.length,
    duckedTrackCount: beds.length,
    stats: {
      inputPeakDb: gainToDb(samplePeak([preMasterLeft, preMasterRight])),
      preLimiterTruePeakDb: gainToDb(beforeLimitTruePeak),
      outputPeakDb: gainToDb(samplePeak([outputLeft, outputRight])),
      outputTruePeakDb: gainToDb(outputTruePeak),
      limiterGainReductionDb: gainToDb(deepestLimiterGain),
      deepestDuckDb
    },
    settings
  };
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
}

const pcm16 = sample => {
  const bounded = Math.min(1, Math.max(-1, Number.isFinite(sample) ? sample : 0));
  return bounded < 0 ? Math.round(bounded * 32768) : Math.round(bounded * 32767);
};

/** Stable PCM16 WAV: no timestamps, randomized dither, metadata, or encoder state. */
export function encodeVoiceMixWav(rendered) {
  const channels = rendered?.channels;
  const sampleRate = Math.trunc(Number(rendered?.sampleRate));
  if (!Array.isArray(channels) || channels.length !== 2
      || !(channels[0] instanceof Float32Array) || !(channels[1] instanceof Float32Array)
      || channels[0].length !== channels[1].length || sampleRate < 8000 || sampleRate > 192000) {
    throw new TypeError('A complete stereo Voice mix is required for WAV export.');
  }
  const frames = channels[0].length;
  const bytes = new ArrayBuffer(44 + frames * 4);
  const view = new DataView(bytes);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + frames * 4, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, frames * 4, true);
  for (let index = 0; index < frames; index++) {
    view.setInt16(44 + index * 4, pcm16(channels[0][index]), true);
    view.setInt16(46 + index * 4, pcm16(channels[1][index]), true);
  }
  return new Uint8Array(bytes);
}

export function voiceMixFingerprint(tracks = [], settings = {}) {
  return JSON.stringify({
    schema: VOICE_MIX_SCHEMA,
    tracks: tracks.map(track => ({
      id: String(track.id || ''),
      ...sanitizeVoiceMixTrack(track),
      sampleRate: Number(track.sampleRate) || 0,
      frames: Array.isArray(track.channels) ? track.channels[0]?.length || 0 : 0
    })),
    settings: sanitizeVoiceMixSettings(settings)
  });
}
