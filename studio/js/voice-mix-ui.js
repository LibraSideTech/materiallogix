import { activeLicense } from './license.js';
import { hasProAccess } from './pricing.js';
import {
  VOICE_MIX_MAX_SECONDS, VOICE_MIX_MAX_TRACKS, VOICE_MIX_ROLES,
  defaultVoiceMixSettings, defaultVoiceMixTrack, encodeVoiceMixWav,
  renderVoiceMix, sanitizeVoiceMixSettings, voiceMixFingerprint
} from './voice-mix.js';

const $ = selector => document.querySelector(selector);
const direction = $('#voiceDirectionWorkspace');
const mixWorkspace = $('#voiceMixWorkspace');
const directionTab = $('#voiceDirectionTab');
const mixTab = $('#voiceMixTab');
const entitlementStatus = $('#voiceMixEntitlement');
const locked = $('#voiceMixLocked');
const surface = $('#voiceMixSurface');
const fileInput = $('#voiceMixFiles');
const trackList = $('#voiceMixTrackList');
const status = $('#voiceMixStatus');
const previewButton = $('#voiceMixPreview');
const stopButton = $('#voiceMixStop');
const exportButton = $('#voiceMixExport');

let proVerified = false;
let tracks = [];
let pendingRole = 'voice';
let playback = null;
let cachedRender = null;
let cachedFingerprint = '';
const localVoiceProQaEnabled = ['127.0.0.1', 'localhost'].includes(location.hostname)
  && new URLSearchParams(location.search).get('qa') === 'voice-pro';
let localQaLicense = null;

let removed = null;

// A status line that offers to put something back has to be able to, and the
// offer has to survive the next status line. So the undo is a real button next
// to the message rather than a sentence in it, and it stays until it is used or
// the track it would restore is no longer the last thing removed.
const setStatus = (message, bad = false, undo = null) => {
  if (!status) return;
  status.replaceChildren(document.createTextNode(message));
  status.classList.toggle('bad', bad);
  if (!undo) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn sm';
  button.textContent = 'Undo';
  button.addEventListener('click', undo);
  status.append(' ', button);
};

function showWorkspace(name) {
  const mixRequested = name === 'mix';
  direction.hidden = mixRequested;
  mixWorkspace.hidden = !mixRequested;
  directionTab.classList.toggle('on', !mixRequested);
  mixTab.classList.toggle('on', mixRequested);
  directionTab.setAttribute('aria-selected', String(!mixRequested));
  mixTab.setAttribute('aria-selected', String(mixRequested));
  directionTab.tabIndex = mixRequested ? -1 : 0;
  mixTab.tabIndex = mixRequested ? 0 : -1;
  document.body.dataset.voiceWorkspace = mixRequested ? 'mix' : 'direction';
  try { localStorage.setItem('mlx:voice-workspace', mixRequested ? 'mix' : 'direction'); } catch { /* unavailable */ }
  if (mixRequested) $('#voiceMixTracksHeading')?.focus?.();
}

directionTab?.addEventListener('click', () => showWorkspace('direction'));
mixTab?.addEventListener('click', () => showWorkspace('mix'));
document.querySelector('.voice-workspace-tabs')?.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const available = [directionTab, mixTab].filter(tab => tab && !tab.disabled);
  if (!available.length) return;
  const current = Math.max(0, available.indexOf(document.activeElement));
  const next = event.key === 'Home' ? 0
    : event.key === 'End' ? available.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + available.length) % available.length;
  event.preventDefault();
  available[next].focus();
  showWorkspace(available[next] === mixTab ? 'mix' : 'direction');
});

// The desk is on screen whether or not this licence covers it. A customer who
// cannot open Pro Mix can still walk the channel strip, the ducking section and
// the meters, and read what each control does; every action fails closed
// through requirePro(). Hiding it would leave the price list as the only
// description of what Pro Mix is.
function applyProAccess(license) {
  proVerified = hasProAccess(license, 'voice');
  locked.hidden = proVerified;
  surface.hidden = false;
  surface.classList.toggle('voice-locked', !proVerified);
  entitlementStatus.textContent = proVerified
    ? 'Voice Pro is on this licence · everything here runs on your computer.'
    : 'Pro Mix comes with Pro Studio, or with Single Studio Pro for Voice.';
  if (!proVerified) {
    stopPreview(false);
    tracks = [];
    paintTracks();
    // "Add at least one local track to begin" is an instruction this customer
    // cannot follow, so it is not the one to leave standing.
    setStatus('The whole desk is here to look at. Nothing on it moves until Voice Pro is on your licence.');
  }
  return proVerified;
}

async function verifyProAccess() {
  if (localVoiceProQaEnabled && localQaLicense) return applyProAccess(localQaLicense);
  let license = null;
  try { license = await activeLicense(); } catch { /* unknown remains locked */ }
  return applyProAccess(license);
}

async function requirePro() {
  if (await verifyProAccess()) return true;
  setStatus('We could not confirm Voice Pro on this licence, so the desk stays locked.', true);
  return false;
}

const roleLabel = role => VOICE_MIX_ROLES.find(candidate => candidate.id === role)?.label || 'Voice';
const boundedName = value => String(value || 'audio').replace(/[\r\n\t]/g, ' ').trim().slice(0, 160) || 'audio';
const finiteDb = value => Number.isFinite(value) ? `${value.toFixed(1)} dB` : '−∞ dB';

// Let the status line paint before a render takes the thread. A plain animation
// frame never arrives in a background tab, which left an export clicked on the
// way out of the room sitting on "Rendering…" until the customer came back.
const yieldToPaint = () => Promise.race([
  new Promise(resolve => requestAnimationFrame(resolve)),
  new Promise(resolve => setTimeout(resolve, 50))
]);

function audioContextConstructor() {
  return window.AudioContext || window.webkitAudioContext || null;
}

function markChanged(message = 'Mix changed. Preview or export to hear the current settings.', undo = null) {
  cachedRender = null;
  cachedFingerprint = '';
  if (playback) stopPreview();
  setStatus(message, false, undo);
}

function updateTransport() {
  const ready = proVerified && tracks.length > 0;
  previewButton.disabled = !ready;
  exportButton.disabled = !ready;
  stopButton.disabled = !playback;
}

const controlId = (track, suffix) => `mix-${track.id}-${suffix}`;
const rangeControl = (track, key, label, min, max, step, format) => {
  const id = controlId(track, key);
  const labelNode = document.createElement('label');
  labelNode.htmlFor = id;
  const name = document.createElement('span');
  name.textContent = label;
  const input = document.createElement('input');
  input.id = id;
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(track[key]);
  const output = document.createElement('output');
  output.setAttribute('for', id);
  const paint = () => { output.textContent = format(Number(input.value)); };
  paint();
  input.addEventListener('input', () => {
    track[key] = Number(input.value);
    paint();
    markChanged();
  });
  labelNode.append(name, input, output);
  return labelNode;
};

const longestTrackSeconds = () =>
  tracks.reduce((longest, track) => Math.max(longest, track.startSeconds + track.duration), 0);

/**
 * Where a track starts. A range alone cannot be nudged to a frame and a number
 * alone cannot be swept, so it is both, bound to the same value.
 */
function placementControl(track, sessionSeconds) {
  const id = controlId(track, 'startSeconds');
  const labelNode = document.createElement('label');
  labelNode.className = 'voice-mix-placement';
  labelNode.htmlFor = id;
  const name = document.createElement('span');
  name.textContent = 'Starts at';
  const slider = document.createElement('input');
  slider.id = id;
  slider.type = 'range';
  slider.min = '0';
  // Room to move a track past everything already loaded, without offering a
  // twenty-minute sweep for a mix that is thirty seconds long.
  slider.max = String(Math.max(10, Math.ceil(sessionSeconds)));
  slider.step = '0.01';
  slider.value = String(track.startSeconds);
  const exact = document.createElement('input');
  exact.type = 'number';
  exact.min = '0';
  exact.max = String(VOICE_MIX_MAX_SECONDS);
  exact.step = '0.01';
  exact.value = track.startSeconds.toFixed(2);
  exact.setAttribute('aria-label', `${track.name} start in seconds`);
  const commit = (value, echo) => {
    const seconds = Math.min(VOICE_MIX_MAX_SECONDS, Math.max(0, Number(value) || 0));
    track.startSeconds = seconds;
    if (echo !== slider) slider.value = String(Math.min(Number(slider.max), seconds));
    if (echo !== exact) exact.value = seconds.toFixed(2);
    markChanged();
  };
  slider.addEventListener('input', () => commit(slider.value, slider));
  exact.addEventListener('change', () => commit(exact.value, exact));
  labelNode.append(name, slider, exact);
  return labelNode;
}

function paintTracks() {
  if (!tracks.length) {
    const empty = document.createElement('p');
    empty.className = 'voice-mix-empty';
    empty.textContent = 'Nothing here yet. Start with a voice track, then add a bed or an effect if the piece needs one.';
    trackList.replaceChildren(empty);
    updateTransport();
    return;
  }
  const cards = tracks.map((track, index) => {
    const card = document.createElement('article');
    card.className = 'voice-mix-track';
    card.dataset.role = track.role;
    const header = document.createElement('header');
    const identity = document.createElement('div');
    const number = document.createElement('span');
    number.className = 'voice-mix-track-number';
    number.textContent = String(index + 1).padStart(2, '0');
    const title = document.createElement('div');
    const heading = document.createElement('h3');
    heading.textContent = track.name;
    const metadata = document.createElement('p');
    const describe = () => `${roleLabel(track.role)} · ${track.duration.toFixed(1)}s · ${Math.round(track.sampleRate / 100) / 10} kHz · ${track.channels.length === 1 ? 'mono' : 'stereo'}`;
    const metadataText = document.createElement('span');
    metadataText.textContent = describe();
    metadata.append(metadataText);
    title.append(heading, metadata);
    identity.append(number, title);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn sm';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${track.name}`);
    remove.addEventListener('click', () => {
      // The decoded audio only exists in this session, so removing a track is
      // otherwise a re-import and a re-decode of a file the operator may not
      // still have to hand.
      removed = { track, index: tracks.indexOf(track) };
      tracks = tracks.filter(candidate => candidate !== track);
      paintTracks();
      markChanged(`${track.name} removed.`, () => {
        if (!removed) return;
        tracks.splice(Math.min(removed.index, tracks.length), 0, removed.track);
        const restored = removed.track.name;
        removed = null;
        paintTracks();
        markChanged(`${restored} restored.`);
      });
    });
    header.append(identity, remove);

    const switches = document.createElement('div');
    switches.className = 'voice-mix-track-switches';
    for (const [key, label] of [['mute', 'Mute'], ['solo', 'Solo']]) {
      const id = controlId(track, key);
      const wrapper = document.createElement('label');
      wrapper.htmlFor = id;
      const input = document.createElement('input');
      input.id = id;
      input.type = 'checkbox';
      input.checked = track[key];
      input.addEventListener('change', () => {
        track[key] = input.checked;
        card.classList.toggle(`is-${key}`, input.checked);
        markChanged();
      });
      wrapper.append(input, ` ${label}`);
      switches.append(wrapper);
    }
    const roleId = controlId(track, 'role');
    const role = document.createElement('label');
    role.htmlFor = roleId;
    const roleName = document.createElement('span');
    roleName.textContent = 'Purpose';
    const roleSelect = document.createElement('select');
    roleSelect.id = roleId;
    for (const option of VOICE_MIX_ROLES) roleSelect.append(new Option(option.label, option.id, false, option.id === track.role));
    roleSelect.addEventListener('change', () => {
      track.role = roleSelect.value;
      card.dataset.role = track.role;
      metadataText.textContent = describe();
      markChanged();
    });
    role.append(roleName, roleSelect);
    switches.append(role);

    const controls = document.createElement('div');
    controls.className = 'voice-mix-track-controls';
    controls.append(
      rangeControl(track, 'gainDb', 'Gain', -60, 12, 0.5, value => `${value.toFixed(1)} dB`),
      rangeControl(track, 'pan', 'Pan', -1, 1, 0.01, value => Math.abs(value) < 0.005 ? 'Center' : `${value < 0 ? 'L' : 'R'} ${Math.round(Math.abs(value) * 100)}`),
      rangeControl(track, 'reverbSend', 'Room send', 0, 1, 0.01, value => `${Math.round(value * 100)}%`),
      // A sting that has to land on a word, and a bed that has to start under
      // the second sentence, are the two things every voice mix needs and
      // neither is possible if every source is nailed to zero.
      placementControl(track, longestTrackSeconds())
    );
    card.classList.toggle('is-mute', track.mute);
    card.classList.toggle('is-solo', track.solo);
    card.append(header, switches, controls);
    return card;
  });
  trackList.replaceChildren(...cards);
  updateTransport();
}

async function importFiles(fileList, role) {
  if (!(await requirePro())) return;
  const files = [...fileList];
  if (!files.length) return;
  if (tracks.length + files.length > VOICE_MIX_MAX_TRACKS) {
    return setStatus(`The desk holds ${VOICE_MIX_MAX_TRACKS} tracks at a time. Remove one to make room.`, true);
  }
  const Context = audioContextConstructor();
  if (!Context) return setStatus('This browser cannot open audio files here. Try a current desktop browser.', true);
  const context = new Context({ sampleRate: 48000 });
  let imported = 0;
  try {
    for (const file of files) {
      if (file.size > 512 * 1024 * 1024) {
        setStatus(`${boundedName(file.name)} is over the 512 MB per-track limit.`, true);
        continue;
      }
      setStatus(`Opening ${boundedName(file.name)}…`);
      try {
        const decoded = await context.decodeAudioData(await file.arrayBuffer());
        if (!decoded.duration || decoded.duration > VOICE_MIX_MAX_SECONDS) {
          setStatus(`${boundedName(file.name)} must be shorter than ${VOICE_MIX_MAX_SECONDS / 60} minutes.`, true);
          continue;
        }
        const defaults = defaultVoiceMixTrack(role);
        tracks.push({
          id: crypto.randomUUID(),
          name: boundedName(file.name),
          duration: decoded.duration,
          sampleRate: decoded.sampleRate,
          channels: Array.from({ length: Math.min(2, decoded.numberOfChannels) }, (_, channel) =>
            new Float32Array(decoded.getChannelData(channel))),
          ...defaults
        });
        imported++;
      } catch {
        setStatus(`${boundedName(file.name)} would not open. WAV, MP3, M4A and FLAC all work.`, true);
      }
    }
  } finally {
    context.close().catch(() => undefined);
    fileInput.value = '';
  }
  paintTracks();
  if (imported) markChanged(`${imported} ${roleLabel(role).toLowerCase()} track${imported === 1 ? '' : 's'} ready. Preview to hear the mix.`);
}

for (const button of document.querySelectorAll('[data-mix-import]')) {
  button.addEventListener('click', async () => {
    if (!(await requirePro())) return;
    pendingRole = button.dataset.mixImport;
    fileInput.click();
  });
}
fileInput?.addEventListener('change', event => importFiles(event.target.files, pendingRole));

const readSettings = () => ({
  bypassProcessing: $('#mixProcessingBypass').checked,
  voiceStrip: {
    bypass: $('#mixStripBypass').checked,
    highPassHz: Number($('#mixHighPass').value),
    lowEqDb: Number($('#mixLowEq').value),
    midEqDb: Number($('#mixMidEq').value),
    highEqDb: Number($('#mixHighEq').value),
    gateThresholdDb: Number($('#mixGate').value),
    compressorThresholdDb: Number($('#mixCompThreshold').value),
    compressorRatio: Number($('#mixCompRatio').value),
    deEsserAmount: Number($('#mixDeEsser').value) / 100
  },
  ducking: {
    enabled: $('#mixDuckEnabled').checked,
    depthDb: Number($('#mixDuckDepth').value),
    thresholdDb: Number($('#mixDuckThreshold').value),
    attackMs: Number($('#mixDuckAttack').value),
    holdMs: Number($('#mixDuckHold').value),
    releaseMs: Number($('#mixDuckRelease').value)
  },
  reverb: {
    returnDb: Number($('#mixRoomReturn').value),
    roomSize: Number($('#mixRoomSize').value) / 100
  },
  master: {
    gainDb: Number($('#mixMasterGain').value),
    limiterBypass: $('#mixLimiterBypass').checked,
    truePeakCeilingDb: Number($('#mixLimiterCeiling').value)
  }
});

const globalControlFormats = {
  mixHighPass: value => `${Math.round(value)} Hz`,
  mixLowEq: value => `${value > 0 ? '+' : ''}${value} dB`,
  mixMidEq: value => `${value > 0 ? '+' : ''}${value} dB`,
  mixHighEq: value => `${value > 0 ? '+' : ''}${value} dB`,
  mixGate: value => `${value} dB`,
  mixCompThreshold: value => `${value} dB`,
  mixCompRatio: value => `${value}:1`,
  mixDeEsser: value => `${value}%`,
  mixDuckDepth: value => `${Number(value).toFixed(1)} dB`,
  mixDuckThreshold: value => `${value} dB`,
  mixDuckAttack: value => `${value} ms`,
  mixDuckHold: value => `${value} ms`,
  mixDuckRelease: value => `${value} ms`,
  mixRoomReturn: value => `${value} dB`,
  mixRoomSize: value => `${value}%`,
  mixMasterGain: value => `${value > 0 ? '+' : ''}${value} dB`,
  mixLimiterCeiling: value => `${Number(value).toFixed(1)} dBTP`
};
for (const [id, format] of Object.entries(globalControlFormats)) {
  const input = $(`#${id}`);
  const output = input?.closest('label')?.querySelector('output');
  if (!input || !output) continue;
  const paint = () => { output.textContent = format(Number(input.value)); };
  input.addEventListener('input', () => { paint(); saveMixSettings(); markChanged(); });
  paint();
}
for (const id of ['mixStripBypass', 'mixLimiterBypass', 'mixProcessingBypass', 'mixDuckEnabled']) {
  $(`#${id}`)?.addEventListener('change', () => { saveMixSettings(); markChanged(); });
}

// Desk settings are kept between sessions; audio never is. A strip and a duck
// that someone dialled in for their room is a setup, not a document, and being
// made to rebuild it every time the window opens is the difference between a
// tool and a demo. Only numbers and switches are stored — the sanitizer is the
// same one the engine runs, so a hand-edited or stale store cannot push the
// desk anywhere the controls could not.
const MIX_SETTINGS_KEY = 'mlx:voice-mix-settings';

function saveMixSettings() {
  try { localStorage.setItem(MIX_SETTINGS_KEY, JSON.stringify(sanitizeVoiceMixSettings(readSettings()))); }
  catch { /* a full or blocked store must not stop the desk working */ }
}

function paintSettings(settings) {
  $('#mixStripBypass').checked = settings.voiceStrip.bypass;
  $('#mixHighPass').value = String(settings.voiceStrip.highPassHz);
  $('#mixLowEq').value = String(settings.voiceStrip.lowEqDb);
  $('#mixMidEq').value = String(settings.voiceStrip.midEqDb);
  $('#mixHighEq').value = String(settings.voiceStrip.highEqDb);
  $('#mixGate').value = String(settings.voiceStrip.gateThresholdDb);
  $('#mixCompThreshold').value = String(settings.voiceStrip.compressorThresholdDb);
  $('#mixCompRatio').value = String(settings.voiceStrip.compressorRatio);
  $('#mixDeEsser').value = String(settings.voiceStrip.deEsserAmount * 100);
  $('#mixDuckEnabled').checked = settings.ducking.enabled;
  $('#mixDuckDepth').value = String(settings.ducking.depthDb);
  $('#mixDuckThreshold').value = String(settings.ducking.thresholdDb);
  $('#mixDuckAttack').value = String(settings.ducking.attackMs);
  $('#mixDuckHold').value = String(settings.ducking.holdMs);
  $('#mixDuckRelease').value = String(settings.ducking.releaseMs);
  $('#mixRoomReturn').value = String(settings.reverb.returnDb);
  $('#mixRoomSize').value = String(settings.reverb.roomSize * 100);
  $('#mixMasterGain').value = String(settings.master.gainDb);
  $('#mixLimiterBypass').checked = settings.master.limiterBypass;
  $('#mixLimiterCeiling').value = String(settings.master.truePeakCeilingDb);
  $('#mixProcessingBypass').checked = settings.bypassProcessing;
  for (const [id, format] of Object.entries(globalControlFormats)) {
    const input = $(`#${id}`);
    const output = input?.closest('label')?.querySelector('output');
    if (input && output) output.textContent = format(Number(input.value));
  }
}

function restoreMixSettings() {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(MIX_SETTINGS_KEY) || 'null'); } catch { return; }
  if (stored && typeof stored === 'object') paintSettings(sanitizeVoiceMixSettings(stored));
}

function applyDefaults() {
  const settings = defaultVoiceMixSettings();
  paintSettings(settings);
  saveMixSettings();
  tracks = tracks.map(track => ({ ...track, ...defaultVoiceMixTrack(track.role) }));
  paintTracks();
  markChanged('Mix controls reset, placements included. Your audio is still loaded.');
}
$('#voiceMixReset')?.addEventListener('click', applyDefaults);
restoreMixSettings();

const duckSummary = rendered => rendered.duckedTrackCount
  ? `bed ducked ${Math.abs(rendered.stats.deepestDuckDb).toFixed(1)} dB under the voice`
  : 'no bed ducking';

function renderCurrentMix() {
  const settings = readSettings();
  const fingerprint = voiceMixFingerprint(tracks, settings);
  if (cachedRender && cachedFingerprint === fingerprint) return cachedRender;
  cachedRender = renderVoiceMix(tracks, settings);
  cachedFingerprint = fingerprint;
  return cachedRender;
}

function audioBufferFrom(context, channels, sampleRate) {
  const buffer = context.createBuffer(2, channels[0].length, sampleRate);
  buffer.copyToChannel(channels[0], 0);
  buffer.copyToChannel(channels[1], 1);
  return buffer;
}

function setMeter(meter, output, decibels) {
  const bounded = Number.isFinite(decibels) ? Math.max(-60, Math.min(0, decibels)) : -60;
  meter.value = bounded;
  output.textContent = Number.isFinite(decibels) ? `${decibels.toFixed(1)} dBFS` : '−∞ dBFS';
}

function stopPreview(updateStatus = true) {
  if (playback) {
    cancelAnimationFrame(playback.animationFrame);
    for (const source of playback.sources) { try { source.stop(); } catch { /* already stopped */ } }
    playback.context.close().catch(() => undefined);
    playback = null;
  }
  setMeter($('#mixInputMeter'), $('#mixInputMeterValue'), -Infinity);
  setMeter($('#mixOutputMeter'), $('#mixOutputMeterValue'), -Infinity);
  updateTransport();
  if (updateStatus && tracks.length) setStatus('Preview stopped. Your settings are still here.');
}

async function previewMix(rendered) {
  stopPreview(false);
  const Context = audioContextConstructor();
  if (!Context) throw new Error('Local Web Audio preview is unavailable in this browser.');
  const context = new Context({ sampleRate: rendered.sampleRate });
  await context.resume();
  const inputSource = context.createBufferSource();
  inputSource.buffer = audioBufferFrom(context, rendered.preMasterChannels, rendered.sampleRate);
  const outputSource = context.createBufferSource();
  outputSource.buffer = audioBufferFrom(context, rendered.channels, rendered.sampleRate);
  const inputAnalyser = context.createAnalyser();
  const outputAnalyser = context.createAnalyser();
  inputAnalyser.fftSize = 2048;
  outputAnalyser.fftSize = 2048;
  const inaudible = context.createGain();
  inaudible.gain.value = 0.000001;
  inputSource.connect(inputAnalyser).connect(inaudible).connect(context.destination);
  outputSource.connect(outputAnalyser).connect(context.destination);
  const inputSamples = new Float32Array(inputAnalyser.fftSize);
  const outputSamples = new Float32Array(outputAnalyser.fftSize);
  const meterDb = samples => {
    let peak = 0;
    for (let index = 0; index < samples.length; index++) peak = Math.max(peak, Math.abs(samples[index]));
    return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  };
  const paintMeters = () => {
    if (!playback) return;
    inputAnalyser.getFloatTimeDomainData(inputSamples);
    outputAnalyser.getFloatTimeDomainData(outputSamples);
    setMeter($('#mixInputMeter'), $('#mixInputMeterValue'), meterDb(inputSamples));
    setMeter($('#mixOutputMeter'), $('#mixOutputMeterValue'), meterDb(outputSamples));
    playback.animationFrame = requestAnimationFrame(paintMeters);
  };
  playback = { context, sources: [inputSource, outputSource], animationFrame: 0 };
  outputSource.addEventListener('ended', () => {
    if (!playback || playback.context !== context) return;
    stopPreview(false);
    setStatus(`Preview complete · output ${finiteDb(rendered.stats.outputTruePeakDb).replace(' dB', ' dBTP')}.`);
  }, { once: true });
  const startAt = context.currentTime + 0.04;
  inputSource.start(startAt);
  outputSource.start(startAt);
  playback.animationFrame = requestAnimationFrame(paintMeters);
  updateTransport();
}

previewButton?.addEventListener('click', async () => {
  if (!(await requirePro()) || !tracks.length) return;
  previewButton.disabled = true;
  setStatus('Building the preview on this computer…');
  await yieldToPaint();
  try {
    const rendered = renderCurrentMix();
    await previewMix(rendered);
    setStatus(`Previewing ${rendered.audibleTrackCount} audible track${rendered.audibleTrackCount === 1 ? '' : 's'} · ${rendered.duration.toFixed(1)}s · ${duckSummary(rendered)} · limiter ${rendered.stats.limiterGainReductionDb < -0.05 ? `${Math.abs(rendered.stats.limiterGainReductionDb).toFixed(1)} dB reduction` : 'idle'}.`);
  } catch (error) {
    setStatus(`Mix preview failed: ${error.message}`, true);
  } finally {
    updateTransport();
  }
});

stopButton?.addEventListener('click', () => stopPreview());

exportButton?.addEventListener('click', async () => {
  if (!(await requirePro()) || !tracks.length) return;
  exportButton.disabled = true;
  setStatus('Rendering your stereo WAV on this computer…');
  await yieldToPaint();
  try {
    const rendered = renderCurrentMix();
    const bytes = encodeVoiceMixWav(rendered);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'voice-pro-mix.wav';
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    setStatus(`WAV ready · ${rendered.sampleRate / 1000} kHz stereo PCM · ${rendered.duration.toFixed(1)}s · ${duckSummary(rendered)} · ${finiteDb(rendered.stats.outputTruePeakDb).replace(' dB', ' dBTP')} · ${(bytes.length / 1048576).toFixed(1)} MB.`);
  } catch (error) {
    setStatus(`Mix export failed: ${error.message}`, true);
  } finally {
    updateTransport();
  }
});

addEventListener('pagehide', () => {
  stopPreview(false);
  tracks = [];
  cachedRender = null;
});

paintTracks();
const initialVerification = verifyProAccess().then(() => {
  let requested = 'direction';
  try { requested = localStorage.getItem('mlx:voice-workspace') || 'direction'; } catch { /* unavailable */ }
  showWorkspace(requested === 'mix' ? 'mix' : 'direction');
});

// Local release QA drives the real import, preview, and download controls. The
// hook cannot exist on a deployed host and still uses the production entitlement
// predicate; it only supplies the signed-license claims normally returned by
// activeLicense().
if (localVoiceProQaEnabled) {
  Object.defineProperty(window, '__materiallogixVoiceProQa', {
    configurable: true,
    value: Object.freeze({
      async applyEntitlement(license) {
        await initialVerification;
        localQaLicense = license;
        return applyProAccess(license);
      },
      state() {
        return Object.freeze({
          proVerified,
          trackCount: tracks.length,
          tracks: tracks.map(track => Object.freeze({
            name: track.name,
            role: track.role,
            duration: track.duration,
            sampleRate: track.sampleRate,
            channels: track.channels.length
          }))
        });
      }
    })
  });
}
