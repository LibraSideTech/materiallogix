export const MUSIC_PROJECT_SCHEMA = 'materiallogix.music-project.v1';
export const MUSIC_SAMPLE_RATE = 48_000;
// The most tracks a project can structurally hold, independent of tier —
// currently equal to Pro's add-time ceiling (see js/pricing.js:MUSIC_TIERS),
// but a distinct concept: this bounds what sanitizeMusicProject preserves
// on load; the tier ceiling bounds what a customer may add. A tier
// downgrade must never destroy tracks a customer already built — the
// ceiling is checked when a track is ADDED, not when a project is opened.
export const MUSIC_TRACK_STRUCTURAL_MAX = 64;

export const MUSIC_TRACK_TYPES = Object.freeze([
  Object.freeze({ id: 'vocal', label: 'Vocal' }),
  Object.freeze({ id: 'instrument', label: 'Instrument' }),
  Object.freeze({ id: 'beat', label: 'Beat' }),
  Object.freeze({ id: 'audio', label: 'Audio' })
]);

const TYPE_IDS = new Set(MUSIC_TRACK_TYPES.map(type => type.id));
const finite = value => Number.isFinite(Number(value));
const clamp = (value, min, max, fallback = min) => {
  const number = finite(value) ? Number(value) : fallback;
  return Math.min(max, Math.max(min, number));
};

const id = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;

export function newMusicProject(name = 'Untitled song', tier = 'standard') {
  const now = new Date().toISOString();
  return {
    schema: MUSIC_PROJECT_SCHEMA,
    id: id('music'),
    name: String(name || 'Untitled song').trim().slice(0, 120) || 'Untitled song',
    tier: tier === 'pro' ? 'pro' : 'standard',
    bpm: 120,
    timeSignature: [4, 4],
    key: 'C major',
    snap: '1/4',
    // No region until one is marked. An end beat here would arm a loop the
    // customer never chose and draw a band they never dragged.
    loop: { enabled: false, startBeat: 0, endBeat: 0 },
    metronome: { enabled: false, countInBars: 1 },
    tracks: [],
    createdAt: now,
    updatedAt: now,
    revision: 1
  };
}

export function createMusicTrack(type = 'audio', name = '') {
  const normalized = TYPE_IDS.has(type) ? type : 'audio';
  return {
    id: id('track'),
    type: normalized,
    name: String(name || MUSIC_TRACK_TYPES.find(entry => entry.id === normalized)?.label || 'Audio').slice(0, 120),
    gainDb: normalized === 'beat' ? -6 : 0,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    color: normalized === 'vocal' ? '#c9a86a' : normalized === 'beat' ? '#9c6b45' : '#8a8378',
    effects: {
      // A new track must reproduce its source without adding ambience,
      // breaths, reverb, or tonal processing. The user opts into a preset.
      bypass: true,
      highPassHz: normalized === 'vocal' ? 80 : 20,
      lowEqDb: 0,
      midEqDb: 0,
      highEqDb: 0,
      compressorAmount: normalized === 'vocal' ? 0.35 : 0.12,
      reverbSend: 0
    },
    clips: []
  };
}

export function createMusicClip({ assetId, name = 'Audio', duration, start = 0, offset = 0, sourceDuration = duration, playbackRate = 1 } = {}) {
  if (!assetId) throw new Error('A music clip needs a saved audio asset.');
  const rate = clamp(playbackRate, 0.25, 4, 1);
  const boundedSource = clamp(sourceDuration, 0.001, 6 * 60 * 60, duration || 1);
  const boundedOffset = clamp(offset, 0, Math.max(0, boundedSource - 0.001), 0);
  // Timeline length is source length divided by speed: a clip at half speed
  // covers twice the timeline for the same audio. Clamping against the raw
  // source length would truncate every slowed-down clip on the next save.
  const available = (boundedSource - boundedOffset) / rate;
  const boundedDuration = clamp(duration, 0.001, available, available);
  return {
    id: id('clip'),
    assetId: String(assetId),
    name: String(name || 'Audio').slice(0, 160),
    start: clamp(start, 0, 24 * 60 * 60, 0),
    offset: boundedOffset,
    duration: boundedDuration,
    sourceDuration: boundedSource,
    gainDb: 0,
    fadeIn: 0,
    fadeOut: 0,
    // Varispeed: resampling moves pitch with speed, the way tape did. There is
    // no separate transpose, because nothing here can shift pitch independently
    // of time, and a field that says otherwise would be a promise the renderer
    // does not keep.
    playbackRate: rate,
    loop: false
  };
}

/** Beats in a bar — the top of the time signature. */
export function beatsPerBar(project) {
  return clamp(project?.timeSignature?.[0], 1, 12, 4);
}

/**
 * How long one beat lasts. Tempo is quoted in quarter notes per minute, so the
 * beat unit comes from the bottom of the time signature: in 6/8 the beat is an
 * eighth and lasts half as long as it would in 6/4 at the same tempo. Reading
 * only the top of the signature made every meter sound like 4/4.
 */
export function secondsPerBeat(project) {
  const unit = [2, 4, 8, 16].includes(Number(project?.timeSignature?.[1])) ? Number(project.timeSignature[1]) : 4;
  return (60 / clamp(project?.bpm, 30, 300, 120)) * (4 / unit);
}

export function beatsToSeconds(beats, bpm = 120) {
  return clamp(beats, 0, 1_000_000, 0) * 60 / clamp(bpm, 30, 300, 120);
}

export function secondsToBeats(seconds, bpm = 120) {
  return clamp(seconds, 0, 24 * 60 * 60, 0) * clamp(bpm, 30, 300, 120) / 60;
}

export function snapSeconds(seconds, bpm = 120, division = '1/4') {
  const divisions = { '1/1': 4, '1/2': 2, '1/4': 1, '1/8': 0.5, '1/16': 0.25, off: 0 };
  const beatStep = divisions[division] ?? 1;
  if (!beatStep) return Math.max(0, Number(seconds) || 0);
  const step = beatsToSeconds(beatStep, bpm);
  return Math.max(0, Math.round((Number(seconds) || 0) / step) * step);
}

export function splitMusicClip(clip, atSeconds) {
  const at = Number(atSeconds);
  if (!finite(at) || at <= clip.start || at >= clip.start + clip.duration) {
    throw new Error('Place the playhead inside the clip before splitting.');
  }
  const leftDuration = at - clip.start;
  const rightDuration = clip.duration - leftDuration;
  const left = {
    ...clip,
    id: id('clip'),
    duration: leftDuration,
    fadeIn: Math.min(clip.fadeIn || 0, leftDuration),
    fadeOut: Math.min(clip.fadeOut || 0, leftDuration)
  };
  const right = {
    ...clip,
    id: id('clip'),
    start: at,
    offset: clip.offset + leftDuration * (clip.playbackRate || 1),
    duration: rightDuration,
    fadeIn: Math.min(clip.fadeIn || 0, rightDuration),
    fadeOut: Math.min(clip.fadeOut || 0, rightDuration)
  };
  return [left, right];
}

export function trimMusicClip(clip, { start = clip.start, end = clip.start + clip.duration } = {}) {
  const originalStart = clip.start;
  const originalEnd = clip.start + clip.duration;
  const nextStart = clamp(start, originalStart, originalEnd - 0.001, originalStart);
  const nextEnd = clamp(end, nextStart + 0.001, originalEnd, originalEnd);
  const removed = nextStart - originalStart;
  const duration = nextEnd - nextStart;
  return {
    ...clip,
    start: nextStart,
    offset: clip.offset + removed * (clip.playbackRate || 1),
    duration,
    fadeIn: Math.min(clip.fadeIn || 0, duration),
    fadeOut: Math.min(clip.fadeOut || 0, duration)
  };
}

export function duplicateMusicClip(clip, start = clip.start + clip.duration) {
  return { ...clip, id: id('clip'), start: Math.max(0, Number(start) || 0) };
}

export function projectDuration(project) {
  return Math.max(0, ...(project?.tracks || []).flatMap(track => (track.clips || []).map(clip => clip.start + clip.duration)));
}

/**
 * Read a stored project back safely. The entitled tier is an argument because
 * the stored file cannot be trusted to declare it: this read the tier out of
 * the project's own JSON, so anyone who edited their saved project to say
 * "pro" raised their own track cap. The file describes what was made; the
 * licence decides what is allowed, and absent a licence this fails closed.
 */
export function sanitizeMusicProject(value, entitledTier = 'standard') {
  if (!value || typeof value !== 'object') throw new Error('That music project is not readable.');
  const tier = entitledTier === 'pro' ? 'pro' : 'standard';
  const project = newMusicProject(value.name, tier);
  project.id = String(value.id || project.id);
  project.bpm = clamp(value.bpm, 30, 300, 120);
  const signature = Array.isArray(value.timeSignature) ? value.timeSignature : [4, 4];
  project.timeSignature = [clamp(signature[0], 1, 12, 4), [2, 4, 8, 16].includes(Number(signature[1])) ? Number(signature[1]) : 4];
  project.key = String(value.key || 'C major').slice(0, 32);
  project.snap = ['1/1', '1/2', '1/4', '1/8', '1/16', 'off'].includes(value.snap) ? value.snap : '1/4';
  project.loop = {
    enabled: value.loop?.enabled === true,
    startBeat: clamp(value.loop?.startBeat, 0, 100_000, 0),
    endBeat: clamp(value.loop?.endBeat, 0, 100_000, 0)
  };
  // An end at or before the start means no region, which is a state a project
  // is allowed to be in. This used to invent a four-beat loop instead, so every
  // project carried a section nobody had marked.
  if (project.loop.endBeat <= project.loop.startBeat) {
    project.loop.endBeat = project.loop.startBeat;
    project.loop.enabled = false;
  }
  project.metronome = {
    enabled: value.metronome?.enabled === true,
    countInBars: clamp(value.metronome?.countInBars, 0, 4, 1)
  };
  // Loading preserves; it does not enforce. A tier ceiling belongs on the
  // path that ADDS a track, not here — a customer who built past today's
  // ceiling (the free preview allows it on purpose) must never have tracks
  // destroyed by a licence change or a tier that later moved. This still
  // rejects a hand-edited file's implausible track count, but at the
  // structural maximum every tier already has to render and mix, not at
  // whatever a saved tier claims.
  project.tracks = (Array.isArray(value.tracks) ? value.tracks : []).slice(0, MUSIC_TRACK_STRUCTURAL_MAX).map(raw => {
    const track = createMusicTrack(raw.type, raw.name);
    track.id = String(raw.id || track.id);
    track.gainDb = clamp(raw.gainDb, -60, 12, 0);
    track.pan = clamp(raw.pan, -1, 1, 0);
    track.mute = raw.mute === true;
    track.solo = raw.solo === true;
    track.armed = raw.armed === true;
    track.color = /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : track.color;
    track.effects = {
      bypass: raw.effects?.bypass === true,
      highPassHz: clamp(raw.effects?.highPassHz, 20, 240, track.effects.highPassHz),
      lowEqDb: clamp(raw.effects?.lowEqDb, -12, 12, 0),
      midEqDb: clamp(raw.effects?.midEqDb, -12, 12, 0),
      highEqDb: clamp(raw.effects?.highEqDb, -12, 12, 0),
      compressorAmount: clamp(raw.effects?.compressorAmount, 0, 1, track.effects.compressorAmount),
      reverbSend: clamp(raw.effects?.reverbSend, 0, 1, 0)
    };
    // createMusicClip mints a fresh id and default envelope, which is right for
    // a new clip and wrong for one being read back: a save that renamed every
    // clip would orphan the selection, and one that dropped these fields would
    // quietly undo the fade or loop the customer just set.
    track.clips = (Array.isArray(raw.clips) ? raw.clips : []).slice(0, 256).map(rawClip => {
      const clip = createMusicClip(rawClip);
      clip.id = String(rawClip.id || clip.id);
      clip.gainDb = clamp(rawClip.gainDb, -60, 12, 0);
      clip.fadeIn = clamp(rawClip.fadeIn, 0, clip.duration, 0);
      clip.fadeOut = clamp(rawClip.fadeOut, 0, clip.duration, 0);
      clip.loop = rawClip.loop === true;
      return clip;
    });
    return track;
  });
  project.createdAt = String(value.createdAt || project.createdAt);
  project.updatedAt = String(value.updatedAt || new Date().toISOString());
  project.revision = Math.max(1, Math.floor(Number(value.revision) || 1));
  return project;
}

export function analyzeMusicOutput(channels = [], sampleRate = MUSIC_SAMPLE_RATE) {
  if (!Array.isArray(channels) || !channels.length || !channels.every(channel => channel instanceof Float32Array)) {
    throw new Error('Music output analysis needs decoded PCM channels.');
  }
  const length = Math.max(...channels.map(channel => channel.length));
  let peak = 0;
  let clipped = 0;
  let sum = 0;
  let dc = 0;
  let samples = 0;
  for (const channel of channels) {
    for (const sample of channel) {
      const value = Number.isFinite(sample) ? sample : 0;
      peak = Math.max(peak, Math.abs(value));
      if (Math.abs(value) >= 0.999) clipped++;
      sum += value * value;
      dc += value;
      samples++;
    }
  }
  const rms = Math.sqrt(sum / Math.max(1, samples));
  return {
    sampleRate,
    channelCount: channels.length,
    duration: length / sampleRate,
    peakDbfs: peak ? 20 * Math.log10(peak) : -Infinity,
    rmsDbfs: rms ? 20 * Math.log10(rms) : -Infinity,
    clippedSamples: clipped,
    dcOffset: dc / Math.max(1, samples),
    deliverable: clipped === 0 && peak <= 0.999 && Math.abs(dc / Math.max(1, samples)) < 0.02
  };
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
}

export function encodeMusicWav(channels, sampleRate = MUSIC_SAMPLE_RATE, bitDepth = 24) {
  if (!Array.isArray(channels) || ![1, 2].includes(channels.length) || !channels.every(channel => channel instanceof Float32Array)) {
    throw new Error('WAV export needs one or two PCM channels.');
  }
  if (![16, 24].includes(bitDepth)) throw new Error('WAV export supports 16-bit or 24-bit PCM.');
  const frames = Math.max(...channels.map(channel => channel.length));
  const bytesPerSample = bitDepth / 8;
  const dataSize = frames * channels.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels.length * bytesPerSample, true);
  view.setUint16(32, channels.length * bytesPerSample, true);
  view.setUint16(34, bitDepth, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (const channel of channels) {
      const sample = Math.max(-1, Math.min(1, Number.isFinite(channel[frame]) ? channel[frame] : 0));
      if (bitDepth === 16) {
        view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
        offset += 2;
      } else {
        const integer = Math.round(sample < 0 ? sample * 8_388_608 : sample * 8_388_607);
        view.setUint8(offset, integer & 0xff);
        view.setUint8(offset + 1, (integer >> 8) & 0xff);
        view.setUint8(offset + 2, (integer >> 16) & 0xff);
        offset += 3;
      }
    }
  }
  return buffer;
}
