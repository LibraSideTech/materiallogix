const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

const clampByte = value => Math.max(0, Math.min(255, Math.round(value)));
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

export const EDIT_DEFAULTS = Object.freeze({
  mode: 'guided',
  adjustments: Object.freeze({
    exposure: 0, contrast: 0, highlights: 0, shadows: 0,
    temperature: 0, tint: 0, saturation: 0, vibrance: 0,
    denoise: 0, blur: 0, sharpen: 0, grain: 0, vignette: 0,
    rotate: 0, heals: Object.freeze([]),
    selective: Object.freeze({ exposure: 0, temperature: 0, saturation: 0, strokes: Object.freeze([]) }),
    curve: null
  }),
  pixelGrid: Object.freeze({ enabled: false, columns: 12, sensitivity: 55 })
});

/** Anchored edits live in normalized source coordinates; anything malformed is dropped, not repaired. */
const sanitizeStamps = (list, maxRadius) => (Array.isArray(list) ? list : [])
  .filter(spot => [spot?.x, spot?.y, spot?.r].every(Number.isFinite) && spot.r > 0)
  .map(spot => ({ x: clamp(spot.x, 0, 1), y: clamp(spot.y, 0, 1), r: clamp(spot.r, 0.001, maxRadius) }));

export const CURVE_IDENTITY = Object.freeze([
  Object.freeze({ x: 0, y: 0 }), Object.freeze({ x: 85, y: 85 }),
  Object.freeze({ x: 170, y: 170 }), Object.freeze({ x: 255, y: 255 })
]);

/** Anything but four finite points falls back to the identity curve. */
const sanitizeCurve = value => {
  const raw = Array.isArray(value) ? value : [];
  if (raw.length !== 4 || raw.some(p => ![p?.x, p?.y].every(Number.isFinite))) {
    return CURVE_IDENTITY.map(p => ({ ...p }));
  }
  return raw.map(p => ({ x: clamp(p.x, 0, 255), y: clamp(p.y, 0, 255) })).sort((a, b) => a.x - b.x);
};

/**
 * 256-entry lookup table from the four-point luminance curve, shaped with a
 * monotone cubic so tones never overshoot between points. Identity returns
 * null: no table, no work.
 */
export function buildLuminanceLut(points) {
  const pts = sanitizeCurve(points);
  if (pts.every(p => Math.abs(p.y - p.x) < 0.5)) return null;
  const stops = [];
  for (const p of pts) {
    if (stops.length && Math.abs(p.x - stops[stops.length - 1].x) < 0.5) stops[stops.length - 1] = p;
    else stops.push(p);
  }
  const count = stops.length;
  const lut = new Uint8ClampedArray(256);
  if (count === 1) { lut.fill(clampByte(stops[0].y)); return lut; }
  const xs = stops.map(p => p.x);
  const ys = stops.map(p => p.y);
  const widths = [];
  const slopes = [];
  for (let i = 0; i < count - 1; i++) {
    widths.push(Math.max(0.0001, xs[i + 1] - xs[i]));
    slopes.push((ys[i + 1] - ys[i]) / widths[i]);
  }
  const tangents = [slopes[0]];
  for (let i = 1; i < count - 1; i++) {
    tangents.push(slopes[i - 1] * slopes[i] <= 0 ? 0
      : 3 * (widths[i - 1] + widths[i]) / ((2 * widths[i] + widths[i - 1]) / slopes[i - 1] + (widths[i] + 2 * widths[i - 1]) / slopes[i]));
  }
  tangents.push(slopes[count - 2]);
  for (let x = 0; x < 256; x++) {
    if (x <= xs[0]) { lut[x] = clampByte(ys[0]); continue; }
    if (x >= xs[count - 1]) { lut[x] = clampByte(ys[count - 1]); continue; }
    let i = 0;
    while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / widths[i];
    const t2 = t * t;
    const t3 = t2 * t;
    lut[x] = clampByte(ys[i] * (2 * t3 - 3 * t2 + 1) + widths[i] * tangents[i] * (t3 - 2 * t2 + t)
      + ys[i + 1] * (3 * t2 - 2 * t3) + widths[i] * tangents[i + 1] * (t3 - t2));
  }
  return lut;
}

/** Clamps in place, because the selective sliders bind to this object. */
const sanitizeSelective = value => {
  const target = value && typeof value === 'object' && !Object.isFrozen(value) ? value : {};
  target.exposure = clamp(target.exposure, -1, 1);
  target.temperature = clamp(target.temperature, -100, 100);
  target.saturation = clamp(target.saturation, -100, 100);
  target.strokes = sanitizeStamps(target.strokes, 0.15);
  return target;
};

/**
 * Adds any missing default onto the object that is already there, instead of
 * building a replacement for it.
 *
 * The distinction matters more than it looks. An editor slider captures the
 * object it writes to when the rail is built, and renderReview calls
 * paintStage on the very next line, which lands back in ensureEditState. If
 * that call swapped in a fresh object, every slider would go on writing to the
 * old one: the readout would move, the adjustment would not, and the value
 * would be dropped on a copy nothing renders or saves.
 */
const fillDefaults = (target, defaults) => {
  for (const [key, value] of Object.entries(defaults)) {
    if (target[key] !== undefined) continue;
    target[key] = Array.isArray(value) ? [...value]
      : (value && typeof value === 'object' ? { ...value } : value);
  }
  return target;
};

export function ensureEditState(asset) {
  asset.edit = asset.edit || {};
  asset.edit.mode = asset.edit.mode === 'advanced' ? 'advanced' : 'guided';
  const adjustments = asset.edit.adjustments && typeof asset.edit.adjustments === 'object'
    && !Object.isFrozen(asset.edit.adjustments) ? asset.edit.adjustments : {};
  fillDefaults(adjustments, EDIT_DEFAULTS.adjustments);
  asset.edit.adjustments = adjustments;
  adjustments.heals = sanitizeStamps(adjustments.heals, 0.08);
  adjustments.selective = sanitizeSelective(adjustments.selective);
  adjustments.curve = sanitizeCurve(adjustments.curve);
  const pixelGrid = asset.edit.pixelGrid && typeof asset.edit.pixelGrid === 'object'
    && !Object.isFrozen(asset.edit.pixelGrid) ? asset.edit.pixelGrid : {};
  asset.edit.pixelGrid = fillDefaults(pixelGrid, EDIT_DEFAULTS.pixelGrid);
  return asset.edit;
}

// Arrays and objects (heals, selective, curve) coerce to NaN and fall out here;
// they carry their own checks.
const numericSliderSet = (a, { includeRotate = true } = {}) => Object.entries(a)
  .some(([key, value]) => (includeRotate || key !== 'rotate')
    && Math.abs(Number(value) || 0) > 0.0001);

/** True when this asset carries any edit at all — sliders, repairs, mask, or curve. */
export function hasVisibleAdjustments(adjustments) {
  if (!adjustments || typeof adjustments !== 'object') return false;
  const a = { ...EDIT_DEFAULTS.adjustments, ...adjustments };
  if (sanitizeStamps(a.heals, 0.08).length) return true;
  const selective = sanitizeSelective({ ...EDIT_DEFAULTS.adjustments.selective, ...(a.selective || {}) });
  if (selective.strokes.length && numericSliderSet(selective)) return true;
  if (buildLuminanceLut(a.curve)) return true;
  return numericSliderSet(a);
}

export function previewFilter(adjustments = {}) {
  const a = { ...EDIT_DEFAULTS.adjustments, ...adjustments };
  const exposure = Math.pow(2, clamp(a.exposure, -2, 2));
  const contrast = 1 + clamp(a.contrast, -100, 100) / 100;
  const saturation = 1 + clamp(a.saturation, -100, 100) / 100 + clamp(a.vibrance, -100, 100) / 250;
  const hue = clamp(a.temperature, -100, 100) * -0.08 + clamp(a.tint, -100, 100) * 0.05;
  const blur = clamp(a.blur, 0, 20) / 4;
  return `brightness(${exposure}) contrast(${contrast}) saturate(${Math.max(0, saturation)}) hue-rotate(${hue}deg) blur(${blur}px)`;
}

/**
 * Bounded joint-bilateral cleanup for camera noise. The range weight prevents
 * pixels on opposite sides of a strong colour or luminance boundary from
 * bleeding together, while the fixed 3×3 neighbourhood keeps runtime bounded.
 */
export function edgeAwareDenoiseRgba(input, width, height, amount = 0) {
  const w = Math.trunc(Number(width));
  const h = Math.trunc(Number(height));
  if (w < 1 || h < 1 || !input || input.length !== w * h * 4) {
    throw new TypeError('Denoise requires a complete RGBA buffer and positive dimensions.');
  }
  const source = new Uint8ClampedArray(input);
  const strength = clamp(amount, 0, 100) / 100;
  if (!strength || w < 3 || h < 3) return source;

  const output = new Uint8ClampedArray(source);
  const rangeSigma = 10 + strength * 34;
  const rangeDenominator = 2 * rangeSigma * rangeSigma;
  const baseMix = 0.18 + strength * 0.74;
  // Each pixel needs its own luminance and that of its eight neighbours.
  // Computed inline that is nine dot products per pixel; computed once it is one.
  const luma = new Float32Array(w * h);
  for (let p = 0, i = 0; p < luma.length; p++, i += 4) {
    luma[p] = 0.2126 * source[i] + 0.7152 * source[i + 1] + 0.0722 * source[i + 2];
  }
  const dPixel = [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1];
  const spatial = [0.68, 1, 0.68, 1, 1, 0.68, 1, 0.68];

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const center = p * 4;
      const cr = source[center];
      const cg = source[center + 1];
      const cb = source[center + 2];
      const centerLuma = luma[p];
      const horizontal = Math.abs(luma[p - 1] - luma[p + 1]);
      const vertical = Math.abs(luma[p - w] - luma[p + w]);
      const edgeProtection = smoothstep(32, 96, horizontal > vertical ? horizontal : vertical);
      const mix = baseMix * (1 - edgeProtection * 0.94);
      let weightSum = 1;
      let sr = cr, sg = cg, sb = cb;

      for (let k = 0; k < 8; k++) {
        const np = p + dPixel[k];
        const neighbor = np * 4;
        const nr = source[neighbor];
        const ng = source[neighbor + 1];
        const nb = source[neighbor + 2];
        const dr = nr - cr;
        const dg = ng - cg;
        const db = nb - cb;
        const colorDistance2 = (dr * dr + dg * dg + db * db) / 3;
        const lumaDistance = luma[np] - centerLuma;
        const weight = spatial[k] * Math.exp(-(colorDistance2 + lumaDistance * lumaDistance) / rangeDenominator);
        weightSum += weight;
        sr += nr * weight;
        sg += ng * weight;
        sb += nb * weight;
      }

      output[center] = clampByte(cr + (sr / weightSum - cr) * mix);
      output[center + 1] = clampByte(cg + (sg / weightSum - cg) * mix);
      output[center + 2] = clampByte(cb + (sb / weightSum - cb) * mix);
      output[center + 3] = source[center + 3];
    }
  }
  return output;
}

/**
 * One-click spot repair: each spot is rebuilt from a ring of surrounding
 * pixels, distance-weighted, then feathered into the untouched frame.
 */
function healSpotsRgba(data, width, height, heals, frame) {
  for (const spot of heals) {
    const [cx, cy] = frame.point(spot.x, spot.y);
    const radius = Math.min(Math.max(frame.radius(spot.r), 2), Math.min(width, height) / 3);
    if (cx < -radius || cy < -radius || cx > width + radius || cy > height + radius) continue;
    const ring = radius * 1.45;
    const count = Math.max(12, Math.min(40, Math.round(ring)));
    const samples = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * 2 * Math.PI;
      const x = Math.round(clamp(cx + Math.cos(angle) * ring, 0, width - 1));
      const y = Math.round(clamp(cy + Math.sin(angle) * ring, 0, height - 1));
      const j = (y * width + x) * 4;
      samples.push([x, y, data[j], data[j + 1], data[j + 2]]);
    }
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(width - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(height - 1, Math.ceil(cy + radius));
    const floor = radius * radius * 0.06;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const blend = 1 - smoothstep(0.62, 1, Math.hypot(x - cx, y - cy) / radius);
        if (blend <= 0) continue;
        let weightSum = 0, r = 0, g = 0, b = 0;
        for (const [sampleX, sampleY, sampleR, sampleG, sampleB] of samples) {
          const weight = 1 / ((x - sampleX) ** 2 + (y - sampleY) ** 2 + floor);
          weightSum += weight;
          r += sampleR * weight; g += sampleG * weight; b += sampleB * weight;
        }
        const i = (y * width + x) * 4;
        data[i] = clampByte(data[i] + (r / weightSum - data[i]) * blend);
        data[i + 1] = clampByte(data[i + 1] + (g / weightSum - data[i + 1]) * blend);
        data[i + 2] = clampByte(data[i + 2] + (b / weightSum - data[i + 2]) * blend);
      }
    }
  }
}

/**
 * Unsharp mask on luminance.
 *
 * Sharpening a photograph is not a Laplacian. A one-pixel second difference
 * added per channel raises grain harder than it raises detail, rings a bright
 * halo either side of every edge, and pulls R, G and B apart at a colour
 * boundary. This is the three-part control the job actually needs: a Gaussian
 * high-pass for radius, a gate that leaves flat grain alone, and an overshoot
 * limit tied to the local range so an edge gains acutance without a halo. One
 * shared luminance delta drives all three channels, so hue cannot shift.
 */
export function unsharpMaskRgba(input, width, height, amount = 0) {
  const w = Math.trunc(Number(width));
  const h = Math.trunc(Number(height));
  if (w < 1 || h < 1 || !input || input.length !== w * h * 4) {
    throw new TypeError('Sharpening requires a complete RGBA buffer and positive dimensions.');
  }
  const output = new Uint8ClampedArray(input);
  const strength = clamp(amount, 0, 100) / 100;
  if (!strength || w < 5 || h < 5) return output;

  const count = w * h;
  const luma = new Float32Array(count);
  for (let p = 0, i = 0; p < count; p++, i += 4) {
    luma[p] = 0.2126 * input[i] + 0.7152 * input[i + 1] + 0.0722 * input[i + 2];
  }

  // Sigma 1.0 px over five taps. Wider than this and the halo becomes the
  // thing you see; narrower and it sharpens the sensor rather than the subject.
  const K0 = 0.402620, K1 = 0.244201, K2 = 0.054489;
  // The vertical half runs first into its own plane; the horizontal half is
  // folded into the pixel loop so only one intermediate plane is ever held.
  const column = new Float32Array(count);
  for (let y = 0; y < h; y++) {
    const up2 = (y > 1 ? y - 2 : 0) * w;
    const up1 = (y > 0 ? y - 1 : 0) * w;
    const row = y * w;
    const down1 = (y < h - 1 ? y + 1 : h - 1) * w;
    const down2 = (y < h - 2 ? y + 2 : h - 1) * w;
    for (let x = 0; x < w; x++) {
      column[row + x] = K2 * luma[up2 + x] + K1 * luma[up1 + x] + K0 * luma[row + x]
        + K1 * luma[down1 + x] + K2 * luma[down2 + x];
    }
  }

  const gain = 0.30 + strength * 2.20;
  // Squared thresholds in luminance levels: detail below 6 is grain rather than
  // subject, and a 3x3 patch spanning less than 14 holds no edge to sharpen.
  const GRAIN_FLOOR = 6 * 6;
  const EDGE_FLOOR = 14 * 14;
  const OVERSHOOT = 0.05 + strength * 0.30;

  for (let y = 0; y < h; y++) {
    const row = y * w;
    const above = (y > 0 ? y - 1 : 0) * w;
    const below = (y < h - 1 ? y + 1 : h - 1) * w;
    for (let x = 0; x < w; x++) {
      const p = row + x;
      const xm2 = x > 1 ? x - 2 : 0;
      const xm1 = x > 0 ? x - 1 : 0;
      const xp1 = x < w - 1 ? x + 1 : w - 1;
      const xp2 = x < w - 2 ? x + 2 : w - 1;
      const blurred = K2 * column[row + xm2] + K1 * column[row + xm1] + K0 * column[p]
        + K1 * column[row + xp1] + K2 * column[row + xp2];
      const delta = luma[p] - blurred;

      let lo = Infinity, hi = -Infinity;
      for (let band = above; ; band += w) {
        let v = luma[band + xm1];
        if (v < lo) lo = v; if (v > hi) hi = v;
        v = luma[band + x];
        if (v < lo) lo = v; if (v > hi) hi = v;
        v = luma[band + xp1];
        if (v < lo) lo = v; if (v > hi) hi = v;
        if (band === below) break;
      }
      const range = hi - lo;
      // Grain fails both gates: its high-pass response is small and the patch
      // it sits in holds no edge. A real edge passes both.
      const d2 = delta * delta;
      const r2 = range * range;
      const applied = delta * gain * (d2 / (d2 + GRAIN_FLOOR)) * (r2 / (r2 + EDGE_FLOOR));
      const headroom = range * OVERSHOOT;
      let target = luma[p] + applied;
      if (target > hi + headroom) target = hi + headroom;
      else if (target < lo - headroom) target = lo - headroom;

      const lift = target - luma[p];
      if (lift === 0) continue;
      const i = p * 4;
      output[i] = clampByte(input[i] + lift);
      output[i + 1] = clampByte(input[i + 1] + lift);
      output[i + 2] = clampByte(input[i + 2] + lift);
    }
  }
  return output;
}

/** Soft-edged mask from brush stamps, in canvas space; overlapping touches keep the strongest one. */
function selectiveMaskFor(strokes, frame, width, height) {
  const mask = new Float32Array(width * height);
  for (const stamp of strokes) {
    const [cx, cy] = frame.point(stamp.x, stamp.y);
    const radius = Math.max(frame.radius(stamp.r), 1.5);
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(width - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(height - 1, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const soft = 1 - smoothstep(0.55, 1, Math.hypot(x - cx, y - cy) / radius);
        if (soft <= 0) continue;
        const i = y * width + x;
        if (soft > mask[i]) mask[i] = soft;
      }
    }
  }
  return mask;
}

/**
 * Apply every visible photo adjustment to a rendered canvas. This is the
 * authoritative preview/export path; previewFilter remains a lightweight CSS
 * approximation for surfaces that cannot read pixels. `frame` maps normalized
 * source coordinates onto this canvas so anchored edits stay anchored.
 */
export function applyPixelAdjustments(canvas, adjustments = {}, frame = null) {
  const a = { ...EDIT_DEFAULTS.adjustments, ...adjustments };
  const width = canvas.width;
  const height = canvas.height;
  if (!width || !height) return canvas;
  const heals = sanitizeStamps(a.heals, 0.08);
  const selective = sanitizeSelective(a.selective);
  const selectiveActive = selective.strokes.length > 0 &&
    (Math.abs(selective.exposure) > 0.0001 || Math.abs(selective.temperature) > 0.0001 || Math.abs(selective.saturation) > 0.0001);
  const lut = buildLuminanceLut(a.curve);
  // Straighten is geometry, applied while the crop is drawn; alone it never needs a pixel pass.
  const slidersActive = numericSliderSet(a, { includeRotate: false });
  if (!slidersActive && !heals.length && !selectiveActive && !lut) return canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const blur = clamp(a.blur, 0, 20) / 4;
  if (blur > 0) {
    const copy = document.createElement('canvas');
    copy.width = width; copy.height = height;
    copy.getContext('2d').drawImage(canvas, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(copy, 0, 0);
    ctx.filter = 'none';
  }

  const anchor = frame || { point: (nx, ny) => [nx * width, ny * height], radius: nr => Math.abs(Number(nr) || 0) * width };
  const image = ctx.getImageData(0, 0, width, height);
  // Repairs land first so every grade below works on the healed photograph.
  if (heals.length) healSpotsRgba(image.data, width, height, heals, anchor);
  if (clamp(a.denoise, 0, 100) > 0) {
    image.data.set(edgeAwareDenoiseRgba(image.data, width, height, a.denoise));
  }
  const data = image.data;
  const mask = selectiveActive ? selectiveMaskFor(selective.strokes, anchor, width, height) : null;
  // A repair-only edit is finished here; the tonal pass has nothing to do.
  if (!slidersActive && !mask && !lut) {
    ctx.putImageData(image, 0, 0);
    return canvas;
  }
  const exposure = Math.pow(2, clamp(a.exposure, -2, 2));
  const contrast = 1 + clamp(a.contrast, -100, 100) / 100;
  const highlights = clamp(a.highlights, -100, 100) / 100;
  const shadows = clamp(a.shadows, -100, 100) / 100;
  const temperature = clamp(a.temperature, -100, 100) / 100;
  const tint = clamp(a.tint, -100, 100) / 100;
  const saturation = clamp(a.saturation, -100, 100) / 100;
  const vibrance = clamp(a.vibrance, -100, 100) / 100;
  const grain = clamp(a.grain, 0, 100) / 100;
  const vignette = clamp(a.vignette, 0, 100) / 100;
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const maxRadius = Math.max(1, Math.hypot(cx, cy));
  const invMaxRadius = 1 / maxRadius;

  // Exposure and contrast are per-channel functions of an integer 0..255
  // sample, so 256 evaluations replace three per pixel. At 24 MP that is the
  // difference between 72 million multiplies and 512.
  const toneBase = new Float64Array(256);
  for (let v = 0; v < 256; v++) toneBase[v] = (v * exposure - 128) * contrast + 128;

  const warmShift = temperature * 24 + tint * 11;
  const greenShift = tint * 20;
  const coolShift = temperature * 24 - tint * 11;
  const grainAmount = grain * 22;
  const vignetteDepth = vignette * 0.72;
  const selectiveExposure = selective.exposure;
  const selectiveWarmth = selective.temperature / 100;
  const selectiveSaturation = selective.saturation / 100;

  // Squared horizontal distance never changes down a column.
  const dx2 = vignette > 0 ? new Float64Array(width) : null;
  if (dx2) for (let x = 0; x < width; x++) { const d = x - cx; dx2[x] = d * d; }

  const step = (edge0, span, value) => {
    let t = (value - edge0) / span;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
  };

  let i = 0;
  for (let y = 0; y < height; y++) {
    const dy = y - cy;
    const dy2 = dy * dy;
    const rowOffset = y * width;
    for (let x = 0; x < width; x++, i += 4) {
      let r = toneBase[data[i]];
      let g = toneBase[data[i + 1]];
      let b = toneBase[data[i + 2]];

      let toneLuma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      toneLuma = toneLuma < 0 ? 0 : toneLuma > 1 ? 1 : toneLuma;
      const toneDelta = 72 * (highlights * step(0.42, 0.58, toneLuma)
        + shadows * (1 - step(0, 0.58, toneLuma)));
      r += toneDelta; g += toneDelta; b += toneDelta;

      r += warmShift;
      g -= greenShift;
      b -= coolShift;

      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const maxChannel = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const minChannel = r < g ? (r < b ? r : b) : (g < b ? g : b);
      let chroma = (maxChannel - minChannel) / 255;
      chroma = chroma < 0 ? 0 : chroma > 1 ? 1 : chroma;
      const colorScale = Math.max(0, 1 + saturation + vibrance * (1 - chroma) * 0.85);
      r = luma + (r - luma) * colorScale;
      g = luma + (g - luma) * colorScale;
      b = luma + (b - luma) * colorScale;

      if (mask) {
        const strength = mask[rowOffset + x];
        if (strength > 0.004) {
          const gain = Math.pow(2, selectiveExposure * strength);
          r *= gain; g *= gain; b *= gain;
          const warmth = selectiveWarmth * strength * 24;
          r += warmth; b -= warmth;
          const brushLuma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          const brushScale = Math.max(0, 1 + selectiveSaturation * strength);
          r = brushLuma + (r - brushLuma) * brushScale;
          g = brushLuma + (g - brushLuma) * brushScale;
          b = brushLuma + (b - brushLuma) * brushScale;
        }
      }

      if (lut) {
        let toneIn = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        toneIn = toneIn < 0 ? 0 : toneIn > 255 ? 255 : toneIn;
        const lift = lut[(toneIn + 0.5) | 0] - toneIn;
        r += lift; g += lift; b += lift;
      }

      if (grain > 0) {
        // An integer bit-mix instead of the fract(sin(dot)) trick: same
        // deterministic per-pixel field, no transcendental per pixel, and no
        // diagonal banding where sin's period nearly aligns with the raster.
        let n = Math.imul(x + 1, 0x27d4eb2d) ^ Math.imul(y + 1, 0x165667b1);
        n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
        n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
        const noise = (((n ^ (n >>> 15)) >>> 0) / 2147483648 - 1) * grainAmount;
        r += noise; g += noise; b += noise;
      }

      if (vignette > 0) {
        const gain = 1 - step(0.34, 0.66, Math.sqrt(dx2[x] + dy2) * invMaxRadius) * vignetteDepth;
        r *= gain; g *= gain; b *= gain;
      }

      r = r < 0 ? 0 : r > 255 ? 255 : r;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      b = b < 0 ? 0 : b > 255 ? 255 : b;
      data[i] = (r + 0.5) | 0;
      data[i + 1] = (g + 0.5) | 0;
      data[i + 2] = (b + 0.5) | 0;
    }
  }

  if (clamp(a.sharpen, 0, 100) > 0) data.set(unsharpMaskRgba(data, width, height, a.sharpen));

  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function pixelGridReview(source, width, height, columns = 12, sensitivity = 55) {
  const cols = Math.round(clamp(columns, 6, 32));
  const rows = Math.max(4, Math.round(cols * height / Math.max(1, width)));
  const canvas = document.createElement('canvas');
  canvas.width = cols * 4;
  canvas.height = rows * 4;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const cell = (cx, cy) => {
    let r = 0, g = 0, b = 0, l = 0, l2 = 0, n = 0;
    for (let y = cy * 4; y < cy * 4 + 4; y++) for (let x = cx * 4; x < cx * 4 + 4; x++) {
      const i = (y * canvas.width + x) * 4;
      const rr = pixels[i], gg = pixels[i + 1], bb = pixels[i + 2];
      const yy = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
      r += rr; g += gg; b += bb; l += yy; l2 += yy * yy; n++;
    }
    const mean = l / n;
    return { r: r / n, g: g / n, b: b / n, l: mean, variance: Math.max(0, l2 / n - mean * mean) };
  };
  const stats = Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => cell(x, y)));
  const tiles = [];
  const threshold = 22 + (100 - clamp(sensitivity, 0, 100)) * 0.55;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const here = stats[y][x];
    const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
      .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < cols && ny < rows)
      .map(([nx, ny]) => stats[ny][nx]);
    const discontinuity = neighbors.reduce((sum, n) => sum + Math.hypot(here.r - n.r, here.g - n.g, here.b - n.b), 0) / Math.max(1, neighbors.length);
    const textureMismatch = neighbors.reduce((sum, n) => sum + Math.abs(Math.sqrt(here.variance) - Math.sqrt(n.variance)), 0) / Math.max(1, neighbors.length);
    const score = Math.round(discontinuity * 0.72 + textureMismatch * 2.1);
    if (score >= threshold) tiles.push({ x, y, score, level: score >= threshold * 1.65 ? 'high' : 'review' });
  }
  return { cols, rows, tiles, threshold: Math.round(threshold) };
}

export function pixelGridOverlay(report) {
  const overlay = document.createElement('div');
  overlay.className = 'pixel-grid-overlay';
  overlay.style.setProperty('--grid-cols', report.cols);
  overlay.style.setProperty('--grid-rows', report.rows);
  for (const tile of report.tiles) {
    const mark = document.createElement('span');
    mark.className = `pixel-grid-tile ${tile.level}`;
    mark.style.gridColumn = String(tile.x + 1);
    mark.style.gridRow = String(tile.y + 1);
    mark.title = `Continuity review score ${tile.score}`;
    overlay.append(mark);
  }
  return overlay;
}
