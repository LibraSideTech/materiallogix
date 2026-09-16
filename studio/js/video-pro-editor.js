import { grabVideoFrame } from './crop.js';
import {
  VIDEO_TIMELINE_MAX_CLIPS,
  audioWaveformPeaks,
  clipOutputDuration,
  computeVideoScopes,
  createVideoTimelineClip,
  defaultVideoTimeline,
  hasVideoProEntitlement,
  interpolateClipKeyframes,
  reflowVideoTimelineTrack,
  removeVideoTimelineKeyframe,
  reorderVideoTimelineClip,
  sanitizeVideoTimeline,
  splitVideoTimelineClip,
  timelineDuration,
  upsertVideoTimelineKeyframe,
  videoTimelineFingerprint,
  videoTimelineStateAt
} from './video-timeline.js';

const clone = value => structuredClone(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const uid = () => `clip-${crypto.randomUUID()}`;
const seconds = value => `${Number(value || 0).toFixed(2)}s`;
const gain = db => !Number.isFinite(db) ? 0 : Math.min(1, Math.pow(10, db / 20));

function element(tag, properties = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(properties)) {
    if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'className') node.className = value;
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child != null && child !== false) {
    node.append(child.nodeType ? child : String(child));
  }
  return node;
}

function action(label, className = 'btn sm', handler = null) {
  const control = element('button', { type: 'button', className }, label);
  if (handler) control.addEventListener('click', handler);
  return control;
}

function outputFrame(spec) {
  const values = {
    vertical: [304, 540], portrait: [432, 540], square: [540, 540], wide: [960, 540]
  };
  const [width, height] = values[spec] || values.vertical;
  return { width, height };
}

function labelControl(label, control, className = 'video-pro-field') {
  const id = control.id || `video-control-${crypto.randomUUID()}`;
  control.id = id;
  return element('label', { className, htmlFor: id }, element('span', {}, label), control);
}

function numberControl(label, value, min, max, step, change) {
  const input = element('input', { type: 'number', value, min, max, step, inputMode: 'decimal' });
  input.addEventListener('change', () => change(clamp(input.value, min, max)));
  return labelControl(label, input);
}

function selectControl(label, value, choices, change) {
  const select = element('select');
  for (const [optionValue, text] of choices) {
    select.append(element('option', { value: String(optionValue), selected: String(value) === String(optionValue) }, text));
  }
  select.addEventListener('change', () => change(select.value));
  return labelControl(label, select);
}

function drawWaveform(canvas, peaks) {
  const ratio = Math.max(1, Math.min(2, globalThis.devicePixelRatio || 1));
  const width = Math.max(140, canvas.clientWidth || 240);
  const height = Math.max(28, canvas.clientHeight || 38);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent-cool').trim() || '#79a8b0';
  context.lineWidth = 1;
  context.beginPath();
  const mid = height / 2;
  for (let index = 0; index < peaks.length; index++) {
    const x = index / Math.max(1, peaks.length - 1) * width;
    context.moveTo(x, mid - peaks[index].max * mid);
    context.lineTo(x, mid - peaks[index].min * mid);
  }
  context.stroke();
}

class VideoProEditor {
  constructor(options) {
    this.options = options;
    this.asset = options.asset;
    this.assets = (options.assets || []).filter(item => item?.kind === 'video' && Number(item.duration) > .04);
    this.knownAssets = new Map(this.assets.map(item => [item.id, item]));
    this.undoStack = [];
    this.redoStack = [];
    this.videos = new Map();
    this.thumbnailCache = new Map();
    this.waveformCache = new Map();
    this.playing = false;
    this.animation = 0;
    this.playStartedAt = 0;
    this.playStartedTime = 0;
    this.lastScopeAt = 0;
    this.saveTimer = 0;
    this.cleaned = false;
    this.audioContext = null;

    let timeline = sanitizeVideoTimeline(this.asset.video?.proTimeline || defaultVideoTimeline(), this.knownAssets);
    if (!timeline.clips.length && this.knownAssets.has(this.asset.id)) {
      const first = createVideoTimelineClip(this.asset, { id: uid(), track: 0, timelineStart: 0 });
      timeline = sanitizeVideoTimeline({ ...timeline, clips: [first], selectedClipId: first.id }, this.knownAssets);
    }
    this.timeline = timeline;
    this.createInterface();
    this.syncAsset(false);
    this.renderAll();
  }

  createInterface() {
    this.dialog = element('dialog', { className: 'video-pro-dialog', 'aria-labelledby': 'videoProTitle' });
    const title = element('h2', { id: 'videoProTitle' }, 'Video Pro Mix & Edit');
    const close = action('Close', 'btn sm', () => this.dialog.close());
    this.header = element('header', { className: 'video-pro-head' },
      element('div', {}, title,
        element('p', {}, 'A local three-track editor. Project media stays on this device; export uses the local CPU renderer.')),
      close);

    const addSelect = element('select', { ariaLabel: 'Project video to add' });
    if (!this.assets.length) addSelect.append(element('option', { value: '' }, 'No decoded project video'));
    for (const item of this.assets) addSelect.append(element('option', { value: item.id }, item.filename));
    const addButton = action('Add clip', 'btn sm', () => this.addClip(addSelect.value));
    addButton.disabled = !this.assets.length;
    const importButton = action('Import video', 'btn sm', () => {
      this.dialog.close();
      this.options.requestImport?.();
    });
    this.undoButton = action('Undo', 'btn sm', () => this.undo());
    this.redoButton = action('Redo', 'btn sm', () => this.redo());
    const safeToggle = element('input', { type: 'checkbox', checked: this.timeline.overlays.safeArea });
    safeToggle.addEventListener('change', () => this.commit('safe-area overlay', value => {
      value.overlays.safeArea = safeToggle.checked; return value;
    }));
    const gridToggle = element('input', { type: 'checkbox', checked: this.timeline.overlays.grid });
    gridToggle.addEventListener('change', () => this.commit('composition grid', value => {
      value.overlays.grid = gridToggle.checked; return value;
    }));
    // Guided and Expert exist at this level too, over the features this level
    // has. Guided assembles and delivers; Expert adds the frame-level
    // instrumentation — scopes and keyframes — that a colourist wants and a
    // first-time user does not.
    this.editMode = (() => {
      try { return localStorage.getItem('mlx:video-mode') === 'advanced' ? 'advanced' : 'guided'; } catch { return 'guided'; }
    })();
    const modeButtons = [];
    const applyMode = value => {
      this.editMode = value === 'advanced' ? 'advanced' : 'guided';
      this.dialog.dataset.videoMode = this.editMode;
      try { localStorage.setItem('mlx:video-mode', this.editMode); } catch { /* the session keeps it either way */ }
      for (const button of modeButtons) {
        const on = button.dataset.mode === this.editMode;
        button.classList.toggle('on', on);
        button.setAttribute('aria-pressed', String(on));
      }
    };
    this.modeSeg = element('div', { className: 'seg editor-mode', role: 'group', ariaLabel: 'Video editing mode' });
    for (const [value, label] of [['guided', 'Guided'], ['advanced', 'Expert']]) {
      const button = action(label, '', () => applyMode(value));
      button.dataset.mode = value;
      modeButtons.push(button);
      this.modeSeg.append(button);
    }

    this.scopeSelect = element('select', { ariaLabel: 'Video scope', className: 'video-expert' },
      element('option', { value: 'histogram' }, 'Luma histogram'),
      element('option', { value: 'waveform' }, 'Luma waveform'),
      element('option', { value: 'vectorscope' }, 'Vectorscope'));
    this.scopeSelect.addEventListener('change', () => this.drawPreview(true));
    this.toolbar = element('div', { className: 'video-pro-toolbar', role: 'toolbar', ariaLabel: 'Timeline tools' },
      addSelect, addButton, importButton, this.undoButton, this.redoButton,
      element('label', { className: 'video-pro-check' }, safeToggle, 'Title safe'),
      element('label', { className: 'video-pro-check' }, gridToggle, 'Grid'),
      this.scopeSelect, this.modeSeg);

    const { width, height } = outputFrame(this.asset.video?.spec);
    this.previewCanvas = element('canvas', { className: 'video-pro-preview-canvas', width, height, ariaLabel: 'Composited local video preview' });
    this.safeOverlay = element('div', { className: 'video-pro-safe-overlay', ariaHidden: 'true' });
    this.gridOverlay = element('div', { className: 'video-pro-grid-overlay', ariaHidden: 'true' });
    this.previewStack = element('div', { className: 'video-pro-preview-stack' }, this.previewCanvas, this.safeOverlay, this.gridOverlay);
    this.hiddenMedia = element('div', { className: 'video-pro-hidden-media', ariaHidden: 'true' });
    this.scopeCanvas = element('canvas', { className: 'video-pro-scope video-expert', width: 320, height: 150, ariaLabel: 'Scope computed from the displayed frame' });
    this.playButton = action('Play', 'btn primary sm', () => this.togglePlayback());
    this.stopButton = action('Stop', 'btn sm', () => this.stopPlayback(true));
    this.scrubber = element('input', { type: 'range', min: 0, max: Math.max(.01, timelineDuration(this.timeline)), step: .01, value: this.timeline.playhead, ariaLabel: 'Timeline playhead' });
    this.timeReadout = element('output', { htmlFor: this.scrubber.id, ariaLive: 'polite' });
    this.scrubber.addEventListener('input', () => this.seek(Number(this.scrubber.value), false));
    this.scrubber.addEventListener('change', () => this.seek(Number(this.scrubber.value), true));
    const transport = element('div', { className: 'video-pro-transport' }, this.playButton, this.stopButton, this.scrubber, this.timeReadout);
    this.monitor = element('section', { className: 'video-pro-monitor', ariaLabel: 'Preview monitor' },
      this.previewStack, this.hiddenMedia, transport, this.scopeCanvas);

    this.timelineLanes = element('div', { className: 'video-pro-lanes' });
    this.timelineArea = element('section', { className: 'video-pro-timeline', ariaLabel: 'Three-track edit timeline' },
      element('div', { className: 'video-pro-section-title' }, 'Edit timeline · three visual/audio tracks'), this.timelineLanes);
    this.inspector = element('aside', { className: 'video-pro-inspector', ariaLabel: 'Selected clip inspector' });
    this.status = element('p', { className: 'video-pro-status', role: 'status', ariaLive: 'polite' }, 'Ready for local editing.');
    this.renderButton = action('Render local MP4', 'btn primary', () => this.renderOutput());
    this.body = element('div', { className: 'video-pro-body' },
      this.toolbar,
      element('div', { className: 'video-pro-workspace' },
        element('div', { className: 'video-pro-main' }, this.monitor, this.timelineArea), this.inspector));
    this.footer = element('footer', { className: 'video-pro-foot' }, this.status, this.renderButton,
      action('Done', 'btn', () => this.dialog.close()));
    this.dialog.append(this.header, this.body, this.footer);
    applyMode(this.editMode);
    document.body.append(this.dialog);
    this.dialog.addEventListener('close', () => this.cleanup(), { once: true });
    this.dialog.addEventListener('keydown', event => this.onKeyDown(event));
  }

  announce(message, bad = false) {
    this.status.textContent = message;
    this.status.classList.toggle('bad', bad);
    this.options.notify?.(message, bad);
  }

  syncAsset(save = true) {
    this.asset.video = this.asset.video || {};
    this.asset.video.workspaceMode = 'pro';
    this.asset.video.proTimeline = clone(this.timeline);
    if (!save) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.options.saveAsset(this.asset).catch(() => this.announce('The edit is in memory, but local persistence failed.', true));
    }, 140);
  }

  commit(label, transform) {
    const before = clone(this.timeline);
    let next = transform(clone(this.timeline));
    next = sanitizeVideoTimeline(next, this.knownAssets);
    if (videoTimelineFingerprint(before) === videoTimelineFingerprint(next)) return;
    this.undoStack.push(before);
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack.length = 0;
    next.revision = Math.max(before.revision + 1, next.revision);
    this.timeline = next;
    this.syncAsset();
    this.announce(`${label} saved locally.`);
    this.renderAll();
  }

  undo() {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(clone(this.timeline));
    this.timeline = sanitizeVideoTimeline(previous, this.knownAssets);
    this.syncAsset();
    this.announce('Undo applied.');
    this.renderAll();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(clone(this.timeline));
    this.timeline = sanitizeVideoTimeline(next, this.knownAssets);
    this.syncAsset();
    this.announce('Redo applied.');
    this.renderAll();
  }

  addClip(assetId) {
    const source = this.knownAssets.get(assetId);
    if (!source) return this.announce('Import or select a decoded project video first.', true);
    if (this.timeline.clips.length >= VIDEO_TIMELINE_MAX_CLIPS) return this.announce(`A timeline is limited to ${VIDEO_TIMELINE_MAX_CLIPS} clips.`, true);
    const selected = this.timeline.clips.find(item => item.id === this.timeline.selectedClipId);
    const track = selected?.track ?? 0;
    this.commit('clip added', value => {
      const created = createVideoTimelineClip(source, { id: uid(), track });
      value.clips.push(created);
      value.selectedClipId = created.id;
      return reflowVideoTimelineTrack(value, track);
    });
  }

  updateClip(clipId, patch, { reflow = false } = {}) {
    this.commit('clip settings', value => {
      const clip = value.clips.find(item => item.id === clipId);
      if (!clip) return value;
      const previousTrack = clip.track;
      Object.assign(clip, patch);
      if (reflow) {
        value = reflowVideoTimelineTrack(value, previousTrack);
        if (Number(patch.track) !== previousTrack) value = reflowVideoTimelineTrack(value, Number(patch.track));
      }
      return value;
    });
  }

  removeClip(clipId) {
    this.commit('clip removed', value => {
      const clip = value.clips.find(item => item.id === clipId);
      value.clips = value.clips.filter(item => item.id !== clipId);
      value.selectedClipId = value.clips[0]?.id || '';
      return clip ? reflowVideoTimelineTrack(value, clip.track) : value;
    });
  }

  splitSelected() {
    const clip = this.timeline.clips.find(item => item.id === this.timeline.selectedClipId);
    if (!clip) return;
    try {
      this.commit('clip split', value => splitVideoTimelineClip(value, clip.id, value.playhead, uid()));
    } catch (error) {
      this.announce(error.message, true);
    }
  }

  moveSelected(direction) {
    const id = this.timeline.selectedClipId;
    this.commit(direction < 0 ? 'clip moved earlier' : 'clip moved later', value => reorderVideoTimelineClip(value, id, direction));
  }

  seek(time, save = false) {
    this.stopPlayback(false);
    this.timeline.playhead = clamp(time, 0, timelineDuration(this.timeline));
    this.scrubber.value = this.timeline.playhead;
    this.updateTimeReadout();
    this.syncMedia(false);
    this.drawPreview(true);
    this.renderInspector();
    if (save) this.syncAsset();
  }

  async togglePlayback() {
    if (this.playing) return this.stopPlayback(true);
    const duration = timelineDuration(this.timeline);
    if (duration <= 0) return this.announce('Add a decoded video clip before previewing.', true);
    if (this.timeline.playhead >= duration - .01) this.timeline.playhead = 0;
    this.playing = true;
    this.playStartedAt = performance.now();
    this.playStartedTime = this.timeline.playhead;
    this.playButton.textContent = 'Pause';
    await this.syncMedia(true);
    this.animation = requestAnimationFrame(now => this.tick(now));
  }

  stopPlayback(save = false) {
    this.playing = false;
    cancelAnimationFrame(this.animation);
    this.animation = 0;
    this.playButton.textContent = 'Play';
    for (const video of this.videos.values()) video.pause();
    if (save) this.syncAsset();
  }

  tick(now) {
    if (!this.playing) return;
    const duration = timelineDuration(this.timeline);
    const next = this.playStartedTime + (now - this.playStartedAt) / 1000;
    if (next >= duration) {
      this.timeline.playhead = duration;
      this.scrubber.value = duration;
      this.updateTimeReadout();
      this.syncMedia(false);
      this.drawPreview(true);
      this.stopPlayback(true);
      return;
    }
    this.timeline.playhead = next;
    this.scrubber.value = next;
    this.updateTimeReadout();
    this.syncMedia(true);
    this.drawPreview(now - this.lastScopeAt > 180);
    this.animation = requestAnimationFrame(value => this.tick(value));
  }

  async ensureMediaElements() {
    const clipIds = new Set(this.timeline.clips.map(clip => clip.id));
    for (const [id, video] of this.videos) if (!clipIds.has(id)) {
      video.pause(); video.remove(); this.videos.delete(id);
    }
    for (const clip of this.timeline.clips) {
      if (this.videos.has(clip.id)) continue;
      const video = element('video', { preload: 'auto', playsInline: true, muted: false });
      video.addEventListener('loadeddata', () => this.drawPreview(true));
      video.addEventListener('seeked', () => this.drawPreview(true));
      this.hiddenMedia.append(video);
      this.videos.set(clip.id, video);
      this.options.objectUrl(clip.assetId).then(url => { video.src = url; video.load(); }).catch(() => {
        video.dataset.failed = 'true';
        this.announce(`Could not open ${clip.name} from local storage.`, true);
      });
    }
  }

  syncMedia(playing) {
    const active = new Map(videoTimelineStateAt(this.timeline, this.timeline.playhead).map(item => [item.clipId, item]));
    for (const clip of this.timeline.clips) {
      const video = this.videos.get(clip.id);
      if (!video) continue;
      const state = active.get(clip.id);
      if (!state) { video.pause(); continue; }
      video.playbackRate = clip.speed;
      video.muted = !Number.isFinite(state.gainDb);
      video.volume = gain(state.gainDb);
      if (Number.isFinite(video.duration) && Math.abs(video.currentTime - state.sourceTime) > (playing ? .16 : .025)) {
        video.currentTime = clamp(state.sourceTime, 0, Math.max(0, video.duration - .001));
      }
      if (playing && video.paused) video.play().catch(() => {
        this.stopPlayback(false);
        this.announce('Preview playback was blocked. Press Play again after interacting with the editor.', true);
      });
      if (!playing) video.pause();
    }
  }

  drawPreview(forceScope = false) {
    const canvas = this.previewCanvas;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.save();
    context.fillStyle = '#050506';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const states = videoTimelineStateAt(this.timeline, this.timeline.playhead);
    let drawn = 0;
    for (const state of states) {
      const video = this.videos.get(state.clipId);
      if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) continue;
      const fit = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
      const width = video.videoWidth * fit;
      const height = video.videoHeight * fit;
      context.save();
      context.globalAlpha = clamp(state.opacity, 0, 1);
      context.translate(canvas.width / 2 + state.x / 100 * canvas.width,
        canvas.height / 2 + state.y / 100 * canvas.height);
      context.rotate(state.rotation * Math.PI / 180);
      context.scale(state.scale, state.scale);
      context.drawImage(video, -width / 2, -height / 2, width, height);
      context.restore();
      drawn++;
    }
    if (!drawn) {
      context.fillStyle = '#b6b1a8';
      context.font = `${Math.max(11, canvas.height / 32)}px system-ui`;
      context.textAlign = 'center';
      context.fillText(this.timeline.clips.length ? 'Seeking local frame…' : 'Import or add a project video', canvas.width / 2, canvas.height / 2);
    }
    context.restore();
    if (forceScope) {
      this.lastScopeAt = performance.now();
      try { this.drawScope(computeVideoScopes(context.getImageData(0, 0, canvas.width, canvas.height), canvas.width, canvas.height)); }
      catch { this.drawScope(null); }
    }
  }

  drawScope(scopes) {
    const canvas = this.scopeCanvas;
    const context = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    context.fillStyle = '#070708';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgba(255,255,255,.12)';
    context.lineWidth = 1;
    for (let index = 1; index < 4; index++) {
      const y = index * height / 4;
      context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
    }
    if (!scopes) return;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-cool').trim() || '#79a8b0';
    context.fillStyle = accent;
    const kind = this.scopeSelect.value;
    if (kind === 'histogram') {
      const maximum = Math.max(1, ...scopes.histogram);
      for (let index = 0; index < 256; index++) {
        const bar = scopes.histogram[index] / maximum * (height - 8);
        context.fillRect(index / 256 * width, height - bar, Math.max(1, width / 256), bar);
      }
      return;
    }
    const grid = kind === 'waveform' ? scopes.waveform : scopes.vectorscope;
    const maximum = Math.max(1, ...grid);
    const size = scopes.width;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const amount = grid[y * size + x];
      if (!amount) continue;
      context.globalAlpha = Math.min(1, .18 + amount / maximum);
      context.fillRect(x / size * width, y / size * height, Math.ceil(width / size), Math.ceil(height / size));
    }
    context.globalAlpha = 1;
  }

  renderAll() {
    const duration = timelineDuration(this.timeline);
    this.timeline.playhead = clamp(this.timeline.playhead, 0, duration);
    this.scrubber.max = Math.max(.01, duration);
    this.scrubber.value = this.timeline.playhead;
    this.safeOverlay.hidden = !this.timeline.overlays.safeArea;
    this.gridOverlay.hidden = !this.timeline.overlays.grid;
    this.undoButton.disabled = !this.undoStack.length;
    this.redoButton.disabled = !this.redoStack.length;
    this.renderButton.disabled = !this.timeline.clips.length;
    this.updateTimeReadout();
    this.renderLanes();
    this.renderInspector();
    this.ensureMediaElements().then(() => { this.syncMedia(false); this.drawPreview(true); });
  }

  updateTimeReadout() {
    this.timeReadout.value = `${seconds(this.timeline.playhead)} / ${seconds(timelineDuration(this.timeline))}`;
    this.timeReadout.textContent = this.timeReadout.value;
  }

  renderLanes() {
    this.timelineLanes.replaceChildren();
    const duration = Math.max(.1, timelineDuration(this.timeline));
    for (let track = 2; track >= 0; track--) {
      const lane = element('div', { className: 'video-pro-lane', dataset: { track: String(track) } });
      const trackClips = this.timeline.clips.filter(item => item.track === track);
      if (!trackClips.length) lane.append(element('span', { className: 'video-pro-empty-lane' }, 'Drop target via selected clip Track control'));
      for (const clip of trackClips) {
        const block = element('button', {
          type: 'button', className: `video-pro-clip${clip.id === this.timeline.selectedClipId ? ' selected' : ''}`,
          ariaLabel: `${clip.name}, track ${track + 1}, starts ${seconds(clip.timelineStart)}, duration ${seconds(clipOutputDuration(clip))}`
        });
        block.style.left = `${clip.timelineStart / duration * 100}%`;
        block.style.width = `${Math.max(3, clipOutputDuration(clip) / duration * 100)}%`;
        const thumbs = element('span', { className: 'video-pro-thumbnails', ariaHidden: 'true' });
        const wave = element('canvas', { className: 'video-pro-waveform', ariaLabel: `Decoded audio waveform for ${clip.name}` });
        block.append(thumbs, wave, element('span', { className: 'video-pro-clip-name' }, clip.name),
          element('span', { className: 'video-pro-clip-meta' }, `${seconds(clipOutputDuration(clip))} · ${clip.speed}×${clip.muted ? ' · muted' : ''}`));
        block.addEventListener('click', () => {
          this.timeline.selectedClipId = clip.id;
          this.timeline.playhead = clamp(this.timeline.playhead, clip.timelineStart, clip.timelineStart + clipOutputDuration(clip) - .001);
          this.syncAsset(); this.renderAll();
        });
        lane.append(block);
        this.loadThumbnails(clip, thumbs);
        this.loadWaveform(clip, wave);
      }
      this.timelineLanes.append(element('div', { className: 'video-pro-lane-row' },
        element('div', { className: 'video-pro-track-label' }, `V${track + 1}`), lane));
    }
  }

  async loadThumbnails(clip, holder) {
    const key = `${clip.assetId}:${clip.sourceStart.toFixed(3)}:${clip.sourceEnd.toFixed(3)}`;
    if (!this.thumbnailCache.has(key)) this.thumbnailCache.set(key, (async () => {
      const url = await this.options.objectUrl(clip.assetId);
      const times = [0, .5, 1].map(amount => clip.sourceStart + (clip.sourceEnd - clip.sourceStart) * amount);
      const results = [];
      for (const time of times) {
        const frame = await grabVideoFrame(url, Math.min(clip.sourceEnd - .001, time));
        results.push(frame.canvas.toDataURL('image/jpeg', .62));
      }
      return results;
    })().catch(() => []));
    const images = await this.thumbnailCache.get(key);
    if (!holder.isConnected) return;
    holder.replaceChildren(...images.map(src => element('img', { src, alt: '' })));
  }

  async loadWaveform(clip, canvas) {
    if (!this.waveformCache.has(clip.assetId)) this.waveformCache.set(clip.assetId, (async () => {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) return null;
      this.audioContext ||= new Context();
      const blob = await this.options.getBlob(clip.assetId);
      const decoded = await this.audioContext.decodeAudioData(await blob.arrayBuffer());
      const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
      return audioWaveformPeaks(channels, 220);
    })().catch(() => null));
    const peaks = await this.waveformCache.get(clip.assetId);
    if (!canvas.isConnected) return;
    if (peaks) drawWaveform(canvas, peaks);
    else canvas.setAttribute('aria-label', `No decodable audio waveform for ${clip.name}`);
  }

  renderInspector() {
    this.inspector.replaceChildren(element('div', { className: 'video-pro-section-title' }, 'Clip inspector'));
    const clip = this.timeline.clips.find(item => item.id === this.timeline.selectedClipId);
    if (!clip) {
      this.inspector.append(element('p', { className: 'hint' },
        this.assets.length ? 'Add a clip, then select it on a track.' : 'Import a video. Decoded project videos become available here automatically.'));
      return;
    }
    const duration = clipOutputDuration(clip);
    const localTime = clamp(this.timeline.playhead - clip.timelineStart, 0, duration);
    const keyed = interpolateClipKeyframes(clip, localTime);
    const heading = element('div', { className: 'video-pro-inspector-heading' },
      element('strong', {}, clip.name), element('span', {}, `Track ${clip.track + 1} · source ${seconds(clip.sourceDuration)}`));
    const mute = element('input', { type: 'checkbox', checked: clip.muted });
    mute.addEventListener('change', () => this.updateClip(clip.id, { muted: mute.checked }));
    const clipControls = element('div', { className: 'video-pro-control-grid' },
      numberControl('Source in (s)', clip.sourceStart, 0, Math.max(0, clip.sourceEnd - .04), .01,
        value => this.updateClip(clip.id, { sourceStart: value }, { reflow: true })),
      numberControl('Source out (s)', clip.sourceEnd, Math.min(clip.sourceDuration, clip.sourceStart + .04), clip.sourceDuration, .01,
        value => this.updateClip(clip.id, { sourceEnd: value }, { reflow: true })),
      numberControl('Timeline start (s)', clip.timelineStart, 0, 7200, .01,
        value => this.updateClip(clip.id, { timelineStart: value })),
      selectControl('Track', clip.track, [[0, 'V1'], [1, 'V2'], [2, 'V3']],
        value => this.updateClip(clip.id, { track: Number(value) }, { reflow: true })),
      numberControl('Gain (dB)', clip.gainDb, -60, 12, .5,
        value => this.updateClip(clip.id, { gainDb: value })),
      selectControl('Speed', clip.speed, [[.5, '0.5×'], [.75, '0.75×'], [1, '1×'], [1.25, '1.25×'], [1.5, '1.5×'], [2, '2×']],
        value => this.updateClip(clip.id, { speed: Number(value) }, { reflow: true })),
      selectControl('Base rotation', clip.rotation, [[0, '0°'], [90, '90°'], [180, '180°'], [270, '270°']],
        value => this.updateClip(clip.id, { rotation: Number(value) })),
      selectControl('Incoming transition', clip.transition, [['cut', 'Cut'], ['dissolve', 'Dissolve']],
        value => this.updateClip(clip.id, { transition: value }, { reflow: true })),
      numberControl('Transition (s)', clip.transitionDuration, 0, Math.min(3, duration / 2), .05,
        value => this.updateClip(clip.id, { transitionDuration: value }, { reflow: true })),
      numberControl('Fade in (s)', clip.fadeIn, 0, Math.min(10, duration / 2), .05,
        value => this.updateClip(clip.id, { fadeIn: value })),
      numberControl('Fade out (s)', clip.fadeOut, 0, Math.min(10, duration / 2), .05,
        value => this.updateClip(clip.id, { fadeOut: value })));
    const clipActions = element('div', { className: 'video-pro-action-row' },
      element('label', { className: 'video-pro-check' }, mute, 'Mute clip'),
      action('Split at playhead', 'btn sm', () => this.splitSelected()),
      action('Earlier', 'btn sm', () => this.moveSelected(-1)),
      action('Later', 'btn sm', () => this.moveSelected(1)),
      action('Remove', 'btn danger sm', () => this.removeClip(clip.id)));

    const keyInputs = {
      x: element('input', { type: 'number', value: keyed.x.toFixed(2), min: -100, max: 100, step: .5 }),
      y: element('input', { type: 'number', value: keyed.y.toFixed(2), min: -100, max: 100, step: .5 }),
      scale: element('input', { type: 'number', value: keyed.scale.toFixed(3), min: 1, max: 4, step: .01 }),
      rotation: element('input', { type: 'number', value: keyed.rotation.toFixed(2), min: -180, max: 180, step: .5 }),
      opacity: element('input', { type: 'number', value: keyed.opacity.toFixed(3), min: 0, max: 1, step: .01 }),
      gainDb: element('input', { type: 'number', value: keyed.gainDb.toFixed(2), min: -60, max: 12, step: .5 })
    };
    const keyGrid = element('div', { className: 'video-pro-control-grid' },
      labelControl('X position (%)', keyInputs.x), labelControl('Y position (%)', keyInputs.y),
      labelControl('Scale', keyInputs.scale), labelControl('Rotation (°)', keyInputs.rotation),
      labelControl('Opacity', keyInputs.opacity), labelControl('Key gain (dB)', keyInputs.gainDb));
    const keyAtTime = clip.keyframes.find(frame => Math.abs(frame.time - localTime) < .015);
    const addKey = action(keyAtTime ? 'Update keyframe' : 'Add keyframe', 'btn primary sm', () => {
      const frame = { time: localTime };
      for (const [name, input] of Object.entries(keyInputs)) frame[name] = Number(input.value);
      this.commit('keyframe', value => upsertVideoTimelineKeyframe(value, clip.id, frame));
    });
    const removeKey = action('Remove keyframe', 'btn sm', () => {
      this.commit('keyframe removed', value => removeVideoTimelineKeyframe(value, clip.id, localTime));
    });
    removeKey.disabled = !keyAtTime || localTime <= .015;
    const keyframeSection = element('section', { className: 'video-pro-keyframes video-expert' },
      element('div', { className: 'video-pro-subtitle' }, `Transform, opacity & audio keyframe at ${seconds(localTime)}`), keyGrid,
      element('div', { className: 'video-pro-action-row' }, addKey, removeKey),
      element('p', { className: 'hint' }, `${clip.keyframes.length} keyframe${clip.keyframes.length === 1 ? '' : 's'} · values interpolate linearly and drive preview and export.`));
    this.inspector.append(heading, clipControls, clipActions, keyframeSection);
  }

  async renderOutput() {
    if (!this.timeline.clips.length) return this.announce('Add a clip before rendering.', true);
    this.stopPlayback(true);
    this.renderButton.disabled = true;
    this.announce('Preparing a deterministic local CPU render…');
    try {
      await this.options.renderTimeline(clone(this.timeline));
      this.announce('Local render completed and was added to the project.');
    } catch (error) {
      this.announce(`Local render failed: ${error.message}`, true);
    } finally {
      this.renderButton.disabled = !this.timeline.clips.length;
    }
  }

  onKeyDown(event) {
    const editing = /^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName || '');
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); event.shiftKey ? this.redo() : this.undo(); return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault(); this.redo(); return;
    }
    if (editing) return;
    if (event.key === ' ') { event.preventDefault(); this.togglePlayback(); return; }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      this.seek(this.timeline.playhead + direction * (event.shiftKey ? 1 : 1 / 30), true);
    }
  }

  async cleanup() {
    if (this.cleaned) return;
    this.cleaned = true;
    this.stopPlayback(false);
    clearTimeout(this.saveTimer);
    try { await this.options.saveAsset(this.asset); } catch { /* edit remains on the live asset */ }
    for (const video of this.videos.values()) { video.pause(); video.removeAttribute('src'); video.load(); }
    this.videos.clear();
    if (this.audioContext && this.audioContext.state !== 'closed') await this.audioContext.close().catch(() => undefined);
    this.dialog.remove();
  }
}

export async function openVideoProEditor(options) {
  if (!hasVideoProEntitlement(options?.license)) {
    throw new Error('Video Pro requires Pro Studio or Single Studio Pro with Video selected.');
  }
  if (!options?.asset || options.asset.kind !== 'video') throw new Error('Choose a video before opening Video Pro.');
  for (const name of ['objectUrl', 'getBlob', 'saveAsset', 'renderTimeline']) {
    if (typeof options[name] !== 'function') throw new TypeError(`Video Pro is missing its local ${name} adapter.`);
  }
  const editor = new VideoProEditor(options);
  editor.dialog.showModal();
  return editor;
}
