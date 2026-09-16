// Local voice performance and finishing utilities.
//
// Any TTS engine renders words; this layer renders a PERFORMANCE. It sits on
// top of whichever engine is plugged in (Kokoro or another free model via the
// bridge, or even a human VO file) and does three jobs:
//
//   1. performancePlan(script)  — text → direction: segments, pauses, breaths,
//      emphasis, pacing that varies the way a person's actually does.
//   2. humanizeBuffer(audio)    — voice finishing: breath support,
//      room tone instead of digital silence, micro-timing, gentle glue
//      compression. Pure Web Audio, free, runs on this machine.
//   3. voiceTells(audio)        — measurements of the too-perfect tells
//      (digital-zero floor, metronome pacing, flat loudness), mirroring the
//      image-quality diagnostics: they direct review and never replace it.
//
// Consent rule carried from identity packs: voices come from packs the user
// owns — their own recording or released talent. Never scraped audio.

// --- 1. performance planning (pure; node-testable) --------------------------

const PAUSE_MS = { '.': 420, '!': 380, '?': 470, ',': 220, ';': 300, ':': 280, '—': 320, '…': 500 };
const LONG_SENTENCE = 18;   // words; beyond this we split at commas
// The renderer trims each engine segment's own silence so these numbers are
// the gap a listener actually hears. That makes the shortest of them literal:
// a comma under an "(urgent)" direction lands near 112 ms, and a bit-exact
// digital gap of 20-150 ms bracketed by speech is precisely what ear.py counts
// as a dropout. Floor the inserted gap just above that window so a legitimately
// brisk pause is never scored as broken audio.
const MIN_PAUSE_MS = 160;

// Deterministic per-index wobble so plans are stable across runs and tests.
const wobble = (i, spread) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2 * spread;
};

// A leading "(sad)" on a paragraph is a stage direction, never spoken — it
// biases that paragraph's rate/pitch/energy/pauses on top of the existing
// per-sentence shape (a question still lifts, a short line still lands).
//
// These were general affective-prosody knowledge until 2026-09-02, when they
// were calibrated against measured speech: all 7,442 clips of CREMA-D, each
// emotion paired against the same actor speaking the same sentence neutrally,
// cross-checked against published prosody literature. Two of the old values
// pointed the wrong way outright — see docs/RESEARCH_PROSODY_REFERENCE_SOURCES.md.
//
//   angry was faster and flat; measured 21% SLOWER and 33% HIGHER in pitch.
//   sad was pitched down; nothing supports that. What sadness robustly is, is
//     much quieter (measured 0.65).
//   excited and urgent were carried by speed; they are carried by pause and
//     pitch instead (Trouvain & Barry measured real commentary going calm to
//     peak with articulation rate unchanged and pauses compressed to 0.62).
//   serious is unchanged because no evidence was found for it, rather than
//     adjusted to look consistent.
//
// Values sit deliberately INSIDE the measured human ratios. A person getting
// angry changes vocal effort, glottal source and spectral tilt; `energy` here
// is a plain gain, so multiplying amplitude by the measured 2.88 would sound
// like the same read, louder. Every pitch value also stays within the 0.85-1.15
// clamp that tts_render.py applies for phase-vocoder artefact reasons; the raw
// evidence wants more, and widening that clamp is a separate, testable change.
//
// Caveat found while verifying these in rendered audio: the three knobs are not
// independent. `rate` changes Kokoro's speed parameter, which re-synthesises the
// line rather than time-stretching it, so intrinsic loudness moves too. `energy`
// therefore sets the direction of loudness reliably but not its exact ratio —
// calm, at energy 0.88, still rendered marginally louder than neutral. Judge
// these by rendering, never by reading the numbers alone.
const DIRECTIONS = {
  sad: { rate: 0.96, pitch: 1.00, energy: 0.70, pause: 1.25 },
  excited: { rate: 1.02, pitch: 1.14, energy: 1.28, pause: 0.68 },
  happy: { rate: 1.00, pitch: 1.12, energy: 1.25, pause: 0.80 },
  angry: { rate: 0.92, pitch: 1.12, energy: 1.45, pause: 0.90 },
  calm: { rate: 0.96, pitch: 0.98, energy: 0.88, pause: 1.20 },
  serious: { rate: 0.93, pitch: 0.98, energy: 0.95, pause: 1.20 },
  urgent: { rate: 1.04, pitch: 1.12, energy: 1.20, pause: 0.62 },
  gentle: { rate: 0.96, pitch: 1.00, energy: 0.80, pause: 1.20 }
};
const DIRECTION_TAG = /^\(([a-z][a-z\s]{0,20})\)\s*/i;

/**
 * @param {string} script  Markup: *word* = emphasis, ... = long beat,
 *                         blank line = paragraph (breath + reset), a leading
 *                         "(sad)"/"(excited)"/etc. = stage direction (never
 *                         spoken; see DIRECTIONS for the full list).
 * @returns {{segments: Array, totalWords: number}}
 */
export function performancePlan(script) {
  const paragraphs = String(script || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const segments = [];
  let idx = 0;

  for (const rawPara of paragraphs) {
    const tagMatch = rawPara.match(DIRECTION_TAG);
    const direction = tagMatch ? DIRECTIONS[tagMatch[1].trim().toLowerCase()] : undefined;
    // Only strip the parenthetical when it's a direction we actually act on —
    // an unrecognized "(door creaks)" is ordinary spoken text, not a tag.
    const para = direction ? rawPara.slice(tagMatch[0].length).trim() : rawPara;
    if (!para) continue;
    // Split into sentences, keeping the terminator.
    const sentences = para.match(/[^.!?…]+[.!?…]+["')\]]*|[^.!?…]+$/g) || [];
    let first = true;
    for (const sentence of sentences) {
      // Long sentences get split at commas so the voice can actually breathe.
      const words = sentence.trim().split(/\s+/);
      const clauses = words.length > LONG_SENTENCE
        ? sentence.split(/(?<=,)/)
        : [sentence];
      for (let c = 0; c < clauses.length; c++) {
        const raw = clauses[c].trim();
        if (!raw) continue;
        const emphasis = [];
        const text = raw
          .replace(/\*([^*]+)\*/g, (_, w) => { emphasis.push(w.toLowerCase()); return w; })
          .replace(/\s+/g, ' ');
        for (const w of text.split(' ')) {
          if (w.length > 3 && w === w.toUpperCase() && /[A-Z]/.test(w)) emphasis.push(w.toLowerCase());
        }
        const tail = text.slice(-1);
        const isQuestion = /\?/.test(text);
        const isExclamation = /!/.test(text);
        const wordCount = text.split(' ').length;
        const intent = isQuestion ? 'invite' : isExclamation ? 'lift' : wordCount < 6 ? 'land' : c < clauses.length - 1 ? 'carry' : 'settle';
        const rate = 1 + (wordCount > 12 ? 0.04 : wordCount < 5 ? -0.05 : 0) + wobble(idx, 0.025);
        // Questions lift, statements settle.
        const pitch = isQuestion ? 1.02 : 1 + wobble(idx + 7, 0.012);
        const energy = 1 + (isExclamation ? 0.08 : wordCount < 6 ? 0.035 : -0.01) + emphasis.length * 0.025 + wobble(idx + 23, 0.025);
        const pauseMs = (PAUSE_MS[tail] || 260) * (1 + wobble(idx + 13, 0.15));
        segments.push({
          text,
          emphasis,
          rate: +(rate * (direction?.rate ?? 1)).toFixed(3),
          pitch: +(pitch * (direction?.pitch ?? 1)).toFixed(3),
          intent,
          energy: +(energy * (direction?.energy ?? 1)).toFixed(3),
          pauseAfterMs: Math.max(MIN_PAUSE_MS, Math.round(pauseMs * (direction?.pause ?? 1))),
          breathBefore: first || (wordCount >= 10 && idx % 3 !== 1),
          paragraphStart: first
        });
        first = false;
        idx++;
      }
    }
    if (segments.length) segments[segments.length - 1].pauseAfterMs += 320;   // paragraph settle
  }
  return { segments, totalWords: segments.reduce((n, s) => n + s.text.split(' ').length, 0) };
}

// The finishing pass below opens and closes the file with room tone. It is
// part of every delivered read, so the duration estimate has to count it, and
// both places read the same two numbers so they cannot drift apart.
// Exported because anything drawn over a finished take has to know how far
// finishing moved it: humanizeBuffer returns head + take + tail, so a moment
// measured in the source sits FINISH_HEAD_S later in what is drawn and played.
export const FINISH_HEAD_S = 0.5;
const FINISH_TAIL_S = 0.6;

// Speaking rate excluding the plan's own pauses, at profile pace 1.0.
//
// Measured, not assumed: the same 22-word script rendered through the real
// house-voice engine across five profiles spanning the pace range (Avenue
// 0.86, District 0.88, Studio 0.99, Metro 1.12, Signal 1.15) came back at
// 191-260 wpm once pace was divided out, mean 228. The previous 150 was a
// guess and overestimated every read by about half, which made the voiceover
// word budget hand back roughly a third fewer words than actually fit.
//
// 215 sits deliberately under the 228 mean. The error that matters is a read
// overrunning its video, so the estimate leans long and the budget leans
// short. Each voice also has its own rate on top of pace, which is why this
// is a band and not a precise number; expect +/-15% per profile.
const BASE_WPM = 215;

/**
 * Read time of the delivered file: speech at the base rate above scaled by the
 * profile's pace, the plan's own pauses, and the finishing pass's head and tail
 * room.
 *
 * It deliberately charges nothing for per-segment breaths. Finishing does place
 * one at each marked phrase, but inside the pause the plan already asked for
 * rather than after it, so a breath costs no extra time. Charging 0.32s for
 * each flagged segment inflated the estimate by 3-7% on real scripts, which
 * made the video word budget hand back a shorter script than actually fits.
 */
export function planDuration(plan, pace = 1) {
  const speech = (plan.totalWords / (BASE_WPM * (pace || 1))) * 60;
  const pauses = plan.segments.reduce((n, s) => n + s.pauseAfterMs, 0) / 1000;
  return +(speech + pauses + FINISH_HEAD_S + FINISH_TAIL_S).toFixed(1);
}

/**
 * The inverse of planDuration: how many words fit a video of this length,
 * spoken at a profile's pace (1.0 = the base rate above). Reserves a breath of
 * lead-in and lead-out so reads never slam the cut points.
 */
export function wordBudgetForSeconds(seconds, pace = 1.0) {
  const usable = Math.max(0, seconds - 1.2);
  const words = Math.floor(usable * (BASE_WPM / 60) * pace);
  return Math.max(0, words);
}

// --- 2. the human post-chain (browser; Web Audio) ---------------------------

/** A synthesized breath: band-passed noise with a soft swell. Reads as human. */
function breathBuffer(ctx, seconds = 0.3, gainDb = -34) {
  const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let lp = 0;
  const g = Math.pow(10, gainDb / 20);
  for (let i = 0; i < d.length; i++) {
    const env = Math.sin((i / d.length) * Math.PI) ** 1.6;          // swell
    lp = lp * 0.72 + (Math.random() * 2 - 1) * 0.28;                // hiss → airflow
    d[i] = lp * env * g;
  }
  return buf;
}

// Below this, a run of samples is the silence the engine wrote between two
// phrases rather than anything a microphone or a model produced. It is not
// exact zero because decoding a delivered file at a different sample rate
// resamples the gap, which leaves the interior at the noise of the arithmetic
// rather than at nothing.
const RENDERED_GAP_FLOOR = 1e-5;
const MIN_BREATH_GAP_S = 0.18;
const MAX_BREATH_S = 0.26;
// A breath has to finish before the next word does, not land on top of it.
const BREATH_LEAD_OUT_S = 0.03;

/**
 * The silences the engine laid between rendered phrases, in order.
 *
 * tts_render.py writes each phrase, fades its edges to zero, and appends the
 * pause the direction asked for as literal silence. Nothing else in a rendered
 * take is silent for that long, so these runs locate the joins exactly — which
 * is what lets a breath be placed in the gap the direction already made room
 * for, instead of being guessed at from the waveform.
 */
function renderedGaps(channel, sampleRate, minSeconds = 0.1) {
  const gaps = [];
  const minRun = Math.round(minSeconds * sampleRate);
  let run = 0;
  for (let i = 0; i <= channel.length; i++) {
    const quiet = i < channel.length && Math.abs(channel[i]) < RENDERED_GAP_FLOOR;
    if (quiet) { run++; continue; }
    if (run >= minRun) gaps.push({ startSeconds: (i - run) / sampleRate, seconds: run / sampleRate });
    run = 0;
  }
  return gaps;
}

/**
 * Where a breath goes in a rendered take, given the direction that made it.
 *
 * `breathBefore` is the plan's flag for the phrases the read draws breath in
 * front of, in render order. Gap n sits after phrase n, so the breath for
 * phrase n lands in gap n-1; the first phrase's breath is the one finishing
 * already places in the head room. An engine that stops writing one gap per
 * phrase would silently shift every breath onto the wrong word, so a take whose
 * gaps do not line up with the direction gets none rather than the wrong ones.
 */
export function breathPlacements(channel, sampleRate, breathBefore = []) {
  if (breathBefore.length < 2) return [];
  const gaps = renderedGaps(channel, sampleRate);
  const joins = gaps.length === breathBefore.length ? gaps.slice(0, -1) : gaps;
  if (joins.length !== breathBefore.length - 1) return [];
  const placements = [];
  for (let phrase = 1; phrase < breathBefore.length; phrase++) {
    if (!breathBefore[phrase]) continue;
    const gap = joins[phrase - 1];
    if (gap.seconds < MIN_BREATH_GAP_S) continue;
    const seconds = Math.min(MAX_BREATH_S, gap.seconds * 0.7);
    placements.push({ atSeconds: gap.startSeconds + gap.seconds - BREATH_LEAD_OUT_S - seconds, seconds });
  }
  return placements;
}

/**
 * Take rendered speech and make it breathe. Adds head/tail room tone, a breath
 * at the front and at every phrase the direction draws breath before, gentle
 * glue compression, and a constant low room-tone bed so there is never
 * digital-zero silence anywhere in the file.
 */
export async function humanizeBuffer(input, {
  roomToneDb = -58, breathDb = -34, headSeconds = FINISH_HEAD_S, tailSeconds = FINISH_TAIL_S,
  presenceDb = 0.8, airDb = -1.4, movementDb = 0.7, breaths = []
} = {}) {
  const sr = input.sampleRate;
  const outLength = Math.round((headSeconds + tailSeconds) * sr) + input.length;
  const ctx = new OfflineAudioContext(1, outLength, sr);

  // A restrained voice chain: slight presence, softened synthetic sibilance,
  // phrase-level movement, then gentle mic-bus compression. The goal is not an
  // audible effect; it is to remove the too-perfect spectral/dynamic shape.
  const src = ctx.createBufferSource();
  src.buffer = input;
  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking'; presence.frequency.value = 2800; presence.Q.value = 0.75; presence.gain.value = presenceDb;
  const air = ctx.createBiquadFilter();
  air.type = 'highshelf'; air.frequency.value = 6200; air.gain.value = airDb;
  const movement = ctx.createGain();
  const base = Math.pow(10, -0.8 / 20);
  const delta = Math.pow(10, movementDb / 20) - 1;
  movement.gain.setValueAtTime(base, headSeconds);
  const duration = input.duration;
  for (let t = 0; t <= duration; t += 1.7) {
    const human = base * (1 + Math.sin(t * 1.31 + 0.6) * delta * 0.55 + Math.sin(t * 0.47) * delta * 0.3);
    movement.gain.linearRampToValueAtTime(human, headSeconds + Math.min(duration, t));
  }
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 2.4;
  comp.attack.value = 0.012; comp.release.value = 0.22;
  src.connect(presence).connect(air).connect(movement).connect(comp).connect(ctx.destination);
  src.start(headSeconds);

  // Breath just before the first word.
  const breath = ctx.createBufferSource();
  breath.buffer = breathBuffer(ctx, 0.3, breathDb);
  breath.connect(ctx.destination);
  breath.start(Math.max(0, headSeconds - 0.28));

  // And one in each gap the direction draws breath in. A catch-breath mid-read
  // is quieter than the one taken before the first word, so it sits down a few
  // decibels; the same gain would read as a gasp.
  for (const placement of breaths) {
    if (!(placement.seconds > 0) || !Number.isFinite(placement.atSeconds)) continue;
    const at = headSeconds + placement.atSeconds;
    if (at < 0 || at + placement.seconds > headSeconds + duration) continue;
    const source = ctx.createBufferSource();
    source.buffer = breathBuffer(ctx, placement.seconds, breathDb - 4);
    source.connect(ctx.destination);
    source.start(at);
  }

  // Room tone across the whole file: silence in a real room is never zero.
  const tone = ctx.createBuffer(1, outLength, sr);
  const td = tone.getChannelData(0);
  const tg = Math.pow(10, roomToneDb / 20);
  let lp = 0;
  for (let i = 0; i < td.length; i++) {
    lp = lp * 0.94 + (Math.random() * 2 - 1) * 0.06;
    td[i] = lp * tg;
  }
  const toneSrc = ctx.createBufferSource();
  toneSrc.buffer = tone;
  toneSrc.connect(ctx.destination);
  toneSrc.start(0);

  return ctx.startRendering();
}

// --- 3. synthetic-sound tells (browser; operates on an AudioBuffer) ----------

export function voiceTells(buffer) {
  const d = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const win = Math.round(sr * 0.05);
  const rms = [];
  for (let i = 0; i + win <= d.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += d[j] * d[j];
    rms.push(Math.sqrt(sum / win));
  }
  const speech = rms.filter(v => v > 0.01);
  const quiet = rms.filter(v => v <= 0.01);
  const mean = speech.reduce((a, b) => a + b, 0) / (speech.length || 1);
  const variance = speech.reduce((a, b) => a + (b - mean) ** 2, 0) / (speech.length || 1);
  const floor = quiet.length ? Math.min(...quiet) : 0;

  // Pause rhythm: a metronome reads as a machine.
  const pauses = [];
  let run = 0;
  for (const v of rms) {
    if (v <= 0.01) run++;
    else { if (run >= 2) pauses.push(run); run = 0; }
  }
  const pMean = pauses.reduce((a, b) => a + b, 0) / (pauses.length || 1);
  const pVar = pauses.reduce((a, b) => a + (b - pMean) ** 2, 0) / (pauses.length || 1);

  let peak = 0, energy = 0, diffEnergy = 0, clipped = 0, transients = 0;
  for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i]); peak = Math.max(peak, a); energy += d[i] * d[i];
    if (a >= 0.995) clipped++;
    if (i) { const delta = d[i] - d[i - 1]; diffEnergy += delta * delta; if (Math.abs(delta) > 0.32) transients++; }
  }
  const totalRms = Math.sqrt(energy / Math.max(1, d.length));
  const crestFactorDb = totalRms ? 20 * Math.log10(peak / totalRms) : 0;
  const sibilanceIndex = energy ? Math.sqrt(diffEnergy / energy) : 0;
  const clipPercent = d.length ? clipped / d.length * 100 : 0;

  return {
    silenceFloorDb: floor > 0 ? +(20 * Math.log10(floor)).toFixed(1) : -Infinity,
    loudnessCv: mean ? +(Math.sqrt(variance) / mean).toFixed(3) : 0,
    pauseCount: pauses.length,
    pauseJitter: pMean ? +(Math.sqrt(pVar) / pMean).toFixed(3) : 0,
    crestFactorDb: +crestFactorDb.toFixed(1),
    sibilanceIndex: +sibilanceIndex.toFixed(3),
    clipPercent: +clipPercent.toFixed(3),
    transientClicks: transients,
    tells: [
      ...(floor === 0 ? ['digital-zero silence (no room tone)'] : []),
      ...(mean && Math.sqrt(variance) / mean < 0.18 ? ['flat loudness (no human dynamics)'] : []),
      ...(pauses.length > 3 && pMean && Math.sqrt(pVar) / pMean < 0.2 ? ['metronome pausing'] : [])
      ,...(clipPercent > 0.02 ? ['clipping at full scale'] : [])
      ,...(transients > Math.max(2, buffer.duration * 0.8) ? ['click-like transients'] : [])
      ,...(sibilanceIndex > 0.42 ? ['hard synthetic sibilance'] : [])
      ,...(crestFactorDb < 5 ? ['over-compressed dynamics'] : [])
    ]
  };
}

/**
 * Preview stamp for unlicensed renders: the spoken mark is inserted at the
 * start, the middle, and the end, so no crop can remove all three. The free
 * tier stays fully audible - and unmistakably a preview.
 */
export async function stampPreview(voiceBuffer, stampBuffer) {
  const sr = voiceBuffer.sampleRate;
  const stamp = stampBuffer;
  // The stamp's own length in the destination's frames. Both buffers come from
  // one decode context today and so share a rate, but the layout below is pure
  // frame arithmetic while playback resamples on its own: a stamp at another
  // rate would lay the second half of the take over the middle mark.
  const stampFrames = Math.round(stamp.duration * sr);
  const gap = Math.round(sr * 0.25);
  const s3 = stampFrames * 3 + gap * 6;
  const ctx = new OfflineAudioContext(1, voiceBuffer.length + s3, sr);

  const place = (buf, at) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(at / sr);
  };
  const half = Math.floor(voiceBuffer.length / 2);
  // head stamp | first half | mid stamp | second half | tail stamp
  place(stamp, 0);
  const firstHalf = ctx.createBuffer(1, half, sr);
  firstHalf.copyToChannel(voiceBuffer.getChannelData(0).slice(0, half), 0);
  place(firstHalf, stampFrames + gap);
  place(stamp, stampFrames + gap + half + gap);
  const secondHalf = ctx.createBuffer(1, voiceBuffer.length - half, sr);
  secondHalf.copyToChannel(voiceBuffer.getChannelData(0).slice(half), 0);
  const at2 = stampFrames + gap + half + gap + stampFrames + gap;
  place(secondHalf, at2);
  place(stamp, at2 + (voiceBuffer.length - half) + gap);
  return ctx.startRendering();
}
