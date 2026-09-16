// Recording-studio-style feedback for the rendered voice take: a peak
// waveform everyone gets, plus a live playhead and a peak/RMS dB meter for
// Pro (the parts a real DAW shows during playback, not just after it).
//
// The waveform math (computeWaveformPeaks) is pure and takes plain Float32
// PCM data, so it is directly testable without a DOM or an AudioContext.

/** One {min, max} pair per output column, the standard peak-waveform
 * technique every audio editor uses: each column covers an equal slice of
 * samples, and drawing its full min-to-max span (not just a a mean) is what
 * keeps a single loud transient visible even when the column spans
 * thousands of samples. */
export function computeWaveformPeaks(channelData, columns) {
  const n = channelData.length;
  const out = new Array(Math.max(0, columns));
  if (n === 0 || columns <= 0) return out;
  const perColumn = n / columns;
  for (let c = 0; c < columns; c++) {
    const start = Math.floor(c * perColumn);
    const end = Math.max(start + 1, Math.floor((c + 1) * perColumn));
    let min = Infinity, max = -Infinity;
    for (let i = start; i < end && i < n; i++) {
      const v = channelData[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    out[c] = { min, max };
  }
  return out;
}

export function drawStaticWaveform(canvas, peaks, { color = '#8a8a8a' } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, width, height);
  const mid = height / 2;
  g.fillStyle = color;
  const columnWidth = width / Math.max(1, peaks.length);
  for (let i = 0; i < peaks.length; i++) {
    const { min, max } = peaks[i];
    const x = i * columnWidth;
    const yTop = mid - max * mid;
    const yBottom = mid - min * mid;
    g.fillRect(x, yTop, Math.max(1, columnWidth - 0.5), Math.max(1, yBottom - yTop));
  }
}

function drawPlayhead(canvas, fraction, color = '#c33') {
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  const dpr = window.devicePixelRatio || 1;
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.strokeStyle = color;
  g.lineWidth = 1.5;
  const x = Math.max(0, Math.min(width, fraction * width));
  g.beginPath(); g.moveTo(x, 0); g.lineTo(x, height); g.stroke();
}

/** Peak and RMS in dBFS from a time-domain buffer. -Infinity on true digital
 * silence is intentional: a meter that floors at some arbitrary "very low"
 * number lies about a track that is actually silent. */
export function levelsFromTimeDomain(samples) {
  let peak = 0, sumSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
    sumSquares += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, samples.length));
  const toDb = v => v > 0 ? 20 * Math.log10(v) : -Infinity;
  return { peakDb: toDb(peak), rmsDb: toDb(rms) };
}

function drawMeter(canvas, { peakDb, rmsDb }, floorDb = -60) {
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, width, height);
  const frac = db => Math.max(0, Math.min(1, (Math.max(db, floorDb) - floorDb) / (0 - floorDb)));
  g.fillStyle = '#2a2a2a';
  g.fillRect(0, 0, width, height);
  const rmsWidth = frac(rmsDb) * width;
  g.fillStyle = '#6a9';
  g.fillRect(0, 0, rmsWidth, height);
  const peakX = frac(peakDb) * width;
  g.fillStyle = peakDb > -1 ? '#c33' : '#ccc';
  g.fillRect(Math.max(0, peakX - 1.5), 0, 2, height);
}

/**
 * Pro-only live feedback: a moving playhead over the static waveform and a
 * peak/RMS dB meter, both driven by an AnalyserNode on the given <audio>
 * element. Returns a cleanup function - call it before re-rendering a new
 * take, since a MediaElementSource can only ever attach to one element once
 * and leaking the rAF loop would keep drawing over a take that changed.
 */
export function attachLiveMeter(audioEl, waveformCanvas, meterCanvas) {
  let ctx, analyser, source, raf = null, stopped = false;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source = ctx.createMediaElementSource(audioEl);
    source.connect(analyser);
    analyser.connect(ctx.destination);
  } catch {
    return () => {}; // Web Audio unavailable - Standard's static waveform still stands alone.
  }
  const buf = new Float32Array(analyser.fftSize);
  const tick = () => {
    if (stopped) return;
    analyser.getFloatTimeDomainData(buf);
    const levels = levelsFromTimeDomain(buf);
    drawMeter(meterCanvas, levels);
    if (audioEl.duration > 0) drawPlayhead(waveformCanvas, audioEl.currentTime / audioEl.duration);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    try { source.disconnect(); analyser.disconnect(); ctx.close(); } catch { /* already torn down */ }
  };
}

/**
 * Mark the joins on a drawn waveform: where the take was cut and pasted.
 *
 * A bad join is often easier to see than to hear - a step in level or a gap
 * that runs long is obvious on the waveform and easy to miss on one listen.
 * Each pause is shaded across its own span and its edges ruled, so the eye
 * lands on the cut rather than hunting for it. Draw this after
 * drawStaticWaveform, which resizes the canvas and would clear it.
 */
export function markJoins(canvas, joins, durationSeconds, {
  clean = 'rgba(201, 168, 106, .55)', clean_fill = 'rgba(201, 168, 106, .10)',
  flagged = 'rgba(208, 122, 113, .85)', flagged_fill = 'rgba(208, 122, 113, .18)'
} = {}) {
  if (!canvas || !Array.isArray(joins) || !joins.length || !(durationSeconds > 0)) return;
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  const dpr = window.devicePixelRatio || 1;
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const join of joins) {
    const x = (join.atSeconds / durationSeconds) * width;
    if (!Number.isFinite(x) || x < 0 || x > width) continue;
    const span = Math.max(1.5, ((join.pauseMs / 1000) / durationSeconds) * width);
    g.fillStyle = join.flagged ? flagged_fill : clean_fill;
    g.fillRect(x, 0, Math.min(span, width - x), height);
    g.fillStyle = join.flagged ? flagged : clean;
    g.fillRect(x, 0, 1, height);
    if (x + span - 1 <= width) g.fillRect(x + span - 1, 0, 1, height);
  }
}
