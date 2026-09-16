import { MUSIC_SAMPLE_RATE, analyzeMusicOutput, projectDuration } from './music.js';
import { biquad, integratedLoudness, truePeakDb } from './loudness.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const dbToGain = value => Math.pow(10, clamp(value, -60, 12) / 20);

function sourceSample(source, channelIndex, position, loop) {
  const channels = source?.channels;
  if (!Array.isArray(channels) || !channels.length) return 0;
  const channel = channels[Math.min(channelIndex, channels.length - 1)];
  if (!(channel instanceof Float32Array) || !channel.length) return 0;
  let samplePosition = position;
  if (loop) samplePosition = ((samplePosition % channel.length) + channel.length) % channel.length;
  if (samplePosition < 0 || samplePosition >= channel.length - 1) return channel[Math.floor(samplePosition)] || 0;
  const left = Math.floor(samplePosition);
  const fraction = samplePosition - left;
  return channel[left] * (1 - fraction) + channel[left + 1] * fraction;
}

function fadeGain(clip, elapsed) {
  const fadeIn = Math.min(clip.duration, Math.max(0, Number(clip.fadeIn) || 0));
  const fadeOut = Math.min(clip.duration, Math.max(0, Number(clip.fadeOut) || 0));
  let value = 1;
  if (fadeIn && elapsed < fadeIn) value *= elapsed / fadeIn;
  const remaining = clip.duration - elapsed;
  if (fadeOut && remaining < fadeOut) value *= remaining / fadeOut;
  return clamp(value, 0, 1);
}

// Second-order sections from the RBJ cookbook, normalised so a0 is 1. The
// first pass at this used one-pole filters throughout: a 6 dB/octave low cut
// that still passes most of what it is asked to remove, and "EQ" bands split by
// subtraction rather than filtered. These are the shapes a mixing desk has.
function shelfOrPeak(kind, sampleRate, frequency, gainDb, q = 0.707) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = 2 * Math.PI * Math.min(frequency, sampleRate * 0.45) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const twoRootA = 2 * Math.sqrt(A) * alpha;
  let b, a;
  if (kind === 'lowShelf') {
    b = [A * ((A + 1) - (A - 1) * cos + twoRootA), 2 * A * ((A - 1) - (A + 1) * cos), A * ((A + 1) - (A - 1) * cos - twoRootA)];
    a = [(A + 1) + (A - 1) * cos + twoRootA, -2 * ((A - 1) + (A + 1) * cos), (A + 1) + (A - 1) * cos - twoRootA];
  } else if (kind === 'highShelf') {
    b = [A * ((A + 1) + (A - 1) * cos + twoRootA), -2 * A * ((A - 1) + (A + 1) * cos), A * ((A + 1) + (A - 1) * cos - twoRootA)];
    a = [(A + 1) - (A - 1) * cos + twoRootA, 2 * ((A - 1) - (A + 1) * cos), (A + 1) - (A - 1) * cos - twoRootA];
  } else if (kind === 'peaking') {
    b = [1 + alpha * A, -2 * cos, 1 - alpha * A];
    a = [1 + alpha / A, -2 * cos, 1 - alpha / A];
  } else {
    b = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
    a = [1 + alpha, -2 * cos, 1 - alpha];
  }
  return { b: b.map(value => value / a[0]), a: [1, a[1] / a[0], a[2] / a[0]] };
}

function highPass(channel, cutoff, sampleRate) {
  if (!cutoff || cutoff <= 20) return channel;
  // Cascaded to 24 dB/octave. A low cut that leaves the rumble audible is not
  // a low cut, and one pole leaves most of it.
  const section = shelfOrPeak('highPass', sampleRate, cutoff, 0, 0.54);
  const wider = shelfOrPeak('highPass', sampleRate, cutoff, 0, 1.31);
  return biquad(biquad(channel, section), wider);
}

/** Low shelf, mid bell, high shelf — the three a channel strip actually has. */
function equalize(channel, effects, sampleRate) {
  const lowDb = clamp(effects.lowEqDb, -12, 12);
  const midDb = clamp(effects.midEqDb, -12, 12);
  const highDb = clamp(effects.highEqDb, -12, 12);
  let out = channel;
  if (lowDb) out = biquad(out, shelfOrPeak('lowShelf', sampleRate, 180, lowDb));
  if (midDb) out = biquad(out, shelfOrPeak('peaking', sampleRate, 1200, midDb, 0.9));
  if (highDb) out = biquad(out, shelfOrPeak('highShelf', sampleRate, 6000, highDb));
  return out;
}

/**
 * A compressor, rather than the waveshaper that stood here before. The old one
 * mapped each sample's magnitude through a fixed curve with no detector and no
 * time constants, which is distortion: it changed timbre instead of dynamics.
 *
 * This is feed-forward with a peak detector, a soft knee, and separate attack
 * and release, and the detector is stereo-linked so the image cannot wander
 * when one side triggers. Gain is computed in decibels and smoothed there.
 */
function compressLinked(channels, amount, sampleRate) {
  const mix = clamp(amount, 0, 1);
  if (!mix) return channels;
  // One knob has to land somewhere musical: gentle levelling at the bottom of
  // the range, firm control at the top.
  const thresholdDb = -6 - mix * 22;
  const ratio = 1.5 + mix * 5.5;
  const kneeDb = 6;
  const attack = Math.exp(-1 / (sampleRate * (0.05 - mix * 0.042)));
  const release = Math.exp(-1 / (sampleRate * (0.36 - mix * 0.2)));
  // Give back roughly what the threshold took, so the knob does not double as
  // a volume control.
  const makeup = dbToGain(Math.max(0, -thresholdDb * (1 - 1 / ratio) * 0.55));
  const length = Math.max(...channels.map(channel => channel.length));
  const out = channels.map(channel => new Float32Array(channel.length));
  let envelopeDb = 0;
  for (let index = 0; index < length; index++) {
    let peak = 0;
    for (const channel of channels) peak = Math.max(peak, Math.abs(channel[index] || 0));
    const levelDb = 20 * Math.log10(peak + 1e-9);
    const over = levelDb - thresholdDb;
    let excess;
    if (over <= -kneeDb / 2) excess = 0;
    else if (over >= kneeDb / 2) excess = over;
    else excess = (over + kneeDb / 2) * (over + kneeDb / 2) / (2 * kneeDb);
    const targetDb = -excess * (1 - 1 / ratio);
    const coefficient = targetDb < envelopeDb ? attack : release;
    envelopeDb = targetDb + (envelopeDb - targetDb) * coefficient;
    const gain = dbToGain(envelopeDb) * makeup;
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
      out[channelIndex][index] = (channels[channelIndex][index] || 0) * gain;
    }
  }
  return out;
}

/**
 * A Schroeder room: four parallel combs feeding two allpass sections, which is
 * a decaying diffuse tail. What was here before was two fixed taps at 43 and
 * 89 ms — audible as two distinct slapback echoes, not a room.
 */
function addRoom(channel, amount, sampleRate, spread = 0) {
  const mix = clamp(amount, 0, 0.65);
  if (!mix) return channel;
  const combs = [0.0297, 0.0371, 0.0411, 0.0437].map(seconds => Math.max(1, Math.round((seconds + spread) * sampleRate)));
  const allpasses = [0.005, 0.0017].map(seconds => Math.max(1, Math.round(seconds * sampleRate)));
  const feedback = 0.77;
  const wet = new Float64Array(channel.length);
  for (const size of combs) {
    const buffer = new Float64Array(size);
    let cursor = 0;
    for (let index = 0; index < channel.length; index++) {
      const delayed = buffer[cursor];
      buffer[cursor] = channel[index] + delayed * feedback;
      wet[index] += delayed;
      cursor = cursor + 1 === size ? 0 : cursor + 1;
    }
  }
  for (let index = 0; index < wet.length; index++) wet[index] /= combs.length;
  for (const size of allpasses) {
    const buffer = new Float64Array(size);
    let cursor = 0;
    for (let index = 0; index < wet.length; index++) {
      const delayed = buffer[cursor];
      const input = wet[index];
      buffer[cursor] = input + delayed * 0.5;
      wet[index] = delayed - input * 0.5;
      cursor = cursor + 1 === size ? 0 : cursor + 1;
    }
  }
  const output = new Float32Array(channel.length);
  for (let index = 0; index < channel.length; index++) {
    output[index] = channel[index] * (1 - mix * 0.3) + wet[index] * mix;
  }
  return output;
}

function processTrack(channels, effects, sampleRate) {
  if (!effects || effects.bypass !== false) return channels;
  const cut = channels.map(channel => highPass(channel, clamp(effects.highPassHz, 20, 240), sampleRate));
  const shaped = cut.map(channel => equalize(channel, effects, sampleRate));
  const levelled = compressLinked(shaped, effects.compressorAmount, sampleRate);
  // A hair of extra delay on the right side keeps the tail from collapsing to
  // the middle the way an identical reverb on both channels does.
  return levelled.map((channel, index) => addRoom(channel, effects.reverbSend, sampleRate, index === 1 ? 0.0011 : 0));
}

/**
 * Render an arrangement into stereo PCM. `assets` is a Map-like object whose
 * values are `{ sampleRate, channels: Float32Array[] }`. Rendering is clean by
 * default: no noise, breaths, room tone, reverb, or limiter is inserted.
 */
export function renderMusicProject(project, assets, { sampleRate = MUSIC_SAMPLE_RATE, maxSeconds = 20 * 60, durationSeconds } = {}) {
  const duration = Math.min(maxSeconds, Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : projectDuration(project));
  const frames = Math.ceil(duration * sampleRate);
  const master = [new Float32Array(frames), new Float32Array(frames)];
  const tracks = Array.isArray(project?.tracks) ? project.tracks : [];
  const hasSolo = tracks.some(track => track.solo === true);

  for (const track of tracks) {
    if (track.mute || (hasSolo && !track.solo)) continue;
    const staged = [new Float32Array(frames), new Float32Array(frames)];
    for (const clip of track.clips || []) {
      const source = typeof assets?.get === 'function' ? assets.get(clip.assetId) : assets?.[clip.assetId];
      if (!source?.channels?.length) throw new Error(`Missing audio for clip ${clip.name || clip.id}.`);
      const sourceRate = Number(source.sampleRate) || sampleRate;
      const rate = clamp(clip.playbackRate || 1, 0.25, 4);
      const startFrame = Math.max(0, Math.round(clip.start * sampleRate));
      const endFrame = Math.min(frames, Math.ceil((clip.start + clip.duration) * sampleRate));
      const clipGain = dbToGain(clip.gainDb || 0);
      for (let frame = startFrame; frame < endFrame; frame++) {
        const elapsed = (frame - startFrame) / sampleRate;
        const sourceSeconds = (Number(clip.offset) || 0) + elapsed * rate;
        const sourcePosition = sourceSeconds * sourceRate;
        const envelope = fadeGain(clip, elapsed) * clipGain;
        staged[0][frame] += sourceSample(source, 0, sourcePosition, clip.loop) * envelope;
        staged[1][frame] += sourceSample(source, source.channels.length > 1 ? 1 : 0, sourcePosition, clip.loop) * envelope;
      }
    }

    const processed = processTrack(staged, track.effects, sampleRate);
    const gain = dbToGain(track.gainDb || 0);
    const pan = clamp(track.pan, -1, 1);
    const leftGain = gain * Math.cos((pan + 1) * Math.PI / 4);
    const rightGain = gain * Math.sin((pan + 1) * Math.PI / 4);
    for (let frame = 0; frame < frames; frame++) {
      master[0][frame] += processed[0][frame] * leftGain;
      master[1][frame] += processed[1][frame] * rightGain;
    }
  }

  return { sampleRate, channels: master, analysis: analyzeMusicOutput(master, sampleRate) };
}

/**
 * One track alone, over the whole project's timeline so a stem set lines up
 * when the parts are opened side by side. Mute and solo set elsewhere are
 * ignored: a stem set is the arrangement, part by part, not the current
 * monitoring state.
 */
export function renderMusicStem(project, trackId, assets, options = {}) {
  const track = (Array.isArray(project?.tracks) ? project.tracks : []).find(item => item.id === trackId);
  if (!track) throw new Error('That track is not in this project.');
  const alone = { ...project, tracks: [{ ...track, mute: false, solo: false }] };
  return renderMusicProject(alone, assets, { ...options, durationSeconds: projectDuration(project) });
}

/**
 * Put a finished mix on the level its destination publishes, instead of
 * leaving it wherever the faders happened to sum. Gain only — no limiter, so
 * what comes out is what went in, moved. When the true-peak ceiling and the
 * loudness target disagree the ceiling wins and the shortfall is reported:
 * a mix over the ceiling is rejected on delivery, a quiet one is only quiet.
 */
export function normalizeToTarget(channels, sampleRate = MUSIC_SAMPLE_RATE, { targetLufs = -14, ceilingDbtp = -1 } = {}) {
  if (!Array.isArray(channels) || !channels.length) throw new Error('Loudness normalization needs PCM channels.');
  const measured = integratedLoudness(channels, sampleRate);
  if (!Number.isFinite(measured)) {
    return {
      channels: channels.map(channel => new Float32Array(channel)),
      appliedDb: 0, integratedLufs: -Infinity, truePeakDbtp: -Infinity,
      targetLufs, ceilingDbtp, onTarget: false, heldBackDb: 0
    };
  }
  const wanted = targetLufs - measured;
  // Measured once. A constant gain scales the interpolated waveform by exactly
  // that gain, so the peak after is the peak before plus the decibels applied —
  // re-scanning the output would cost seconds on a full song to learn nothing.
  const peakBefore = truePeakDb(channels);
  const applied = Math.min(wanted, ceilingDbtp - peakBefore);
  const scale = Math.pow(10, applied / 20);
  const out = channels.map(channel => Float32Array.from(channel, sample => sample * scale));
  const integratedLufs = measured + applied;
  return {
    channels: out,
    appliedDb: applied,
    integratedLufs,
    truePeakDbtp: peakBefore + applied,
    targetLufs,
    ceilingDbtp,
    onTarget: Math.abs(integratedLufs - targetLufs) <= 1,
    heldBackDb: Math.max(0, wanted - applied)
  };
}

export function peakNormalize(channels, targetDbfs = -1) {
  if (!Array.isArray(channels) || !channels.length) throw new Error('Normalization needs PCM channels.');
  let peak = 0;
  for (const channel of channels) for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  if (!peak) return channels.map(channel => new Float32Array(channel));
  const target = Math.pow(10, clamp(targetDbfs, -12, -0.1) / 20);
  const scale = Math.min(1, target / peak);
  return channels.map(channel => Float32Array.from(channel, sample => sample * scale));
}
