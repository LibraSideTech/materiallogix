// Pure, deterministic state and analysis helpers for the local Video Pro editor.
// Media bytes stay with the caller; this module contains no storage or transport.

export const VIDEO_TIMELINE_SCHEMA = 'materiallogix.video-timeline.v1';
const VIDEO_TIMELINE_TRACKS = 3;
export const VIDEO_TIMELINE_MAX_CLIPS = 24;
const VIDEO_TIMELINE_MAX_SECONDS = 2 * 60 * 60;

const finite = value => value !== '' && value !== null && Number.isFinite(Number(value));
const clamp = (value, min, max, fallback = min) => Math.min(max, Math.max(min, finite(value) ? Number(value) : fallback));
const clone = value => structuredClone(value);
const allowedRotation = value => [0, 90, 180, 270].includes(Number(value)) ? Number(value) : 0;
const idText = value => String(value || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 96);

export function hasVideoProEntitlement(license) {
  if (!license || typeof license !== 'object' || String(license.plan || '').startsWith('suspended:')) return false;
  if (license.plan === 'fullPro') return true;
  const selected = license.selected_product || license.selectedProduct;
  return license.plan === 'singlePro' && selected === 'video';
}

export function defaultVideoTimeline() {
  return {
    schema: VIDEO_TIMELINE_SCHEMA,
    revision: 1,
    playhead: 0,
    selectedClipId: '',
    overlays: { safeArea: true, grid: false },
    clips: []
  };
}

export function clipOutputDuration(clip) {
  const start = clamp(clip?.sourceStart, 0, VIDEO_TIMELINE_MAX_SECONDS, 0);
  const end = clamp(clip?.sourceEnd, start, VIDEO_TIMELINE_MAX_SECONDS, start);
  const speed = clamp(clip?.speed, 0.5, 2, 1);
  return Math.max(0, (end - start) / speed);
}

export function createVideoTimelineClip(asset, options = {}) {
  const duration = clamp(asset?.duration, 0, VIDEO_TIMELINE_MAX_SECONDS, 0);
  if (!idText(asset?.id) || duration <= 0) throw new Error('Choose a decoded video with a measurable duration.');
  const id = idText(options.id);
  if (!id) throw new Error('A stable local clip ID is required.');
  return {
    id,
    assetId: idText(asset.id),
    name: String(asset.filename || 'Video clip').replace(/[\r\n\t]/g, ' ').trim().slice(0, 160) || 'Video clip',
    sourceDuration: duration,
    sourceStart: 0,
    sourceEnd: duration,
    timelineStart: clamp(options.timelineStart, 0, VIDEO_TIMELINE_MAX_SECONDS, 0),
    track: Math.round(clamp(options.track, 0, VIDEO_TIMELINE_TRACKS - 1, 0)),
    muted: false,
    gainDb: 0,
    speed: 1,
    rotation: 0,
    transition: 'cut',
    transitionDuration: 0,
    fadeIn: 0,
    fadeOut: 0,
    keyframes: [{ time: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, gainDb: 0 }]
  };
}

function sanitizeKeyframe(value, duration) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    time: clamp(raw.time, 0, duration, 0),
    x: clamp(raw.x, -100, 100, 0),
    y: clamp(raw.y, -100, 100, 0),
    scale: clamp(raw.scale, 1, 4, 1),
    rotation: clamp(raw.rotation, -180, 180, 0),
    opacity: clamp(raw.opacity, 0, 1, 1),
    gainDb: clamp(raw.gainDb, -60, 12, 0)
  };
}

function sanitizeVideoTimelineClip(value, knownAssets = null) {
  const raw = value && typeof value === 'object' ? value : {};
  const id = idText(raw.id);
  const assetId = idText(raw.assetId);
  if (!id || !assetId) return null;
  const asset = knownAssets instanceof Map ? knownAssets.get(assetId) : null;
  if (knownAssets instanceof Map && !asset) return null;
  const sourceDuration = clamp(asset?.duration ?? raw.sourceDuration, 0, VIDEO_TIMELINE_MAX_SECONDS, 0);
  if (sourceDuration <= 0) return null;
  const sourceStart = clamp(raw.sourceStart, 0, Math.max(0, sourceDuration - 0.04), 0);
  const sourceEnd = clamp(raw.sourceEnd, sourceStart + 0.04, sourceDuration, sourceDuration);
  const speed = clamp(raw.speed, 0.5, 2, 1);
  const duration = (sourceEnd - sourceStart) / speed;
  const byTime = new Map();
  const sourceKeyframes = Array.isArray(raw.keyframes) ? raw.keyframes : [];
  for (const item of sourceKeyframes.slice(0, 64)) {
    const frame = sanitizeKeyframe(item, duration);
    byTime.set(frame.time.toFixed(3), frame);
  }
  if (!byTime.has('0.000')) byTime.set('0.000', sanitizeKeyframe({}, duration));
  const keyframes = [...byTime.values()].sort((a, b) => a.time - b.time);
  return {
    id,
    assetId,
    name: String(asset?.filename || raw.name || 'Video clip').replace(/[\r\n\t]/g, ' ').trim().slice(0, 160) || 'Video clip',
    sourceDuration,
    sourceStart,
    sourceEnd,
    timelineStart: clamp(raw.timelineStart, 0, Math.max(0, VIDEO_TIMELINE_MAX_SECONDS - duration), 0),
    track: Math.round(clamp(raw.track, 0, VIDEO_TIMELINE_TRACKS - 1, 0)),
    muted: raw.muted === true,
    gainDb: clamp(raw.gainDb, -60, 12, 0),
    speed,
    rotation: allowedRotation(raw.rotation),
    transition: raw.transition === 'dissolve' ? 'dissolve' : 'cut',
    transitionDuration: clamp(raw.transitionDuration, 0, Math.min(3, duration / 2), 0),
    fadeIn: clamp(raw.fadeIn, 0, Math.min(10, duration / 2), 0),
    fadeOut: clamp(raw.fadeOut, 0, Math.min(10, duration / 2), 0),
    keyframes
  };
}

export function timelineDuration(value) {
  const clips = Array.isArray(value?.clips) ? value.clips : [];
  return clips.reduce((end, clip) => Math.max(end, Number(clip.timelineStart || 0) + clipOutputDuration(clip)), 0);
}

export function sanitizeVideoTimeline(value, knownAssets = null) {
  const raw = value && typeof value === 'object' ? value : {};
  const clips = [];
  const seen = new Set();
  for (const candidate of (Array.isArray(raw.clips) ? raw.clips : []).slice(0, VIDEO_TIMELINE_MAX_CLIPS)) {
    const clip = sanitizeVideoTimelineClip(candidate, knownAssets);
    if (!clip || seen.has(clip.id)) continue;
    seen.add(clip.id);
    clips.push(clip);
  }
  const duration = timelineDuration({ clips });
  const selected = idText(raw.selectedClipId);
  return {
    schema: VIDEO_TIMELINE_SCHEMA,
    revision: Math.max(1, Math.trunc(clamp(raw.revision, 1, Number.MAX_SAFE_INTEGER, 1))),
    playhead: clamp(raw.playhead, 0, duration, 0),
    selectedClipId: clips.some(clip => clip.id === selected) ? selected : clips[0]?.id || '',
    overlays: { safeArea: raw.overlays?.safeArea !== false, grid: raw.overlays?.grid === true },
    clips
  };
}

export function interpolateClipKeyframes(clip, localTime) {
  const duration = clipOutputDuration(clip);
  const time = clamp(localTime, 0, duration, 0);
  const frames = Array.isArray(clip?.keyframes) && clip.keyframes.length
    ? clip.keyframes.map(frame => sanitizeKeyframe(frame, duration)).sort((a, b) => a.time - b.time)
    : [sanitizeKeyframe({}, duration)];
  if (time <= frames[0].time) return { ...frames[0], time };
  if (time >= frames[frames.length - 1].time) return { ...frames[frames.length - 1], time };
  let left = frames[0];
  let right = frames[frames.length - 1];
  for (let index = 0; index < frames.length - 1; index++) {
    if (time >= frames[index].time && time <= frames[index + 1].time) {
      left = frames[index]; right = frames[index + 1]; break;
    }
  }
  if (time <= left.time || left === right) return { ...left, time };
  const amount = (time - left.time) / Math.max(0.001, right.time - left.time);
  const result = { time };
  for (const key of ['x', 'y', 'scale', 'rotation', 'opacity', 'gainDb']) {
    result[key] = left[key] + (right[key] - left[key]) * amount;
  }
  return result;
}

function evaluateVideoTimelineClip(clip, timelineTime, order = 0) {
  const duration = clipOutputDuration(clip);
  const localTime = Number(timelineTime) - Number(clip.timelineStart || 0);
  if (localTime < 0 || localTime >= duration) return null;
  const keyed = interpolateClipKeyframes(clip, localTime);
  const fadeIn = Math.max(Number(clip.fadeIn || 0), clip.transition === 'dissolve' ? Number(clip.transitionDuration || 0) : 0);
  const inAlpha = fadeIn > 0 ? Math.min(1, localTime / fadeIn) : 1;
  const outAlpha = clip.fadeOut > 0 ? Math.min(1, (duration - localTime) / clip.fadeOut) : 1;
  return {
    ...keyed,
    clipId: clip.id,
    assetId: clip.assetId,
    localTime,
    sourceTime: clip.sourceStart + localTime * clip.speed,
    opacity: keyed.opacity * inAlpha * outAlpha,
    gainDb: clip.muted ? -Infinity : clip.gainDb + keyed.gainDb,
    rotation: clip.rotation + keyed.rotation,
    track: clip.track,
    zIndex: clip.track * 100 + order
  };
}

export function videoTimelineStateAt(value, time) {
  return (Array.isArray(value?.clips) ? value.clips : [])
    .map((clip, index) => evaluateVideoTimelineClip(clip, time, index))
    .filter(Boolean)
    .sort((a, b) => a.zIndex - b.zIndex);
}

export function reflowVideoTimelineTrack(value, trackNumber) {
  const timeline = sanitizeVideoTimeline(clone(value));
  const track = Math.round(clamp(trackNumber, 0, VIDEO_TIMELINE_TRACKS - 1, 0));
  const ordered = timeline.clips.filter(clip => clip.track === track)
    .sort((a, b) => a.timelineStart - b.timelineStart || timeline.clips.indexOf(a) - timeline.clips.indexOf(b));
  let cursor = 0;
  for (const clip of ordered) {
    const overlap = clip.transition === 'dissolve' ? Math.min(clip.transitionDuration, cursor) : 0;
    clip.timelineStart = Math.max(0, cursor - overlap);
    cursor = clip.timelineStart + clipOutputDuration(clip);
  }
  timeline.revision++;
  timeline.playhead = Math.min(timeline.playhead, timelineDuration(timeline));
  return timeline;
}

export function reorderVideoTimelineClip(value, clipId, direction) {
  let timeline = sanitizeVideoTimeline(clone(value));
  const clip = timeline.clips.find(item => item.id === clipId);
  if (!clip) return timeline;
  const indices = timeline.clips.map((item, index) => ({ item, index }))
    .filter(entry => entry.item.track === clip.track)
    .sort((a, b) => a.item.timelineStart - b.item.timelineStart || a.index - b.index);
  const current = indices.findIndex(entry => entry.item.id === clipId);
  const next = current + (direction < 0 ? -1 : 1);
  if (current < 0 || next < 0 || next >= indices.length) return timeline;
  const a = indices[current].index;
  const b = indices[next].index;
  [timeline.clips[a], timeline.clips[b]] = [timeline.clips[b], timeline.clips[a]];
  const orderedIds = indices.map(entry => entry.item.id);
  [orderedIds[current], orderedIds[next]] = [orderedIds[next], orderedIds[current]];
  const rank = new Map(orderedIds.map((id, index) => [id, index]));
  timeline.clips.sort((left, right) => left.track - right.track
    || (left.track === clip.track ? rank.get(left.id) - rank.get(right.id) : left.timelineStart - right.timelineStart));
  let cursor = 0;
  for (const item of timeline.clips.filter(candidate => candidate.track === clip.track)) {
    const overlap = item.transition === 'dissolve' ? Math.min(item.transitionDuration, cursor) : 0;
    item.timelineStart = Math.max(0, cursor - overlap);
    cursor = item.timelineStart + clipOutputDuration(item);
  }
  timeline.revision++;
  timeline.playhead = Math.min(timeline.playhead, timelineDuration(timeline));
  return sanitizeVideoTimeline(timeline);
}

export function splitVideoTimelineClip(value, clipId, timelineTime, newClipId) {
  const timeline = sanitizeVideoTimeline(clone(value));
  const index = timeline.clips.findIndex(clip => clip.id === clipId);
  if (index < 0) throw new Error('Select a clip before splitting.');
  const clip = timeline.clips[index];
  const local = Number(timelineTime) - clip.timelineStart;
  const duration = clipOutputDuration(clip);
  if (!Number.isFinite(local) || local < 0.04 || local > duration - 0.04) {
    throw new Error('Move the playhead inside the selected clip before splitting.');
  }
  const id = idText(newClipId);
  if (!id || timeline.clips.some(item => item.id === id)) throw new Error('A new unique clip ID is required.');
  const splitSource = clip.sourceStart + local * clip.speed;
  const boundary = interpolateClipKeyframes(clip, local);
  const firstFrames = clip.keyframes.filter(frame => frame.time < local).concat({ ...boundary, time: local });
  const secondFrames = [{ ...boundary, time: 0 }].concat(
    clip.keyframes.filter(frame => frame.time > local).map(frame => ({ ...frame, time: frame.time - local })));
  const second = {
    ...clone(clip), id, name: `${clip.name} · split`, sourceStart: splitSource,
    timelineStart: Number(timelineTime), transition: 'cut', transitionDuration: 0,
    fadeIn: 0, keyframes: secondFrames
  };
  clip.sourceEnd = splitSource;
  clip.fadeOut = 0;
  clip.keyframes = firstFrames;
  timeline.clips.splice(index + 1, 0, second);
  timeline.selectedClipId = second.id;
  timeline.revision++;
  return sanitizeVideoTimeline(timeline);
}

export function upsertVideoTimelineKeyframe(value, clipId, keyframe) {
  const timeline = sanitizeVideoTimeline(clone(value));
  const clip = timeline.clips.find(item => item.id === clipId);
  if (!clip) throw new Error('Select a clip before adding a keyframe.');
  const local = clamp(keyframe?.time, 0, clipOutputDuration(clip), 0);
  const sanitized = sanitizeKeyframe({ ...keyframe, time: local }, clipOutputDuration(clip));
  const index = clip.keyframes.findIndex(frame => Math.abs(frame.time - local) < 0.015);
  if (index >= 0) clip.keyframes[index] = sanitized; else clip.keyframes.push(sanitized);
  clip.keyframes.sort((a, b) => a.time - b.time);
  timeline.revision++;
  return timeline;
}

export function removeVideoTimelineKeyframe(value, clipId, time) {
  const timeline = sanitizeVideoTimeline(clone(value));
  const clip = timeline.clips.find(item => item.id === clipId);
  if (!clip) return timeline;
  const index = clip.keyframes.findIndex(frame => Math.abs(frame.time - Number(time)) < 0.015 && frame.time > 0);
  if (index >= 0) { clip.keyframes.splice(index, 1); timeline.revision++; }
  return timeline;
}

export function videoTimelineFingerprint(value) {
  return JSON.stringify(sanitizeVideoTimeline(value));
}

/**
 * Rewrite the media each clip points at. Recovery gives every restored asset a
 * new local id, and without this the saved edit sanitizes down to nothing.
 */
export function remapVideoTimelineAssets(value, idMap) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.clips)) return value;
  const lookup = idMap instanceof Map ? idMap : new Map(Object.entries(idMap || {}));
  return {
    ...value,
    clips: value.clips.map(clip => {
      const mapped = lookup.get(idText(clip?.assetId));
      return mapped ? { ...clip, assetId: idText(mapped) } : clip;
    })
  };
}

export function audioWaveformPeaks(channels, buckets = 240) {
  const usable = Array.isArray(channels) ? channels.filter(channel => channel instanceof Float32Array) : [];
  const length = usable.reduce((maximum, channel) => Math.max(maximum, channel.length), 0);
  const count = Math.round(clamp(buckets, 8, 2048, 240));
  const result = Array.from({ length: count }, () => ({ min: 0, max: 0 }));
  if (!length || !usable.length) return result;
  for (let bucket = 0; bucket < count; bucket++) {
    const start = Math.floor(bucket * length / count);
    const end = Math.max(start + 1, Math.floor((bucket + 1) * length / count));
    let minimum = 1;
    let maximum = -1;
    for (const channel of usable) for (let index = start; index < end && index < channel.length; index++) {
      const sample = Number.isFinite(channel[index]) ? Math.max(-1, Math.min(1, channel[index])) : 0;
      minimum = Math.min(minimum, sample);
      maximum = Math.max(maximum, sample);
    }
    result[bucket] = { min: minimum === 1 ? 0 : minimum, max: maximum === -1 ? 0 : maximum };
  }
  return result;
}

export function computeVideoScopes(imageData, width, height, resolution = 64) {
  const data = imageData?.data || imageData;
  const w = Math.trunc(Number(width));
  const h = Math.trunc(Number(height));
  const size = Math.round(clamp(resolution, 16, 128, 64));
  if (!data || !Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || data.length < w * h * 4) {
    throw new TypeError('A complete RGBA frame is required for video scopes.');
  }
  const histogram = new Uint32Array(256);
  const waveform = new Uint32Array(size * size);
  const vectorscope = new Uint32Array(size * size);
  const stride = Math.max(1, Math.floor(Math.sqrt((w * h) / 120000)));
  let sampledPixels = 0;
  for (let y = 0; y < h; y += stride) for (let x = 0; x < w; x += stride) {
    const offset = (y * w + x) * 4;
    const r = data[offset] / 255;
    const g = data[offset + 1] / 255;
    const b = data[offset + 2] / 255;
    const luma = Math.max(0, Math.min(1, 0.2126 * r + 0.7152 * g + 0.0722 * b));
    histogram[Math.round(luma * 255)]++;
    const wx = Math.min(size - 1, Math.floor(x / w * size));
    const wy = Math.min(size - 1, Math.floor((1 - luma) * size));
    waveform[wy * size + wx]++;
    const cb = Math.max(0, Math.min(1, 0.5 - 0.1146 * r - 0.3854 * g + 0.5 * b));
    const cr = Math.max(0, Math.min(1, 0.5 + 0.5 * r - 0.4542 * g - 0.0458 * b));
    const vx = Math.min(size - 1, Math.floor(cb * size));
    const vy = Math.min(size - 1, Math.floor((1 - cr) * size));
    vectorscope[vy * size + vx]++;
    sampledPixels++;
  }
  return { width: size, height: size, sampledPixels, histogram, waveform, vectorscope };
}
