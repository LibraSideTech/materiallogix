import {
  SURFACE_GROUPS, SURFACE_BY_ID, ASSET_STATUSES, STATUS_BY_ID,
  ASSET_ROLES, QA_CHECKS, QA_BY_ID, QA_PRESETS, PRESET_BY_ID, FIX_PRESETS, SURFACE_PRESETS, REJECTION_REASONS,
  newProject, newAsset, newPlacement
} from './model.js';
import * as store from './store.js';
import { localFallbackMessage, recordVideoPace } from './video-pace.js';
import { PRICING_URL, STUDIO_DOWNLOAD_URL } from './routes.js';
import {
  canvasToBytes, defaultCrop, clampCrop, zoomCrop, panCrop, snapToRatio, renderCrop, loadImage, grabVideoFrame,
  adjustmentFrame, placementRect
} from './crop.js';
import {
  analyzeAsset, assetIssues, placementIssues, preflight, smartCrop, captureCoverage, captureCoverageBody, cornerSignature, captureFrameQuality
} from './analyze.js';
import { buildPackage, decisionsMarkdown, approvedPairs, planFinishedPhoto, slug } from './export.js';
import { buildClientPage, applyClientVerdict } from './clientpage.js';
import { snapshot, snapshotProject, popUndo, clearUndo, log, logMarkdown } from './history.js';
import { downloadBlob, makeZip, readStoreZip } from './zip.js';
import { activeLicense, activate, activationFailureReason, deactivate, covers } from './license.js';
import { assessInpaintMaskedBoundary, blendInpaintMaskedCandidate,
  bridgeFetch, DEFAULT_BASE, detectComfy, listCheckpoints, inspectInpaintCompatibility, generateOne, normalizeInpaintSelection,
  normalizeInpaintPath, summarizeInpaintMask, inpaintOne, listUpscaleModels, upscaleOne, detectBridge,
  upscaleViaBridge, localUpscaleEngineLabel,
  CPU_PRESETS, cpuJobSettings, estimateCpuSeconds, recordCpuPace, waitLabel,
  PROMPT_MIN_LENGTH, PROMPT_MAX_LENGTH, buildFluxTxt2Img, detectFluxReady, runGraph, uploadImage } from './generate.js';
import { buildReferencePhoto } from './generate-reference.js';
import { probeDevice, deviceSummary } from './device.js';
import { featureEnabled } from './features.js';
import { guidanceFor } from './capture-guidance.js';
import { screenPrompt } from './prompt-guard.js';
import { wordBudgetForSeconds } from './voice.js';
import { HOUSE_VOICE_BY_ID } from './house-voices.js';
import { paceTrace, paceTraceSvg, runPaceGuide, paceTarget } from './capture-pacer.js';
import {
  PERSON_GEOMETRY_OBSERVATION_ALGORITHM_ID,
  PERSON_GEOMETRY_OBSERVATION_MANIFEST_SHA256,
  analyzeGeometry
} from './geometry.js';
import { NOTICE_TEXT as PEOPLE_MAPPING_NOTICE } from './human-geometry-notice.js';
import {
  OPTIONAL_APPEARANCE_LAYERS,
  PERSONAL_GEOMETRY_NOTICE_SHA256,
  PERSONAL_GEOMETRY_NOTICE_TEXT,
  PERSONAL_GEOMETRY_NOTICE_VERSION,
  PERSONAL_GEOMETRY_PURPOSES,
  PERSONAL_GEOMETRY_RETENTION_POLICY_ID,
  PERSONAL_GEOMETRY_US_JURISDICTIONS,
  SKIN_DETAIL_CONTINUITY_ALGORITHM_ID,
  SKIN_DETAIL_CONTINUITY_ALGORITHM_SHA256,
  evaluatePersonalGeometryConsent,
  personalGeometryRetentionExpiry
} from './personal-geometry-consent.js';
import {
  LOCAL_FACE_MAP_ALGORITHM_ID,
  LOCAL_FACE_MAP_ALGORITHM_SHA256,
  buildSinglePhotoFaceMap,
  validateLocalFaceMap
} from './local-face-map.js';
import { buildPersonalGeometryPack } from './personal-geometry-pack.js';
import {
  PERSONAL_GEOMETRY_TEMPORARY_TTL_MS,
  completePersonalGeometryPurpose,
  deletePersonalGeometryAsset,
  deletePersonalGeometryProject,
  getPersonalGeometryFaceMapsForAsset,
  getPersonalGeometryPacksForProject,
  getPersonalGeometryTattooMapsForAsset,
  personalGeometrySafeRecoveryView,
  savePersonalGeometryConsentReceipt,
  savePersonalGeometryFaceMap,
  savePersonalGeometryPack,
  savePersonalGeometryTattooMap,
  subscribePersonalGeometryDeletion,
  sweepExpiredPersonalGeometryData,
  withdrawAndDeletePersonalGeometry
} from './personal-geometry-storage.js';
import { CURVE_IDENTITY, buildLuminanceLut, ensureEditState, hasVisibleAdjustments, pixelGridReview, pixelGridOverlay, previewFilter } from './editing.js';
import { authorizeOutbound, consumeEntitlement, settleOutbound, settleOutboundBeforeDelivery, voidOutbound } from './billing-client.js';
import { COLOR_PIPELINE, colorExportDecision, decodeColorManagedBlob } from './color-management.js';
import { PRINT_PPI, PRINT_PRESETS, encodePrintJpeg, planPrint, printColorDecision, renderPrint } from './print.js';
import { normalizeSpinIndex, stepSpinIndex, spinIndexFromDrag, spinStepFromWheel, spinAngleLabel } from './spin-viewer.js';
import { makeInpaintJobSpec, createInpaintBenchmark } from './inpaint-foundation.js';
import { LANES, hasProAccess, imageExportCeiling, quoteCloudJob, recordExport, laneFor } from './pricing.js';
import { cloudVideoAvailability, submitCloudVideoPackage, watchCloudVideoJob, downloadCloudVideo } from './cloud-video.js';
import { isImportableMediaFile, isRadianceFile, isRawCameraFile, prepareRawCameraImport } from './raw.js';
import {
  TATTOO_CONTROL_POINT_COUNT, TATTOO_MESH_MAX_DENSITY,
  TATTOO_MESH_MIN_DENSITY, TATTOO_REGIONS, generateTattooMesh,
  TATTOO_PLACEMENT_ALGORITHM_ID, TATTOO_PLACEMENT_ALGORITHM_SHA256,
  createTattooPlacementMap, defaultTattooMap, manualTattooControlLattice,
  tattooControlLatticeForRegion, tattooPlacementConsentState, tattooPoseGeometryFromPackRecords,
  validateTattooPlacementMap
} from './tattoo-mapping.js';
import {
  VIDEO_TIMELINE_SCHEMA, hasVideoProEntitlement, remapVideoTimelineAssets,
  sanitizeVideoTimeline, timelineDuration, videoTimelineFingerprint
} from './video-timeline.js';
import { openVideoProEditor } from './video-pro-editor.js';
import { adoptBridgePinFromHash, companionQrMatrix, companionUrl, paintCompanionQr } from './companion-link.js';

const FLUX_SENTINEL = '__flux__';
const $ = sel => document.querySelector(sel);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k in n) n[k] = v;
    else n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : String(k));
  return n;
};

// A scanned companion code may carry the bridge PIN in its fragment. Adopt it
// before any bridge call, then clear it so the PIN never lingers in the
// address bar or in a shared link.
if (adoptBridgePinFromHash(location.hash, localStorage)) {
  history.replaceState(null, '', location.pathname + location.search);
}

// 1× is source pixels; 2× and 4× are what judging a hairline or a retouched
// pore actually takes.
const LOUPE_ZOOMS = Object.freeze([1, 2, 4]);
const storedLoupeZoom = Number(localStorage.getItem('cros:loupeZoom'));

const state = {
  projects: [], project: null, assets: [],
  mode: 'review',
  index: 0,
  activeSurface: null,
  view: 'source',             // 'source' | 'placement' | 'compare'
  compareWith: null,
  reviewRailTab: 'edit',
  loupe: false,
  loupeZoom: LOUPE_ZOOMS.includes(storedLoupeZoom) ? storedLoupeZoom : 1,
  editTool: null,              // null | 'heal' | 'brush' | 'tattoo' — stage input routes to the armed edit tool
  healSize: 1.2,               // spot radius as a percentage of the frame width
  brushSize: 4,                // selective brush radius as a percentage of the frame width
  filters: { status: '', role: '', kind: '', surface: '', issues: '', rating: 0, q: '' },
  reviewer: localStorage.getItem('cros:reviewer') || 'reviewer',
  decoded: new Map(),         // assetId -> { source, w, h, url }
  tattooMaps: new Map(),      // assetId -> isolated-store record; never persisted in ordinary assets
  busy: false
};
const localVideoJobs = new Map();
let personalGeometrySubjectRef = null;
const PERSONAL_GEOMETRY_ACCOUNT_REF_KEY = 'materiallogix:personal-geometry-account-ref';
const VALID_PLACEMENT_FILL = new Set(['crop', 'contain', 'blur']);
const LEGACY_PERSONAL_GEOMETRY_LINK_FIELDS = Object.freeze([
  'personalGeometryPackId', 'personalGeometryConsentId', 'personalGeometryCaptureMode',
  'identityPackId', 'identityCaptureMode'
]);
const LEGACY_PERSONAL_GEOMETRY_FIELDS = Object.freeze([
  ...LEGACY_PERSONAL_GEOMETRY_LINK_FIELDS,
  'geometry', 'geometryConsentId', 'geometryPackId', 'humanGeometry',
  'localFaceMaps', 'localFaceMapConsentId', 'personalGeometry',
  'personalGeometryPack', 'peopleReview', 'tattooMap'
]);

function hasLegacyPersonalGeometryLink(asset) {
  return LEGACY_PERSONAL_GEOMETRY_LINK_FIELDS.some(field =>
    Object.prototype.hasOwnProperty.call(asset || {}, field));
}

function stripLegacyPersonalGeometryFields(asset) {
  let changed = false;
  for (const field of LEGACY_PERSONAL_GEOMETRY_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(asset || {}, field)) continue;
    delete asset[field];
    changed = true;
  }
  return changed;
}

function normalizePlacementFill(placement) {
  if (!placement || typeof placement !== 'object') return;
  if (!VALID_PLACEMENT_FILL.has(placement.fill)) {
    placement.fill = 'contain';
  }
  if (!placement.crop || typeof placement.crop.x !== 'number' || typeof placement.crop.y !== 'number' ||
      typeof placement.crop.w !== 'number' || typeof placement.crop.h !== 'number') {
    placement.crop = { x: 0, y: 0, w: 1, h: 1 };
  }
}

// ---------------------------------------------------------------------------
// small helpers

const TOAST_STACK_LIMIT = 3;
/**
 * Messages stack instead of replacing each other. Clearing the previous toast
 * on every call meant a second message issued in the same tick erased the
 * first before anyone could read it — and a failure reason was usually the one
 * that vanished.
 */
function toast(msg, bad = false) {
  let stack = document.querySelector('.toast-stack');
  if (!stack) {
    stack = el('div', { className: 'toast-stack' });
    document.body.append(stack);
  }
  const existing = [...stack.children];
  const hold = node => {
    clearTimeout(Number(node.dataset.expiry));
    node.dataset.expiry = String(setTimeout(() => {
      node.remove();
      if (!stack.children.length) stack.remove();
    }, bad ? 7000 : 2600));
  };
  const duplicate = existing.find(node => node.textContent === msg);
  // A repeated message moves to the bottom and starts its life over, rather
  // than expiring on the timer the first one set.
  if (duplicate) { stack.append(duplicate); hold(duplicate); return; }
  for (const extra of existing.slice(0, Math.max(0, existing.length + 1 - TOAST_STACK_LIMIT))) extra.remove();
  const t = el('div', { className: 'toast' + (bad ? ' bad' : ''), textContent: msg, role: 'status' });
  t.setAttribute('aria-live', bad ? 'assertive' : 'polite');
  stack.append(t);
  hold(t);
}

/** Wraps long jobs so the tab-close guard and the cursor both know. */
async function busy(fn) {
  state.busy = true;
  document.body.style.cursor = 'progress';
  // Let whatever the caller just put on screen actually reach it. These jobs
  // are synchronous once they start — a 24 MP grade holds the thread for
  // seconds — and awaiting a microtask would run before the frame is painted.
  // The timeout is the fallback: a backgrounded tab never fires a frame.
  await new Promise(resolve => { requestAnimationFrame(resolve); setTimeout(resolve, 50); });
  try { return await fn(); }
  finally { state.busy = false; document.body.style.cursor = ''; }
}

function dialog(title, body, buttons) {
  $('#dlgTitle').textContent = title;
  $('#dlgBody').replaceChildren(body);
  $('#dlgFoot').replaceChildren(...buttons.filter(Boolean));
  const d = $('#dlg');
  if (!d.open) d.showModal();
  return d;
}
const closeDialog = () => { const d = $('#dlg'); d.close(); d.classList.remove('feedback-popover'); };
/** replaceChildren stringifies whatever it is given, so a skipped conditional
 * child arrives on screen as the word "null". */
const setChildren = (node, ...kids) => node.replaceChildren(...kids.flat().filter(k => k != null && k !== false));
const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;
const sentence = text => String(text || '').replace(/^./, c => c.toUpperCase());
const btn = (label, cls = 'btn', onclick) => {
  const b = el('button', { className: cls, type: 'button' }, label);
  if (onclick) b.onclick = onclick;
  return b;
};
/** A link that carries the weight of a button, for routes that leave the app. */
const linkBtn = (label, href, cls = 'btn') =>
  el('a', { className: cls, href, target: '_blank', rel: 'noopener noreferrer' }, label);

/** Names a control whose visible label is a glyph. */
const aria = (node, label) => { node.setAttribute('aria-label', label); node.title = label; return node; };

const svgEl = (tag, attrs = {}, ...kids) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const kid of kids) node.append(kid);
  return node;
};

const pendingSaves = new Map();
function scheduleSave(key, save) {
  clearTimeout(pendingSaves.get(key)?.timer);
  const timer = setTimeout(() => { pendingSaves.delete(key); save(); }, 220);
  pendingSaves.set(key, { timer, save });
}
function flushPendingSaves() {
  for (const [, entry] of pendingSaves) { clearTimeout(entry.timer); entry.save(); }
  pendingSaves.clear();
}
function touchAsset(asset) {
  scheduleSave(`asset:${asset.id}`, () => store.saveAsset(asset));
}
function touchProject() {
  scheduleSave('project', () => store.saveProject(state.project));
}

function tattooRecordForAsset(asset) {
  return state.tattooMaps.get(asset?.id) || null;
}

function cacheTattooMapReadback(assetId, record) {
  if (!record?.tattooMap || record.tattooMap.targetAssetId !== assetId) return null;
  const cached = {
    ...record,
    tattooMap: structuredClone(record.tattooMap),
    storeAuthority: Object.freeze({
      verified: true,
      assetId,
      mapId: record.mapId,
      packId: record.packId,
      checkedAt: new Date().toISOString()
    })
  };
  state.tattooMaps.set(assetId, cached);
  return cached;
}

function tattooMapForAsset(asset) {
  let record = tattooRecordForAsset(asset);
  if (!record) {
    record = {
      mapId: '', packId: '', expiresAt: null,
      tattooMap: defaultTattooMap(), receipt: null, sourcePackRecord: null
    };
    state.tattooMaps.set(asset.id, record);
  }
  return record.tattooMap;
}

function activeTattooMapRecord(asset, mapping = tattooMapForAsset(asset)) {
  const record = tattooRecordForAsset(asset);
  if (!record || record.mapId !== mapping?.mapId || record.packId !== mapping?.packId) return null;
  const authority = record.storeAuthority;
  if (authority?.verified !== true || authority.assetId !== asset.id
      || authority.mapId !== record.mapId || authority.packId !== record.packId) return null;
  const consent = tattooPlacementConsentState(record.receipt, {
    targetAssetId: asset.id,
    sourcePackRecord: record.sourcePackRecord
  });
  if (!consent.allowed) return null;
  const validation = validateTattooPlacementMap(mapping, {
    consentReceipt: record.receipt,
    targetAssetId: asset.id,
    sourcePackRecord: record.sourcePackRecord
  });
  return validation.valid ? record : null;
}

async function persistTattooMap(asset, mapping = tattooMapForAsset(asset)) {
  if (!activeTattooMapRecord(asset, mapping)) {
    throw new Error('The direct tattoo-placement consent is no longer active.');
  }
  await savePersonalGeometryTattooMap(mapping, {
    projectId: state.project.id,
    assetId: asset.id,
    retentionClass: 'saved'
  });
  const records = await getPersonalGeometryTattooMapsForAsset(asset.id);
  const readback = records.find(record => record.mapId === mapping.mapId);
  const validation = readback && validateTattooPlacementMap(readback.tattooMap, {
    consentReceipt: readback.receipt,
    targetAssetId: asset.id,
    sourcePackRecord: readback.sourcePackRecord
  });
  if (!readback || !validation?.valid || readback.tattooMap.updatedAt !== mapping.updatedAt
      || readback.tattooMap.meshDensity !== mapping.meshDensity
      || JSON.stringify(readback.tattooMap.controlPoints) !== JSON.stringify(mapping.controlPoints)) {
    throw new Error('The tattoo-placement map did not pass isolated-store read-back verification.');
  }
  return cacheTattooMapReadback(asset.id, readback);
}

function touchTattooMap(asset, mapping = tattooMapForAsset(asset)) {
  scheduleSave(`tattoo:${asset.id}`, () => persistTattooMap(asset, mapping)
    .catch(cause => toast(cause?.message || 'The tattoo-placement map could not be saved.', true)));
}

const tattooMapLoads = new Map();
const tattooMapDiscoveryComplete = new Set();

function purgeTattooMapReadbacks(result) {
  if (result?.verified !== true) return;
  const affectedPackIds = new Set(result.affectedPackIds || []);
  const scope = result.scope || {};
  const allLocal = Object.keys(scope).length === 0
    && ['local_data_deleted', 'account_closed'].includes(result.reason);
  let removed = false;
  for (const [assetId, record] of state.tattooMaps) {
    const sourcePackId = record?.sourcePackRecord?.pack?.packId || record?.tattooMap?.sourcePackId;
    const matches = allLocal
      || scope.assetId === assetId
      || (scope.projectId && scope.projectId === state.project?.id)
      || affectedPackIds.has(record?.packId)
      || (sourcePackId && affectedPackIds.has(sourcePackId));
    if (!matches) continue;
    const pendingKey = `tattoo:${assetId}`;
    clearTimeout(pendingSaves.get(pendingKey)?.timer);
    pendingSaves.delete(pendingKey);
    state.tattooMaps.delete(assetId);
    tattooMapDiscoveryComplete.add(assetId);
    removed = true;
  }
  if (!removed) return;
  if (state.editTool === 'tattoo') state.editTool = null;
  queueMicrotask(() => {
    if (state.project && document.body) renderReview();
  });
}

subscribePersonalGeometryDeletion(purgeTattooMapReadbacks);

function hydrateTattooMap(asset) {
  if (tattooMapDiscoveryComplete.has(asset.id)) {
    return Promise.resolve(state.tattooMaps.get(asset.id) || null);
  }
  if (tattooMapLoads.has(asset.id)) return tattooMapLoads.get(asset.id);
  const load = getPersonalGeometryTattooMapsForAsset(asset.id).then(records => {
    const record = records[0] || null;
    if (record) cacheTattooMapReadback(asset.id, record);
    else state.tattooMaps.delete(asset.id);
    tattooMapDiscoveryComplete.add(asset.id);
    return record;
  }).finally(() => tattooMapLoads.delete(asset.id));
  tattooMapLoads.set(asset.id, load);
  return load;
}

async function createAuthorizedTattooMap(asset, {
  sourcePackRecord = null,
  controlPoints = null,
  buildControlPoints = null,
  region,
  method
} = {}) {
  const accountRef = personalGeometryAccountRef();
  if (sourcePackRecord && (sourcePackRecord.receipt?.subject_role !== 'self'
      || sourcePackRecord.receipt?.subject_ref !== accountRef
      || sourcePackRecord.receipt?.account_ref !== accountRef)) {
    throw new Error('The selected body Pack is not your directly consented self-subject Pack.');
  }
  const receipt = await requestPersonalGeometryConsent({
    packId: `tattoo-pack-${crypto.randomUUID()}`,
    specificPurpose: PERSONAL_GEOMETRY_PURPOSES.tattooPlacement,
    coreCategories: ['source_media', 'tattoo_mapping'],
    algorithms: [{
      algorithm_id: TATTOO_PLACEMENT_ALGORITHM_ID,
      sha256: TATTOO_PLACEMENT_ALGORITHM_SHA256
    }],
    allowedOptionalLayers: ['tattoos'],
    receiptBindings: {
      target_asset_id: asset.id,
      source_pack_id: sourcePackRecord?.pack?.packId || null,
      source_pack_subject_ref: sourcePackRecord?.receipt?.subject_ref || null
    },
    directSelfOnly: true
  });
  if (!receipt) return null;
  // Landmark-to-placement derivation begins only after the new target-bound
  // direct release is stored. Cancelling the dialog executes no mapping code.
  const authorizedControlPoints = typeof buildControlPoints === 'function'
    ? buildControlPoints()
    : controlPoints;
  if (!Array.isArray(authorizedControlPoints)
      || authorizedControlPoints.length !== TATTOO_CONTROL_POINT_COUNT) {
    throw new Error('The selected local landmarks cannot seed this region. No placement map was stored.');
  }
  const map = createTattooPlacementMap({
    mapId: `tattoo-map-${crypto.randomUUID()}`,
    targetAssetId: asset.id,
    consentReceipt: receipt,
    sourcePackRecord,
    controlPoints: authorizedControlPoints,
    region,
    method
  });
  await savePersonalGeometryTattooMap(map, {
    projectId: state.project.id,
    assetId: asset.id,
    retentionClass: 'saved'
  });
  const records = await getPersonalGeometryTattooMapsForAsset(asset.id);
  const readback = records.find(record => record.mapId === map.mapId);
  if (!readback) throw new Error('The tattoo-placement map did not pass isolated-store read-back verification.');
  cacheTattooMapReadback(asset.id, readback);
  tattooMapDiscoveryComplete.add(asset.id);
  return tattooMapForAsset(asset);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPendingSaves(); });

/** Every state change to an asset goes through here: undo + audit for free. */
function mutate(asset, label, fn) {
  snapshot(asset, label);
  fn();
  log(asset, label, state.reviewer);
  touchAsset(asset);
}

/** Crop gestures write placement.crop directly for speed, so they take their
 * own history entry here. Without one, a reframe rode inside whatever entry
 * came before it, and Undo after a crop threw away the color edit made
 * moments earlier along with the crop. Drags snapshot once at first
 * movement; wheel ticks, key presses, and zoom clicks coalesce per burst so
 * ten scroll notches step back as one reframe, not ten. */
const cropBursts = new WeakMap();
function captureCropBurst(asset, label) {
  const now = Date.now();
  const last = cropBursts.get(asset);
  if (last && last.label === label && now - last.at < 600) { last.at = now; return; }
  snapshot(asset, label);
  cropBursts.set(asset, { label, at: now });
}

const activeSurfaces = () => (state.project?.surfaces || []).map(id => SURFACE_BY_ID[id]).filter(Boolean);
/** Surfaces an asset can actually ship to: TikTok placements are video-only,
 * so stills must never see them in the stage, shortcuts, or auto-reframe. */
const surfacesForAsset = asset => activeSurfaces().filter(surface => asset?.kind === 'video' || surface.group !== 'tiktok');

function ensurePlacement(asset, surfaceId) {
  if (!asset.placements[surfaceId]) {
    const p = newPlacement();
    // A new placement starts with the complete source visible. Cropping is an
    // explicit choice so Photo and Video never look stretched on first open.
    p.crop = { x: 0, y: 0, w: 1, h: 1 };
    p.fill = 'contain';
    asset.placements[surfaceId] = p;
  } else {
    normalizePlacementFill(asset.placements[surfaceId]);
  }
  normalizePlacementFill(asset.placements[surfaceId]);
  return asset.placements[surfaceId];
}

function issueCount(asset) {
  if (!asset.auto) return { block: 0, warn: 0 };
  let block = 0, warn = 0;
  const bump = list => { for (const i of list) { if (i.level === 'block') block++; else if (i.level === 'warn') warn++; } };
  bump(assetIssues(asset, state.assets, state.project));
  for (const sid of Object.keys(asset.placements || {})) {
    if (asset.placements[sid].decision === 'pending') continue;
    bump(placementIssues(asset, sid, state.project));
  }
  return { block, warn };
}

function visibleAssets() {
  const f = state.filters;
  return state.assets.filter(a => {
    if (f.status && a.status !== f.status) return false;
    if (f.role && a.role !== f.role) return false;
    if (f.kind && a.kind !== f.kind) return false;
    if (f.surface && a.placements?.[f.surface]?.decision !== 'approved') return false;
    if (f.rating && (a.rating || 0) < f.rating) return false;
    if (f.issues) {
      const c = issueCount(a);
      if (f.issues === 'block' && !c.block) return false;
      if (f.issues === 'any' && !c.block && !c.warn) return false;
      if (f.issues === 'clean' && (c.block || c.warn)) return false;
    }
    if (f.q) {
      const hay = `${a.filename} ${a.notes} ${a.altText} ${a.labels.campaign} ${a.labels.audience} ${a.labels.lane}`.toLowerCase();
      if (!hay.includes(f.q.toLowerCase())) return false;
    }
    return true;
  });
}

const currentAsset = () => visibleAssets()[state.index] || null;

function qaChecksForAsset(asset) {
  const presetId = asset.kind === 'video' ? 'video' : state.project.qaPreset;
  const ids = PRESET_BY_ID[presetId]?.checks || QA_CHECKS.map(c => c.id);
  return QA_CHECKS.filter(c => ids.includes(c.id));
}

// ---------------------------------------------------------------------------
// decode + analysis

const DECODE_CACHE = 5;

async function decode(asset) {
  const hit = state.decoded.get(asset.id);
  if (hit) return hit;
  const url = await store.objectUrl(asset.id);
  if (!url) return null;
  let d;
  try {
    if (asset.kind === 'video') {
      // Frame zero is usually a fade-in or a black slate, which makes every
      // measurement meaningless. Default the poster to 30% in, then let the
      // reviewer scrub it.
      let t = asset.video.posterTime;
      let frame = await grabVideoFrame(url, t ?? 0);
      if (t == null) {
        t = frame.duration > 1 ? +(frame.duration * 0.3).toFixed(2) : 0;
        if (t > 0) frame = await grabVideoFrame(url, t);
        asset.video.posterTime = t;
        await store.saveAsset(asset);
      }
      d = { source: frame.canvas, w: frame.width, h: frame.height, url, duration: frame.duration };
    } else {
      const blob = await store.getBlob(asset.id);
      const managed = await decodeColorManagedBlob(blob);
      if (managed) d = { ...managed, url };
      else {
        const img = await loadImage(url);
        d = { source: img, w: img.naturalWidth, h: img.naturalHeight, url };
      }
    }
  } catch {
    return null;
  }
  if (!asset.width && d.w) {
    asset.width = d.w; asset.height = d.h;
    if (d.duration) asset.duration = d.duration;
    await store.saveAsset(asset);
  }
  state.decoded.set(asset.id, d);
  if (state.decoded.size > DECODE_CACHE) state.decoded.delete(state.decoded.keys().next().value);
  return d;
}

async function runAnalysis(asset, {
  quiet = false,
  geometryConsentReceipt = null,
  geometryPackId = null,
  geometryRequiredCategories = []
} = {}) {
  if (geometryConsentReceipt || geometryPackId) {
    // Validate the exact receipt, purpose, Pack, and algorithm before decoding
    // or otherwise reading pixels for this sensitive operation.
    await analyzeGeometry(null, 0, 0, {
      consentReceipt: geometryConsentReceipt,
      packId: geometryPackId,
      specificPurpose: geometryConsentReceipt?.specific_purpose || null,
      requiredCategories: geometryRequiredCategories
    });
  }
  const d = await decode(asset);
  if (!d) { if (!quiet) toast(`Could not decode ${asset.filename}.`, true); return null; }
  const blob = await store.getBlob(asset.id);
  asset.auto = await analyzeAsset(d.source, d.w, d.h, blob, d.colorTransform || null);
  if (asset.kind === 'video' && (d.duration || asset.duration) > 0) {
    const duration = d.duration || asset.duration;
    const url = await store.objectUrl(asset.id);
    const count = Math.min(9, Math.max(5, Math.ceil(duration / 4)));
    const samples = [];
    for (let i = 0; i < count; i++) {
      const time = duration * ((i + 0.5) / count);
      const frame = await grabVideoFrame(url, time);
      const result = await analyzeAsset(frame.canvas, frame.width, frame.height, null);
      samples.push({
        time: +time.toFixed(2), hash: result.hash, sharpness: result.sharpness,
        blown: result.exposure.blown, crushed: result.exposure.crushed,
        meanLuma: result.exposure.meanLuma
      });
    }
    asset.temporal = {
      version: 1,
      sampledAt: new Date().toISOString(),
      duration: +duration.toFixed(2),
      samples,
      sharpnessMin: Math.min(...samples.map(s => s.sharpness)),
      blownMax: Math.max(...samples.map(s => s.blown)),
      crushedMax: Math.max(...samples.map(s => s.crushed)),
      lumaRange: Math.max(...samples.map(s => s.meanLuma)) - Math.min(...samples.map(s => s.meanLuma))
    };
  }
  // Person mapping is a separate sensitive operation. Generic import and
  // quality checks never invoke it. A Pack-specific receipt must be active and
  // must name this exact pseudonymous Pack before local inference.
  let geometry = null;
  let peopleReview = {
    status: 'consent-required',
    faces: 0,
    hands: 0,
    bodies: 0,
    reviewedAt: null
  };
  if (geometryConsentReceipt) {
    geometry = await analyzeGeometry(d.source, d.w, d.h, {
      consentReceipt: geometryConsentReceipt,
      packId: geometryPackId,
      specificPurpose: geometryConsentReceipt.specific_purpose,
      requiredCategories: geometryRequiredCategories
    });
    peopleReview = {
      status: geometry ? 'complete' : 'manual-review-needed',
      faces: geometry?.faces?.length || 0,
      hands: geometry?.hands?.length || 0,
      bodies: geometry?.poses?.length || (geometry?.body ? 1 : 0),
      reviewedAt: new Date().toISOString()
    };
  }

  // Older builds wrote sensitive derived data into ordinary asset recovery.
  // Remove those fields on every save; current results live only in the
  // dedicated local store and this call's ephemeral return value.
  stripLegacyPersonalGeometryFields(asset);
  await store.saveAsset(asset);
  return { auto: asset.auto, geometry, peopleReview };
}

async function analyzeAll() {
  const pending = state.assets.filter(a => !a.auto);
  if (!pending.length) return toast('Every asset has already been analysed.');
  const bar = el('i');
  const status = el('p', {}, `Analysing ${pending.length} asset(s)…`);
  dialog('Automated checks', el('div', {}, status, el('div', { className: 'progress' }, bar)),
    [btn('Close', 'btn', closeDialog)]);
  try {
    await busy(async () => {
      let n = 0;
      for (const a of pending) {
        status.textContent = `Analysing ${++n} / ${pending.length} — ${a.filename}`;
        bar.style.width = `${(n / pending.length) * 100}%`;
        await runAnalysis(a, { quiet: true });
      }
    });
  } catch (error) {
    closeDialog();
    render();
    toast(error?.message || 'Analysis stopped early. Already-analysed assets kept their results.', true);
    return;
  }
  status.textContent = `Done. ${pending.length} asset(s) analysed.`;
  render();
}

// ---------------------------------------------------------------------------
// import

async function probe(file, url) {
  try {
    if (file.type.startsWith('video')) {
      const { width, height, duration } = await grabVideoFrame(url, 0);
      return { width, height, duration };
    }
    const managed = await decodeColorManagedBlob(file);
    if (managed) return { width: managed.w, height: managed.h, duration: 0 };
    const img = await loadImage(url);
    return { width: img.naturalWidth, height: img.naturalHeight, duration: 0 };
  } catch {
    return { width: 0, height: 0, duration: 0 };
  }
}

async function importFiles(fileList) {
  const files = [...fileList].filter(isImportableMediaFile);
  if (!files.length) return toast('No supported photo or video files in that drop.', true);

  const bar = el('i');
  const status = el('p', {}, `Importing ${count(files.length, 'file')}…`);
  dialog('Import', el('div', {}, status, el('div', { className: 'progress' }, bar)), [btn('Close', 'btn', closeDialog)]);

  let imported = 0, blocked = 0;
  try {
  await busy(async () => {
    let n = 0;
    let lastBlockedMessage = '';
    for (const sourceFile of files) {
      status.textContent = `Importing ${++n} / ${files.length} — ${sourceFile.name}`;
      bar.style.width = `${(n / files.length) * 100}%`;
      let file = sourceFile;
      let rawImport = null;
      if (isRawCameraFile(sourceFile)) {
        rawImport = await prepareRawCameraImport(sourceFile);
        if (!rawImport.ok) {
          blocked += 1;
          lastBlockedMessage = rawImport.message;
          status.textContent = rawImport.message;
          continue;
        }
        file = rawImport.file;
      }
      const asset = newAsset(state.project.id, file);
      if (!file.type && isRadianceFile(file)) asset.mime = 'image/vnd.radiance';
      if (rawImport?.ok) {
        asset.source = 'camera-raw-import';
        asset.rawImport = rawImport.provenance;
        asset.provenance = rawImport.mode === 'embedded-preview'
          ? 'Imported from the finished JPEG the camera stored inside this RAW file. Full RAW development unlocks once the verified offline decoder packet is installed.'
          : 'Camera RAW converted inside Studio from a verified offline decoder packet.';
      }
      await store.addAsset(asset, file);
      const url = await store.objectUrl(asset.id);
      Object.assign(asset, rawImport?.ok && rawImport.width && rawImport.height
        ? { width: rawImport.width, height: rawImport.height, duration: 0 }
        : await probe(file, url));
      const sourceLabel = rawImport?.ok ? `camera RAW from ${sourceFile.name}` : (file.type || 'unknown type');
      log(asset, `imported (${sourceLabel}, ${(sourceFile.size / 1048576).toFixed(1)} MB)`, state.reviewer);
      await store.saveAsset(asset);
      state.assets.push(asset);
      await runAnalysis(asset, { quiet: true });
      imported += 1;
    }
    if (!imported && blocked) {
      throw new Error(lastBlockedMessage || 'Camera RAW import needs setup before Studio can open that file.');
    }
  });
  } catch (error) {
    closeDialog();
    state.assets = await store.listAssets(state.project.id).catch(() => state.assets);
    render();
    toast(error?.message || 'Import failed. Files already imported are safe in the library.', true);
    return;
  }
  state.assets = await store.listAssets(state.project.id);
  closeDialog();
  render();
  toast(`Imported ${count(imported, 'file')} and ran the automatic checks. Face and body mapping only runs when you ask for it.${blocked ? ` ${count(blocked, 'file')} could not be opened.` : ''}`);
}

// ---------------------------------------------------------------------------
// sidebar

function panel(title, open, ...body) {
  return el('details', { className: 'panel', open },
    el('summary', {}, title), el('div', { className: 'panel-body' }, ...body));
}

function briefField(key, label, multiline = false) {
  const input = multiline
    ? el('textarea', { value: state.project.brief[key] || '' })
    : el('input', { type: 'text', value: state.project.brief[key] || '' });
  input.oninput = () => { state.project.brief[key] = input.value; touchProject(); };
  return el('label', { className: 'field' }, el('span', {}, label), input);
}

function peopleMappingNotice() {
  return el('p', { className: 'notice-bar', style: 'white-space:pre-line;font-size:11.5px;margin:10px 0' },
    PEOPLE_MAPPING_NOTICE);
}

function photoWorkflowSteps(active = 1, product = 'Photo') {
  return el('ol', { className: 'photo-flow', ariaLabel: `${product} workflow` },
    ...['Create or open', 'Review', 'Edit', 'Quality check', 'Export'].map((label, index) =>
      el('li', { className: index + 1 === active ? 'active' : index + 1 < active ? 'complete' : '' },
        el('span', {}, String(index + 1)), label)));
}

function openPhotoCreationDialog() {
  // From the start page, generation deserves the centre of the screen —
  // not a drawer. The dialog closes itself when the photos arrive.
  const d = dialog('Generate a photo', generatePanel(), [btn('Close', 'btn', closeDialog)]);
  d.classList.add('generate-dialog');
}

function openPhotoCreation() {
  const sidebar = $('#sidebar');
  sidebar.classList.remove('closed');
  sidebar.classList.add('open');
  $('#menuBtn').setAttribute('aria-expanded', 'true');
  const start = sidebar.querySelector('[data-photo-start]');
  if (start) start.open = true;
  const generation = sidebar.querySelector('[data-photo-generation]');
  if (generation) generation.open = true;
  requestAnimationFrame(() => generation?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

// --- generation panel: local GPU now, BYO key and managed tiers later ------

let comfyStatus = null;   // cached detection result for this session
// Owner-authorized local customer preview. Beta stays explicit because the real
// fixture still needs final human boundary acceptance; compatibility remains
// fail-closed and the original is always preserved.
const GENERATIVE_FILL_RELEASE = 'beta';

function generatePanel() {
  const wrap = el('div', {});

  const local = el('div', { style: 'margin-bottom:16px' });
  wrap.append(local);

  const renderLocal = async (force = false) => {
    const savedBase = localStorage.getItem('cros:comfyBase') || DEFAULT_BASE;
    if (!comfyStatus || force) {
      local.replaceChildren(el('p', { className: 'hint' }, 'Checking Photo creation\u2026'));
      comfyStatus = await detectComfy(savedBase);
    }
    if (!comfyStatus.ok) {
      const baseInput = el('input', { type: 'text', value: savedBase, placeholder: 'http://127.0.0.1:8188' });
      baseInput.onchange = () => localStorage.setItem('cros:comfyBase', baseInput.value.trim() || DEFAULT_BASE);
      const phoneConnection = el('details', { className: 'connection-details' },
        el('summary', {}, 'Phone connection'),
        el('p', { className: 'hint' }, 'Enter the Wi-Fi address shown by MaterialLogix to control Studio from your phone. Non-person photo quality checks run on the computer where the photo is open. Face, hand, and body mapping stays off until the pictured adult gives direct consent.'),
        el('label', { className: 'field' }, el('span', {}, 'Wi-Fi address'), baseInput));
      const routes = el('div', {});
      local.replaceChildren(
        el('p', { className: 'hint' }, 'Photo creation needs setup before you can generate an image.'),
        routes,
        phoneConnection,
        btn('Try again', 'btn sm', () => renderLocal(true)));

      // Fastest first: another computer already running Studio, then this one.
      const [bridge, device] = await Promise.all([detectBridge(), probeDevice().catch(() => null)]);
      if (bridge.ok) {
        baseInput.value = bridge.base;
        localStorage.setItem('cros:comfyBase', bridge.base);
        routes.replaceChildren(
          el('p', { className: 'hint' }, 'MaterialLogix is running on another computer here. That one is fastest.'),
          btn('Use that computer', 'btn primary sm', () => renderLocal(true)));
        return;
      }
      const onMac = /mac/i.test(`${navigator.userAgentData?.platform || navigator.platform || ''} ${navigator.userAgent || ''}`);
      if (onMac && await featureEnabled('mac_byo_engine')) {
        routes.replaceChildren(macEngineSetup(() => renderLocal(true)));
        return;
      }
      const lines = ['Install MaterialLogix for Windows to create photos on this computer.'];
      if (device && device.verdict === 'draft-capable') {
        lines.push('Your graphics card works here. Renders come back in seconds.');
      } else if (device) {
        lines.push('No graphics card Studio can use. Photos render on the processor, a minute or two each.');
        lines.push(deviceSummary(device));
      }
      routes.replaceChildren(...lines.map(text => el('p', { className: 'hint' }, text)));
      return;
    }
    let ckpts = [];
    try { ckpts = await listCheckpoints(comfyStatus.base); } catch { /* handled below */ }
    const head = el('p', { className: 'hint' }, comfyStatus.cpuOnly
      ? `Photo creation is ready on ${comfyStatus.device}.`
      : 'Photo creation is ready.');
    if (!ckpts.length) {
      local.replaceChildren(head,
        el('p', { className: 'hint' }, 'Add a Photo quality pack, then try again.'),
        btn('Try again', 'btn sm', () => renderLocal(true)));
      return;
    }
    const ckptSel = el('select', {});
    const fluxReady = await detectFluxReady(comfyStatus.base).catch(() => ({ ok: false, nodeMissing: true, missingFiles: [] }));
    if (fluxReady.ok) {
      ckptSel.append(el('option', { value: FLUX_SENTINEL }, 'Studio quality — Flux (highest)'));
    }
    for (const [index, c] of ckpts.entries()) ckptSel.append(el('option', { value: c }, `Studio quality ${index + 1}`));
    const fluxNote = fluxReady.ok ? null : el('p', { className: 'hint' }, fluxReady.nodeMissing
      ? 'Add the Flux quality pack for the sharpest results: install the ComfyUI-GGUF node, then restart Studio’s local engine.'
      : `Add the Flux quality pack for the sharpest results: missing ${fluxReady.missingFiles.join(', ')}.`);
    const promptBox = el('textarea', { placeholder: 'What to generate. Wording from the brief helps.', rows: 3 });
    const negBox = el('input', { type: 'text', placeholder: 'Avoid (optional)', value: state.project.brief.mustAvoid || '' });
    const referenceInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true });
    const referenceKind = el('select', {},
      el('option', { value: 'identity' }, 'Identity / appearance'),
      el('option', { value: 'composition' }, 'Composition only'),
      el('option', { value: 'style' }, 'Style only'));
    const subjectSel = el('select', {},
      el('option', { value: 'full' }, 'Whole image'),
      el('option', { value: 'left' }, 'Left subject'),
      el('option', { value: 'center' }, 'Center subject'),
      el('option', { value: 'right' }, 'Right subject'));
    const referenceList = el('div', { className: 'reference-photo-list', ariaLive: 'polite' });
    const referenceHelp = el('p', { className: 'hint' }, 'Add a clear reference to guide the person or product in a new scene. Use a close, readable face when likeness matters.');
    let referencePhotos = [];
    let activeReferenceId = null;
    let replacingReferenceId = null;
    const referenceRegion = () => ({
      full: { x: 0, y: 0, width: 1, height: 1 },
      left: { x: 0, y: 0, width: 0.5, height: 1 },
      center: { x: 0.25, y: 0, width: 0.5, height: 1 },
      right: { x: 0.5, y: 0, width: 0.5, height: 1 }
    })[subjectSel.value] || { x: 0, y: 0, width: 1, height: 1 };
    const activeReference = () => referencePhotos.find(item => item.id === activeReferenceId) || null;
    const renderReferencePhotos = () => {
      if (!referencePhotos.length) {
        referenceList.replaceChildren(el('p', { className: 'hint' }, 'No reference photos added.'));
        return;
      }
      referenceList.replaceChildren(...referencePhotos.map((item, index) => {
        const choose = btn(activeReferenceId === item.id ? 'Selected' : 'Use', 'btn sm', () => { activeReferenceId = item.id; renderReferencePhotos(); });
        choose.disabled = activeReferenceId === item.id;
        const remove = btn('Remove', 'btn sm', () => {
          URL.revokeObjectURL(item.url);
          referencePhotos = referencePhotos.filter(ref => ref.id !== item.id);
          if (activeReferenceId === item.id) activeReferenceId = referencePhotos[0]?.id || null;
          renderReferencePhotos();
        });
        const replace = btn('Replace', 'btn sm', () => { replacingReferenceId = item.id; referenceInput.click(); });
        return el('div', { className: 'reference-photo-row' },
          el('img', { src: item.url, alt: `Reference photo ${index + 1}` }),
          el('span', {}, `${item.file.name || 'Reference ' + (index + 1)} · ${item.width || '?'}×${item.height || '?'}`),
          choose, replace, remove);
      }));
    };
    const prepareReferenceFile = async (file) => {
      if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) throw new Error('Use PNG, JPG, or WebP.');
      status.textContent = 'Reading reference photo…';
      const bitmap = await createImageBitmap(file).catch(() => null);
      if (!bitmap) throw new Error('That reference photo could not be read.');
      const width = bitmap.width, height = bitmap.height;
      bitmap.close?.();
      if (Math.min(width, height) < 512) throw new Error('Use a clearer reference at least 512 px on the short side.');
      return { file, width, height, url: URL.createObjectURL(file) };
    };
    referenceInput.onchange = async () => {
      const chosenFiles = [...(referenceInput.files || [])];
      try {
        const prepared = [];
        for (const file of chosenFiles) prepared.push(await prepareReferenceFile(file));
        if (replacingReferenceId && prepared[0]) {
          const target = referencePhotos.find(item => item.id === replacingReferenceId);
          if (target) {
            URL.revokeObjectURL(target.url);
            Object.assign(target, prepared[0]);
            activeReferenceId = target.id;
          }
          for (const item of prepared.slice(1)) {
            const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            referencePhotos.push({ id, ...item });
            activeReferenceId = id;
          }
        } else {
          for (const item of prepared) {
            const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            referencePhotos.push({ id, ...item });
            activeReferenceId = id;
          }
        }
        status.textContent = prepared.length ? `${prepared.length} reference photo${prepared.length === 1 ? '' : 's'} ready.` : '';
      } catch (error) {
        status.textContent = 'Reference blocked: ' + (error.message || 'choose another photo.');
      } finally {
        replacingReferenceId = null;
        referenceInput.value = '';
        renderReferencePhotos();
      }
    };
    const styleSel = el('select', {},
      el('option', { value: 'natural' }, 'Photographic · believable by default'),
      el('option', { value: 'film' }, 'Film · adds grain and highlight roll-off'),
      el('option', { value: 'stylized' }, 'Stylized · follow my direction'));
    // Shape only. Pixels and timing live on one line below, so the list
    // stays short and nothing in it can go stale.
    const SIZES = [
      ['1024x1024', 'Social square'],
      ['832x1216', 'Phone portrait'],
      ['1216x832', 'Wide banner']
    ];
    const sizeSel = el('select', {});
    for (const [value, name] of SIZES) sizeSel.append(el('option', { value }, name));
    const countSel = el('select', {});
    for (const n of [1, 2, 4]) countSel.append(el('option', { value: String(n) }, `${n} image${n > 1 ? 's' : ''}`));
    const status = el('p', { className: 'hint', style: 'margin:8px 0 0' }, '');

    // No graphics card: same engine, but the customer picks speed over polish
    // and sees a real clock instead of a spinner.
    const speedSel = el('select', {});
    for (const [value, preset] of Object.entries(CPU_PRESETS)) {
      speedSel.append(el('option', { value }, preset.label));
    }
    const outputNote = el('p', { className: 'hint' }, '');
    const jobPlan = () => {
      const [w, h] = sizeSel.value.split('x').map(Number);
      if (!comfyStatus.cpuOnly) return { width: w, height: h, steps: undefined, seconds: 0 };
      const fit = cpuJobSettings(speedSel.value, w, h);
      const { seconds, measured } = estimateCpuSeconds(fit.steps, fit.width, fit.height, navigator.hardwareConcurrency || 4);
      return { ...fit, seconds, measured };
    };
    // One line, after both choices: what this makes and how long it takes.
    const refreshOutput = () => {
      const plan = jobPlan();
      const size = `${plan.width} \u00d7 ${plan.height}`;
      if (!comfyStatus.cpuOnly) { outputNote.textContent = `Makes ${size}.`; return; }
      outputNote.textContent = plan.measured
        ? `Makes ${size} in ${waitLabel(plan.seconds)}, measured on this computer.`
        : `Makes ${size} in roughly ${waitLabel(plan.seconds)}. Your first render sets the real number.`;
    };
    speedSel.onchange = refreshOutput;
    sizeSel.onchange = refreshOutput;
    refreshOutput();
    renderReferencePhotos();

    const go = btn('Generate photos', 'btn primary', async () => {
      const count = Number(countSel.value);
      // Every prompt is screened before any GPU time is spent on it.
      const screen = screenPrompt(promptBox.value, { recent: state.recentPrompts || [] });
      if (!screen.ok) { status.textContent = screen.reason; toast(screen.reason, true); return; }
      state.recentPrompts = [...(state.recentPrompts || []), screen.normalized].slice(-20);
      go.disabled = true;
      let ticker = null;
      try {
        await busy(async () => {
          for (let i = 0; i < count; i++) {
            const plan = jobPlan();
            const label = `Image ${i + 1} of ${count}`;
            status.textContent = `${label} \u2014 queued\u2026`;
            const startedAt = Date.now();
            const tick = () => {
              const elapsed = Math.round((Date.now() - startedAt) / 1000);
              const mins = Math.floor(elapsed / 60), secs = String(elapsed % 60).padStart(2, '0');
              status.textContent = comfyStatus.cpuOnly
                ? `${label} \u2014 creating\u2026 ${mins}:${secs} elapsed. It is safe to leave this open.`
                : `${label} \u2014 creating\u2026`;
            };
            const onStatus = () => {
              if (!ticker) { tick(); ticker = setInterval(tick, 1000); }
            };
            let blob, seed;
            const ref = activeReference();
            if (ref && referenceKind.value !== 'identity') {
              throw new Error('Composition and style references need a supported reference model before rendering. Choose Identity / appearance or remove the reference.');
            }
            if (ref && ckptSel.value === FLUX_SENTINEL) {
              throw new Error('Reference photos are available with Studio quality checkpoints. Choose a checkpoint or remove the reference.');
            }
            if (ckptSel.value === FLUX_SENTINEL) {
              // Flux has no CPU-only lane and no native-resolution ceiling to
              // fit a speed preset around, so it always runs the plan's exact
              // requested size, not plan.steps (tuned for SD1.5's
              // CPU_PRESETS, not this model's own fixed step count).
              const built = buildFluxTxt2Img({ prompt: promptBox.value, negative: negBox.value, styleIntent: styleSel.value, width: plan.width, height: plan.height });
              const result = await runGraph(built.graph, onStatus, comfyStatus.base, 10);
              blob = result.blob;
              seed = built.seed;
            } else if (ref) {
              status.textContent = `${label} — uploading reference…`;
              const imageName = await uploadImage(ref.file, ref.file.name || `reference_${i + 1}.png`, comfyStatus.base);
              const built = buildReferencePhoto({
                ckpt: ckptSel.value,
                prompt: promptBox.value,
                negative: negBox.value,
                styleIntent: styleSel.value,
                width: plan.width, height: plan.height, steps: plan.steps,
                imageName,
                region: referenceRegion()
              });
              const result = await runGraph(built.graph, onStatus, comfyStatus.base, comfyStatus.cpuOnly ? 45 : 10);
              blob = result.blob;
              seed = built.seed;
            } else {
              ({ blob, seed } = await generateOne({
                ckpt: ckptSel.value,
                prompt: promptBox.value,
                negative: negBox.value,
                styleIntent: styleSel.value,
                width: plan.width, height: plan.height, steps: plan.steps
              }, onStatus, comfyStatus.base, comfyStatus.cpuOnly ? 45 : 10));
            }
            if (ticker) { clearInterval(ticker); ticker = null; }
            if (comfyStatus.cpuOnly) {
              recordCpuPace((Date.now() - startedAt) / 1000, plan.steps, plan.width, plan.height);
              refreshSpeedNote();
            }
            const file = new File([blob], `gen_${seed}_${i + 1}.png`, { type: 'image/png' });
            const asset = newAsset(state.project.id, file);
            asset.source = 'generated-local';
            asset.provenance = `Created in MaterialLogix (seed ${seed}; ${styleSel.value} style intent; ${plan.width}\u00d7${plan.height} on ${comfyStatus.cpuOnly ? 'the processor' : comfyStatus.device}). Prompt: ${promptBox.value.slice(0, 300)}`;
            await store.addAsset(asset, file);
            const url = await store.objectUrl(asset.id);
            Object.assign(asset, await probe(file, url));
            log(asset, 'created in Studio', state.reviewer);
            await store.saveAsset(asset);
            state.assets.push(asset);
            await runAnalysis(asset, { quiet: true });
          }
        });
        state.assets = await store.listAssets(state.project.id);
        status.textContent = `Done \u2014 ${count} photo${count === 1 ? '' : 's'} added and checked.`;
        render();
        const dlg = $('#dlg');
        if (dlg.open && dlg.classList.contains('generate-dialog')) { dlg.classList.remove('generate-dialog'); closeDialog(); }
        toast(`Created ${count} candidate${count === 1 ? '' : 's'}.`);
      } catch (err) {
        status.textContent = 'Failed: ' + err.message;
      } finally {
        if (ticker) clearInterval(ticker);
        go.disabled = false;
      }
    });
    local.replaceChildren(head,
      el('label', { className: 'field' }, el('span', {}, 'Quality'), ckptSel),
      ...(fluxNote ? [fluxNote] : []),
      el('label', { className: 'field' }, el('span', {}, 'Describe your image'), promptBox),
      el('label', { className: 'field' }, el('span', {}, 'Look'), styleSel),
      el('p', { className: 'hint' }, 'Photographic keeps people and materials believable unless your direction asks for a stylized result.'),
      el('label', { className: 'field' }, el('span', {}, 'Avoid'), negBox),
      el('details', { className: 'reference-photo-picker' },
        el('summary', {}, 'Reference photos'),
        referenceHelp,
        el('label', { className: 'field' }, el('span', {}, 'Add photos'), referenceInput),
        el('div', { style: 'display:flex;gap:8px' },
          el('label', { className: 'field', style: 'flex:1' }, el('span', {}, 'Use as'), referenceKind),
          el('label', { className: 'field', style: 'flex:1' }, el('span', {}, 'Subject'), subjectSel)),
        referenceList),
      el('div', { style: 'display:flex;gap:8px' },
        el('label', { className: 'field', style: 'flex:1' }, el('span', {}, 'Size'), sizeSel),
        el('label', { className: 'field', style: 'flex:1' }, el('span', {}, 'Count'), countSel)),
      ...(comfyStatus.cpuOnly
        ? [el('label', { className: 'field' }, el('span', {}, 'Speed'), speedSel)]
        : []),
      outputNote,
      go, status);
  };
  renderLocal();

  return wrap;
}

// Set when the Mac packets are published.
const MAC_PACKET_URL = '';
const MAC_PACKET_LITE_URL = '';

// The signed Mac app is not out yet. The packet runs Studio from the Mac
// itself, which is what keeps every browser working.
function macEngineSetup(onConnected) {
  const command = 'python main.py --enable-cors-header ' + location.origin;
  const commandBox = el('code', { className: 'setup-command' }, command);
  const copy = btn('Copy command', 'btn sm', async () => {
    try {
      await navigator.clipboard.writeText(command);
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy command'; }, 2000);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(commandBox);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });
  if (!MAC_PACKET_URL) {
    return el('div', {},
      el('p', { className: 'hint' }, 'Mac Beta. Studio runs on your Mac, on your own graphics card.'),
      el('div', { className: 'setup-command-row' }, commandBox, copy),
      btn('Connect', 'btn primary sm', onConnected),
      el('details', { className: 'connection-details' },
        el('summary', {}, 'Setting this up'),
        el('p', { className: 'hint' }, 'The Mac setup is in beta: it takes a few steps, and a one-file installer is coming.'),
        el('ol', { className: 'setup-steps' },
          el('li', {}, 'Install ComfyUI for Mac.'),
          el('li', {}, 'Start it with the command above.'),
          el('li', {}, 'Add a Photo quality pack, then connect.')),
        el('p', { className: 'hint' }, 'Runs on your graphics card. This local Photo engine path stays on this Mac.'),
        el('p', { className: 'hint' }, 'Chrome for now. Safari can block the connection.')));
  }
  return el('div', {},
    el('p', { className: 'hint' }, 'Download MaterialLogix for Mac. Beta.'),
    el('div', { className: 'setup-choice' },
      el('a', { className: 'btn primary sm', href: MAC_PACKET_URL }, 'With the engine'),
      el('a', { className: 'btn sm', href: MAC_PACKET_LITE_URL || MAC_PACKET_URL }, 'Without it')),
    el('details', { className: 'connection-details' },
      el('summary', {}, 'Which one'),
      el('p', { className: 'hint' }, 'The engine makes the photos. Without it Studio still reviews, edits, and exports.'),
      el('p', { className: 'hint' }, 'With the engine is one file and nothing else to install. Without it is a small file, and Studio fetches the engine the first time you create.'),
      el('p', { className: 'hint' }, 'Runs on your graphics card. This local Photo engine path stays on this Mac.')),
    btn('Connect', 'btn primary sm', onConnected));
}

function localToolsPanel() {
  const wrap = el('div', {});
  const status = el('div', {}, el('p', { className: 'hint' }, 'Checking this computer…'));
  wrap.append(status);

  const statusRow = (label, ready, detail = '') => el('p', {
    className: 'hint',
    style: 'display:flex;gap:8px;align-items:flex-start;margin:0 0 7px'
  },
  el('strong', { style: `min-width:58px;color:${ready ? 'var(--ok)' : 'var(--muted)'}` }, ready ? 'Ready' : 'Optional'),
  el('span', {}, label, detail ? ` · ${detail}` : ''));

  const refresh = async () => {
    const bridge = await detectBridge();
    if (!bridge.ok) {
      status.replaceChildren(
        el('p', { className: 'hint' }, 'Open MaterialLogix Studio on your computer to manage creative tools.'));
      return;
    }
    const video = bridge.video || {};
    const rows = [
      statusRow('Photo enhancement', !!bridge.upscale?.available),
      statusRow('Video editing and delivery', !!video.ffmpeg),
      statusRow('Automatic captions', !!video.whisper),
      statusRow('Smooth motion', !!video.rife),
      statusRow('House Voice', !!bridge.voice?.available),
    ];
    const missingVideoPack = !video.whisper || !video.rife;
    if (missingVideoPack) {
      rows.push(el('p', { className: 'hint', style: 'margin:10px 0' },
        'Add the optional Video pack for captions and smoother motion.'));
      rows.push(btn('Add captions + smooth motion', 'btn sm', () => {
        const consent = el('input', { type: 'checkbox' });
        const close = btn('Cancel', 'btn', closeDialog);
        const message = el('p', { className: 'hint', role: 'status' },
          'Nothing will render during setup. Keep Studio open while the verified files download and install.');
        const install = btn('Install Video tools', 'btn primary', async () => {
          if (!consent.checked) return;
          install.disabled = true;
          message.textContent = 'Downloading and verifying the Video pack…';
          try {
            const response = await bridgeFetch(`${bridge.base}/engines/video/install`, { method: 'POST' });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || `setup ${response.status}`);
            message.textContent = 'Captions and smooth motion are ready on this computer.';
            await refresh();
            install.textContent = 'Installed';
            close.textContent = 'Close';
            toast('Video tools are ready.');
          } catch (error) {
            install.disabled = false;
            message.textContent = `Setup stopped safely: ${error.message}`;
          }
        });
        install.disabled = true;
        consent.onchange = () => { install.disabled = !consent.checked; };
        dialog('Add Video tools', el('div', {},
          el('p', {}, 'Adds automatic captions and smoother motion to Video Studio.'),
          el('p', { className: 'hint' }, 'Needs up to 588 MB to download and about 225 MB after installation.'),
          el('label', { className: 'checkline' }, consent,
            el('span', {}, 'Download and install the optional Video pack.')),
          message), [close, install]);
      }));
    } else {
      rows.push(el('p', { className: 'hint', style: 'margin:10px 0 0;color:var(--ok)' },
        'Creative tools are ready.'));
    }
    status.replaceChildren(...rows);
  };
  refresh();
  return wrap;
}

/** Load the product-made QA proof in both the packaged app and source checkout. */
async function loadDemo() {
  // One canonical location: the proof ships with the app's own assets in
  // every layout, so there is nothing to hunt for.
  const files = [];
  try {
    const r = await fetch('assets/upscale-qa.png');
    if (r.ok) {
      const b = await r.blob();
      files.push(new File([b], 'upscale-qa.png', { type: b.type || 'image/png' }));
    }
  } catch { /* handled below */ }
  if (!files.length) return toast('The product-made QA proof could not be loaded.', true);
  if (!state.project.brief.campaignGoal) {
    state.project.brief.brand = state.project.brief.brand || 'Demo';
    state.project.brief.campaignGoal = 'Demo \u2014 app launch, paid social and web hero';
    await store.saveProject(state.project);
  }
  await importFiles(files);
}

function renderSidebar() {
  const p = state.project;
  const bar = $('#sidebar');
  if (!p) return bar.replaceChildren();

  bar.classList.remove('dock-right');
  localStorage.removeItem('mlx:settings-dock');
  const closeSidebar = btn('Close', 'btn sm', () => {
    bar.classList.remove('open');
    bar.classList.add('closed');
    $('#menuBtn').setAttribute('aria-expanded', 'false');
  });
  bar.setAttribute('aria-label', 'Create and project tools');
  const sidebarHead = el('div', { className: 'sidebar-head' },
    el('strong', {}, 'Create or open'), el('span', { className: 'spacer' }), closeSidebar);
  const projectStrip = el('div', { className: 'sidebar-project' },
    el('span', { className: 'eyebrow' }, 'Project'), $('#projectSelect'), $('#newProject'));
  const status = panel('Project status', false, $('#counters'));

  const addBtn = btn('Add files', 'btn', () => $('#fileInput').click());
  const analyzeBtn = btn('Run checks on all', 'btn sm', analyzeAll);
  const storageLine = el('p', { className: 'hint', style: 'margin-top:4px' }, 'Checking storage…');
  store.usage().then(u => {
    if (!u || !u.quota) { storageLine.textContent = 'Browser storage use is not reportable here.'; return; }
    const pct = u.used / u.quota;
    storageLine.textContent =
      `${(u.used / 1073741824).toFixed(2)} GB of ${(u.quota / 1073741824).toFixed(1)} GB browser storage used (${Math.round(pct * 100)}%).`;
    if (pct > 0.8) {
      storageLine.style.color = 'var(--warn)';
      storageLine.textContent += ' Back up and prune before importing more — the browser evicts without warning.';
    }
  });

  // Demo assets are a local convenience, not a shipped feature.
  const demoBtn = btn('Load demo assets', 'btn sm', loadDemo);
  demoBtn.hidden = /(^|\.)materiallogix\.com$/i.test(location.hostname);
  const generation = panel('Generate photo', !state.assets.length, generatePanel());
  generation.dataset.photoGeneration = 'true';
  const activeAsset = currentAsset();
  const reviewStatus = activeAsset?.auto;
  const startActions = el('div', { className: 'photo-start-actions' },
    btn('Generate photo', 'btn primary', () => {
      generation.open = true;
      generation.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }),
    btn('Import photo or video', 'btn', () => $('#fileInput').click()));
  const startBody = [
    photoWorkflowSteps(state.assets.length ? (reviewStatus ? 3 : 2) : 1),
    startActions,
    el('p', { className: 'hint photo-flow-note' }, 'New photos receive non-person media-quality checks automatically. Face, hand, and body mapping runs locally only after the pictured adult gives direct consent.'),
    peopleMappingNotice()
  ];
  if (activeAsset) {
    startBody.push(btn(activeAsset.kind === 'image' ? 'Map the pictured adult locally' : 'Create a local geometry reference set',
      'btn sm', () => activeAsset.kind === 'image'
        ? createSinglePhotoFaceMap(activeAsset)
        : createPersonalGeometryReferencePack(activeAsset)));
  }
  startBody.push(generation);
  const photoStart = panel(el('span', { className: 'panel-label' },
    el('span', {}, 'Create or open'), el('small', {}, 'Generate · import · consented local mapping')),
  !state.assets.length, ...startBody);
  photoStart.dataset.photoStart = 'true';

  const library = panel(el('span', { className: 'panel-label' },
    el('span', {}, 'Library'), el('small', {}, 'Add files · checks · demo assets')), false,
    el('div', { style: 'display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap' }, addBtn, analyzeBtn, demoBtn),
    el('div', { className: 'dropzone' }, 'or drop images and video anywhere'),
    peopleMappingNotice(),
    el('p', { className: 'hint', style: 'margin-top:12px;margin-bottom:0' },
      `${state.assets.length} asset(s) · ${state.assets.filter(a => a.auto).length} analysed`),
    storageLine
  );

  const brief = panel('Brand brief', false,
    briefField('brand', 'Brand'),
    briefField('campaignGoal', 'Campaign goal'),
    briefField('audience', 'Audience'),
    briefField('tone', 'Tone'),
    briefField('mustHave', 'Must have', true),
    briefField('mustAvoid', 'Must avoid', true),
    briefField('brandRules', 'Brand rules — include #hex colours', true),
    briefField('rejectedStyles', 'Rejected styles (memory)', true),
    brandOverlayControls()
  );

  const surfBody = SURFACE_GROUPS.map(g => el('div', { className: 'surface-group' },
    el('h4', {}, g.label),
    ...g.surfaces.map(s => {
      const cb = el('input', { type: 'checkbox', checked: p.surfaces.includes(s.id) });
      cb.onchange = () => {
        snapshotProject(p, 'surface list');
        p.surfaces = cb.checked ? [...p.surfaces, s.id] : p.surfaces.filter(x => x !== s.id);
        if (!p.surfaces.includes(state.activeSurface)) state.activeSurface = p.surfaces[0] || null;
        store.saveProject(p).then(render);
      };
      return el('label', { className: 'surface-row' }, cb, s.label, el('span', { className: 'dim' }, `${s.w}×${s.h}`));
    })));
  const surfaces = panel(`Surfaces · ${p.surfaces.length}`, false,
    el('p', { className: 'hint' }, 'Each surface carries its own approval, its own crop, and its own safe zones.'),
    ...surfBody);

  const presetSel = el('select', {});
  for (const pr of QA_PRESETS) presetSel.append(el('option', { value: pr.id, selected: pr.id === p.qaPreset }, `${pr.label} · ${pr.checks.length} checks`));
  presetSel.onchange = () => { p.qaPreset = presetSel.value; store.saveProject(p).then(render); };
  const qa = panel('QA checklist · optional', false,
    el('p', { className: 'hint' }, 'Video always uses the video preset regardless of this setting.'),
    el('label', { className: 'field' }, el('span', {}, 'Preset'), presetSel),
    el('p', { className: 'hint' }, (PRESET_BY_ID[p.qaPreset]?.checks || []).map(id => QA_BY_ID[id]?.label).join(' · ')));

  const localTools = panel('Creative setup', false, localToolsPanel());

  const who = el('input', { type: 'text', value: state.reviewer });
  who.oninput = () => { state.reviewer = who.value || 'reviewer'; localStorage.setItem('cros:reviewer', state.reviewer); };

  const licBox = el('div', { style: 'margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--hair-soft)' });
  activeLicense().then(lic => {
    if (lic) {
      licBox.append(
        el('p', { className: 'hint', style: 'margin-bottom:6px' },
          `Licensed \u2014 ${String(lic.plan).replaceAll('_', ' ')}${lic.selected_product ? ` / ${lic.selected_product}` : ''} (${lic.email}). Clean exports require online authorization and verified remaining usage.`),
        btn('Deactivate on this device', 'btn sm', () => { deactivate(); render(); }));
    } else {
      const input = el('input', { type: 'text', placeholder: 'ML1.\u2026 license key' });
      const msg = el('p', { className: 'hint', style: 'margin:6px 0 0' },
        'Free preview lets you explore and review. Downloads require an active matching license and online usage confirmation.');
      licBox.append(input, el('div', { style: 'height:6px' }),
        btn('Activate', 'btn sm', async () => {
          const lic = await activate(input.value);
          if (lic) { toast(`Licensed: ${lic.plan}.`); render(); }
          else {
            const reason = activationFailureReason();
            msg.textContent = reason === 'online_verification_required' || reason === 'verification_unavailable'
              ? 'Connect to the internet so the license service can verify this key before first use.'
              : reason === 'invalid_or_legacy_key'
                ? 'That key is invalid or from an unsupported pre-release format.'
                : 'The license service could not verify this key as active.';
          }
        }), msg);
    }
  });

  const deliver = panel('Deliver', false,
    licBox,
    el('p', { className: 'hint' }, 'Choose the files you want to prepare.'),
    btn('Proof package (licensed, watermarked)', 'btn', () => doExport({ proof: true })),
    el('div', { style: 'height:6px' }),
    btn('Finished photo', 'btn', openFinishedPhotoDelivery),
    el('div', { style: 'height:6px' }),
    btn('Print-ready photo', 'btn', openPrintDelivery),
    el('div', { style: 'height:14px' }),
    (() => {
      const box = el('div', {});
      box.append(el('p', { className: 'hint', style: 'margin-bottom:6px' }, 'Your phone (no app store needed):'));
      const line = el('p', { className: 'hint', style: 'font-family:var(--mono);font-size:11px' }, 'looking for the bridge…');
      box.append(line);
      detectBridge().then(b => {
        if (b.ok && b.lan?.length) {
          // First address is the real Wi-Fi interface; the rest are virtual adapters.
          const link = companionUrl(b.lan, location.port || 80, b.lanPin);
          line.textContent = link.split('#')[0];
          try {
            const code = el('canvas', { className: 'companion-qr', role: 'img',
              ariaLabel: 'Connection code for your phone camera' });
            paintCompanionQr(code, companionQrMatrix(link));
            box.append(code);
          } catch { /* the typed address below still works */ }
          box.append(el('p', { className: 'hint' }, b.lanPin
            ? 'Point your phone camera at the code to connect with the Wi-Fi PIN already filled in, or type the address while both devices use the same Wi-Fi.'
            : 'Point your phone camera at the code, or type the address on your phone while both devices use the same Wi-Fi.'));
        } else {
          line.textContent = 'Open MaterialLogix Studio on your computer to show its Wi-Fi address.';
        }
      });
      return box;
    })(),
    el('div', { style: 'height:6px' }),
    btn('Client review page', 'btn', exportClientPage),
    el('div', { style: 'height:6px' }),
    btn('Import client decisions', 'btn', () => $('#verdictInput').click()),
    el('div', { style: 'height:6px' }),
    btn('Contact sheet (PNG)', 'btn', exportContactSheet),
    el('div', { style: 'height:6px' }),
    btn('Decision summary', 'btn', showSummary),
    el('div', { style: 'height:14px' }),
    el('label', { className: 'field' }, el('span', {}, 'Reviewer name (audit trail)'), who));

  const backup = panel('Project', false,
    el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
      btn('Rename', 'btn sm', renameProject),
      btn('Save recovery file', 'btn sm', backupProject),
      btn('Restore file', 'btn sm', () => $('#recoveryInput').click()),
      btn('Delete', 'btn sm', deleteProjectFlow)),
    el('p', { className: 'hint', style: 'margin-top:12px' },
      `Created ${new Date(p.createdAt).toLocaleDateString()}. Changes auto-save locally. A recovery file includes the project, decisions, and original media.`));

  const secondaryPanels = [status, brief, library, surfaces, qa, localTools, deliver, backup];
  for (const secondary of secondaryPanels) secondary.setAttribute('name', 'settings-more-tools');
  const moreTools = panel(el('span', { className: 'panel-label' },
    el('span', {}, 'Project tools'),
    el('small', {}, 'Brief · Library · Formats · QA · Deliver')),
  false,
  el('p', { className: 'hint panel-index' },
    'Open one labeled section at a time. QA is optional and stays out of the main workflow until you need it.'),
  ...secondaryPanels);
  moreTools.classList.add('panel-group');
  moreTools.dataset.secondaryTools = 'true';

  bar.replaceChildren(sidebarHead, projectStrip, photoStart, moreTools);
}

function renameProject() {
  const input = el('input', { type: 'text', value: state.project.name });
  dialog('Rename project', el('label', { className: 'field' }, el('span', {}, 'Name'), input), [
    btn('Cancel', 'btn', closeDialog),
    btn('Save', 'btn primary', () => {
      state.project.name = input.value.trim() || state.project.name;
      store.saveProject(state.project).then(() => { closeDialog(); boot(state.project.id); });
    })
  ]);
}

/** Full removal: no undo entry, because undo() can only restore field
 * changes on an asset still present in state.assets — it cannot bring a
 * deleted one back. Every path that deletes an asset goes through here. */
async function removeAsset(asset) {
  await deletePersonalGeometryAsset(asset.id, { deletedAt: new Date().toISOString() });
  await store.deleteAsset(asset.id);
  state.assets = state.assets.filter(a => a.id !== asset.id);
  renderReview(); renderCounters();
}

function deleteProjectFlow() {
  dialog('Delete project',
    el('p', {}, `Delete "${state.project.name}" and its ${state.assets.length} asset(s)? Back up first — this cannot be undone.`),
    [btn('Cancel', 'btn', closeDialog),
     btn('Delete', 'btn primary', async () => {
       try {
         await deletePersonalGeometryProject(state.project.id);
         await store.deleteProject(state.project.id);
         closeDialog(); boot();
       } catch (cause) {
         toast(cause?.message || 'The project could not be deleted completely.', true);
       }
     })]);
}

async function backupProject() {
  const { providers: _retiredProviders, ...safeProject } = state.project;
  const recovery = personalGeometrySafeRecoveryView({ project: safeProject, assets: state.assets });
  const manifest = JSON.stringify({
    schema: 'materiallogix/recovery@2',
    exportedAt: new Date().toISOString(),
    project: recovery.project,
    assets: recovery.assets
  }, null, 2);
  const entries = [{ name: 'project.json', data: manifest }];
  try {
    await busy(async () => {
      for (const asset of recovery.assets) {
        const blob = await store.getBlob(asset.id);
        if (blob) entries.push({ name: `media/${asset.id}`, data: new Uint8Array(await blob.arrayBuffer()) });
      }
    });
    downloadBlob(makeZip(entries), `${slug(state.project.name)}-recovery.zip`);
    toast(`Recovery file saved with ${entries.length - 1} media file(s).`);
  } catch (error) {
    toast(error?.message || 'The recovery file could not be created. Nothing was saved.', true);
  }
}

async function restoreProject(file) {
  try {
    const entries = await readStoreZip(file);
    const raw = entries.get('project.json');
    if (!raw) throw new Error('project.json is missing.');
    const backup = JSON.parse(new TextDecoder().decode(raw));
    if (backup.schema !== 'materiallogix/recovery@2' || !backup.project || !Array.isArray(backup.assets)) {
      throw new Error('This is not a MaterialLogix recovery file.');
    }
    const recoverableProject = personalGeometrySafeRecoveryView(backup.project);
    const recoverableAssets = backup.assets
      .filter(asset => !hasLegacyPersonalGeometryLink(asset))
      .map(asset => {
        const clean = structuredClone(asset);
        stripLegacyPersonalGeometryFields(clean);
        return personalGeometrySafeRecoveryView(clean);
      })
      .filter(Boolean);
    const projectId = crypto.randomUUID();
    const idMap = new Map(recoverableAssets.map(a => [a.id, crypto.randomUUID()]));
    const { providers: _legacyProviders, ...recoveredFields } = recoverableProject;
    const project = { ...recoveredFields, id: projectId, name: `${recoverableProject.name} (recovered)` };
    if (project.brandOverlay?.assetId) project.brandOverlay.assetId = idMap.get(project.brandOverlay.assetId) || '';
    await busy(async () => {
      await store.saveProject(project);
      for (const original of recoverableAssets) {
        const bytes = entries.get(`media/${original.id}`);
        if (!bytes) throw new Error(`Media missing for ${original.filename}.`);
        const asset = { ...original, id: idMap.get(original.id), projectId };
        if (asset.video?.proTimeline) {
          asset.video = { ...asset.video, proTimeline: remapVideoTimelineAssets(asset.video.proTimeline, idMap) };
        }
        const media = new File([bytes], asset.filename, { type: asset.mime || 'application/octet-stream' });
        await store.addAsset(asset, media);
      }
    });
    await boot(projectId);
    toast(`Recovered ${recoverableAssets.length} media file(s) and all project decisions.`);
  } catch (error) {
    toast(`Recovery failed: ${error.message}`, true);
  }
}

// ---------------------------------------------------------------------------
// board

function renderBoard() {
  const f = state.filters;
  const mk = (key, label, options) => {
    const s = el('select', {});
    s.append(el('option', { value: '' }, label));
    for (const o of options) s.append(el('option', { value: o.id, selected: f[key] === o.id }, o.label));
    s.onchange = () => { f[key] = s.value; state.index = 0; render(); };
    return s;
  };
  const search = el('input', { type: 'text', placeholder: 'Search files, notes, labels', value: f.q });
  search.oninput = () => { f.q = search.value; renderBoardList(); };

  const toolbar = el('div', { className: 'toolbar' },
    mk('status', 'Any status', ASSET_STATUSES),
    mk('role', 'Any role', ASSET_ROLES),
    mk('kind', 'Stills and video', [{ id: 'image', label: 'Stills' }, { id: 'video', label: 'Video' }]),
    mk('surface', 'Any surface', activeSurfaces().map(s => ({ id: s.id, label: `Approved · ${s.label}` }))),
    (() => {
      const sel = el('select', {});
      sel.append(el('option', { value: '0' }, 'Any rating'));
      for (const n of [1, 2, 3, 4, 5]) sel.append(el('option', { value: String(n), selected: f.rating === n }, '★'.repeat(n) + ' and up'));
      sel.onchange = () => { f.rating = Number(sel.value); state.index = 0; render(); };
      return sel;
    })(),
    mk('issues', 'Any check state', [
      { id: 'block', label: 'Blocking issues' }, { id: 'any', label: 'Any issue' }, { id: 'clean', label: 'Clean' }]),
    search,
    btn('Clear', 'btn sm', () => { state.filters = { status: '', role: '', kind: '', surface: '', issues: '', rating: 0, q: '' }; render(); }),
    el('div', { className: 'spacer' }),
    el('span', { className: 'note' }, 'Click a card to review it'));

  $('#main').replaceChildren(toolbar, el('div', { className: 'board' }));
  renderBoardList();
}

function renderBoardList() {
  const list = $('.board');
  if (!list) return;
  const assets = visibleAssets();
  if (!assets.length) {
    list.replaceChildren(el('div', { className: 'empty' },
      el('h2', {}, 'Nothing matches'),
      el('p', {}, 'Loosen the filters, or add files from the Library panel.')));
    return;
  }
  const grid = el('div', { className: 'grid' });
  list.replaceChildren(grid);

  for (const a of assets) {
    const thumb = el('div', { className: 'thumb' });
    const c = issueCount(a);
    const edited = hasVisibleAdjustments(a.edit?.adjustments);
    const card = el('div', { className: 'card' }, thumb,
      el('div', { className: 'meta' },
        el('div', { className: 'name', title: a.filename }, a.filename),
        el('div', { className: 'sub' },
          el('span', { className: 'chip ' + a.status }, STATUS_BY_ID[a.status]?.label || a.status),
          edited ? el('span', { className: 'chip edited', title: 'The card shows a quick preview. The full view and every export are exact.' }, 'Edited') : null,
          (a.rating ? el('span', { style: 'color:var(--gold)' }, '★'.repeat(a.rating)) : null),
          el('span', {}, a.kind === 'video' ? 'video' : a.width ? `${a.width}×${a.height}` : '—'),
          c.block ? el('span', { style: 'color:var(--bad)' }, `${c.block} blocking`) : null,
          !c.block && c.warn ? el('span', { style: 'color:var(--warn)' }, `${c.warn} warn`) : null),
        el('div', { className: 'pmatrix' },
          ...activeSurfaces().map(s => el('span', {
            className: 'pdot ' + (a.placements?.[s.id]?.decision || 'pending'),
            title: `${s.label}: ${a.placements?.[s.id]?.decision || 'pending'}`
          }, s.label)))));
    card.onclick = () => { state.index = assets.indexOf(a); state.mode = 'review'; render(); };
    grid.append(card);
    store.objectUrl(a.id).then(url => {
      if (!url) return;
      const media = a.kind === 'video'
        ? el('video', { src: url, muted: true, preload: 'metadata' })
        : el('img', { src: url, loading: 'lazy', alt: a.filename });
      // Board cards used to show the untouched file, so a graded shoot looked
      // ungraded while culling. A CSS approximation is enough at card size and
      // costs no decode; the stage and every export stay authoritative.
      if (edited) media.style.filter = previewFilter(a.edit.adjustments);
      thumb.append(media);
    });
  }
}

// ---------------------------------------------------------------------------
// stage painting

const PREVIEW_MAX = 1000;
const previewSurface = s => {
  const k = Math.min(1, PREVIEW_MAX / Math.max(s.w, s.h));
  return { ...s, w: Math.max(1, Math.round(s.w * k)), h: Math.max(1, Math.round(s.h * k)) };
};

function safeOverlay(surface) {
  if (!(surface.safeTop || surface.safeBottom || surface.safeRight || surface.safeLeft)) return null;
  const wrap = el('div', { className: 'safe' });
  const band = (style, label) => {
    const d = el('div', { className: 'band', style });
    d.append(el('span', { className: 'lbl' }, label));
    return d;
  };
  if (surface.safeTop) wrap.append(band(`left:0;right:0;top:0;height:${surface.safeTop * 100}%`, 'chrome'));
  if (surface.safeBottom) wrap.append(band(`left:0;right:0;bottom:0;height:${surface.safeBottom * 100}%`, 'caption'));
  if (surface.safeRight) wrap.append(band(`top:${(surface.safeTop || 0) * 100}%;bottom:${(surface.safeBottom || 0) * 100}%;right:0;width:${surface.safeRight * 100}%`, 'rail'));
  if (surface.safeLeft) wrap.append(band(`top:0;bottom:0;left:0;width:${surface.safeLeft * 100}%`, 'ui'));
  return wrap;
}

// A slider fires input events far faster than a full-resolution grade can be
// rendered. Without coalescing every one of them queued its own paint, so a
// two-second drag on Noise reduction spent the next thirty seconds catching up
// on frames nobody would ever see. One paint in flight, at most one queued.
let paintInFlight = null;
let paintQueued = false;
function schedulePaint() {
  if (paintInFlight) { paintQueued = true; return paintInFlight; }
  paintInFlight = new Promise(resolve => {
    let ran = false;
    const run = async () => {
      if (ran) return;
      ran = true;
      try { await paintStage(); }
      finally {
        paintInFlight = null;
        resolve();
        if (paintQueued) { paintQueued = false; schedulePaint(); }
      }
    };
    requestAnimationFrame(run);
    // A tab that is not compositing never fires the frame callback, and
    // without a second path this promise never settles: paintInFlight stays
    // set, every later call returns it unresolved, and the preview stops
    // answering the controls until the page is reloaded. The guard makes the
    // two paths idempotent, so whichever arrives first does the work.
    setTimeout(run, 250);
  });
  return paintInFlight;
}

async function paintStage() {
  const viewport = $('#viewport');
  if (!viewport) return;
  const asset = currentAsset();
  if (!asset) return;
  const surface = SURFACE_BY_ID[state.activeSurface];
  const d = await decode(asset);
  if (!d) {
    viewport.replaceChildren(el('div', { className: 'empty' },
      el('h2', {}, 'Cannot decode'),
      el('p', {}, `${asset.filename} could not be read by this browser. Convert it and re-import.`)));
    return;
  }

  if (state.view === 'source' || !surface) {
    const wrap = el('div', {
      className: 'srcwrap', tabIndex: 0, role: 'group',
      ariaLabel: state.editTool === 'tattoo'
        ? 'Tattoo placement map. Drag a visible anchor or use arrow keys to move the selected anchor; hold Shift for a larger step.'
        : 'Full source preview. Drag to move the crop. Use arrow keys to nudge, plus and minus to zoom, and zero to reset.'
    });
    const scale = Math.min(1, PREVIEW_MAX / Math.max(d.w, d.h));
    const sourcePreview = renderCrop(d.source, d.w, d.h, { x: 0, y: 0, w: 1, h: 1 }, {
      w: Math.max(1, Math.round(d.w * scale)), h: Math.max(1, Math.round(d.h * scale))
    }, 'crop', null, ensureEditState(asset).adjustments);
    sourcePreview.setAttribute('role', 'img');
    sourcePreview.setAttribute('aria-label', `${asset.filename} edited source preview`);
    wrap.append(sourcePreview);
    if (surface) {
      const p = ensurePlacement(asset, surface.id);
      const rect = el('div', {
        className: 'croprect',
        style: `left:${p.crop.x * 100}%;top:${p.crop.y * 100}%;width:${p.crop.w * 100}%;height:${p.crop.h * 100}%`
      }, ...['tl', 'tr', 'bl', 'br'].map(c => el('div', { className: 'corner ' + c })));
      wrap.append(rect);
      attachSourceDrag(wrap, rect, asset, surface);
    }
    const edit = ensureEditState(asset);
    const tattooMap = tattooMapForAsset(asset);
    if (edit.pixelGrid.enabled) wrap.append(pixelGridOverlay(pixelGridReview(d.source, d.w, d.h, edit.pixelGrid.columns, edit.pixelGrid.sensitivity)));
    if (tattooMap.controlPoints.length === TATTOO_CONTROL_POINT_COUNT
        && (tattooMap.enabled || state.editTool === 'tattoo')) {
      paintTattooOverlay(wrap, () => sourcePreview, tattooMap,
        () => adjustmentFrame({ x: 0, y: 0, w: 1, h: 1 },
          { x: 0, y: 0, w: sourcePreview.width, h: sourcePreview.height }, edit.adjustments.rotate));
    }
    viewport.replaceChildren(wrap);
    attachLoupe(wrap, d, () => ({ x: 0, y: 0, w: 1, h: 1 }));
    if (asset.kind === 'image' && state.editTool) {
      attachEditTool(wrap, () => sourcePreview, asset, d,
        () => adjustmentFrame({ x: 0, y: 0, w: 1, h: 1 },
          { x: 0, y: 0, w: sourcePreview.width, h: sourcePreview.height }, edit.adjustments.rotate));
    }
    return;
  }

  const p = ensurePlacement(asset, surface.id);
  const ps = previewSurface(surface);
  const edit = ensureEditState(asset);
  const tattooMap = tattooMapForAsset(asset);
  const canvas = renderCrop(d.source, d.w, d.h, p.crop, ps, p.fill, null, edit.adjustments);
  const frame = el('div', {
    className: 'frame grab', tabIndex: 0, role: 'group',
    ariaLabel: state.editTool === 'tattoo'
      ? `${surface.label} tattoo placement map. Drag a visible anchor or use arrow keys to move the selected anchor; hold Shift for a larger step.`
      : `${surface.label} placement. Drag to reframe. Use arrow keys to nudge, plus and minus to zoom, and zero to reset.`
  }, canvas);
  if (edit.pixelGrid.enabled) frame.append(pixelGridOverlay(pixelGridReview(d.source, d.w, d.h, edit.pixelGrid.columns, edit.pixelGrid.sensitivity)));
  if (state.thirds) frame.append(el('div', { className: 'thirds' }));
  const safe = safeOverlay(surface);
  if (safe) frame.append(safe);
  viewport.replaceChildren(frame);
  // Repaint the crop into the live frame during drags: replacing the frame
  // itself would release the pointer capture and kill the drag mid-gesture.
  let stageCanvas = canvas;
  const tattooFrame = () => adjustmentFrame(p.crop, placementRect(d.w, d.h, p.crop, ps, p.fill), edit.adjustments.rotate);
  if (tattooMap.controlPoints.length === TATTOO_CONTROL_POINT_COUNT
      && (tattooMap.enabled || state.editTool === 'tattoo')) {
    paintTattooOverlay(frame, () => stageCanvas, tattooMap, tattooFrame);
  }
  const repaintPlacement = () => {
    const next = renderCrop(d.source, d.w, d.h, p.crop, ps, p.fill, null, edit.adjustments);
    stageCanvas.replaceWith(next);
    stageCanvas = next;
    if (tattooMap.controlPoints.length === TATTOO_CONTROL_POINT_COUNT
        && (tattooMap.enabled || state.editTool === 'tattoo')) {
      paintTattooOverlay(frame, () => stageCanvas, tattooMap, tattooFrame);
    }
  };
  attachPlacementDrag(frame, asset, surface, repaintPlacement);
  attachLoupe(frame, d, () => p.crop);
  if (asset.kind === 'image' && state.editTool) {
    attachEditTool(frame, () => stageCanvas, asset, d,
      tattooFrame);
  }
}

function attachPlacementDrag(frame, asset, surface, repaint = paintStage) {
  const p = asset.placements[surface.id];
  let drag = null;
  // A repaint re-grades the whole frame, which takes longer than the gap
  // between pointer events. One repaint per animation frame keeps the crop
  // under the finger instead of minutes behind it.
  let repaintPending = false;
  const coalescedRepaint = () => {
    if (repaintPending) return;
    repaintPending = true;
    requestAnimationFrame(() => { repaintPending = false; repaint(); });
  };
  frame.onpointerdown = e => {
    if (state.loupe) return;
    drag = { x: e.clientX, y: e.clientY, crop: { ...p.crop } };
    frame.setPointerCapture(e.pointerId);
  };
  frame.onpointermove = e => {
    if (!drag) return;
    if (!drag.captured) { snapshot(asset, `reframed ${surface.label}`); drag.captured = true; }
    const r = frame.getBoundingClientRect();
    p.crop = panCrop(drag.crop,
      -((e.clientX - drag.x) / r.width) * drag.crop.w,
      -((e.clientY - drag.y) / r.height) * drag.crop.h);
    coalescedRepaint();
  };
  frame.onpointerup = frame.onpointercancel = () => {
    if (!drag) return;
    drag = null;
    log(asset, `reframed ${surface.label}`, state.reviewer);
    touchAsset(asset);
    renderIssuesOnly();
  };
  frame.onlostpointercapture = () => { drag = null; };
  frame.onwheel = e => {
    if (state.loupe) return;
    e.preventDefault();
    captureCropBurst(asset, `reframed ${surface.label}`);
    p.crop = zoomCrop(p.crop, e.deltaY < 0 ? 1.08 : 1 / 1.08);
    touchAsset(asset);
    repaint();
    renderIssuesOnly();
  };
  frame.onkeydown = e => {
    const step = e.shiftKey ? 0.06 : 0.018;
    let next = p.crop;
    if (e.key === 'ArrowLeft') next = panCrop(p.crop, -step * p.crop.w, 0);
    else if (e.key === 'ArrowRight') next = panCrop(p.crop, step * p.crop.w, 0);
    else if (e.key === 'ArrowUp') next = panCrop(p.crop, 0, -step * p.crop.h);
    else if (e.key === 'ArrowDown') next = panCrop(p.crop, 0, step * p.crop.h);
    else if (e.key === '+' || e.key === '=') next = zoomCrop(p.crop, 1.12);
    else if (e.key === '-' || e.key === '_') next = zoomCrop(p.crop, 1 / 1.12);
    else if (e.key === '0' || e.key === 'Home') next = asset.width
      ? defaultCrop(asset.width, asset.height, surface)
      : { x: 0, y: 0, w: 1, h: 1 };
    else return;
    e.preventDefault();
    captureCropBurst(asset, `reframed ${surface.label}`);
    p.crop = next; touchAsset(asset); schedulePaint(); renderIssuesOnly();
  };
}

async function blobEvidenceHash(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function stableLocalVideoJobId(asset, options) {
  const material = new TextEncoder().encode(`${asset.id}\n${JSON.stringify(options)}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', material));
  const suffix = [...digest.slice(0, 18)].map(value => value.toString(16).padStart(2, '0')).join('');
  return `local-video-${suffix}`;
}

async function releaseUsage(authorizationId, reason = 'client_failure') {
  try {
    await voidOutbound(authorizationId, reason);
    return { confirmed: true, message: 'Reserved usage was returned.' };
  } catch (error) {
    if (error instanceof Error && error.message === 'usage_already_settled') {
      return { confirmed: false, settled: true, message: 'Usage was already finalized and remains visible in Usage.' };
    }
    return { confirmed: false, pending: true, message: 'Usage release is pending and will retry automatically; it is visible in Usage.' };
  }
}

function attachSourceDrag(wrap, rect, asset, surface) {
  const p = asset.placements[surface.id];
  let drag = null;
  rect.onpointerdown = e => {
    if (state.loupe) return;
    drag = { x: e.clientX, y: e.clientY, crop: { ...p.crop } };
    rect.setPointerCapture(e.pointerId);
    e.stopPropagation();
  };
  rect.onpointermove = e => {
    if (!drag) return;
    if (!drag.captured) { snapshot(asset, `reframed ${surface.label}`); drag.captured = true; }
    const r = wrap.getBoundingClientRect();
    p.crop = clampCrop({
      ...drag.crop,
      x: drag.crop.x + (e.clientX - drag.x) / r.width,
      y: drag.crop.y + (e.clientY - drag.y) / r.height
    });
    rect.style.left = p.crop.x * 100 + '%';
    rect.style.top = p.crop.y * 100 + '%';
  };
  rect.onpointerup = rect.onpointercancel = () => {
    if (!drag) return;
    drag = null;
    log(asset, `reframed ${surface.label}`, state.reviewer);
    touchAsset(asset);
    renderIssuesOnly();
  };
  rect.onlostpointercapture = () => { drag = null; };

  // Corner handles resize the window; the result is snapped straight back to
  // the placement's aspect ratio so an export can never come out distorted.
  const paint = () => Object.assign(rect.style, {
    left: p.crop.x * 100 + '%', top: p.crop.y * 100 + '%',
    width: p.crop.w * 100 + '%', height: p.crop.h * 100 + '%'
  });
  for (const handle of rect.querySelectorAll('.corner')) {
    const corner = [...handle.classList].find(c => c !== 'corner');
    let grab = null;
    handle.onpointerdown = e => {
      if (state.loupe) return;
      grab = { x: e.clientX, y: e.clientY, crop: { ...p.crop } };
      handle.setPointerCapture(e.pointerId);
      e.stopPropagation();
    };
    handle.onpointermove = e => {
      if (!grab) return;
      if (!grab.captured) { snapshot(asset, `resized crop for ${surface.label}`); grab.captured = true; }
      const r = wrap.getBoundingClientRect();
      const dx = (e.clientX - grab.x) / r.width;
      const dy = (e.clientY - grab.y) / r.height;
      const c = { ...grab.crop };
      const fromRight = corner.includes('l');
      const fromBottom = corner.startsWith('t');
      if (fromRight) { c.x = grab.crop.x + dx; c.w = grab.crop.w - dx; }
      else { c.w = grab.crop.w + dx; }
      if (fromBottom) { c.y = grab.crop.y + dy; c.h = grab.crop.h - dy; }
      else { c.h = grab.crop.h + dy; }
      // Anchor the ratio snap to the fixed opposite corner, not the box's
      // center, or the box drifts away from the corner being dragged.
      const anchor = {
        x: fromRight ? grab.crop.x + grab.crop.w : grab.crop.x,
        y: fromBottom ? grab.crop.y + grab.crop.h : grab.crop.y,
        fromRight,
        fromBottom
      };
      p.crop = snapToRatio(clampCrop(c), asset.width || 1, asset.height || 1, surface, anchor);
      paint();
      e.stopPropagation();
    };
    handle.onpointerup = handle.onpointercancel = () => {
      if (!grab) return;
      grab = null;
      log(asset, `resized crop for ${surface.label}`, state.reviewer);
      touchAsset(asset);
      renderIssuesOnly();
    };
    handle.onlostpointercapture = () => { grab = null; };
  }

  wrap.onwheel = e => {
    if (state.loupe) return;
    e.preventDefault();
    captureCropBurst(asset, `reframed ${surface.label}`);
    p.crop = zoomCrop(p.crop, e.deltaY < 0 ? 1.08 : 1 / 1.08);
    Object.assign(rect.style, {
      left: p.crop.x * 100 + '%', top: p.crop.y * 100 + '%',
      width: p.crop.w * 100 + '%', height: p.crop.h * 100 + '%'
    });
    touchAsset(asset);
    renderIssuesOnly();
  };
  wrap.onkeydown = e => {
    const step = e.shiftKey ? 0.06 : 0.018;
    let next = p.crop;
    if (e.key === 'ArrowLeft') next = panCrop(p.crop, -step * p.crop.w, 0);
    else if (e.key === 'ArrowRight') next = panCrop(p.crop, step * p.crop.w, 0);
    else if (e.key === 'ArrowUp') next = panCrop(p.crop, 0, -step * p.crop.h);
    else if (e.key === 'ArrowDown') next = panCrop(p.crop, 0, step * p.crop.h);
    else if (e.key === '+' || e.key === '=') next = zoomCrop(p.crop, 1.12);
    else if (e.key === '-' || e.key === '_') next = zoomCrop(p.crop, 1 / 1.12);
    else if (e.key === '0' || e.key === 'Home') next = asset.width
      ? defaultCrop(asset.width, asset.height, surface)
      : { x: 0, y: 0, w: 1, h: 1 };
    else return;
    e.preventDefault();
    captureCropBurst(asset, `reframed ${surface.label}`);
    p.crop = next; paint(); touchAsset(asset); renderIssuesOnly();
  };
}

function paintTattooOverlay(host, getCanvas, mapping, frameFor) {
  const existing = host.querySelector('.tattoo-map-overlay');
  const mesh = generateTattooMesh(mapping.controlPoints, mapping.meshDensity);
  if (!mesh.length) { existing?.remove(); return; }
  const canvas = getCanvas();
  let overlay = existing;
  if (!overlay) {
    overlay = el('canvas', { className: 'tattoo-map-overlay', 'aria-hidden': 'true' });
    host.append(overlay);
  }
  overlay.width = canvas.width;
  overlay.height = canvas.height;
  const ctx = overlay.getContext('2d');
  const frame = frameFor();
  const density = mapping.meshDensity;
  const lineScale = Math.max(1, Math.min(canvas.width, canvas.height) / 720);
  const at = point => frame.point(point.x, point.y);
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.lineWidth = lineScale;
  ctx.strokeStyle = 'rgba(99, 224, 215, 0.72)';
  const trace = indexes => {
    ctx.beginPath();
    indexes.forEach((index, order) => {
      const [x, y] = at(mesh[index]);
      if (order) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.stroke();
  };
  for (let row = 0; row < density; row++) {
    trace(Array.from({ length: density }, (_, column) => row * density + column));
  }
  for (let column = 0; column < density; column++) {
    trace(Array.from({ length: density }, (_, row) => row * density + column));
  }
  ctx.fillStyle = 'rgba(99, 224, 215, 0.86)';
  for (const point of mesh) {
    const [x, y] = at(point);
    ctx.beginPath(); ctx.arc(x, y, 1.5 * lineScale, 0, Math.PI * 2); ctx.fill();
  }
  mapping.controlPoints.forEach((point, index) => {
    const [x, y] = at(point);
    ctx.beginPath();
    ctx.arc(x, y, (index === mapping.selectedAnchor ? 6 : 4) * lineScale, 0, Math.PI * 2);
    ctx.fillStyle = index === mapping.selectedAnchor ? '#fff4c8' : '#c9a86a';
    ctx.fill();
    ctx.lineWidth = 1.5 * lineScale;
    ctx.strokeStyle = 'rgba(10, 12, 13, 0.9)';
    ctx.stroke();
  });
}

function syncTattooAnchorControls(asset, mapping) {
  for (const control of document.querySelectorAll('[data-tattoo-anchor-control]')) {
    if (control.dataset.assetId !== asset.id) continue;
    const point = mapping.controlPoints[mapping.selectedAnchor];
    if (!point) continue;
    if (control.dataset.tattooAnchorControl === 'select') control.value = String(mapping.selectedAnchor);
    if (control.dataset.tattooAnchorControl === 'x') control.value = (point.x * 100).toFixed(2);
    if (control.dataset.tattooAnchorControl === 'y') control.value = (point.y * 100).toFixed(2);
  }
}

// --- loupe: true 1:1 source pixels, the only way to judge hands and skin ---

/** Stage-side retouch input: while a tool is armed it owns the pointer, replacing drag and loupe. */
function attachEditTool(host, getCanvas, asset, decoded, frameFor) {
  host.classList.add('retouch');
  const edit = ensureEditState(asset);
  const sourcePoint = e => {
    const canvas = getCanvas();
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    return frameFor().unpoint(
      (e.clientX - box.left) * canvas.width / box.width,
      (e.clientY - box.top) * canvas.height / box.height);
  };
  if (state.editTool === 'tattoo') {
    const mapping = tattooMapForAsset(asset);
    let dragging = false;
    const updateSelected = at => {
      const point = mapping.controlPoints[mapping.selectedAnchor];
      if (!point || !at) return;
      point.x = Math.min(1, Math.max(0, at[0]));
      point.y = Math.min(1, Math.max(0, at[1]));
      point.source = 'manual';
      mapping.method = 'manual';
      mapping.updatedAt = new Date().toISOString();
      paintTattooOverlay(host, getCanvas, mapping, frameFor);
      syncTattooAnchorControls(asset, mapping);
    };
    host.onpointerdown = e => {
      const canvas = getCanvas();
      const box = canvas.getBoundingClientRect();
      const px = (e.clientX - box.left) * canvas.width / box.width;
      const py = (e.clientY - box.top) * canvas.height / box.height;
      const frame = frameFor();
      let nearest = -1;
      let distance = 30 * canvas.width / Math.max(1, box.width);
      mapping.controlPoints.forEach((point, index) => {
        const [x, y] = frame.point(point.x, point.y);
        const candidate = Math.hypot(x - px, y - py);
        if (candidate < distance) { nearest = index; distance = candidate; }
      });
      if (nearest < 0) return;
      mapping.selectedAnchor = nearest;
      dragging = true;
      host.setPointerCapture(e.pointerId);
      updateSelected(sourcePoint(e));
      e.preventDefault();
      e.stopPropagation();
    };
    host.onpointermove = e => {
      if (!dragging) return;
      updateSelected(sourcePoint(e));
      e.preventDefault();
    };
    host.onpointerup = host.onpointercancel = () => {
      if (!dragging) return;
      dragging = false;
      touchTattooMap(asset, mapping);
    };
    host.onlostpointercapture = () => { dragging = false; };
    host.onkeydown = e => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      const point = mapping.controlPoints[mapping.selectedAnchor];
      if (!point) return;
      const step = e.shiftKey ? 0.01 : 0.002;
      updateSelected([
        point.x + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0),
        point.y + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0)
      ]);
      touchTattooMap(asset, mapping);
      e.preventDefault();
      e.stopPropagation();
    };
    paintTattooOverlay(host, getCanvas, mapping, frameFor);
    return;
  }
  // The champagne overlay marks the painted mask; the true grade lands on the next repaint.
  const paintOverlay = () => {
    if (state.editTool !== 'brush') return;
    const canvas = getCanvas();
    let overlay = host.querySelector('.retouch-overlay');
    if (!overlay) {
      overlay = el('canvas', { className: 'retouch-overlay' });
      host.append(overlay);
    }
    overlay.width = canvas.width;
    overlay.height = canvas.height;
    const ctx = overlay.getContext('2d');
    ctx.fillStyle = 'rgba(201,168,106,0.32)';
    const frame = frameFor();
    for (const stamp of edit.adjustments.selective.strokes) {
      const [x, y] = frame.point(stamp.x, stamp.y);
      ctx.beginPath();
      ctx.arc(x, y, frame.radius(stamp.r), 0, 2 * Math.PI);
      ctx.fill();
    }
  };
  paintOverlay();
  let stroke = null;
  host.onpointerenter = null;
  host.onpointerdown = e => {
    const at = sourcePoint(e);
    if (!at) return;
    if (state.editTool === 'heal') return healAt(asset, decoded, at[0], at[1]);
    if (state.editTool !== 'brush') return;
    snapshot(asset, 'painted the selective brush');
    stroke = { last: at };
    host.setPointerCapture(e.pointerId);
    brushStamp(asset, at);
    paintOverlay();
  };
  host.onpointermove = e => {
    if (!stroke) return;
    const at = sourcePoint(e);
    if (!at) return;
    if (Math.hypot(at[0] - stroke.last[0], at[1] - stroke.last[1]) < (state.brushSize / 100) * 0.35) return;
    stroke.last = at;
    brushStamp(asset, at);
    paintOverlay();
  };
  host.onpointerup = host.onpointercancel = () => {
    if (!stroke) return;
    stroke = null;
    log(asset, 'painted the selective brush', state.reviewer);
    touchAsset(asset);
    renderReview();
  };
}

function brushStamp(asset, [nx, ny]) {
  if (nx < -0.02 || nx > 1.02 || ny < -0.02 || ny > 1.02) return;
  ensureEditState(asset).adjustments.selective.strokes.push({
    x: Math.min(1, Math.max(0, nx)),
    y: Math.min(1, Math.max(0, ny)),
    r: Math.max(0.002, Math.min(0.15, state.brushSize / 100))
  });
}

function healAt(asset, decoded, nx, ny) {
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;
  const edit = ensureEditState(asset);
  const r = Math.max(0.004, Math.min(0.03, state.healSize / 100));
  const left = Math.min(Math.max(0, (nx - r) * 100), 99.9);
  const top = Math.min(Math.max(0, (ny - r) * 100), 99.9);
  // The inpaint contract bounds the repair before a pixel moves.
  let spec;
  try {
    spec = makeInpaintJobSpec({
      width: decoded.w, height: decoded.h, operation: 'remove', execution: 'local', selectionKind: 'brush',
      selection: { x: left, y: top, width: Math.min(2 * r * 100, 100 - left), height: Math.min(2 * r * 100, 100 - top) },
      maskCoverage: Math.PI * r * r * (decoded.w / decoded.h)
    });
  } catch (error) {
    toast(error.message, true);
    return;
  }
  mutate(asset, `healed a spot (${(spec.maskCoverage * 100).toFixed(2)}% of frame)`, () => {
    edit.adjustments.heals = [...edit.adjustments.heals, { x: nx, y: ny, r }];
  });
  renderReview();
}

function attachLoupe(host, decoded, cropFn) {
  host.onpointerenter = host.onpointermove = e => {
    if (!state.loupe) return removeLoupe();
    const r = host.getBoundingClientRect();
    // A host with no box yields NaN coordinates, and drawImage(NaN) paints a
    // black square instead of throwing.
    if (!r.width || !r.height) return removeLoupe();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return removeLoupe();
    const crop = cropFn();
    drawLoupe(decoded, (crop.x + fx * crop.w) * decoded.w, (crop.y + fy * crop.h) * decoded.h, e.clientX, e.clientY);
  };
  host.onpointerleave = removeLoupe;
}

function removeLoupe() { document.querySelector('.loupe')?.remove(); }

function setLoupeZoom(factor) {
  if (!LOUPE_ZOOMS.includes(factor)) return state.loupeZoom;
  state.loupeZoom = factor;
  try { localStorage.setItem('cros:loupeZoom', String(factor)); } catch { /* storage full or blocked */ }
  removeLoupe();
  return state.loupeZoom;
}

function drawLoupe(decoded, sx, sy, clientX, clientY) {
  const SIZE = 260;
  let node = document.querySelector('.loupe');
  if (!node) {
    node = el('div', { className: 'loupe' },
      el('canvas', { width: SIZE, height: SIZE }),
      el('span', { className: 'mag' }, ''));
    document.body.append(node);
  }
  const zoom = state.loupeZoom;
  const span = SIZE / zoom;
  const ctx = node.querySelector('canvas').getContext('2d');
  ctx.imageSmoothingEnabled = zoom < 2;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(decoded.source, sx - span / 2, sy - span / 2, span, span, 0, 0, SIZE, SIZE);
  ctx.strokeStyle = 'rgba(201,168,106,.5)';
  ctx.beginPath();
  ctx.moveTo(SIZE / 2, SIZE / 2 - 8); ctx.lineTo(SIZE / 2, SIZE / 2 + 8);
  ctx.moveTo(SIZE / 2 - 8, SIZE / 2); ctx.lineTo(SIZE / 2 + 8, SIZE / 2);
  ctx.stroke();
  node.querySelector('.mag').textContent = zoom === 1
    ? '100% · source pixels'
    : `${zoom * 100}% · ${zoom}× source pixels`;
  node.style.left = `${Math.min(window.innerWidth - 150, Math.max(150, clientX + 190))}px`;
  node.style.top = `${Math.min(window.innerHeight - 150, Math.max(150, clientY))}px`;
}

// ---------------------------------------------------------------------------
// compare

async function paintCompare() {
  const host = $('#comparePanes');
  if (!host) return;
  const asset = currentAsset();
  const other = state.assets.find(a => a.id === state.compareWith);
  const surface = SURFACE_BY_ID[state.activeSurface];

  const pane = async (a, label) => {
    const body = el('div', { className: 'body' });
    const p = el('div', { className: 'pane' },
      el('header', {},
        el('span', { className: 'eyebrow' }, label),
        el('span', { className: 'nm' }, a ? a.filename : 'nothing selected')),
      body);
    if (!a) { body.append(el('p', { className: 'note' }, 'Pick an asset to compare.')); return p; }
    const d = await decode(a);
    if (!d) { body.append(el('p', { className: 'note' }, 'Cannot decode.')); return p; }
    if (surface) {
      const pl = ensurePlacement(a, surface.id);
      body.append(renderCrop(d.source, d.w, d.h, pl.crop, previewSurface(surface), pl.fill, null, ensureEditState(a).adjustments));
    } else {
      body.append(el('img', { src: d.url, alt: a.filename }));
    }
    return p;
  };
  host.replaceChildren(await pane(other, 'Reference'), await pane(asset, 'Candidate'));
}

// ---------------------------------------------------------------------------
// rail

function issueList(items, emptyText) {
  if (!items.length) return el('p', { className: 'hint', style: 'margin:0' }, emptyText);
  return el('div', {}, ...items.map(i => el('div', { className: 'issue ' + i.level },
    el('span', { className: 'dot' }),
    el('div', {},
      i.surface ? el('span', { className: 'where' }, i.surface + ' — ') : null,
      el('span', { className: 'msg' }, i.message),
      i.fix ? el('span', { className: 'fix' }, i.fix) : null))));
}

function metricsBlock(asset) {
  const a = asset.auto;
  const wrap = el('div', { className: 'block' });
  const faceMapActions = () => {
    if (asset.kind !== 'image') return null;
    return el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:10px' },
      btn('Open saved face map', 'btn sm', () => showLocalFaceMap(asset)),
      btn('Map face locally', 'btn sm', () => createSinglePhotoFaceMap(asset)),
      btn('Review skin detail', 'btn sm', () => reviewSkinDetail(asset)),
      btn('Manage local reference Packs', 'btn sm', () => showPersonalGeometryManager()));
  };
  if (!a) {
    wrap.append(el('p', { className: 'hint' }, 'Not analysed yet.'),
      btn('Run checks on this asset', 'btn sm', async () => { await runAnalysis(asset); renderReview(); }),
      el('p', { className: 'hint' }, 'General checks do not map a person. Face mapping has its own direct-consent step.'),
      faceMapActions());
    return wrap;
  }
  const cell = (k, v, extra) => el('div', {}, el('div', { className: 'k' }, k), el('div', { className: 'v' }, v, extra || null));
  const sharpLabel = a.sharpness < 40 ? 'soft' : a.sharpness < 150 ? 'adequate' : 'crisp';
  wrap.append(el('div', { className: 'metrics' },
    cell('Resolution', `${a.megapixels} MP`, el('small', {}, ` · ${a.width}×${a.height}`)),
    cell('Sharpness', String(a.sharpness), el('small', {}, ` · ${sharpLabel}`)),
    cell('Blown highlights', `${(a.exposure.blown * 100).toFixed(1)}%`)));

  const sw = el('div', { className: 'swatches' }, ...a.palette.map(c => el('i', { style: `background:${c.hex}`, title: `${c.hex} · ${Math.round(c.pct * 100)}%` })));
  wrap.append(el('div', { style: 'font-size:11px;color:var(--faint);margin-bottom:4px' }, 'Dominant colour'), sw);

  const color = a.color || {};
  const colorDelivery = colorExportDecision(color);
  wrap.append(el('div', { className: 'metrics', style: 'margin-top:12px' },
    cell('Input profile', String(color.profile || 'unknown').replaceAll('-', ' '),
      el('small', {}, color.embedded ? ' · embedded' : ' · fallback')),
    cell('Working space', COLOR_PIPELINE.workingSpace),
    cell('Output transform', COLOR_PIPELINE.deliverySpace,
      el('small', {}, ` · ${COLOR_PIPELINE.renderingIntent}`)),
    cell('Clipping', `${(a.exposure.blown * 100).toFixed(1)}% high · ${(a.exposure.crushed * 100).toFixed(1)}% low`)));
  wrap.append(el('p', { className: 'hint', style: 'margin:8px 0 0' },
    !colorDelivery.allowed
      ? 'Color needs a verified sRGB conversion before export.'
      : color.conversion
        ? 'Color converted to sRGB for digital delivery.'
        : 'Color profile checked for digital delivery.'));

  wrap.append(el('p', { className: 'hint', style: 'margin:12px 0 0' },
    'People mapping is not part of general checks. It requires the depicted adult’s direct consent and uses separate local storage.'),
    faceMapActions());

  const prov = a.provenance;
  if (prov) {
    const bits = [];
    if (prov.c2pa || prov.contentCredentials) bits.push('Content Credentials present');
    if (prov.syntheticDigitalSource) bits.push('Synthetic-origin label present');
    wrap.append(el('p', { className: 'hint', style: 'margin:12px 0 0' },
      bits.length ? bits.join(' · ') : 'No content credentials found.'));
  }
  wrap.append(el('div', { style: 'margin-top:12px' },
    btn('Re-run checks', 'btn sm', async () => { await runAnalysis(asset); renderReview(); })));
  return wrap;
}

function placementCard(asset, surface) {
  const p = ensurePlacement(asset, surface.id);
  const card = el('div', { className: 'placement' + (surface.id === state.activeSurface ? ' active' : '') });
  card.onclick = e => {
    if (e.target.closest('button, input, textarea')) return;
    state.activeSurface = surface.id;
    renderReview();
  };
  card.append(el('div', { className: 'top' },
    el('span', { className: 'nm' }, surface.label),
    el('span', { className: 'chip' }, surface.groupLabel),
    el('span', { className: 'sz' }, `${surface.w}×${surface.h}`)));

  const decide = el('div', { className: 'decide' });
  for (const d of ['approved', 'revise', 'denied']) {
    const b = el('button', { className: p.decision === d ? 'on' : '', dataset: { d } }, d[0].toUpperCase() + d.slice(1));
    b.onclick = () => decidePlacement(asset, surface.id, d);
    decide.append(b);
  }
  card.append(decide);

  const note = el('input', { className: 'pnote', type: 'text', placeholder: 'Note for this placement', value: p.note });
  let noteCaptured = false;
  note.oninput = () => {
    if (!noteCaptured) { snapshot(asset, `changed ${surface.label} note`); noteCaptured = true; }
    p.note = note.value;
    touchAsset(asset);
  };
  note.onchange = () => {
    log(asset, `${surface.label} note → ${note.value.trim() || 'cleared'}`, state.reviewer);
    noteCaptured = false;
  };
  card.append(note);

  if (p.client) {
    card.append(el('div', { className: 'client' },
      `Client: ${p.client.verdict === 'approved' ? 'approved' : 'requested a change'}${p.client.note ? ` — ${p.client.note}` : ''}`));
  }

  const issues = placementIssues(asset, surface.id, state.project);
  for (const i of issues.filter(x => x.level !== 'info')) {
    card.append(el('div', { className: 'issue ' + i.level, style: 'border:0;padding:6px 0 0' },
      el('span', { className: 'dot' }), el('div', {}, el('span', { className: 'msg' }, i.message))));
  }
  return card;
}

function decidePlacement(asset, surfaceId, decision) {
  mutate(asset, `${decision} · ${SURFACE_BY_ID[surfaceId]?.label || surfaceId}`, () => {
    const p = ensurePlacement(asset, surfaceId);
    p.decision = p.decision === decision ? 'pending' : decision;
    syncStatusFromPlacements(asset);
  });
  renderReview();
  renderCounters();
}

function syncStatusFromPlacements(asset) {
  const decisions = Object.values(asset.placements || {}).map(p => p.decision).filter(d => d !== 'pending');
  if (!decisions.length) return;
  if (decisions.includes('approved') && ['unreviewed', 'rejected'].includes(asset.status)) asset.status = 'approved';
  else if (decisions.every(d => d === 'denied') && asset.status === 'approved') asset.status = 'rejected';
}

function qaBlock(asset) {
  const wrap = el('div', { className: 'block' });
  const checks = qaChecksForAsset(asset);
  // An asset restored from an older project file, or recovered from a partial
  // import, can arrive without a qa map. Reading through it unguarded threw and
  // took the whole review screen down rather than showing zero answers.
  const qa = asset.qa || (asset.qa = {});
  const failed = checks.filter(c => qa[c.id] === 'fail').length;
  const answered = checks.filter(c => qa[c.id]).length;

  wrap.append(el('div', { style: 'display:flex;align-items:center;gap:9px;margin:2px 0 6px' },
    el('span', { style: 'font-size:11.5px;color:var(--muted)' }, `${answered} of ${checks.length} answered`),
    failed ? el('span', { className: 'chip rejected' }, `${failed} failed`) : null,
    (() => {
      const b = btn('Pass remaining', 'btn sm', () => {
        mutate(asset, 'passed remaining QA checks', () => {
          for (const c of checks) if (!asset.qa[c.id]) asset.qa[c.id] = 'pass';
        });
        renderReview();
      });
      b.style.marginLeft = 'auto';
      return b;
    })()));

  for (const g of [...new Set(checks.map(c => c.group))]) {
    const box = el('div', { className: 'qa-group' }, el('h5', {}, g));
    for (const c of checks.filter(x => x.group === g)) {
      const tri = el('div', { className: 'tri' });
      for (const v of ['pass', 'fail', 'na']) {
        const label = v === 'na' ? 'N/A' : v === 'pass' ? 'Pass' : 'Fix';
        const description = v === 'na' ? 'Not applicable' : v === 'pass' ? 'Pass this check' : 'Needs work';
        const b = el('button', {
          className: asset.qa[c.id] === v ? 'on' : '', title: description,
          ariaLabel: `${c.label}: ${description}`, dataset: { v }
        }, label);
        b.onclick = () => {
          mutate(asset, `${c.label}: ${asset.qa[c.id] === v ? 'cleared' : v}`, () => {
            if (asset.qa[c.id] === v) delete asset.qa[c.id]; else asset.qa[c.id] = v;
          });
          renderReview();
        };
        tri.append(b);
      }
      box.append(el('div', { className: 'qa-row' },
        el('div', {}, el('div', { className: 'lab' }, c.label), el('div', { className: 'ask' }, c.ask)), tri));
    }
    wrap.append(box);
  }
  return wrap;
}

/** The delivery contract the local and cloud renderers both encode to.
 * Mirrors SPECS in tools/video_ops.py; the delivery check measures against it. */
const VIDEO_DELIVERY_SPECS = Object.freeze({
  vertical: { w: 1080, h: 1920, fps: 30, lufs: -14 },
  portrait: { w: 1080, h: 1350, fps: 30, lufs: -14 },
  square: { w: 1080, h: 1080, fps: 30, lufs: -14 },
  wide: { w: 1920, h: 1080, fps: 30, lufs: -14 }
});

/** A delivered length, stated exactly. plainWait rounds because it describes a
 * wait; this describes the file, so a 1.5-second clip must not read as 2. */
function exactDuration(seconds) {
  const total = Math.round(seconds * 10) / 10;
  if (total < 60) return `${total.toFixed(1)} seconds`;
  const minutes = Math.floor(total / 60);
  const rest = Math.round((total - minutes * 60) * 10) / 10;
  return rest ? `${minutes} min ${rest.toFixed(1)} s` : `${minutes} min`;
}

const VIDEO_PRO_PITCH = 'Included with Pro Studio, or with Single Studio Pro and Video selected.';

/** Pro capability a Standard customer can see and ask about, never a hidden one. */
function proGate(control, entitled, name, explanation) {
  if (entitled) return control;
  // A locked control must not read as this customer's main call to action.
  control.classList.remove('primary');
  control.classList.add('pro-only');
  control.append(el('span', { className: 'pro-tag' }, 'Pro'));
  control.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    dialog(`${name} is a Pro feature`, el('div', {},
      el('p', {}, explanation),
      el('p', { className: 'hint' }, VIDEO_PRO_PITCH),
      el('p', { className: 'hint' }, 'Activate a matching Pro license in Deliver. Everything else in Video Studio stays available on your plan.')),
    [btn('Close', 'btn primary', closeDialog)]);
  }, true);
  return control;
}

function videoBlock(asset) {
  const v = asset.video;
  v.workspaceMode = v.workspaceMode || 'guided';
  const entitled = hasVideoProEntitlement(globalThis.lic);
  const proActive = v.workspaceMode === 'pro' && entitled;
  const wrap = el('div', { className: 'block' });
  // The first paint has no verified license yet, so an entitled customer would
  // otherwise be shown the Pro tags until they clicked something.
  activeLicense().then(license => {
    globalThis.lic = license;
    if (wrap.isConnected && hasVideoProEntitlement(license) !== entitled) renderReview();
  }).catch(() => { /* the locked state is the safe one */ });
  const guidedMode = btn('Guided delivery', `btn sm${proActive ? '' : ' on'}`, () => {
    if (v.workspaceMode === 'guided') return;
    mutate(asset, 'Video workspace → Guided', () => { v.workspaceMode = 'guided'; });
    renderReview();
  });
  guidedMode.setAttribute('aria-pressed', String(!proActive));
  const openPro = async () => {
    const license = await activeLicense();
    globalThis.lic = license;
    if (!hasVideoProEntitlement(license)) {
      return dialog('Video Pro is locked', el('div', {},
        el('p', {}, 'Video Pro requires Pro Studio or Single Studio Pro with Video selected.'),
        el('p', {}, 'Pro adds a three-track timeline, keyframes, real frame and audio analysis, and a deterministic export.'),
        el('p', { className: 'hint' }, 'Already bought it? Activate the key under Deliver in the project sidebar. An unknown, expired, suspended, or different-product license does not unlock the timeline.'),
        el('p', { className: 'hint' }, 'Guided delivery keeps working either way.')),
      [linkBtn('See Video Pro plans', PRICING_URL, 'btn primary'), btn('Close', 'btn', closeDialog)]);
    }
    if (v.workspaceMode !== 'pro') {
      mutate(asset, 'Video workspace → Pro', () => { v.workspaceMode = 'pro'; });
      renderReview();
    }
    try {
      await openVideoProEditor({
        license, asset, assets: state.assets,
        objectUrl: id => store.objectUrl(id), getBlob: id => store.getBlob(id),
        saveAsset: value => store.saveAsset(value),
        renderTimeline: timeline => renderVideoTimeline(asset, timeline),
        requestImport: () => $('#fileInput')?.click()
      });
    } catch (error) {
      if (error?.code !== VIDEO_TOOLS_UNREADY) toast(error.message, true);
    }
  };
  const proMode = btn(entitled ? 'Pro timeline' : 'Pro timeline · locked', `btn sm${proActive ? ' on' : ''}`, openPro);
  proMode.setAttribute('aria-pressed', String(proActive));
  wrap.append(
    el('div', { className: 'seg video-workspace-tabs', role: 'group', ariaLabel: 'Video workspace mode' }, guidedMode, proMode),
    el('p', { className: 'hint video-workspace-explainer' }, proActive
      ? 'Pro adds a local three-track timeline, real frame and audio analysis, keyframes, preview, and deterministic CPU export.'
      : 'Guided keeps delivery direction and a single-clip local render. Pro is a separate licensed editing workspace.'),
    el('div', { className: 'editor-group-title' }, 'Guided delivery controls'));
  const bind = (key, label, placeholder = '') => {
    const i = el('input', { type: 'text', value: v[key] || '', placeholder });
    let captured = false;
    const capture = () => { if (!captured) { snapshot(asset, `changed ${label}`); captured = true; } };
    i.oninput = () => { capture(); v[key] = i.value; touchAsset(asset); };
    i.onchange = () => { log(asset, `${label} → ${i.value || 'cleared'}`, state.reviewer); captured = false; };
    return el('label', { className: 'field' }, el('span', {}, label), i);
  };
  wrap.append(
    bind('hook', 'Opening intent', 'Define the message or action for the first two seconds'),
    el('div', { style: 'display:flex;gap:8px' }, bind('trimStart', 'In point', '0:00'), bind('trimEnd', 'Out point', '0:08')),
    bind('cropNote', 'Reframing direction', 'For example: retain both hands in the vertical composition'));

  v.spec = v.spec || 'vertical'; v.speed = Number(v.speed || 1); v.fadeIn = Number(v.fadeIn || 0);
  v.fadeOut = Number(v.fadeOut || 0); v.rotate = Number(v.rotate || 0); v.volumeDb = Number(v.volumeDb || 0);
  v.audioEq = v.audioEq || 'flat';
  const select = (key, label, options) => {
    const input = el('select', {});
    for (const [value, text] of options) input.append(el('option', { value: String(value), selected: String(v[key]) === String(value) }, text));
    input.onchange = () => { mutate(asset, `${label} → ${input.options[input.selectedIndex].text}`, () => { v[key] = isNaN(Number(input.value)) ? input.value : Number(input.value); }); };
    return el('label', { className: 'field' }, el('span', {}, label), input);
  };
  const number = (key, label, min, max, step, format) => {
    const input = el('input', { type: 'number', value: String(v[key] ?? 0), min, max, step, inputMode: 'decimal' });
    input.onchange = () => {
      const value = Math.min(max, Math.max(min, Number(input.value) || 0));
      input.value = String(value);
      mutate(asset, `${label} → ${format ? format(value) : value}`, () => { v[key] = value; });
    };
    return el('label', { className: 'field' }, el('span', {}, label), input);
  };
  wrap.append(el('div', { className: 'video-delivery-grid' },
    select('spec', 'Delivery frame', [['vertical', 'Vertical 9:16'], ['portrait', 'Portrait 4:5'], ['square', 'Square 1:1'], ['wide', 'Landscape 16:9']]),
    select('speed', 'Playback speed', [[0.5, '0.5×'], [0.75, '0.75×'], [1, 'Source speed'], [1.25, '1.25×'], [1.5, '1.5×'], [2, '2×']]),
    select('rotate', 'Orientation', [[0, 'Source orientation'], [90, '90° clockwise'], [180, '180°'], [270, '90° counterclockwise']]),
    select('audioEq', 'Audio profile', [['flat', 'Full range'], ['voice', 'Dialogue focus'], ['music', 'Music focus']])));

  // These reach real filters in the delivery render. Before they had controls
  // the render always ran at 0 dB with no fades, no cleanup and no captions,
  // whatever the delivery notes said.
  wrap.append(el('div', { className: 'editor-group-title' }, 'Sound and timing'),
    el('div', { className: 'video-delivery-grid' },
      number('volumeDb', 'Level (dB)', -24, 12, 0.5, value => `${value > 0 ? '+' : ''}${value} dB`),
      number('fadeIn', 'Fade in (s)', 0, 10, 0.1),
      number('fadeOut', 'Fade out (s)', 0, 10, 0.1)),
    el('p', { className: 'hint' },
      `Every delivery is levelled to −${Math.abs((VIDEO_DELIVERY_SPECS[v.spec] || VIDEO_DELIVERY_SPECS.vertical).lufs)} LUFS under a −1 dBTP ceiling. Leave this at 0 unless you want the clip quieter or louder than that.`));
  const denoiseToggle = el('input', { type: 'checkbox', checked: !!v.denoise });
  denoiseToggle.onchange = () => mutate(asset, `background noise cleanup: ${denoiseToggle.checked}`,
    () => { v.denoise = denoiseToggle.checked; });
  const captionToggle = el('input', { type: 'checkbox', checked: !!v.burnCaptions });
  captionToggle.onchange = () => mutate(asset, `burned captions: ${captionToggle.checked}`,
    () => { v.burnCaptions = captionToggle.checked; });
  const captionNote = el('p', { className: 'hint' }, 'Checking the caption engine on this computer…');
  // What this edit actually delivers. The trim points and the speed already
  // decide it exactly, and the renderer has always known - it was just never
  // said out loud, so someone could set an in point, an out point and 1.5x
  // and have nothing tell them the result was two seconds long. A bad in or
  // out point is reported here too, rather than waiting for the render to
  // refuse it.
  const deliveryLine = el('p', { className: 'hint video-delivery-summary' });
  // These fields deliberately do not re-render the panel on every keystroke,
  // because that would take the caret out of whatever is being typed. So this
  // line keeps itself current instead of waiting to be rebuilt.
  const refreshDeliveryLine = () => {
    try {
      const planned = videoRenderPlan(asset);
      const frame = VIDEO_DELIVERY_SPECS[v.spec] || VIDEO_DELIVERY_SPECS.vertical;
      deliveryLine.textContent = `Delivers ${exactDuration(planned.outputSeconds)} at ${frame.w} × ${frame.h}, ${frame.fps} fps.`;
      deliveryLine.classList.remove('warn');
    } catch (error) {
      deliveryLine.textContent = error.message;
      deliveryLine.classList.add('warn');
    }
  };
  refreshDeliveryLine();
  wrap.addEventListener('input', refreshDeliveryLine);
  wrap.addEventListener('change', refreshDeliveryLine);
  wrap.append(
    el('label', { className: 'toggle' }, denoiseToggle, 'Reduce background noise'),
    el('label', { className: 'toggle' }, captionToggle, 'Burn spoken captions into the video'),
    captionNote, deliveryLine);
  const proLaunch = el('section', { className: 'video-pro-launch' },
    el('div', {}, el('strong', {}, 'Pro timeline'),
      el('p', { className: 'hint' }, 'Edit multiple local clips and tracks. The Pro renderer is CPU-only and does not submit cloud jobs.')),
    proGate(btn(asset.video.proTimeline?.clips?.length ? 'Continue Pro edit' : 'Open Pro editor', 'btn primary sm', openPro),
      entitled, 'The Pro timeline',
      'A local three-track timeline with clip trimming, dissolves, keyframed motion and opacity, scopes, audio waveforms, and a deterministic CPU export.'));
  const motionRow = el('div', { className: 'video-motion-actions' },
    proGate(btn('Smooth motion 2×', 'btn sm', () => runVideoMotionEngine(asset, 'interpolate')), entitled,
      'Smooth motion',
      'Doubles the frame rate on this computer by generating the in-between frames, so slow motion and pans read smoothly.'),
    proGate(btn('Restore detail 2×', 'btn sm', () => runVideoMotionEngine(asset, 'upscale')), entitled,
      'Detail restoration',
      'Rebuilds detail at twice the frame size on this computer, then re-encodes to the delivery contract with the audio kept.'));
  const motionNote = el('p', { className: 'hint' }, 'Checking the motion engines on this computer…');
  wrap.append(proLaunch, el('section', { className: 'video-motion' },
    el('div', { className: 'editor-group-title' }, 'Pro Motion Engine'),
    el('p', { className: 'hint' }, 'Runs on this computer and adds the result to the project as a new take. The source is never replaced.'),
    motionRow, motionNote));

  detectBridge().then(bridge => {
    if (!captionNote.isConnected) return;
    if (!bridge.ok) {
      captionNote.textContent = 'Open MaterialLogix Studio on this computer to render, caption, or check a delivery.';
      motionNote.textContent = 'Available once Studio is open on this computer.';
      return;
    }
    captionNote.textContent = bridge.video?.whisper
      ? 'Captions are transcribed on this computer and burned into the render. Read them before delivery.'
      : 'Automatic captions need the optional Video pack. Add it from the setup panel on this computer, or leave captions off.';
    // Detail restoration always runs: without the optional model the engine
    // falls back to its own scaler, so only smooth motion is actually blocked.
    const notes = [
      !bridge.video?.rife && 'Smooth motion needs the optional Video pack on this computer.',
      !bridge.video?.esrgan_video && 'Detail restoration uses the built-in scaler until the optional model is added.'
    ].filter(Boolean);
    motionNote.textContent = notes.join(' ') || 'Both engines are installed on this computer.';
  }).catch(() => {
    captionNote.textContent = 'The caption engine could not be checked on this computer.';
    motionNote.textContent = 'The motion engines could not be checked on this computer.';
  });

  const stars = el('div', { className: 'stars' });
  for (let i = 1; i <= 5; i++) {
    const b = el('button', { className: i <= v.believability ? 'on' : '' }, '★');
    b.setAttribute('aria-label', `Naturalism rating ${i} of 5`);
    b.onclick = () => { mutate(asset, `naturalism ${i}/5`, () => { v.believability = v.believability === i ? 0 : i; }); renderReview(); };
    stars.append(b);
  }
  wrap.append(el('label', { className: 'field' }, el('span', {}, 'Naturalism rating'), stars));

  const mkToggle = (key, label) => {
    const cb = el('input', { type: 'checkbox', checked: v[key] });
    cb.onchange = () => { mutate(asset, `${label}: ${cb.checked}`, () => { v[key] = cb.checked; }); };
    return el('label', { className: 'toggle' }, cb, label);
  };
  wrap.append(mkToggle('looksSynthetic', 'Flag synthetic-looking motion or performance'), mkToggle('recast', 'Request a new performance or cast selection'));

  // The poster remains the crop reference; automated QA also samples the full
  // timeline so soft, blown, or black sections do not hide between stills.
  if (asset.duration > 0) {
    const scrub = el('input', {
      type: 'range', min: 0, max: asset.duration.toFixed(2), step: 0.05,
      value: v.posterTime ?? 0
    });
    const readout = el('span', { style: 'font:400 11px var(--mono);color:var(--faint)' },
      `${(v.posterTime ?? 0).toFixed(2)}s of ${asset.duration.toFixed(1)}s`);
    scrub.oninput = () => { readout.textContent = `${Number(scrub.value).toFixed(2)}s of ${asset.duration.toFixed(1)}s`; };
    scrub.onchange = async () => {
      mutate(asset, `poster frame → ${Number(scrub.value).toFixed(2)}s`, () => { v.posterTime = Number(scrub.value); });
      state.decoded.delete(asset.id);
      await runAnalysis(asset);
      renderReview();
    };
    wrap.append(el('label', { className: 'field' },
      el('span', {}, 'Crop reference frame'), scrub, readout));
    if (asset.temporal?.samples?.length) {
      wrap.append(el('p', { className: 'hint' },
        `Temporal quality review sampled ${asset.temporal.samples.length} points across ${asset.temporal.duration.toFixed(1)}s. ` +
        `Lowest sharpness ${asset.temporal.sharpnessMin}; brightness swing ${asset.temporal.lumaRange}.`));
    }
  }

  if (asset.duration) {
    // Scripts written to fit beat scripts trimmed after: the same cadence
    // model that renders the voice sizes the copy for this exact cut.
    wrap.append(el('p', { className: 'hint' },
      `Voiceover fit: about ${wordBudgetForSeconds(asset.duration, HOUSE_VOICE_BY_ID['studio-clear'].pace)} words fill these ${asset.duration.toFixed(0)} seconds at the default house pace.`));
  }
  wrap.append(el('div', { className: 'video-actions', style: 'display:flex;gap:6px;flex-wrap:wrap' },
    btn('Review with timecoded notes', 'btn sm', () => playWithComments(asset)),
    btn('Create Personal Geometry reference set', 'btn sm', () => createPersonalGeometryReferencePack(asset)),
    btn('Manage local reference Packs', 'btn sm', () => showPersonalGeometryManager()),
    btn('Check delivery', 'btn sm', () => checkVideoDelivery(asset)),
    btn('Render in the cloud', 'btn sm', () => reviewCloudVideoRender(asset)),
    btn('Render this clip', 'btn primary sm', () => renderEditedVideo(asset))));
  return wrap;
}

function parseVideoTime(value) {
  if (value === '' || value == null) return null;
  if (typeof value === 'number') return value;
  const parts = String(value).trim().split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function videoRenderPlan(asset) {
  const v = asset.video;
  const trimStart = parseVideoTime(v.trimStart);
  const trimEnd = parseVideoTime(v.trimEnd);
  if (v.trimStart && trimStart == null) throw new Error('Enter the in point as seconds or timecode, for example 0:03.5.');
  if (v.trimEnd && trimEnd == null) throw new Error('Enter the out point as seconds or timecode, for example 0:12.');
  if (trimEnd != null && trimEnd <= (trimStart || 0)) throw new Error('The out point must be later than the in point.');
  const frame = VIDEO_DELIVERY_SPECS[v.spec] || VIDEO_DELIVERY_SPECS.vertical;
  const activePlacement = state.activeSurface ? ensurePlacement(asset, state.activeSurface) : null;
  const crop = snapToRatio(
    activePlacement?.crop || defaultCrop(asset.width, asset.height, frame),
    asset.width, asset.height, frame
  );
  const speed = v.speed || 1;
  const sourceEnd = trimEnd ?? asset.duration;
  const outputSeconds = Math.max(0, (sourceEnd - (trimStart || 0)) / speed);
  if (!Number.isFinite(outputSeconds) || outputSeconds <= 0) throw new Error('The selected video range has no renderable duration.');
  return {
    outputSeconds,
    opts: {
      trimStart: trimStart || 0, trimEnd, spec: v.spec || 'vertical', speed,
      fadeIn: v.fadeIn || 0, fadeOut: v.fadeOut || 0, rotate: v.rotate || 0,
      volumeDb: v.volumeDb || 0, denoise: !!v.denoise, audioEq: v.audioEq || 'flat',
      burnCaptions: !!v.burnCaptions, crop, adjustments: ensureEditState(asset).adjustments
    }
  };
}

function cloudActivity(detail) {
  window.dispatchEvent(new CustomEvent('materiallogix:job', { detail: {
    title: 'Cloud video render', kind: 'video', location: 'cloud', ...detail
  } }));
}

function localVideoActivity(detail) {
  window.dispatchEvent(new CustomEvent('materiallogix:job', { detail: {
    title: 'Local video render', kind: 'video', location: 'local', cancellable: true, ...detail
  } }));
}

async function cancelLocalVideoJob(jobId) {
  const active = localVideoJobs.get(jobId);
  if (active) active.cancelRequested = true;
  localVideoActivity({ id: jobId, status: 'processing', progress: active?.progress || 54, detail: 'Stopping safely…' });
  let base = active?.base;
  if (!base) {
    const bridge = await detectBridge();
    base = bridge.ok ? bridge.base : null;
  }
  let confirmed = false;
  if (base) {
    for (let attempt = 0; attempt < 3 && !confirmed; attempt++) {
      try {
        const response = await bridgeFetch(`${base}/video/cancel?job=${encodeURIComponent(jobId)}`, { method: 'POST' });
        const result = await response.json().catch(() => ({}));
        confirmed = response.ok && result.cancelRequested === true;
      } catch { /* the original request still has its bounded engine timeout */ }
      if (!confirmed && attempt < 2) await new Promise(resolve => setTimeout(resolve, 80));
    }
  }
  active?.controller.abort();
  localVideoActivity({ id: jobId, status: confirmed || !active ? 'cancelled' : 'failed', progress: 100,
    detail: confirmed ? 'Stopped' : active ? 'Stop could not be confirmed' : 'Recovered after the previous session' });
  if (active) toast(confirmed ? 'Video render stopped.' : 'The video render could not be stopped.', !confirmed);
}

window.addEventListener('materiallogix:cancel-job', event => {
  const jobId = String(event.detail?.id || '');
  if (jobId) cancelLocalVideoJob(jobId).catch(error => {
    localVideoActivity({ id: jobId, status: 'failed', progress: 100,
      detail: `Stop failed safely · ${error.message}` });
  });
});
window.dispatchEvent(new Event('materiallogix:cancel-ready'));

const OUT_OF_CLOUD_CREDIT = new Set(['insufficient_cloud_balance', 'insufficient_entitlement', 'cloud_402']);

function offerLocalRender(asset, plan) {
  const wait = localFallbackMessage(plan.outputSeconds);
  return dialog('You are out of cloud credit', el('div', {},
    el('p', {}, 'Nothing has been charged and your edit is intact. This video can be rendered on this computer instead.'),
    el('p', { className: 'hint' }, wait.detail)),
  [btn('Add credit', 'btn', () => { closeDialog(); location.href = 'usage.html'; }),
   btn('Render on this computer', 'btn primary', () => { closeDialog(); renderEditedVideo(asset); })]);
}

async function reviewCloudVideoRender(asset) {
  const availability = await cloudVideoAvailability();
  if (!availability.available) {
    // Three different problems used to share one sentence. Each needs a
    // different thing from the reader, so each gets its own.
    const [title, reason, next] = !availability.reachable
      ? ['Cloud render could not be reached',
         'The cloud service did not answer, so nothing was sent and nothing was charged.',
         'Check your connection and try again, or render on this computer instead.']
      : !availability.authenticated
        ? ['Sign in to render in the cloud',
           'Cloud rendering runs under your account, and this browser is not signed in.',
           'Sign in from Account and settings, or render on this computer instead.']
        : ['Cloud render is not on this account',
           'Your account does not have cloud rendering enabled yet.',
           'Rendering on this computer produces the same file from the same edit.'];
    return dialog(title, el('div', {},
      el('p', {}, reason),
      el('p', { className: 'hint' }, next)),
    [btn('Close', 'btn', closeDialog),
     btn('Render on this computer', 'btn primary', () => { closeDialog(); renderEditedVideo(asset); })]);
  }
  let plan;
  try { plan = videoRenderPlan(asset); }
  catch (error) { return toast(error.message, true); }
  const quote = quoteCloudJob({ kind: 'video', durationSeconds: plan.outputSeconds });
  const consent = el('input', { type: 'checkbox' });
  const continueButton = btn('Compile and send package', 'btn primary', async () => {
    if (!consent.checked) return;
    closeDialog();
    const activityId = `cloud-video-${crypto.randomUUID()}`;
    cloudActivity({ id: activityId, status: 'processing', progress: 1, detail: 'Preparing complete package', credits: quote.amountCents / 100 });
    try {
      const source = await store.getBlob(asset.id);
      const manifest = {
        schema: 'materiallogix.cloud-video-job.v1', createdAt: new Date().toISOString(),
        source: { filename: asset.filename, contentType: source.type || 'application/octet-stream',
          size: source.size, durationSeconds: asset.duration },
        outputSeconds: plan.outputSeconds, edit: plan.opts,
        brandOverlay: state.project.brandOverlay || null
      };
      const result = await busy(() => submitCloudVideoPackage({ source, manifest,
        outputSeconds: plan.outputSeconds, expectedAmountCents: quote.amountCents,
        cloudProcessingConsent: true, retentionAccepted: true, operationId: activityId,
        onProgress: update => cloudActivity({ ...update, id: activityId }) }));
      cloudActivity({ id: activityId, status: 'queued', progress: 82, detail: 'Cloud render queued', credits: result.quote.amountCents / 100 });
      let notified = false;
      watchCloudVideoJob(result.jobId, update => {
        cloudActivity({ ...update, id: activityId });
        if (notified || update.status !== 'completed') {
          if (update.status === 'failed') toast('Cloud video render failed. Reserved wallet funds were returned.', true);
          return;
        }
        notified = true;
        dialog('Cloud render ready', el('div', {},
          el('p', {}, 'Your finished video is ready.'),
          el('p', { className: 'hint' }, 'The private cloud copy follows the temporary retention window shown when you submitted the package.')),
        [btn('Later', 'btn', closeDialog), btn('Download video', 'btn primary', () => { downloadCloudVideo(result.jobId); closeDialog(); })]);
      });
      toast('Complete package uploaded. Cloud rendering has started.');
    } catch (error) {
      cloudActivity({ id: activityId, status: 'failed', progress: 100, detail: error.message });
      // The same edit can be rendered on this computer, so running out of
      // credit is a choice to offer rather than a wall to stop at. The wait is
      // stated only when this machine has actually measured one.
      if (OUT_OF_CLOUD_CREDIT.has(error.message)) return offerLocalRender(asset, plan);
      toast('Cloud render was not started: ' + error.message, true);
    }
  });
  continueButton.disabled = true;
  consent.onchange = () => { continueButton.disabled = !consent.checked; };
  dialog('Review cloud render', el('div', {},
    el('p', {}, `Estimated charge: $${(quote.amountCents / 100).toFixed(2)} for ${quote.billedSeconds} seconds; included Video credit is used first.`),
    el('label', { className: 'checkline' }, consent,
      el('span', {}, 'I agree to cloud processing on RunPod Secure Cloud and temporary private storage for this job. Faces in the file may be processed as part of the render. Face and body geometry stay on this device. Input and output are scheduled for deletion within about 72 hours after completion or failure, or sooner if I delete them. We do not train models on your media.'))),
  [btn('Cancel', 'btn', closeDialog), btn('Use local render', 'btn', () => { closeDialog(); renderEditedVideo(asset); }), continueButton]);
}

/** Distinguishes "Studio is closed" from "Studio is open but has no encoder",
 * because the two need different things from the person reading it. */
const VIDEO_TOOLS_UNREADY = 'video-tools-unready';

/**
 * What to show when a video action cannot run on this computer.
 *
 * This used to be a toast reading "Video tools are not ready on this device."
 * It named the problem, offered no route, and then disappeared - including for
 * people who had already paid for Pro. A blocked action needs somewhere to go,
 * so this states what is missing, offers the download, and re-checks and
 * resumes the action that was blocked, rather than making anyone find their
 * way back to it.
 */
function videoToolsUnready(bridge, retry) {
  const studioClosed = !bridge?.ok;
  const body = el('div', {},
    el('p', {}, studioClosed
      ? 'This step encodes video, which happens in MaterialLogix Studio on your computer. Studio is not open here yet.'
      : 'Studio is open, but its video tools are not installed on this computer, so there is nothing here to encode with.'),
    el('p', { className: 'hint' }, studioClosed
      ? 'Open Studio and this picks up where it left off. If it is not installed yet, the Windows download is below.'
      : 'Reinstalling Studio from the download below restores the video tools.'),
    el('p', { className: 'hint' }, 'Editing, review and cloud rendering do not need it. Only local encoding does.'));

  const again = btn('Check again', 'btn', async () => {
    again.disabled = true;
    again.textContent = 'Checking…';
    const fresh = await detectBridge().catch(() => null);
    if (fresh?.ok && fresh.video?.ffmpeg) {
      closeDialog();
      if (retry) retry();
      return;
    }
    again.disabled = false;
    again.textContent = 'Check again';
    toast(fresh?.ok ? 'Studio is open, but its video tools are still missing.' : 'Studio is still not open on this computer.', true);
  });

  return dialog('Video tools are not on this computer', body, [
    linkBtn('Download Studio for Windows · about 82 MB', STUDIO_DOWNLOAD_URL, 'btn primary'),
    retry ? again : null,
    btn('Close', 'btn', closeDialog)]);
}

async function renderEditedVideo(asset) {
  const localRenderStartedAt = Date.now();
  const bridge = await detectBridge();
  if (!bridge.ok || !bridge.video?.ffmpeg) return videoToolsUnready(bridge, () => renderEditedVideo(asset));
  if (asset.video.burnCaptions && !bridge.video?.whisper) {
    return toast('Captions need the optional Video pack; add it or turn captions off.', true);
  }
  let plan;
  try { plan = videoRenderPlan(asset); }
  catch (error) { return toast(error.message, true); }
  const opts = { ...plan.opts, resume: true };
  const authorization = await authorizeOutbound({ product: 'video', artifactKind: 'upload', quantity: 1 });
  if (!authorization.ok) return toast(`Online render authorization failed: ${authorization.reason || 'authorization_required'}.`, true);
  const jobId = await stableLocalVideoJobId(asset, opts);
  const controller = new AbortController();
  localVideoJobs.set(jobId, { controller, base: bridge.base, cancelRequested: false, progress: 18 });
  const stopProgress = watchLocalVideoProgress(bridge.base, jobId, localVideoActivity);
  let loudness = null;
  try {
    await busy(async () => {
      toast('Rendering video with the saved editorial settings…');
      const source = await store.getBlob(asset.id);
      localVideoActivity({ id: jobId, status: 'processing', progress: 18, detail: 'Checking saved render segments, then continuing locally' });
      const response = await bridgeFetch(`${bridge.base}/video/render?opts=${encodeURIComponent(JSON.stringify(opts))}`, {
        method: 'POST',
        headers: { 'Content-Type': source.type || 'video/mp4', 'X-MaterialLogix-Job-Id': jobId },
        body: source,
        signal: controller.signal
      });
      stopProgress();
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `engine ${response.status}`);
      loudness = readDeliveryLoudness(response);
      const reusedSegments = Math.max(0, Number(response.headers.get('X-MaterialLogix-Video-Reused-Segments')) || 0);
      if (reusedSegments) localVideoActivity({ id: jobId, status: 'processing', progress: 82,
        detail: `Recovered ${reusedSegments} completed segment${reusedSegments === 1 ? '' : 's'} · finalizing` });
      const blob = await response.blob();
      await settleOutbound(authorization.authorization.id, await blobEvidenceHash(blob));
      const file = new File([blob], asset.filename.replace(/\.[^.]+$/, '') + '-edited.mp4', { type: 'video/mp4' });
      const rendered = newAsset(state.project.id, file);
      rendered.provenance = `Rendered locally from ${asset.filename} with the saved non-destructive edit settings.`;
      if (loudness?.linear) rendered.provenance += ` Levelled to ${loudness.deliveredLufs} LUFS.`;
      await store.addAsset(rendered, file);
      const url = await store.objectUrl(rendered.id);
      Object.assign(rendered, await probe(file, url));
      log(rendered, `rendered from ${asset.filename}`, state.reviewer);
      await store.saveAsset(rendered);
      state.assets.push(rendered);
    });
    localVideoActivity({ id: jobId, status: 'complete', progress: 100, detail: deliveryDetail(loudness) });
    recordVideoPace((Date.now() - localRenderStartedAt) / 1000, plan.outputSeconds);
    render();
    toast(`Video render completed and added to the project. ${deliveryLoudnessNote(loudness)}`.trim());
  } catch (error) {
    const cancelled = localVideoJobs.get(jobId)?.cancelRequested || error.name === 'AbortError';
    const release = await releaseUsage(authorization.authorization.id, cancelled ? 'user_cancelled' : 'render_failed');
    localVideoActivity({ id: jobId, status: cancelled ? 'cancelled' : 'failed', progress: 100,
      detail: cancelled ? `Stopped locally · ${release.message}` : `${error.message} · ${release.message}` });
    if (!cancelled) toast(`Video render failed: ${error.message}. ${release.message}`, true);
  } finally {
    stopProgress();
    localVideoJobs.delete(jobId);
  }
}

/** The engine's own account of where the delivery level landed. */
function readDeliveryLoudness(response) {
  try {
    const raw = response.headers.get('X-MaterialLogix-Video-Loudness');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/**
 * Say where the level actually landed. A mix whose peaks are already at the
 * ceiling cannot also reach the loudness target, and the customer is told the
 * distance rather than left to measure the file themselves.
 */
function deliveryLoudnessNote(loudness) {
  if (!loudness || !loudness.linear) {
    return loudness?.sourceAudio === false ? 'This clip had no sound, so it carries a silent track.' : '';
  }
  if (loudness.shortfallDb > 0.3) {
    return `Levelled to ${loudness.deliveredLufs} LUFS, ${loudness.shortfallDb} dB under the ${loudness.targetLufs} LUFS target: any louder and the peaks pass ${loudness.truePeakCeilingDb} dBTP.`;
  }
  return `Levelled to ${loudness.deliveredLufs} LUFS.`;
}

/** Activity rows lead with the outcome, then the level. */
function deliveryDetail(loudness) {
  return ['Added to project', deliveryLoudnessNote(loudness)].filter(Boolean).join(' · ');
}

const VIDEO_STAGE_LABELS = Object.freeze({
  preparing: 'Preparing', captions: 'Transcribing speech', rendering: 'Rendering',
  motion: 'Generating in-between frames', detail: 'Restoring detail'
});

/**
 * Poll the engine's own encoder position. A multi-minute render otherwise sits
 * at a single unchanging number until the response arrives.
 */
function watchLocalVideoProgress(base, jobId, report, intervalMs = 1200) {
  let stopped = false;
  let timer = 0;
  const tick = async () => {
    if (stopped) return;
    try {
      const response = await bridgeFetch(`${base}/video/progress?job=${encodeURIComponent(jobId)}`,
        { signal: AbortSignal.timeout(2500) });
      if (response.ok && !stopped) {
        const reading = await response.json();
        const stage = VIDEO_STAGE_LABELS[reading.stage] || 'Rendering';
        const detail = Number.isFinite(reading.percent)
          ? `${stage} · ${Math.round(reading.percent)}% of ${reading.totalSeconds}s${reading.speed ? ` · ${reading.speed}× real time` : ''}`
          : `${stage} on this computer`;
        report({ id: jobId, status: 'processing', detail,
          progress: Number.isFinite(reading.percent) ? 18 + reading.percent * 0.74 : 18 });
      }
    } catch { /* the render's own result still reports the terminal state */ }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  timer = setTimeout(tick, intervalMs);
  return () => { stopped = true; clearTimeout(timer); };
}

/**
 * Frame interpolation and detail restoration on this computer. Both add a new
 * take rather than replacing the source, so the original stays deliverable.
 */
async function runVideoMotionEngine(asset, operation) {
  const bridge = await detectBridge();
  if (!bridge.ok || !bridge.video?.ffmpeg) return videoToolsUnready(bridge, () => runVideoMotionEngine(asset, operation));
  if (operation === 'interpolate' && !bridge.video?.rife) {
    return toast('Smooth motion needs the optional Video pack on this computer.', true);
  }
  if (!(asset.duration > 0)) return toast('Decode this video before running a motion pass.', true);
  const label = operation === 'interpolate' ? 'Smooth motion' : 'Detail restoration';
  const suffix = operation === 'interpolate' ? '-smooth.mp4' : '-detail.mp4';
  const authorization = await authorizeOutbound({ product: 'video', artifactKind: 'upload', quantity: 1 });
  if (!authorization.ok) return toast(`Online authorization failed: ${authorization.reason || 'authorization_required'}.`, true);
  const jobId = await stableLocalVideoJobId(asset, { operation });
  const controller = new AbortController();
  localVideoJobs.set(jobId, { controller, base: bridge.base, cancelRequested: false, progress: 18 });
  const activity = detail => window.dispatchEvent(new CustomEvent('materiallogix:job', { detail: {
    title: `${label} · ${asset.filename}`, kind: 'video', location: 'local', cancellable: true, ...detail } }));
  const stopProgress = watchLocalVideoProgress(bridge.base, jobId, activity);
  try {
    let produced;
    await busy(async () => {
      activity({ id: jobId, status: 'processing', progress: 18, detail: `${label} running on this computer` });
      const source = await store.getBlob(asset.id);
      const response = await bridgeFetch(`${bridge.base}/video/${operation}`, {
        method: 'POST',
        headers: { 'Content-Type': source.type || 'video/mp4', 'X-MaterialLogix-Job-Id': jobId },
        body: source,
        signal: controller.signal
      });
      stopProgress();
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `engine ${response.status}`);
      const engineUsed = response.headers.get('X-MaterialLogix-Upscale-Engine') || '';
      const blob = await response.blob();
      await settleOutbound(authorization.authorization.id, await blobEvidenceHash(blob));
      const file = new File([blob], asset.filename.replace(/\.[^.]+$/, '') + suffix, { type: 'video/mp4' });
      produced = newAsset(state.project.id, file);
      produced.labels = { ...asset.labels };
      produced.video.spec = asset.video?.spec || 'vertical';
      produced.provenance = operation === 'interpolate'
        ? `Frame rate doubled locally from ${asset.filename} by the local motion engine.`
        : `Detail restored locally from ${asset.filename} by ${localUpscaleEngineLabel(engineUsed)}.`;
      await store.addAsset(produced, file);
      const url = await store.objectUrl(produced.id);
      Object.assign(produced, await probe(file, url));
      log(produced, `${label.toLowerCase()} from ${asset.filename}`, state.reviewer);
      await store.saveAsset(produced);
      state.assets.push(produced);
    });
    activity({ id: jobId, status: 'complete', progress: 100, detail: 'Added to project' });
    render();
    toast(`${label} finished and was added to the project.`);
  } catch (error) {
    const cancelled = localVideoJobs.get(jobId)?.cancelRequested || error.name === 'AbortError';
    const release = await releaseUsage(authorization.authorization.id, cancelled ? 'user_cancelled' : 'render_failed');
    activity({ id: jobId, status: cancelled ? 'cancelled' : 'failed', progress: 100,
      detail: cancelled ? `Stopped locally · ${release.message}` : `${error.message} · ${release.message}` });
    if (!cancelled) toast(`${label} failed: ${error.message}. ${release.message}`, true);
  } finally {
    stopProgress();
    localVideoJobs.delete(jobId);
  }
}

/**
 * Measure a finished file against the delivery contract the renderer encodes
 * to, so nobody has to take the render's word for frame, rate, or loudness.
 */
async function checkVideoDelivery(asset) {
  const bridge = await detectBridge();
  if (!bridge.ok || !bridge.video?.ffmpeg) return videoToolsUnready(bridge, () => checkVideoDelivery(asset));
  const spec = VIDEO_DELIVERY_SPECS[asset.video?.spec] || VIDEO_DELIVERY_SPECS.vertical;
  try {
    const source = await store.getBlob(asset.id);
    const measure = async path => {
      const response = await bridgeFetch(`${bridge.base}/video/${path}`, {
        method: 'POST', headers: { 'Content-Type': source.type || 'video/mp4' }, body: source
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `engine ${response.status}`);
      return response.json();
    };
    const [probed, loudness] = await busy(async () => [
      await measure('probe'),
      await measure('loudness').catch(() => null)
    ]);
    const stream = probed.streams?.[0] || {};
    const [numerator, denominator] = String(stream.r_frame_rate || '0/1').split('/').map(Number);
    const fps = denominator ? numerator / denominator : 0;
    const header = new Uint8Array(await source.slice(0, 256 * 1024).arrayBuffer());
    const marker = [0x6d, 0x6f, 0x6f, 0x76];
    let fastStart = false;
    for (let index = 0; index + 3 < header.length && !fastStart; index++) {
      fastStart = marker.every((byte, offset) => header[index + offset] === byte);
    }
    const seconds = Number(stream.duration || asset.duration || 0);
    let planned = null;
    try { planned = videoRenderPlan(asset).outputSeconds; } catch { planned = null; }
    const rows = [
      ['Frame size', `${stream.width || 0}×${stream.height || 0}`, `${spec.w}×${spec.h}`,
        stream.width === spec.w && stream.height === spec.h],
      ['Frame rate', `${fps ? fps.toFixed(3).replace(/\.?0+$/, '') : '—'} fps`, `${spec.fps} fps`,
        Math.abs(fps - spec.fps) < 0.01],
      ['Length', `${seconds.toFixed(2)}s`,
        planned ? `${planned.toFixed(2)}s from your in and out points` : 'longer than zero',
        planned ? Math.abs(seconds - planned) < 0.25 : seconds > 0],
      ['Starts playing while it loads', fastStart ? 'yes' : 'no', 'yes', fastStart]
    ];
    if (loudness) {
      rows.push(['Loudness', `${loudness.lufs.toFixed(2)} LUFS`, `${spec.lufs} LUFS ±1`,
        Math.abs(loudness.lufs - spec.lufs) <= 1]);
      rows.push(['Loudest peak', `${loudness.truePeakDb.toFixed(2)} dBTP`, 'at or below −1.0 dBTP',
        loudness.truePeakDb <= -0.5]);
    } else {
      rows.push(['Sound', 'no audio track', 'one levelled stereo track', false]);
    }
    const failures = rows.filter(row => !row[3]).length;
    const table = el('div', { className: 'delivery-check' });
    for (const [name, measured, target, ok] of rows) {
      table.append(el('div', { className: `delivery-check-row${ok ? '' : ' bad'}` },
        el('span', {}, name), el('b', {}, measured),
        el('span', { className: 'hint' }, `target ${target}`),
        el('strong', {}, ok ? 'meets' : 'differs')));
    }
    dialog(failures ? `${failures} delivery check${failures === 1 ? ' differs' : 's differ'}` : 'Delivery checks pass',
      el('div', {},
        el('p', { className: 'hint' },
          `Measured on this computer against the ${asset.video?.spec || 'vertical'} delivery frame. A rendered delivery meets it. A source file usually will not until you render.`),
        table),
      [btn('Close', 'btn primary', closeDialog)]);
  } catch (error) {
    toast(`Delivery check failed: ${error.message}`, true);
  }
}

function localTimelineMediaExtension(asset) {
  const mime = String(asset?.mime || '').toLowerCase();
  if (mime.includes('webm')) return '.webm';
  if (mime.includes('quicktime')) return '.mov';
  if (mime.includes('matroska')) return '.mkv';
  if (mime.includes('x-m4v')) return '.m4v';
  return '.mp4';
}

async function buildLocalVideoTimelinePackage(asset, value) {
  const knownAssets = new Map(state.assets.filter(item => item.kind === 'video').map(item => [item.id, item]));
  const timeline = sanitizeVideoTimeline(value, knownAssets);
  const durationSeconds = timelineDuration(timeline);
  if (!timeline.clips.length || durationSeconds <= 0) throw new Error('Add at least one measurable video clip to the Pro timeline.');
  const sourceEntries = new Map();
  for (const clip of timeline.clips) {
    if (sourceEntries.has(clip.assetId)) continue;
    const sourceAsset = knownAssets.get(clip.assetId);
    if (!sourceAsset) throw new Error(`The local source for ${clip.name} is no longer in this project.`);
    sourceEntries.set(clip.assetId,
      `media/${String(sourceEntries.size).padStart(2, '0')}${localTimelineMediaExtension(sourceAsset)}`);
  }
  const manifest = {
    schema: VIDEO_TIMELINE_SCHEMA,
    spec: asset.video?.spec || 'vertical',
    revision: timeline.revision,
    durationSeconds,
    clips: timeline.clips.map(clip => ({ ...clip, source: sourceEntries.get(clip.assetId) }))
  };
  const fixedDate = new Date(1980, 0, 1, 0, 0, 0, 0);
  const entries = [{ name: 'manifest.json', data: JSON.stringify(manifest), date: fixedDate }];
  for (const [assetId, name] of sourceEntries) {
    const blob = await store.getBlob(assetId);
    entries.push({ name, data: new Uint8Array(await blob.arrayBuffer()), date: fixedDate });
  }
  const archive = makeZip(entries);
  if (archive.size > 2 * 1024 * 1024 * 1024) {
    throw new Error('This timeline package exceeds the local engine’s 2 GB request limit. Shorten it or render in sections.');
  }
  return { archive, timeline, manifest };
}

async function renderVideoTimeline(asset, value, licenseOverride = null) {
  const license = licenseOverride || await activeLicense();
  globalThis.lic = license;
  if (!hasVideoProEntitlement(license)) throw new Error('Video Pro entitlement is unavailable or could not be verified.');
  const bridge = await detectBridge();
  if (!bridge.ok || !bridge.video?.ffmpeg) {
    videoToolsUnready(bridge, null);
    const blocked = new Error('Video tools are not on this computer.');
    blocked.code = VIDEO_TOOLS_UNREADY;
    throw blocked;
  }
  // Metered the same way renderEditedVideo meters a Regular local render:
  // Pro Mix's own monthly-unit allowance (see LANES/Pro's higher unit cap)
  // covers this, but nothing consumed it until this fix - a Pro timeline
  // render was previously free of the unit cost every other local render
  // pays. See docs/TASK_LIST_2026-09-04.md for the reasoning.
  const authorization = await authorizeOutbound({ product: 'video', artifactKind: 'upload', quantity: 1 });
  if (!authorization.ok) throw new Error(`Render authorization failed: ${authorization.reason || 'authorization_required'}.`);
  const { archive, timeline } = await buildLocalVideoTimelinePackage(asset, value);
  const jobId = await stableLocalVideoJobId(asset, {
    operation: 'pro-timeline', timeline: videoTimelineFingerprint(timeline),
    sourceAssetIds: [...new Set(timeline.clips.map(clip => clip.assetId))]
  });
  const controller = new AbortController();
  localVideoJobs.set(jobId, { controller, base: bridge.base, cancelRequested: false, progress: 18 });
  const stopProgress = watchLocalVideoProgress(bridge.base, jobId, localVideoActivity);
  try {
    let rendered;
    let loudness = null;
    await busy(async () => {
      localVideoActivity({ id: jobId, status: 'processing', progress: 18,
        detail: 'Rendering the saved Pro timeline locally on CPU' });
      const response = await bridgeFetch(`${bridge.base}/video/timeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip', 'X-MaterialLogix-Job-Id': jobId },
        body: archive,
        signal: controller.signal
      });
      stopProgress();
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `engine ${response.status}`);
      loudness = readDeliveryLoudness(response);
      const blob = await response.blob();
      await settleOutbound(authorization.authorization.id, await blobEvidenceHash(blob));
      const file = new File([blob], asset.filename.replace(/\.[^.]+$/, '') + '-pro-edit.mp4', { type: 'video/mp4' });
      downloadBlob(blob, file.name);
      rendered = newAsset(state.project.id, file);
      rendered.provenance = `Rendered locally on CPU from a saved ${timeline.clips.length}-clip Video Pro timeline.`;
      if (loudness?.linear) rendered.provenance += ` Levelled to ${loudness.deliveredLufs} LUFS.`;
      await store.addAsset(rendered, file);
      const url = await store.objectUrl(rendered.id);
      Object.assign(rendered, await probe(file, url));
      log(rendered, `rendered from ${timeline.clips.length}-clip Video Pro timeline`, state.reviewer);
      await store.saveAsset(rendered);
      state.assets.push(rendered);
    });
    localVideoActivity({ id: jobId, status: 'complete', progress: 100,
      detail: deliveryDetail(loudness) });
    render();
    return rendered;
  } catch (error) {
    const cancelled = localVideoJobs.get(jobId)?.cancelRequested || error.name === 'AbortError';
    const release = await releaseUsage(authorization.authorization.id, cancelled ? 'user_cancelled' : 'render_failed');
    localVideoActivity({ id: jobId, status: cancelled ? 'cancelled' : 'failed', progress: 100,
      detail: cancelled ? `Stopped locally; renderer termination requested · ${release.message}` : `${error.message} · ${release.message}` });
    if (cancelled) throw new Error('The local render was stopped safely.');
    throw error;
  } finally {
    stopProgress();
    localVideoJobs.delete(jobId);
  }
}

/**
 * Turn a turntable video into local reference frames and consent-bound
 * landmark observations. The output is not a calibrated 3D scan, contains no
 * source images, and cannot become model-training data.
 */
/**
 * Frame-anchored video comments: every note is pinned to a timestamp, the list
 * seeks the player, and the lot exports into VIDEO_NOTES.md for the editor.
 */
async function playWithComments(asset) {
  const url = await store.objectUrl(asset.id);
  asset.video.comments = asset.video.comments || [];
  const vid = el('video', { src: url, controls: true, autoplay: true, style: 'width:100%' });
  const listBox = el('div', { style: 'margin-top:12px;max-height:60vh;overflow-y:auto' });

  const fmt = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}.${Math.floor((t % 1) * 10)}`;
  const paint = () => {
    listBox.replaceChildren(...[...asset.video.comments].sort((a, b) => a.t - b.t).map(c => {
      const row = el('div', { className: 'fixrow' });
      const seek = el('button', { className: 'btn sm', type: 'button', style: 'font-family:var(--mono);font-size:10.5px' }, fmt(c.t));
      seek.onclick = () => { vid.currentTime = c.t; vid.play(); };
      const x = el('button', { className: 'x', type: 'button', title: 'Remove' }, '\u00d7');
      x.onclick = () => {
        mutate(asset, `removed comment at ${fmt(c.t)}`, () => {
          asset.video.comments = asset.video.comments.filter(y => y !== c);
        });
        paint();
      };
      row.append(seek, el('span', { style: 'flex:1' }, c.text), x);
      return row;
    }));
    if (!asset.video.comments.length) {
      listBox.append(el('p', { className: 'hint', style: 'margin:0' },
        'No notes yet. Pause at the relevant frame and add a timecoded review note.'));
    }
  };

  const input = el('input', { type: 'text', placeholder: 'Add a note at the current frame and press Enter' });
  const add = () => {
    const text = input.value.trim();
    if (!text) return;
    const t = vid.currentTime || 0;
    mutate(asset, `comment at ${fmt(t)}: ${text.slice(0, 60)}`, () => {
      asset.video.comments.push({ t: +t.toFixed(2), text, who: state.reviewer, at: new Date().toISOString() });
    });
    input.value = '';
    paint();
  };
  input.onkeydown = e => { if (e.key === 'Enter') { add(); e.stopPropagation(); } };

  const stopPlayback = () => { vid.pause(); vid.removeAttribute('src'); vid.load(); };
  const commentsDialog = dialog(asset.filename,
    el('div', {}, vid,
      el('div', { style: 'display:flex;gap:6px;margin-top:12px' }, input, btn('Add timecode', 'btn', add)),
      listBox),
    [btn('Close', 'btn', () => { stopPlayback(); renderReview(); closeDialog(); })]);
  commentsDialog.addEventListener('close', stopPlayback, { once: true });
  paint();
}

const PERSONAL_APPEARANCE_LABELS = Object.freeze({
  tattoos: 'Tattoo locations and artwork appearance'
});

function personalGeometryAccountRef() {
  if (!personalGeometrySubjectRef) {
    const saved = localStorage.getItem(PERSONAL_GEOMETRY_ACCOUNT_REF_KEY);
    personalGeometrySubjectRef = /^account-[A-Za-z0-9._:-]{8,127}$/.test(saved || '')
      ? saved
      : `account-${crypto.randomUUID()}`;
    localStorage.setItem(PERSONAL_GEOMETRY_ACCOUNT_REF_KEY, personalGeometrySubjectRef);
  }
  return personalGeometrySubjectRef;
}

/**
 * Direct self-subject release used by both supported geometry operations.
 * Another-person and group sources stop here because this interface cannot
 * collect a direct third-party signature or prove local subject isolation.
 */
function requestPersonalGeometryConsent({
  packId,
  specificPurpose,
  coreCategories,
  algorithms,
  allowedOptionalLayers = [],
  receiptBindings = {},
  directSelfOnly = false
}) {
  return new Promise(resolve => {
    const enabledOptionalLayers = OPTIONAL_APPEARANCE_LAYERS
      .filter(layer => allowedOptionalLayers.includes(layer) && PERSONAL_APPEARANCE_LABELS[layer]);
    const role = el('select', {},
      el('option', { value: 'self' }, 'I am the person shown'),
      directSelfOnly ? null : el('option', { value: 'third_party' }, 'Another adult is shown'));
    const jurisdiction = el('select', {},
      el('option', { value: '' }, 'Select state or district'),
      ...PERSONAL_GEOMETRY_US_JURISDICTIONS.map(item => el('option', { value: item.value }, item.label)));
    const sourceScope = el('select', {},
      el('option', { value: '' }, 'Select who appears'),
      el('option', { value: 'self_only' }, 'Only me'),
      el('option', { value: 'group' }, 'Other people also appear'));
    const check = label => {
      const input = el('input', { type: 'checkbox', checked: false });
      return { input, row: el('label', { className: 'toggle' }, input, label) };
    };
    const adult = check('I confirm that I am the person shown and I am at least 18.');
    const rights = check('I have the right to use this source photo or video for this Pack.');
    const release = check('I read the exact notice above and directly sign this limited release.');
    const appearanceRights = check('I have the right to include the selected tattoo artwork or other protected appearance material.');
    appearanceRights.row.hidden = true;
    const optional = Object.fromEntries(enabledOptionalLayers.map(layer => {
      const control = check(PERSONAL_APPEARANCE_LABELS[layer]);
      return [layer, control];
    }));
    const guidance = el('p', { className: 'hint', ariaLive: 'polite' });
    const error = el('p', { className: 'hint', style: 'color:var(--bad)', ariaLive: 'assertive' });
    const go = btn('Sign release and continue', 'btn primary');
    let settled = false;
    let d;
    const finish = result => {
      if (settled) return;
      settled = true;
      d?.removeEventListener('close', closed);
      if (d?.open) closeDialog();
      resolve(result);
    };
    // HTMLDialogElement dispatches `close` asynchronously. If a person cancels
    // one release and immediately opens another, the earlier close event can
    // arrive after the new dialog is already open. Ignore that stale event;
    // only an actually closed dialog may cancel this request.
    const closed = () => { if (!d?.open) finish(null); };
    const update = () => {
      const thirdParty = role.value === 'third_party';
      const group = sourceScope.value === 'group';
      const tattooSelected = optional.tattoos?.input.checked === true;
      appearanceRights.row.hidden = !tattooSelected;
      if (thirdParty) {
        guidance.textContent = 'This release must come directly from the depicted adult. Another-person mapping is unavailable in this version because this screen cannot collect that person’s signature.';
      } else if (group) {
        guidance.textContent = 'This flow requires a source that shows only you. Studio does not map bystanders, so group sources are unavailable on this screen.';
      } else {
        guidance.textContent = 'Processing and storage stay on this device. Every optional appearance layer is off unless you select it.';
      }
      const tattooPurpose = specificPurpose === PERSONAL_GEOMETRY_PURPOSES.tattooPlacement;
      go.disabled = thirdParty || group || !jurisdiction.value || sourceScope.value !== 'self_only'
        || !adult.input.checked || !rights.input.checked || !release.input.checked
        || (tattooPurpose && !tattooSelected)
        || (tattooSelected && !appearanceRights.input.checked);
    };
    for (const control of [role, jurisdiction, sourceScope, adult.input, rights.input, release.input,
      appearanceRights.input, ...Object.values(optional).map(item => item.input)]) {
      control.onchange = update;
    }
    go.onclick = async () => {
      go.disabled = true;
      error.textContent = '';
      const signedAt = new Date().toISOString();
      const subjectRef = personalGeometryAccountRef();
      try {
        const decision = await evaluatePersonalGeometryConsent({
          consent_granted: true,
          consent_id: `consent-${crypto.randomUUID()}`,
          pack_id: packId,
          subject_ref: subjectRef,
          account_ref: subjectRef,
          notice_version: PERSONAL_GEOMETRY_NOTICE_VERSION,
          notice_sha256: PERSONAL_GEOMETRY_NOTICE_SHA256,
          locale: document.documentElement.lang || 'en-US',
          subject_role: 'self',
          subject_state_or_region: jurisdiction.value,
          adult_confirmed: adult.input.checked,
          specific_purpose: specificPurpose,
          core_categories: coreCategories,
          optional_layers: Object.fromEntries(OPTIONAL_APPEARANCE_LAYERS
            .map(layer => [layer, optional[layer]?.input.checked === true])),
          processing_mode: 'local_only',
          local_retention_policy_id: PERSONAL_GEOMETRY_RETENTION_POLICY_ID,
          local_expires_at: personalGeometryRetentionExpiry(signedAt),
          group_source: false,
          manual_subject_crop_confirmed: false,
          source_rights_confirmed: rights.input.checked,
          appearance_rights_confirmed: appearanceRights.input.checked,
          ...receiptBindings,
          subject_signature: {
            signed_by: 'subject',
            direct_subject_action: true,
            subject_ref: subjectRef,
            signature_event_ref: `signature-${crypto.randomUUID()}`,
            signature_method: 'affirmative_release_button',
            notice_version: PERSONAL_GEOMETRY_NOTICE_VERSION,
            notice_sha256: PERSONAL_GEOMETRY_NOTICE_SHA256,
            signed_at: signedAt,
            channel: 'current_subject_session'
          },
          algorithm_ids_and_digests: algorithms
        });
        if (!decision.allowed) {
          error.textContent = `Consent did not pass: ${decision.blockers.join(', ')}.`;
          update();
          return;
        }
        await savePersonalGeometryConsentReceipt(decision.receipt, { projectId: state.project.id });
        finish(decision.receipt);
      } catch (cause) {
        error.textContent = cause?.message || 'Consent could not be recorded.';
        update();
      }
    };

    const operation = specificPurpose === PERSONAL_GEOMETRY_PURPOSES.singlePhotoFaceMap
      ? 'one local 468-point relative face map from this photo'
      : specificPurpose === PERSONAL_GEOMETRY_PURPOSES.tattooPlacement
        ? 'one local 2D tattoo-placement map for this photo'
        : specificPurpose === PERSONAL_GEOMETRY_PURPOSES.skinDetailReview
          ? 'one local skin-detail continuity review from this photo'
          : 'one local multi-view reference Pack from this video';
    const optionalRows = enabledOptionalLayers.map(layer => optional[layer].row);
    d = dialog('Your direct consent is required', el('div', {},
      el('p', {}, `You are authorizing ${operation}. Refusing or cancelling starts no person analysis.`),
      el('div', { className: 'notice-bar', style: 'white-space:pre-line;max-height:220px;overflow:auto' }, PERSONAL_GEOMETRY_NOTICE_TEXT),
      el('label', { className: 'field' }, el('span', {}, 'Who is shown'), role),
      el('label', { className: 'field' }, el('span', {}, 'Your state or district'), jurisdiction),
      el('label', { className: 'field' }, el('span', {}, 'People in the source'), sourceScope),
      adult.row,
      rights.row,
      release.row,
      optionalRows.length ? el('details', {}, el('summary', {}, 'Optional tattoo mapping · off'),
        el('p', { className: 'hint' }, 'Selecting this permits a separate local tattoo-placement record. The landmark Pack does not copy source pixels.'),
        ...optionalRows,
        appearanceRights.row) : null,
      guidance,
      error),
    [btn('Cancel without analysis', 'btn', () => finish(null)), go]);
    d.addEventListener('close', closed, { once: true });
    update();
  });
}

async function latestLocalFaceMap(asset) {
  const records = await getPersonalGeometryFaceMapsForAsset(asset.id);
  for (const record of records) {
    if (validateLocalFaceMap(record.faceMap, { consentReceipt: record.receipt }).valid) return record;
  }
  return null;
}

function faceMapPreview(faceMap) {
  const canvas = el('canvas', {
    width: 560,
    height: 440,
    role: 'img',
    ariaLabel: 'Front projection of the stored 468-point relative face map',
    style: 'width:100%;height:auto;background:#070708;border:1px solid var(--hair)'
  });
  const points = faceMap.points || [];
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = Math.max(0.001, maxX - minX), spanY = Math.max(0.001, maxY - minY);
  const pad = 30;
  const scale = Math.min((canvas.width - 2 * pad) / spanX, (canvas.height - 2 * pad) / spanY);
  const offsetX = (canvas.width - spanX * scale) / 2;
  const offsetY = (canvas.height - spanY * scale) / 2;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#070708';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(201,168,106,.84)';
  for (const point of points) {
    const x = offsetX + (point.x - minX) * scale;
    const y = offsetY + (point.y - minY) * scale;
    ctx.beginPath();
    ctx.arc(x, y, 1.65, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

function confirmPersonalGeometryWithdrawal(packId, recordLabel = 'local Personal Geometry record') {
  dialog('Withdraw consent and delete', el('div', {},
    el('p', {}, `Withdraw consent and permanently delete this ${recordLabel} from this device?`),
    el('p', { className: 'hint' }, 'Studio verifies that the derived record and its local associations are gone. This cannot be undone.')),
  [btn('Keep it', 'btn', closeDialog),
    btn('Withdraw and delete', 'btn primary', async () => {
      try {
        await withdrawAndDeletePersonalGeometry(packId, { withdrawnAt: new Date().toISOString() });
        closeDialog();
        toast('Consent withdrawn and the local Personal Geometry record was deleted.');
      } catch (cause) {
        toast(cause?.message || 'Consent withdrawal could not be verified.', true);
      }
    })]);
}

async function showPersonalGeometryManager() {
  if (!state.project?.id) return toast('Open a project to manage local reference Packs.', true);
  try {
    const records = await getPersonalGeometryPacksForProject(state.project.id);
    const body = el('div', {});
    if (!records.length) {
      body.append(el('p', {}, 'No active local reference Packs are saved for this project.'));
    } else {
      body.append(
        el('p', { className: 'hint' },
          'These landmark-only records stay in separate storage on this device. You can withdraw consent and permanently delete any Pack here.'),
        ...records.map(record => {
          const pack = record.pack;
          const frames = Array.isArray(pack?.canonical?.referenceViews)
            ? pack.canonical.referenceViews.length : 0;
          const expires = new Date(record.expiresAt).toLocaleDateString();
          const label = pack?.captureMode === 'body' ? 'Full-body reference' : 'Facial reference';
          const remove = btn('Withdraw and delete', 'btn sm', () =>
            confirmPersonalGeometryWithdrawal(pack.packId, `${label.toLowerCase()} Pack`));
          return el('section', { className: 'notice-bar', style: 'margin:10px 0' },
            el('strong', {}, label),
            el('p', { className: 'hint', style: 'margin:6px 0' },
              `${frames} normalized landmark view${frames === 1 ? '' : 's'} · expires ${expires}`),
            remove);
        })
      );
    }
    dialog('Local reference Packs', body, [btn('Close', 'btn', closeDialog)]);
  } catch (cause) {
    toast(cause?.message || 'Local reference Packs could not be read.', true);
  }
}

async function showLocalFaceMap(asset, selectedRecord = null) {
  try {
    const record = selectedRecord || await latestLocalFaceMap(asset);
    if (!record) return toast('No active local face map is saved for this photo.', true);
    const { faceMap, receipt } = record;
    const validation = validateLocalFaceMap(faceMap, { consentReceipt: receipt });
    if (!validation.valid) throw new Error(`Saved face map is blocked: ${validation.findings.join(', ')}.`);
    const expires = new Date(faceMap.authorization.localExpiresAt).toLocaleDateString();
    dialog('Local face map', el('div', {},
      faceMapPreview(faceMap),
      el('p', {}, `${faceMap.points.length} face-relative points · stored on this device · consent expires ${expires}.`),
      el('p', { className: 'hint' }, 'This is a lower-confidence single-photo map. Its depth is model-relative, not a metric measurement. It cannot see the back of the head or prove hidden surface detail, and it is not a calibrated 3D scan or identity verification.'),
      ...faceMap.quality.warnings.map(warning => el('p', { className: 'hint' }, warning.replaceAll('_', ' ')))),
    [btn('Close', 'btn', closeDialog),
      btn('Withdraw consent and delete', 'btn primary', () => confirmPersonalGeometryWithdrawal(faceMap.packId, 'face map'))]);
  } catch (cause) {
    toast(cause?.message || 'The saved local face map is unavailable.', true);
  }
}

async function createSinglePhotoFaceMap(asset) {
  if (asset.kind !== 'image') return toast('Single-photo face mapping requires a still image.', true);
  const packId = `pack-${crypto.randomUUID()}`;
  const consentReceipt = await requestPersonalGeometryConsent({
    packId,
    specificPurpose: PERSONAL_GEOMETRY_PURPOSES.singlePhotoFaceMap,
    coreCategories: ['source_media', 'face_geometry'],
    algorithms: [
      {
        algorithm_id: PERSON_GEOMETRY_OBSERVATION_ALGORITHM_ID,
        sha256: PERSON_GEOMETRY_OBSERVATION_MANIFEST_SHA256
      },
      {
        algorithm_id: LOCAL_FACE_MAP_ALGORITHM_ID,
        sha256: LOCAL_FACE_MAP_ALGORITHM_SHA256
      }
    ]
  });
  if (!consentReceipt) return;
  try {
    const analysis = await busy(() => runAnalysis(asset, {
      quiet: true,
      geometryConsentReceipt: consentReceipt,
      geometryPackId: packId,
      geometryRequiredCategories: ['source_media', 'face_geometry']
    }));
    if (!analysis?.geometry?.mapping) throw new Error('Local face observation was unavailable. Check the local model connection and try again.');
    const faceMap = buildSinglePhotoFaceMap({
      mapId: `face-map-${crypto.randomUUID()}`,
      packId,
      observation: { id: `face-view-${crypto.randomUUID()}`, geometry: analysis.geometry.mapping },
      consentReceipt,
      createdAt: new Date().toISOString()
    });
    await savePersonalGeometryFaceMap(faceMap, {
      projectId: state.project.id,
      assetId: asset.id,
      retentionClass: 'saved'
    });
    await showLocalFaceMap(asset, { faceMap, receipt: consentReceipt });
  } catch (cause) {
    toast(cause?.message || 'The local face map could not be created.', true);
  }
}

async function reviewSkinDetail(asset) {
  if (asset.kind !== 'image') return toast('Skin-detail review requires a still image.', true);
  const packId = `skin-review-${crypto.randomUUID()}`;
  const consentReceipt = await requestPersonalGeometryConsent({
    packId,
    specificPurpose: PERSONAL_GEOMETRY_PURPOSES.skinDetailReview,
    coreCategories: ['source_media', 'skin_detail'],
    algorithms: [{
      algorithm_id: SKIN_DETAIL_CONTINUITY_ALGORITHM_ID,
      sha256: SKIN_DETAIL_CONTINUITY_ALGORITHM_SHA256
    }],
    directSelfOnly: true
  });
  if (!consentReceipt) return;
  try {
    const result = await busy(async () => {
      const decoded = await decode(asset);
      if (!decoded) throw new Error('The photo could not be decoded.');
      const blob = await store.getBlob(asset.id);
      return analyzeAsset(
        decoded.source,
        decoded.w,
        decoded.h,
        blob,
        decoded.colorTransform || null,
        {
          skinDetailAuthorized: true,
          skinDetailConsentReceipt: consentReceipt,
          skinDetailPackId: packId
        }
      );
    });
    const metric = result.skin;
    const message = !metric
      ? 'No stable skin-detail region was measured. Inspect the photo at 100%.'
      : metric.ratio < 0.45
        ? 'Skin detail is much smoother than nearby texture. Inspect the transition at 100%.'
        : 'No strong skin-detail mismatch was measured. A final visual check is still required.';
    dialog('Skin-detail review', el('div', {},
      el('p', {}, message),
      el('p', { className: 'hint' },
        'This one-time local check estimates texture continuity. It does not identify anyone or infer age, gender, race, health, or any other personal trait.')),
    [btn('Close', 'btn primary', closeDialog)]);
  } catch (cause) {
    toast(cause?.message || 'Skin-detail review could not run.', true);
  } finally {
    await completePersonalGeometryPurpose(packId).catch(() => null);
  }
}

async function createPersonalGeometryReferencePack(asset) {
  const modeSel = el('select', {});
  modeSel.append(el('option', { value: 'face' }, 'Facial reference set — requested profile-to-profile sweep'));
  modeSel.append(el('option', { value: 'body' }, 'Full-body reference set — requested full turn'));
  const countSel = el('select', {});
  for (const n of [8, 12, 16]) countSel.append(el('option', { value: String(n) }, `${n} frames`));
  const shootGuide = el('div', { className: 'spin-shoot-guide' });
  // Play the pace out loud so they can film to it on a phone.
  const guideDial = el('div', { className: 'pace-dial' });
  let stopGuide = null;
  const playGuide = btn('Play the pace', 'btn sm', () => {
    if (stopGuide) { stopGuide(); stopGuide = null; playGuide.textContent = 'Play the pace'; return; }
    playGuide.textContent = 'Stop';
    stopGuide = runPaceGuide({
      kind: modeSel.value,
      mount: guideDial,
      onDone: () => { stopGuide = null; playGuide.textContent = 'Play again'; }
    });
  });
  const paintShootGuide = () => {
    const guide = guidanceFor(modeSel.value);
    shootGuide.replaceChildren(
      el('strong', {}, guide.title),
      el('p', {}, guide.target),
      el('ol', {}, ...guide.steps.map(step => el('li', {}, step))),
      el('p', { className: 'hint' }, guide.graded));
  };
  modeSel.onchange = paintShootGuide;
  const cancelSetup = () => {
    if (stopGuide) stopGuide();
    stopGuide = null;
    closeDialog();
  };
  dialog('Create Personal Geometry reference set',
    el('div', {},
      el('p', { className: 'hint' },
        'Creates local multi-view landmark observations for one consented adult, not a calibrated 3D face or body surface. The frames are not used for model training.'),
      shootGuide,
      el('div', { className: 'pace-row' }, guideDial,
        el('div', {}, playGuide,
          el('p', { className: 'hint' }, 'Turn with the ticks. The last few drop in pitch as you finish.'))),
      el('label', { className: 'field' }, el('span', {}, 'Capture type'), modeSel),
      el('label', { className: 'field' }, el('span', {}, 'Frames'), countSel)),
    [btn('Cancel', 'btn', cancelSetup),
     btn('Create reference set', 'btn primary', async () => {
       const count = Number(countSel.value);
       const captureMode = modeSel.value;
       const packId = `pack-${crypto.randomUUID()}`;
       if (stopGuide) stopGuide();
       stopGuide = null;
       const consentReceipt = await requestPersonalGeometryConsent({
         packId,
         specificPurpose: PERSONAL_GEOMETRY_PURPOSES.multiviewGeometryPack,
         coreCategories: captureMode === 'body'
           ? ['source_media', 'hand_geometry', 'pose_geometry', 'body_geometry']
           : ['source_media', 'face_geometry'],
         algorithms: [{
           algorithm_id: PERSON_GEOMETRY_OBSERVATION_ALGORITHM_ID,
           sha256: PERSON_GEOMETRY_OBSERVATION_MANIFEST_SHA256
          }],
          allowedOptionalLayers: captureMode === 'body' ? ['tattoos'] : []
        });
       if (!consentReceipt) return;
       const person = captureMode === 'body' ? 'My body reference' : 'My facial reference';
       let extracted = 0;
       const captured = [];
       let previewsReleased = false;
       let previewExpiryTimer = null;
       const releasePreviews = () => {
         if (previewsReleased) return;
         previewsReleased = true;
         if (previewExpiryTimer) clearTimeout(previewExpiryTimer);
         for (const frame of captured) URL.revokeObjectURL(frame.url);
       };
       previewExpiryTimer = setTimeout(() => {
         releasePreviews();
         toast('Temporary reference-frame previews expired. The saved landmark Pack contains no source images.');
       }, PERSONAL_GEOMETRY_TEMPORARY_TTL_MS);
       try {
         await busy(async () => {
           const url = await store.objectUrl(asset.id);
           const probeFrame = await grabVideoFrame(url, 0);
           const duration = probeFrame.duration || asset.duration || 0;
           if (!duration) throw new Error('Could not read the video duration.');
           for (let i = 0; i < count; i++) {
             const t = duration * ((i + 0.5) / count);
             const { canvas } = await grabVideoFrame(url, t);
             const corners = cornerSignature(canvas);
             const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
             if (!blob) throw new Error(`Reference frame ${i + 1} could not be prepared locally.`);
             const [auto, geometry] = await Promise.all([
               analyzeAsset(canvas, canvas.width, canvas.height, blob),
               analyzeGeometry(canvas, canvas.width, canvas.height, {
                 consentReceipt,
                 packId,
                 specificPurpose: PERSONAL_GEOMETRY_PURPOSES.multiviewGeometryPack,
                 requiredCategories: consentReceipt.core_categories
               })
             ]);
             captured.push({
               id: `view-${String(i + 1).padStart(2, '0')}`,
               url: URL.createObjectURL(blob),
               width: canvas.width,
               height: canvas.height,
               captureCorners: corners,
               auto,
               geometry,
               capturedAt: new Date().toISOString()
             });
             extracted += 1;
           }
         });
       } catch (cause) {
         releasePreviews();
         toast(cause?.message || 'The local reference set could not be created.', true);
         return;
       }
       if (!extracted) return;

       // Coverage check: did the turn actually sweep the angles?
       const packAssets = captured;
       const packFrames = captured.map(item => item.geometry);
       if (packFrames.some(Boolean)) {
         const rep = captureMode === 'body'
           ? captureCoverageBody(packFrames)
           : captureCoverage(packFrames);
         rep.flags = [...rep.flags, ...captureFrameQuality(packAssets, captureMode)];
         const yawByFrame = new Map(rep.samples.map(sample => [sample.frame, sample.yaw]));
         let savedPack = null;
         let packBlocker = '';
         try {
           const geometryFrames = captured
             .map((item, index) => item.geometry?.mapping ? {
               id: `view-${String(index + 1).padStart(2, '0')}`,
               geometry: item.geometry.mapping,
               capturedAt: item.capturedAt,
               yawDeg: yawByFrame.get(index) ?? null
             } : null)
             .filter(Boolean);
           const candidatePack = buildPersonalGeometryPack({
             packId,
             captureMode,
             frames: geometryFrames,
             consentReceipt,
             retentionPolicyId: PERSONAL_GEOMETRY_RETENTION_POLICY_ID,
             createdAt: new Date().toISOString()
           });
             await savePersonalGeometryPack(candidatePack, {
               projectId: state.project.id,
               assetId: asset.id,
               retentionClass: 'saved'
             });
           savedPack = candidatePack;
         } catch (cause) {
           packBlocker = cause?.message || 'The landmark observations did not pass Pack validation.';
         }
         const lines = el('div', {},
           el('p', { className: 'hint' }, rep.verdict === 'good'
            ? 'Observed angle coverage is verified for this reference capture.'
            : 'Observed angle coverage is not verified; review the gaps and re-shoot before relying on this set.'),
           el('p', { className: 'hint' }, savedPack
             ? 'The landmark-only Pack was saved in separate local storage without source images or names.'
             : `No Pack was saved: ${packBlocker}`),
           el('p', {}, captureMode === 'body'
             ? `Coverage: ${rep.bodiesFound}/${rep.frames} frames tracked · ${rep.coveredBuckets}/8 angle zones of the full 360° · verdict: ${rep.verdict}.`
             : `Coverage: ${rep.facesFound}/${rep.frames} frames tracked · ${rep.yawSpreadDeg}° of head turn · verdict: ${rep.verdict}.`),
           rep.gaps.length ? el('p', { className: 'hint' }, 'Missing angles: ' + rep.gaps.join(', ')) : null,
           ...rep.flags.map(f => el('p', { className: 'hint', style: 'color:var(--warn)' }, f)),
           ...(() => {
             // Where the turn drifted, not just that it did.
             const trace = paceTrace(captureMode, rep);
             if (!trace.steps.length) return [];
             const bar = el('div', { className: 'pace-trace' });
             bar.innerHTML = paceTraceSvg(trace);
             return [el('p', { className: 'hint', style: 'margin:10px 0 2px' }, 'Turn speed'), bar,
               el('p', { className: 'hint' }, trace.advice)];
           })(),
           rep.verdict !== 'good' ? el('p', { className: 'hint' }, 'Re-shoot with a slower turn to fill the gaps — the pack works better the wider the sweep.') : null,
           el('p', { className: 'hint' }, 'Laptop controls: open the spin preview, then drag directly on the picture, use a two-finger trackpad scroll, or press the left and right arrow keys.'));
         const reportDialog = dialog('Personal Geometry capture report', lines, [
           btn('Close', 'btn', () => { releasePreviews(); closeDialog(); }),
           savedPack ? btn('Withdraw consent and delete Pack', 'btn', () => {
             releasePreviews();
             confirmPersonalGeometryWithdrawal(savedPack.packId, 'landmark-only Pack');
           }) : null,
            btn('Open easy spin preview', 'btn primary', () =>
              openPersonalGeometrySpinPreview(person, packAssets, captureMode, releasePreviews))
         ]);
         reportDialog.addEventListener('close', releasePreviews, { once: true });
       } else {
         const reportDialog = dialog('Reference frames created', el('div', {},
           el('p', {}, `${extracted} frames were extracted successfully.`),
           el('p', { className: 'hint' }, 'Tracking was unavailable, so no Personal Geometry Pack was saved and angle coverage is not verified. You can still inspect every frame with the easy spin preview.')),
         [btn('Close', 'btn', () => { releasePreviews(); closeDialog(); }),
           btn('Open easy spin preview', 'btn primary', () =>
             openPersonalGeometrySpinPreview(person, packAssets, captureMode, releasePreviews))]);
         reportDialog.addEventListener('close', releasePreviews, { once: true });
       }
     })]);
  paintShootGuide();
}

async function openPersonalGeometrySpinPreview(person, referenceFrames, mode = 'body', onRelease = () => {}) {
  const frames = [...referenceFrames].filter(frame => frame?.url);
  if (frames.length < 2) {
    onRelease();
    return toast('This reference set needs at least two readable frames to spin.', true);
  }

  let index = 0;
  let grab = null;
  let wheelTotal = 0;
  let autoplay = null;
  const picture = el('img', { src: frames[0].url, alt: `${person}, view 1 of ${frames.length}`, draggable: false });
  const stage = el('div', {
    className: 'spin-stage', tabIndex: 0, role: 'group',
    ariaLabel: `${person} interactive ${mode === 'face' ? '180 degree' : '360 degree'} reference viewer`
  }, picture,
  el('div', { className: 'spin-drag-cue', ariaHidden: 'true' }, '↔ Drag or swipe to turn'));
  const slider = el('input', { type: 'range', min: 0, max: frames.length - 1, step: 1, value: 0, ariaLabel: 'Spin view frame' });
  const readout = el('output', { className: 'spin-readout', ariaLive: 'polite' });
  const play = btn('Play turn', 'btn sm');

  const paint = next => {
    index = normalizeSpinIndex(next, frames.length);
    picture.src = frames[index].url;
    picture.alt = `${person}, view ${index + 1} of ${frames.length}`;
    slider.value = String(index);
    readout.textContent = `${index + 1} of ${frames.length} · ${spinAngleLabel(index, frames.length, mode)}`;
  };
  const stop = () => {
    if (autoplay) clearInterval(autoplay);
    autoplay = null;
    play.textContent = 'Play turn';
    play.setAttribute('aria-pressed', 'false');
  };
  const step = delta => { stop(); paint(stepSpinIndex(index, delta, frames.length)); stage.focus(); };
  play.onclick = () => {
    if (autoplay) return stop();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return toast('Automatic motion is off because reduced motion is enabled. Use drag, the slider, or arrow keys.');
    play.textContent = 'Pause turn'; play.setAttribute('aria-pressed', 'true');
    autoplay = setInterval(() => paint(index + 1), 180);
  };
  slider.oninput = () => { stop(); paint(Number(slider.value)); };
  stage.onpointerdown = event => {
    stop(); grab = { x: event.clientX, index }; stage.classList.add('dragging');
    stage.setPointerCapture(event.pointerId); stage.focus();
  };
  stage.onpointermove = event => {
    if (!grab) return;
    paint(spinIndexFromDrag(grab.index, event.clientX - grab.x, frames.length, 22));
  };
  stage.onpointerup = stage.onpointercancel = () => { grab = null; stage.classList.remove('dragging'); };
  stage.onlostpointercapture = () => { grab = null; stage.classList.remove('dragging'); };
  stage.onwheel = event => {
    event.preventDefault(); stop();
    wheelTotal += Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const delta = spinStepFromWheel(0, wheelTotal, 24);
    if (delta) { paint(index + delta); wheelTotal = 0; }
  };
  stage.onkeydown = event => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
    else if (event.key === 'Home') { event.preventDefault(); step(-index); }
    else if (event.key === ' ') { event.preventDefault(); play.click(); }
  };

  const controls = el('div', { className: 'spin-controls' },
    btn('← Turn left', 'btn spin-turn', () => step(-1)),
    el('label', { className: 'spin-slider' }, slider, readout),
    btn('Turn right →', 'btn spin-turn', () => step(1)));
  const body = el('div', { className: 'spin-viewer' },
    el('p', { className: 'spin-help' }, 'Drag or swipe the picture to turn it; a trackpad, the slider, and the arrow keys work too.'),
    stage, controls,
    el('div', { className: 'spin-actions' },
      btn('Front / reset', 'btn sm', () => { stop(); paint(0); stage.focus(); }), play));
  const close = () => { stop(); onRelease(); closeDialog(); };
  const spinDialog = dialog(`${person} · easy spin preview`, body, [btn('Close', 'btn primary', close)]);
  spinDialog.addEventListener('close', () => { stop(); onRelease(); }, { once: true });
  paint(0);
  requestAnimationFrame(() => stage.focus());
}

function metaBlock(asset) {
  const wrap = el('div', { className: 'block' });
  const stars = el('div', { className: 'stars', style: 'margin-bottom:10px' });
  for (let i = 1; i <= 5; i++) {
    const b = el('button', { className: i <= (asset.rating || 0) ? 'on' : '', type: 'button', title: `${i} star${i > 1 ? 's' : ''}` }, '★');
    b.onclick = () => {
      mutate(asset, `rated ${asset.rating === i ? 0 : i}/5`, () => {
        asset.rating = asset.rating === i ? 0 : i;
      });
      renderReview();
    };
    stars.append(b);
  }
  wrap.append(el('label', { className: 'field' }, el('span', {}, 'Rating'), stars));

  const statuses = el('div', { className: 'statusrow' });
  for (const s of ASSET_STATUSES) {
    const b = el('button', { className: asset.status === s.id ? 'on' : '', title: s.hint, dataset: { s: s.id } }, s.label);
    b.onclick = () => {
      if (s.id === 'rejected' || s.id === 'needs-new-generation') return rejectionDialog(asset, s);
      mutate(asset, `status → ${s.label}`, () => { asset.status = s.id; });
      renderReview(); renderCounters();
    };
    statuses.append(b);
  }
  wrap.append(el('div', { style: 'margin-bottom:14px' }, statuses));

  const roleSel = el('select', {});
  for (const r of ASSET_ROLES) roleSel.append(el('option', { value: r.id, selected: asset.role === r.id }, r.label));
  const roleRow = el('div', { style: 'display:flex;gap:6px;align-items:flex-end' });
  roleSel.onchange = () => { mutate(asset, `role → ${roleSel.value}`, () => { asset.role = roleSel.value; }); };
  roleRow.append(el('label', { className: 'field', style: 'flex:1;margin-bottom:0' }, el('span', {}, 'Role'), roleSel));
  if (asset.kind === 'image') roleRow.append(btn('Upscale', 'btn sm', () => upscaleAsset(asset)));
  wrap.append(el('div', { style: 'margin-bottom:11px' }, roleRow));
  // The capture report offers the spin preview once; after that dialog closes
  // this is the only way back into it for a frame that belongs to a Pack.
  if (asset.kind === 'image' && asset.personalGeometryPackId) {
    const peers = state.assets.filter(item => item.role === 'reference' && item.personalGeometryPackId === asset.personalGeometryPackId);
    if (peers.length > 1) wrap.append(el('div', { style: 'margin-bottom:11px' },
      btn('Open easy spin preview', 'btn sm', async () => {
        // The preview takes frames with a url, the shape the capture report
        // hands it; stored assets are resolved to the same shape here.
        const frames = await Promise.all([...peers]
          .sort((a, b) => String(a.filename || '').localeCompare(String(b.filename || '')))
          .map(async item => ({ asset: item, url: await store.objectUrl(item.id) })));
        openPersonalGeometrySpinPreview(asset.labels?.lane || 'Reference set', frames, asset.personalGeometryCaptureMode || 'body');
      })));
  }

  // Same capture-once-per-edit shape the video block uses: one snapshot when
  // typing starts, so undo restores what was there before the edit rather than
  // silently dropping it, and one log line when the field is committed. Rights
  // and provenance in particular has no business changing without a record.
  const text = (key, label, placeholder = '', multi = false, obj = asset) => {
    const i = multi ? el('textarea', { value: obj[key] || '', placeholder })
                    : el('input', { type: 'text', value: obj[key] || '', placeholder });
    let captured = false;
    i.oninput = () => {
      if (!captured) { snapshot(asset, `changed ${label}`); captured = true; }
      obj[key] = i.value;
      touchAsset(asset);
    };
    i.onchange = () => { log(asset, `${label} → ${i.value.trim() || 'cleared'}`, state.reviewer); captured = false; };
    return el('label', { className: 'field' }, el('span', {}, label), i);
  };
  wrap.append(
    el('div', { style: 'display:flex;gap:8px' }, text('campaign', 'Campaign', '', false, asset.labels), text('lane', 'Side / lane', '', false, asset.labels)),
    text('audience', 'Audience', '', false, asset.labels),
    text('altText', 'Alt text', 'Describe the image for screen readers', true),
    text('provenance', 'Rights and provenance', 'Model, source, licence, release', true),
    text('notes', 'Reviewer notes', 'Why this passed or failed', true));
  return wrap;
}

function brandOverlayControls() {
  const config = state.project.brandOverlay ||= { assetId: '', position: 'bottom-right', widthPct: 18, marginPct: 4, opacity: 1 };
  const logos = state.assets.filter(a => a.role === 'logo');
  const logo = el('select', {}, el('option', { value: '' }, 'No logo overlay'));
  for (const asset of logos) logo.append(el('option', { value: asset.id, selected: asset.id === config.assetId }, asset.filename));
  const position = el('select', {});
  for (const id of ['top-left','top-right','bottom-left','bottom-right','center']) position.append(el('option', { value:id, selected:id===config.position }, id.replace('-', ' ')));
  const width = el('input', { type:'number', min:5, max:60, value:config.widthPct || 18 });
  const margin = el('input', { type:'number', min:0, max:15, value:config.marginPct ?? 4 });
  const opacity = el('input', { type:'number', min:0.1, max:1, step:0.1, value:config.opacity ?? 1 });
  const save = () => {
    Object.assign(config, {
      assetId:logo.value, position:position.value,
      widthPct:Number(width.value), marginPct:Number(margin.value), opacity:Number(opacity.value)
    });
    touchProject();
  };
  logo.onchange=position.onchange=width.oninput=margin.oninput=opacity.oninput=save;
  return el('div', { className:'brand-overlay-controls' },
    el('p', { className:'hint', style:'margin:12px 0 8px' }, 'Apply supplied artwork as-is to exported photos and video render instructions.'),
    el('label', { className:'field' }, el('span', {}, 'Logo overlay'), logo),
    el('div', { style:'display:grid;grid-template-columns:1fr 68px 68px 68px;gap:6px' },
      el('label', { className:'field' }, el('span', {}, 'Position'), position),
      el('label', { className:'field' }, el('span', {}, 'Width %'), width),
      el('label', { className:'field' }, el('span', {}, 'Margin %'), margin),
      el('label', { className:'field' }, el('span', {}, 'Opacity'), opacity)));
}

function rejectionDialog(asset, targetStatus) {
  const current = asset.rejectionFeedback || { reasons: [], note: '' };
  const reasonInputs = REJECTION_REASONS.map(reason => {
    const input = el('input', { type: 'checkbox', value: reason.id, checked: current.reasons.includes(reason.id) });
    return el('label', { className: 'checkline' }, input, el('span', {}, reason.label));
  });
  const note = el('textarea', { placeholder: 'What should be different next time?', value: current.note || '' });
  const isFinalReject = targetStatus.id === 'rejected';
  const body = el('div', {},
    el('p', { className: 'hint' }, isFinalReject
      ? 'Choose every reason that applies. The file is deleted once you save — there is no in-between state for something that already didn’t pass.'
      : 'Choose every reason that applies. It stays with the project and appears in the rejected-work list you export.'),
    el('div', { className: 'reason-grid' }, ...reasonInputs),
    el('label', { className: 'field', style: 'margin-top:14px' }, el('span', {}, 'Optional note'), note),
    el('p', { className: 'hint' }, 'These reasons stay on this computer. Nothing is sent anywhere.'));
  dialog('Why are you declining this result?', body, [
    btn('Cancel', 'btn', closeDialog),
    btn(isFinalReject ? 'Delete file' : 'Save rejection', 'btn primary', async () => {
      const reasons = reasonInputs.filter(label => label.querySelector('input').checked).map(label => label.querySelector('input').value);
      if (!reasons.length) return toast('Choose at least one reason.', true);
      if (isFinalReject) {
        await removeAsset(asset);
        closeDialog();
        toast('File deleted.');
        return;
      }
      mutate(asset, `status → ${targetStatus.label}`, () => {
        asset.status = targetStatus.id;
        asset.rejectionFeedback = { reasons, note: note.value.trim(), recordedAt: new Date().toISOString() };
      });
      closeDialog(); renderReview(); renderCounters();
      toast('Thanks — this helps the next result.');
    })
  ]);
  $('#dlg').classList.add('feedback-popover');
}

function logBlock(asset) {
  const wrap = el('div', { className: 'block' });
  const entries = [...(asset.log || [])].reverse().slice(0, 24);
  if (!entries.length) return wrap.appendChild(el('p', { className: 'hint', style: 'margin:0' }, 'No actions recorded yet.')), wrap;
  wrap.append(el('ul', { className: 'log' }, ...entries.map(e =>
    el('li', {}, el('time', {}, new Date(e.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })),
      el('span', {}, `${e.what}`)))));
  return wrap;
}

const canvasBlob = (canvas, type = 'image/png') => new Promise((resolve, reject) =>
  canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The browser could not encode the image.')), type));

async function generativeFillDialog(asset) {
  if (asset.kind !== 'image') return toast('Generative Fill currently supports still images only.', true);
  const base = localStorage.getItem('cros:comfyBase') || DEFAULT_BASE;
  const engine = await detectComfy(base);
  if (!engine.ok) {
    return dialog('Generative Fill unavailable', el('div', {},
      el('p', {}, 'Generative Fill is not ready on this device.')),
    [btn('Close', 'btn primary', closeDialog)]);
  }
  let compatibility = null;
  try { compatibility = await inspectInpaintCompatibility(base); } catch { /* unavailable below */ }
  if (compatibility && !compatibility.compatibleNodes) {
    return dialog('Generative Fill unavailable', el('div', {},
      el('p', {}, 'This installation needs an update before it can use Generative Fill.')),
    [btn('Close', 'btn primary', closeDialog)]);
  }
  const checkpoints = compatibility?.inpaintModels || [];
  if (!checkpoints.length) {
    return dialog('Generative Fill unavailable', el('div', {},
      el('p', {}, 'Add the Generative Fill pack in Workspace, then try again.')),
    [btn('Close', 'btn primary', closeDialog)]);
  }

  const decoded = await decode(asset);
  if (!decoded) return toast('The selected image could not be decoded.', true);
  const mode = el('select', {},
    el('option', { value: 'add' }, 'Add inside selection'),
    el('option', { value: 'remove' }, 'Remove from selection'),
    el('option', { value: 'replace' }, 'Replace selection'));
  const model = el('select', {}, ...checkpoints.map((name, index) => el('option', { value: name }, `Fill quality ${index + 1}`)));
  const promptInput = el('textarea', { minLength: PROMPT_MIN_LENGTH, maxLength: PROMPT_MAX_LENGTH, placeholder: 'Describe what to add, remove, or replace…' });
  const negative = el('textarea', { maxLength: PROMPT_MAX_LENGTH, placeholder: 'Optional: details to avoid' });
  const styleIntent = el('select', {},
    el('option', { value: 'natural' }, 'Match believable photography'),
    el('option', { value: 'film' }, 'Add film character'),
    el('option', { value: 'stylized' }, 'Apply a stylized direction'));
  const defaults = { x: 25, y: 25, width: 50, height: 50 };
  const fields = {};
  const preview = el('canvas', { className: 'fill-mask-preview', width: 480, height: 300, tabIndex: 0,
    role: 'img', ariaLabel: 'Selection canvas. Draw around the area to change with a mouse, trackpad, pen, or touch.' });
  const selectionState = { tool: 'outline', outline: [], strokes: [], brushPercent: 8, drawing: false };
  const selectionStatus = el('p', { className: 'hint fill-selection-status', role: 'status' }, 'No area selected.');
  const imageRect = () => {
    const scale = Math.min(preview.width / decoded.w, preview.height / decoded.h);
    const width = decoded.w * scale, height = decoded.h * scale;
    return { x: (preview.width - width) / 2, y: (preview.height - height) / 2, width, height };
  };
  const drawSelection = (ctx, width, height, offsetX = 0, offsetY = 0) => {
    const path = normalizeInpaintPath(selectionState.outline);
    if (path.length >= 2) {
      ctx.beginPath(); ctx.moveTo(offsetX + path[0].x * width, offsetY + path[0].y * height);
      for (const point of path.slice(1)) ctx.lineTo(offsetX + point.x * width, offsetY + point.y * height);
      if (path.length >= 3) { ctx.closePath(); ctx.fill(); }
      ctx.stroke();
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, Math.min(width, height) * selectionState.brushPercent / 100);
    for (const stroke of selectionState.strokes) {
      const points = normalizeInpaintPath(stroke);
      if (!points.length) continue;
      ctx.beginPath(); ctx.moveTo(offsetX + points[0].x * width, offsetY + points[0].y * height);
      if (points.length === 1) ctx.lineTo(offsetX + points[0].x * width + 0.01, offsetY + points[0].y * height);
      else for (const point of points.slice(1)) ctx.lineTo(offsetX + point.x * width, offsetY + point.y * height);
      ctx.stroke();
    }
  };
  const paintPreview = () => {
    const ctx = preview.getContext('2d');
    ctx.clearRect(0, 0, preview.width, preview.height);
    const rect = imageRect();
    ctx.drawImage(decoded.source, rect.x, rect.y, rect.width, rect.height);
    ctx.save(); ctx.fillStyle = 'rgba(255, 184, 77, .30)'; ctx.strokeStyle = 'rgba(255, 184, 77, .68)'; ctx.lineWidth = 2;
    drawSelection(ctx, rect.width, rect.height, rect.x, rect.y); ctx.restore();
    try {
      const summary = summarizeInpaintMask(selectionState);
      preview.dataset.selectionKind = summary.kind; preview.dataset.selectionPoints = String(summary.pointCount);
      selectionStatus.textContent = `${summary.kind === 'lasso' ? 'Outline' : summary.kind === 'brush' ? 'Brush' : 'Mixed'} selection ready.`;
    } catch {
      preview.dataset.selectionKind = 'none'; preview.dataset.selectionPoints = '0'; selectionStatus.textContent = 'No area selected.';
    }
  };
  const pointFromEvent = event => {
    const box = preview.getBoundingClientRect(), image = imageRect();
    const x = (event.clientX - box.left) * preview.width / Math.max(1, box.width);
    const y = (event.clientY - box.top) * preview.height / Math.max(1, box.height);
    if (x < image.x || y < image.y || x > image.x + image.width || y > image.y + image.height) return null;
    return { x: (x - image.x) / image.width, y: (y - image.y) / image.height };
  };
  const appendPoint = point => {
    if (!point) return;
    const list = selectionState.tool === 'outline'
      ? selectionState.outline : selectionState.strokes[selectionState.strokes.length - 1];
    const prior = list[list.length - 1];
    if (!prior || Math.hypot(point.x - prior.x, point.y - prior.y) >= 0.003) list.push(point);
    paintPreview();
  };
  preview.onpointerdown = event => {
    const point = pointFromEvent(event); if (!point) return;
    event.preventDefault(); selectionState.drawing = true; preview.setPointerCapture(event.pointerId);
    if (selectionState.tool === 'outline') selectionState.outline = [];
    else selectionState.strokes.push([]);
    appendPoint(point);
  };
  preview.onpointermove = event => { if (selectionState.drawing) appendPoint(pointFromEvent(event)); };
  preview.onpointerup = preview.onpointercancel = event => {
    if (!selectionState.drawing) return;
    selectionState.drawing = false; preview.releasePointerCapture?.(event.pointerId); paintPreview();
  };
  const buildSelectionMask = (width, height) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; drawSelection(ctx, width, height);
    return canvas;
  };
  const buildEngineMask = selectionMask => {
    const canvas = document.createElement('canvas'); canvas.width = selectionMask.width; canvas.height = selectionMask.height;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(selectionMask, 0, 0); ctx.globalCompositeOperation = 'source-over';
    return canvas;
  };
  const measuredCoverage = selectionMask => {
    const pixels = selectionMask.getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, selectionMask.width, selectionMask.height).data;
    let selected = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) selected += pixels[i] / 255;
    return selected / (selectionMask.width * selectionMask.height);
  };
  const outlineButton = btn('Outline', 'btn sm on', () => {
    selectionState.tool = 'outline'; outlineButton.classList.add('on'); brushButton.classList.remove('on');
  });
  const brushButton = btn('Brush', 'btn sm', () => {
    selectionState.tool = 'brush'; brushButton.classList.add('on'); outlineButton.classList.remove('on');
  });
  const selectionActions = el('div', { className: 'fill-selection-actions' }, outlineButton, brushButton,
    btn('Undo', 'btn sm', () => {
      if (selectionState.tool === 'brush' && selectionState.strokes.length) selectionState.strokes.pop();
      else selectionState.outline = [];
      paintPreview();
    }),
    btn('Clear', 'btn sm', () => { selectionState.outline = []; selectionState.strokes = []; paintPreview(); }));
  const brushSize = el('input', { type: 'range', min: 2, max: 24, step: 1, value: selectionState.brushPercent });
  const brushSizeOut = el('output', {}, `${selectionState.brushPercent}%`);
  brushSize.oninput = () => {
    selectionState.brushPercent = Number(brushSize.value); brushSizeOut.textContent = `${selectionState.brushPercent}%`; paintPreview();
  };
  const dimensions = el('div', { className: 'fill-selection-grid' });
  for (const [key, label] of [['x', 'Left %'], ['y', 'Top %'], ['width', 'Width %'], ['height', 'Height %']]) {
    const input = fields[key] = el('input', { type: 'number', min: key === 'x' || key === 'y' ? 0 : 1, max: 100, step: 1, value: defaults[key] });
    dimensions.append(el('label', { className: 'field' }, el('span', {}, label), input));
  }
  const applyBounds = btn('Use rectangle', 'btn sm', () => {
    const s = normalizeInpaintSelection(Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value])));
    const left = s.x / 100, top = s.y / 100, right = (s.x + s.width) / 100, bottom = (s.y + s.height) / 100;
    selectionState.outline = [{ x:left, y:top }, { x:right, y:top }, { x:right, y:bottom }, { x:left, y:bottom }];
    selectionState.strokes = []; paintPreview();
  });
  const denoise = el('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: 0.8 });
  const denoiseOut = el('output', {}, '0.80');
  denoise.oninput = () => { denoiseOut.textContent = Number(denoise.value).toFixed(2); };
  const status = el('p', { className: 'hint', role: 'status' }, 'The result will be added as a new candidate.');
  const body = el('div', {},
    el('p', { className: 'hint', style: 'color:var(--warn)' }, 'Beta: review edges, anatomy, fabric, skin, and lighting at 100% before approval.'),
    el('p', { className: 'hint' }, 'Draw around the area, then describe the change; your original stays unchanged.'),
    preview,
    el('h4', { className: 'editor-group-title' }, 'Selection'), selectionActions, selectionStatus,
    el('label', { className: 'editor-slider fill-brush-size' }, el('span', {}, 'Brush size'), brushSize, brushSizeOut),
    el('details', { className: 'editor-control-group fill-precise-selection' }, el('summary', {}, 'Precise rectangle'),
      el('div', { className: 'editor-control-body' }, dimensions, applyBounds)),
    el('label', { className: 'field' }, el('span', {}, 'Operation'), mode),
    el('label', { className: 'field' }, el('span', {}, 'Quality'), model),
    el('label', { className: 'field' }, el('span', {}, 'Describe the change'), promptInput),
    el('label', { className: 'field' }, el('span', {}, 'Look'), styleIntent),
    el('p', { className: 'hint' }, 'Believable skin, fabric, anatomy, materials, and environmental light remain the default unless you explicitly choose a stylized result.'),
    el('label', { className: 'field' }, el('span', {}, 'Avoid'), negative),
    el('label', { className: 'editor-slider fill-strength' }, el('span', {}, 'Blend strength'), denoise, denoiseOut), status);
  const run = btn('Create new candidate', 'btn primary', async () => {
    const requested = promptInput.value.trim();
    if (!requested) return toast('Describe the intended result first.', true);
    run.disabled = true;
    let fillBoundaryQuality = null;
    try {
      await busy(async () => {
        const source = document.createElement('canvas'); source.width = decoded.w; source.height = decoded.h;
        source.getContext('2d').drawImage(decoded.source, 0, 0, decoded.w, decoded.h);
        const shape = summarizeInpaintMask(selectionState);
        const selectionMask = buildSelectionMask(decoded.w, decoded.h);
        const coverage = measuredCoverage(selectionMask);
        if (coverage < 0.00001) throw new Error('Draw around the area to change first.');
        const jobSpec = makeInpaintJobSpec({ width: decoded.w, height: decoded.h, selection: shape,
          operation: mode.value, geometry: asset.geometry, execution: 'local', maskCoverage: coverage,
          selectionKind: shape.kind });
        const benchmark = createInpaintBenchmark(jobSpec);
        benchmark.phase('local_3d_mapping');
        const engineMask = buildEngineMask(selectionMask);
        benchmark.phase('mask_preparation');
        const operationPrompt = mode.value === 'remove'
          ? `remove ${requested}; reconstruct the selected area as a coherent continuation of the surrounding scene, matching structure, perspective, repeated patterns, texture, depth, and environmental light; no blur, smudge, or empty patch`
          : requested;
        const avoid = mode.value === 'remove' ? [negative.value.trim(), requested].filter(Boolean).join(', ') : negative.value.trim();
        const contextPixels = Math.max(8, Math.min(32, Math.round(Math.min(decoded.w, decoded.h) * 0.012)));
        const result = await inpaintOne(await canvasBlob(source), `fill-source-${asset.id}.png`,
          await canvasBlob(engineMask), `fill-mask-${asset.id}.png`, {
            ckpt: model.value, prompt: operationPrompt, negative: avoid,
            styleIntent: styleIntent.value,
            denoise: Number(denoise.value), growMaskBy: contextPixels
          }, () => { status.textContent = 'Creating candidate…'; }, base);
        benchmark.phase('inpainting_request');
        const blended = await blendInpaintMaskedCandidate(source, result.blob, selectionMask, 16);
        const boundaryQuality = await assessInpaintMaskedBoundary(source, blended, selectionMask);
        fillBoundaryQuality = boundaryQuality;
        const file = new File([blended], `fill_${mode.value}_${result.seed}.png`, { type: 'image/png' });
        const created = newAsset(state.project.id, file);
        created.source = 'generated-fill-local';
        created.inpaintJob = jobSpec;
        created.inpaintBoundaryQuality = boundaryQuality;
        if (boundaryQuality.status !== 'pass') created.labels = { ...created.labels, boundary_review: 'required' };
        created.provenance = `MaterialLogix Generative Fill Beta (${mode.value}; seed ${result.seed}; ${styleIntent.value} style intent; ${shape.kind} selection; coverage ${coverage.toFixed(6)}; bounds ${JSON.stringify({ x:shape.x, y:shape.y, width:shape.width, height:shape.height })}). Source asset ${asset.id}. Prompt: ${requested.slice(0, 300)}`;
        await store.addAsset(created, file);
        const url = await store.objectUrl(created.id);
        Object.assign(created, await probe(file, url));
        log(created, `Generative Fill ${mode.value}`, state.reviewer);
        await store.saveAsset(created); state.assets.push(created);
        await runAnalysis(created, { quiet: true });
        benchmark.phase('output_processing');
        created.inpaintBenchmark = benchmark.finish();
        await store.saveAsset(created);
        state.assets = await store.listAssets(state.project.id);
        state.index = Math.max(0, visibleAssets().findIndex(item => item.id === created.id));
      });
      closeDialog(); render(); toast(fillBoundaryQuality?.status === 'pass'
        ? 'Generative Fill Beta candidate created — automated boundary continuity passed; complete human review.'
        : 'Generative Fill Beta candidate created and flagged for boundary review.', fillBoundaryQuality?.status !== 'pass');
    } catch (err) { status.textContent = `Failed: ${err.message}`; }
    finally { run.disabled = false; }
  });
  dialog('Generative Fill Beta', body, [btn('Cancel', 'btn', closeDialog), run]);
  requestAnimationFrame(paintPreview);
}

function requestTattooPackLink(asset, records) {
  const accountRef = personalGeometryAccountRef();
  const eligible = records.filter(record => tattooPoseGeometryFromPackRecords([record])
    && record.receipt?.subject_role === 'self'
    && record.receipt?.subject_ref === accountRef
    && record.receipt?.account_ref === accountRef);
  if (!eligible.length) return Promise.resolve(null);
  return new Promise(resolve => {
    const selection = el('select', { ariaLabel: 'Tattoo-authorized local body Pack' },
      ...eligible.map((record, index) => el('option', {
        value: String(index)
      }, `Body Pack ${record.pack.packId.slice(-12)} · ${record.pack.canonical.referenceViews.filter(view => view.body).length} views · expires ${new Date(record.expiresAt).toLocaleDateString()}`)));
    const error = el('p', { className: 'hint', style: 'color:var(--bad)', ariaLive: 'assertive' });
    let settled = false;
    let d;
    const finish = value => {
      if (settled) return;
      settled = true;
      d?.removeEventListener('close', closed);
      if (d?.open) closeDialog();
      resolve(value);
    };
    const closed = () => { if (!d?.open) finish(null); };
    const link = btn('Use Pack and review consent', 'btn primary', () => {
      const selected = eligible[Number(selection.value) || 0];
      finish(selected);
    });
    d = dialog('Choose a local body Pack', el('div', {},
      el('p', {}, 'Choose one active body Pack for the same directly consenting person. Studio requests a new release bound to this exact photo before it creates or stores any placement coordinates.'),
      el('label', { className: 'field' }, el('span', {}, 'Body Pack'), selection),
      error),
    [btn('Cancel without analysis', 'btn', () => finish(null)), link]);
    d.addEventListener('close', closed, { once: true });
  });
}

function editingBlock(asset) {
  const edit = ensureEditState(asset);
  if (!tattooMapDiscoveryComplete.has(asset.id) && !tattooMapLoads.has(asset.id)) {
    hydrateTattooMap(asset)
      .then(() => renderReview())
      .catch(cause => toast(cause?.message || 'The local tattoo-placement map could not be opened.', true));
  }
  const isolatedTattooMap = tattooMapForAsset(asset);
  if (state.editTool === 'tattoo'
      && (!activeTattooMapRecord(asset, isolatedTattooMap)
        || isolatedTattooMap.controlPoints.length !== TATTOO_CONTROL_POINT_COUNT)) {
    state.editTool = null;
  }
  const wrap = el('div', { className: 'block editor-block' });
  const modes = el('div', { className: 'seg editor-mode', role: 'group', ariaLabel: 'Editing mode' });
  for (const [value, label] of [['guided', 'Guided'], ['advanced', 'Advanced']]) {
    const b = el('button', { className: edit.mode === value ? 'on' : '', type: 'button' }, label);
    b.onclick = () => {
      mutate(asset, `editor mode → ${label}`, () => { edit.mode = value; });
      renderReview();
    };
    modes.append(b);
  }
  if (asset.kind === 'image') {
    const fillButton = el('button', { type: 'button', className: 'editor-fill-tab' }, 'Generative Fill · Beta');
    fillButton.dataset.release = GENERATIVE_FILL_RELEASE;
    fillButton.title = 'Pro Beta feature; review every result before use.';
    fillButton.setAttribute('aria-haspopup', 'dialog');
    // Entitlement is resolved asynchronously; the control is present and
    // labelled from the first paint either way.
    markProFeature(fillButton, 'generative-fill');
    activeLicense().then(license => setProEntitlement(fillButton, hasProAccess(license, 'photo')));
    fillButton.onclick = async () => {
      const license = await activeLicense();
      if (!hasProAccess(license, 'photo')) return explainProFeature('generative-fill');
      return generativeFillDialog(asset);
    };
    modes.append(fillButton);
  }
  wrap.append(modes, el('p', { className: 'hint editor-explainer' },
    edit.mode === 'guided'
      ? `The adjustments most ${asset.kind === 'video' ? 'footage needs' : 'photos need'}. Your original file is never changed.`
      : 'Every control, grouped: tone, color, detail, curves, and repair.'));

  const applyPreset = (label, values) => {
    mutate(asset, `applied ${label} edit preset`, () => {
      edit.adjustments = { ...edit.adjustments, ...values };
    });
    renderReview();
  };
  const presets = el('div', { className: 'editor-presets' },
    btn('Refined clarity', 'btn sm', () => applyPreset('Refined clarity', { exposure: 0.08, contrast: 8, vibrance: 10, sharpen: 8, blur: 0 })),
    btn('Warm editorial', 'btn sm', () => applyPreset('Warm editorial', { exposure: 0.04, contrast: 6, temperature: 12, tint: 2, vibrance: 6 })),
    btn('Neutral color match', 'btn sm', () => applyPreset('Neutral color match', { exposure: 0, contrast: 0, temperature: 0, tint: 0, saturation: 0, vibrance: 0 })),
    btn('Reset adjustments', 'btn sm', () => applyPreset('reset', { exposure: 0, contrast: 0, highlights: 0, shadows: 0, temperature: 0, tint: 0, saturation: 0, vibrance: 0, denoise: 0, blur: 0, sharpen: 0, grain: 0, vignette: 0, rotate: 0 }))
  );
  wrap.append(presets);

  // The noise estimate already carries a measured starting amount. Until this
  // it was computed on every analysis and shown to nobody.
  const noiseSuggestion = () => {
    const measured = asset.auto?.cameraNoise;
    if (!measured || !(measured.suggestedReduction > 0)) return null;
    if (Math.abs((edit.adjustments.denoise || 0) - measured.suggestedReduction) < 0.5) {
      return el('p', { className: 'hint' },
        `Noise cleanup is set to the amount measured for this photo (${measured.class} noise).`);
    }
    return el('div', { className: 'editor-tool-row editor-noise-suggestion' },
      btn(`Use the measured amount (${measured.suggestedReduction})`, 'btn sm', () => {
        mutate(asset, `noise cleanup → measured suggestion ${measured.suggestedReduction}`, () => {
          edit.adjustments.denoise = measured.suggestedReduction;
        });
        renderReview();
      }),
      el('span', { className: 'note' }, `${sentence(measured.class)} camera noise in this photo`));
  };

  const boundSlider = (target, key, label, min, max, step = 1) => {
    const value = target[key] ?? 0;
    const readout = el('output', {}, String(value));
    const input = el('input', { type: 'range', min, max, step, value });
    let captured = false;
    const capture = () => { if (!captured) { snapshot(asset, `adjusted ${label}`); captured = true; } };
    input.oninput = () => {
      capture();
      target[key] = Number(input.value);
      readout.textContent = input.value;
      touchAsset(asset);
      schedulePaint();
    };
    input.onchange = () => { log(asset, `${label} → ${input.value}`, state.reviewer); captured = false; };
    return el('label', { className: 'editor-slider' }, el('span', {}, label), input, readout);
  };
  const slider = (key, label, min, max, step = 1) => boundSlider(edit.adjustments, key, label, min, max, step);
  const controlGroup = (title, ...controls) => el('details', { className: 'editor-control-group', name: 'photo-editor-controls' },
    el('summary', {}, title), el('div', { className: 'editor-control-body' }, ...controls));

  const healTools = () => {
    const armed = state.editTool === 'heal';
    const toggle = btn(armed ? 'Spot heal · armed' : 'Spot heal', 'btn sm' + (armed ? ' on' : ''), () => {
      state.editTool = armed ? null : 'heal';
      renderReview();
    });
    toggle.setAttribute('aria-pressed', String(armed));
    const size = el('input', { type: 'range', min: 0.4, max: 3, step: 0.1, value: state.healSize });
    const sizeOut = el('output', {}, String(state.healSize));
    size.oninput = () => { state.healSize = Number(size.value); sizeOut.textContent = size.value; };
    const heals = edit.adjustments.heals || [];
    return el('div', { className: 'editor-tool' },
      el('div', { className: 'editor-tool-row' }, toggle,
        heals.length ? btn(`Clear spots (${heals.length})`, 'btn sm', () => {
          mutate(asset, 'cleared healed spots', () => { edit.adjustments.heals = []; });
          renderReview();
        }) : null),
      el('label', { className: 'editor-slider' }, el('span', {}, 'Spot size'), size, sizeOut),
      el('p', { className: 'hint' }, armed
        ? 'Click a blemish on the photo to blend it away.'
        : 'One click rebuilds a small spot from its surroundings.'));
  };

  const brushTools = () => {
    const armed = state.editTool === 'brush';
    const selective = edit.adjustments.selective;
    const toggle = btn(armed ? 'Paint mask · armed' : 'Paint mask', 'btn sm' + (armed ? ' on' : ''), () => {
      state.editTool = armed ? null : 'brush';
      renderReview();
    });
    toggle.setAttribute('aria-pressed', String(armed));
    const size = el('input', { type: 'range', min: 1, max: 8, step: 0.5, value: state.brushSize });
    const sizeOut = el('output', {}, String(state.brushSize));
    size.oninput = () => { state.brushSize = Number(size.value); sizeOut.textContent = size.value; };
    return el('div', { className: 'editor-tool' },
      el('div', { className: 'editor-tool-row' }, toggle,
        selective.strokes.length ? btn(`Clear mask (${selective.strokes.length})`, 'btn sm', () => {
          mutate(asset, 'cleared the selective mask', () => { selective.strokes = []; });
          renderReview();
        }) : null),
      el('label', { className: 'editor-slider' }, el('span', {}, 'Brush size'), size, sizeOut),
      boundSlider(selective, 'exposure', 'Exposure', -1, 1, 0.05),
      boundSlider(selective, 'temperature', 'Temperature', -100, 100),
      boundSlider(selective, 'saturation', 'Saturation', -100, 100),
      el('p', { className: 'hint' }, armed
        ? 'Paint on the photo; these adjustments apply only inside the mask.'
        : 'Paint a soft mask, then grade only what it covers.'));
  };

  const tattooTools = () => {
    const mapping = tattooMapForAsset(asset);
    const record = activeTattooMapRecord(asset, mapping);
    const authorized = Boolean(record);
    const pointsReady = authorized && mapping.controlPoints.length === TATTOO_CONTROL_POINT_COUNT;

    const region = el('select', { ariaLabel: 'Tattoo body region' },
      ...TATTOO_REGIONS.map(option => el('option', {
        value: option.id, selected: option.id === mapping.region
      }, option.label)));
    region.onchange = () => {
      if (!authorized) {
        mapping.region = region.value;
        return;
      }
      mapping.region = region.value;
      mapping.updatedAt = new Date().toISOString();
      touchTattooMap(asset, mapping);
    };

    const beginExistingMap = (controlPoints, method, label) => {
      if (!activeTattooMapRecord(asset, mapping)) {
        toast('A current direct release for this exact photo is required.', true);
        return;
      }
      snapshot(asset, label);
      mapping.controlPoints = controlPoints;
      mapping.method = method;
      mapping.selectedAnchor = 0;
      mapping.enabled = true;
      mapping.updatedAt = new Date().toISOString();
      state.editTool = 'tattoo';
      log(asset, label, state.reviewer);
      touchAsset(asset);
      touchTattooMap(asset, mapping);
      renderReview();
    };
    const posePreset = btn('Seed from consented local body landmarks', 'btn sm', async () => {
      if (mapping.region === 'custom') return toast('Choose a body region or start a manual map.', true);
      if (authorized) {
        if (!record.sourcePackRecord) {
          return toast('This map has a manual-only release. Withdraw it before starting a new map from a body Pack.', true);
        }
        const geometry = tattooPoseGeometryFromPackRecords([record.sourcePackRecord]);
        const controlPoints = tattooControlLatticeForRegion(geometry, mapping.region);
        if (!controlPoints) return toast('The stored local landmarks cannot seed this region. Use the manual map.', true);
        beginExistingMap(controlPoints, 'local-pose-preset', `seeded tattoo placement to ${mapping.region} from local 2D landmarks`);
        return;
      }
      let available;
      try {
        available = await getPersonalGeometryPacksForProject(state.project.id);
      } catch (cause) {
        return toast(cause?.message || 'Local body Packs could not be listed.', true);
      }
      const selected = await requestTattooPackLink(asset, available);
      if (!selected) {
        if (!available.some(item => tattooPoseGeometryFromPackRecords([item]))) {
          toast('No active self-consented body Pack with tattoo scope is available in this project. Create one or start a manual map.', true);
        }
        return;
      }
      try {
        const created = await createAuthorizedTattooMap(asset, {
          sourcePackRecord: selected,
          buildControlPoints: () => tattooControlLatticeForRegion(
            tattooPoseGeometryFromPackRecords([selected]), mapping.region),
          region: mapping.region,
          method: 'local-pose-preset'
        });
        if (created) {
          state.editTool = 'tattoo';
          renderReview();
        }
      } catch (cause) {
        toast(cause?.message || 'The tattoo-placement map could not be created.', true);
      }
    });
    const manual = btn(authorized ? 'Reset manual map' : 'Start manual map', 'btn sm', async () => {
      if (authorized) {
        beginExistingMap(manualTattooControlLattice(), 'manual', 'reset the manual tattoo placement map');
        return;
      }
      try {
        const created = await createAuthorizedTattooMap(asset, {
          buildControlPoints: () => manualTattooControlLattice(),
          region: mapping.region,
          method: 'manual'
        });
        if (created) {
          state.editTool = 'tattoo';
          renderReview();
        }
      } catch (cause) {
        toast(cause?.message || 'The tattoo-placement map could not be created.', true);
      }
    });

    const enabled = el('input', {
      type: 'checkbox', checked: mapping.enabled,
      disabled: !pointsReady
    });
    enabled.onchange = () => {
      mapping.enabled = enabled.checked;
      if (!enabled.checked && state.editTool === 'tattoo') state.editTool = null;
      mapping.updatedAt = new Date().toISOString();
      touchTattooMap(asset, mapping);
      renderReview();
    };

    const density = el('input', {
      type: 'range', min: TATTOO_MESH_MIN_DENSITY, max: TATTOO_MESH_MAX_DENSITY,
      step: 1, value: mapping.meshDensity, disabled: !pointsReady
    });
    const densityOut = el('output', {}, `${mapping.meshDensity ** 2}`);
    density.oninput = () => {
      mapping.meshDensity = Number(density.value);
      mapping.updatedAt = new Date().toISOString();
      densityOut.textContent = String(mapping.meshDensity ** 2);
      touchTattooMap(asset, mapping);
      schedulePaint();
    };

    const anchor = el('select', {
      disabled: !pointsReady,
      dataset: { tattooAnchorControl: 'select', assetId: asset.id },
      ariaLabel: 'Selected tattoo control anchor'
    }, ...Array.from({ length: TATTOO_CONTROL_POINT_COUNT }, (_, index) => el('option', {
      value: String(index), selected: index === mapping.selectedAnchor
    }, `Anchor ${index + 1} · row ${Math.floor(index / 4) + 1}, column ${(index % 4) + 1}`)));
    anchor.onchange = () => {
      mapping.selectedAnchor = Number(anchor.value);
      touchTattooMap(asset, mapping);
      syncTattooAnchorControls(asset, mapping);
      schedulePaint();
    };

    const coordinate = axis => {
      const point = mapping.controlPoints[mapping.selectedAnchor];
      const input = el('input', {
        type: 'number', min: 0, max: 100, step: 0.1,
        value: point ? (point[axis] * 100).toFixed(2) : '', disabled: !point,
        dataset: { tattooAnchorControl: axis, assetId: asset.id },
        ariaLabel: `Selected tattoo anchor ${axis.toUpperCase()} coordinate in percent`
      });
      input.oninput = () => {
        const selected = mapping.controlPoints[mapping.selectedAnchor];
        if (!selected || !Number.isFinite(Number(input.value))) return;
        selected[axis] = Math.min(1, Math.max(0, Number(input.value) / 100));
        selected.source = 'manual';
        mapping.method = 'manual';
        mapping.updatedAt = new Date().toISOString();
        touchTattooMap(asset, mapping);
        schedulePaint();
      };
      return input;
    };
    const xInput = coordinate('x');
    const yInput = coordinate('y');

    const arm = btn(state.editTool === 'tattoo' ? 'Edit 16 anchors · armed' : 'Edit 16 anchors',
      'btn sm' + (state.editTool === 'tattoo' ? ' on' : ''), () => {
        if (!pointsReady) return toast('Create a directly authorized map first.', true);
        state.editTool = state.editTool === 'tattoo' ? null : 'tattoo';
        mapping.enabled = true;
        touchTattooMap(asset, mapping);
        renderReview();
      });
    arm.disabled = !pointsReady;
    arm.setAttribute('aria-pressed', String(state.editTool === 'tattoo'));
    const clear = btn('Withdraw and delete map', 'btn sm', async () => {
      if (!record) return;
      clear.disabled = true;
      const pendingKey = `tattoo:${asset.id}`;
      clearTimeout(pendingSaves.get(pendingKey)?.timer);
      pendingSaves.delete(pendingKey);
      try {
        const result = await withdrawAndDeletePersonalGeometry(record.packId);
        if (result?.verified !== true || result.readback?.derivedRecords
            || result.readback?.associations || result.readback?.activeReceipts) {
          throw new Error('Tattoo-placement deletion did not pass read-back verification.');
        }
        const reopenedMaps = await getPersonalGeometryTattooMapsForAsset(asset.id);
        if (reopenedMaps.length) {
          throw new Error('The deleted tattoo-placement map still reopened from the isolated store.');
        }
        state.tattooMaps.delete(asset.id);
        tattooMapDiscoveryComplete.add(asset.id);
        clearUndo();
        if (state.editTool === 'tattoo') state.editTool = null;
        await store.saveAsset(asset);
        const reopened = await store.getAsset(asset.id);
        if (reopened?.edit?.tattooMap || reopened?.edit?.tattooMapRef) {
          throw new Error('The ordinary asset record still referenced the deleted tattoo map.');
        }
        renderReview();
        toast('Consent withdrawn and the local tattoo-placement map was deleted.');
      } catch (cause) {
        clear.disabled = false;
        toast(cause?.message || 'The tattoo-placement map could not be deleted.', true);
      }
    });
    clear.disabled = !authorized;

    const artworkReference = el('input', {
      type: 'text', maxLength: 180, value: mapping.artworkReference,
      placeholder: 'Local artwork filename or design ID', disabled: !pointsReady
    });
    artworkReference.oninput = () => {
      mapping.artworkReference = artworkReference.value;
      mapping.updatedAt = new Date().toISOString();
      touchTattooMap(asset, mapping);
    };
    const notes = el('textarea', {
      maxLength: 1000, value: mapping.notes, disabled: !pointsReady,
      placeholder: 'Placement, orientation, scale, edge, or production notes'
    });
    notes.oninput = () => {
      mapping.notes = notes.value;
      mapping.updatedAt = new Date().toISOString();
      touchTattooMap(asset, mapping);
    };

    return el('div', { className: 'editor-tool tattoo-map-controls' },
      el('p', { className: 'tattoo-sterile-notice' },
        'Local 2D placement guide only. Coordinates are non-metric landmark observations—not a scan, calibrated body surface, 3D reconstruction, or digital double. No tattoo artwork is applied, no identity is inferred, and no mapping or media is sent to a server.'),
      el('p', { className: 'hint tattoo-consent' }, authorized
        ? `Direct self release active for this photo until ${new Date(record.expiresAt).toLocaleDateString()}. Coordinates stay in the dedicated local Personal Geometry store.`
        : tattooMapLoads.has(asset.id)
          ? 'Opening the local authorization record…'
          : 'No map is authorized. Starting either map opens the exact notice and requires a direct self release for this photo before coordinates are created.'),
      el('label', { className: 'tattoo-field' }, el('span', {}, 'Body region'), region),
      el('div', { className: 'editor-tool-row' }, posePreset, manual, clear),
      el('label', { className: 'toggle' }, enabled, 'Show placement mesh'),
      el('label', { className: 'editor-slider tattoo-density' },
        el('span', {}, 'Mesh density'), density, densityOut),
      el('p', { className: 'hint tattoo-point-count' }, pointsReady
        ? `${TATTOO_CONTROL_POINT_COUNT} editable anchors · ${mapping.meshDensity ** 2} mapped points · normalized 2D source coordinates · non-metric`
        : 'No authorized coordinates are open.'),
      el('div', { className: 'editor-tool-row' }, arm),
      el('label', { className: 'tattoo-field' }, el('span', {}, 'Selected anchor'), anchor),
      el('div', { className: 'tattoo-coordinate-grid' },
        el('label', {}, el('span', {}, 'X position (%)'), xInput),
        el('label', {}, el('span', {}, 'Y position (%)'), yInput)),
      el('label', { className: 'tattoo-field' }, el('span', {}, 'Artwork reference · text only'), artworkReference),
      el('label', { className: 'tattoo-field' }, el('span', {}, 'Placement notes'), notes),
      el('p', { className: 'hint' },
        'Drag an anchor on the preview, use arrow keys while the preview is focused, or enter exact X/Y percentages. Shift + arrow moves one percent. Ordinary asset records, rendered image pixels, and campaign packages exclude this sensitive map.'));
  };

  const curveTools = () => {
    const W = 240, H = 150, PAD = 10;
    const toSvg = p => [PAD + (p.x / 255) * (W - 2 * PAD), H - PAD - (p.y / 255) * (H - 2 * PAD)];
    const svg = svgEl('svg', {
      viewBox: `0 0 ${W} ${H}`, class: 'curve-editor', role: 'img',
      'aria-label': 'Luminance curve. Drag one of the four points to shape tones.'
    });
    for (const f of [1 / 3, 2 / 3]) {
      svg.append(
        svgEl('line', { class: 'curve-grid', x1: PAD + f * (W - 2 * PAD), y1: PAD, x2: PAD + f * (W - 2 * PAD), y2: H - PAD }),
        svgEl('line', { class: 'curve-grid', x1: PAD, y1: PAD + f * (H - 2 * PAD), x2: W - PAD, y2: PAD + f * (H - 2 * PAD) }));
    }
    const [dx0, dy0] = toSvg({ x: 0, y: 0 });
    const [dx1, dy1] = toSvg({ x: 255, y: 255 });
    svg.append(svgEl('line', { class: 'curve-ref', x1: dx0, y1: dy0, x2: dx1, y2: dy1 }));
    const line = svgEl('polyline', { class: 'curve-line' });
    svg.append(line);
    const dots = edit.adjustments.curve.map(() => svgEl('circle', { class: 'curve-dot', r: 5.5 }));
    svg.append(...dots);
    const redraw = () => {
      const lut = buildLuminanceLut(edit.adjustments.curve);
      const points = [];
      for (let x = 0; x <= 255; x += 5) points.push(toSvg({ x, y: lut ? lut[x] : x }).join(','));
      line.setAttribute('points', points.join(' '));
      edit.adjustments.curve.forEach((p, i) => {
        const [cx, cy] = toSvg(p);
        dots[i].setAttribute('cx', cx);
        dots[i].setAttribute('cy', cy);
      });
    };
    redraw();
    let drag = -1;
    svg.onpointerdown = e => {
      const box = svg.getBoundingClientRect();
      const sx = (e.clientX - box.left) * W / box.width;
      const sy = (e.clientY - box.top) * H / box.height;
      let bestDist = 22;
      edit.adjustments.curve.forEach((p, i) => {
        const [cx, cy] = toSvg(p);
        const dist = Math.hypot(cx - sx, cy - sy);
        if (dist < bestDist) { drag = i; bestDist = dist; }
      });
      if (drag < 0) return;
      snapshot(asset, 'shaped the luminance curve');
      svg.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    svg.onpointermove = e => {
      if (drag < 0) return;
      const box = svg.getBoundingClientRect();
      const x = (((e.clientX - box.left) * W / box.width) - PAD) / (W - 2 * PAD) * 255;
      const y = (H - PAD - ((e.clientY - box.top) * H / box.height)) / (H - 2 * PAD) * 255;
      const curve = edit.adjustments.curve;
      const p = curve[drag];
      p.y = Math.max(0, Math.min(255, y));
      // End points hold the black and white anchors; inner points stay ordered.
      if (drag > 0 && drag < curve.length - 1) {
        p.x = Math.max(curve[drag - 1].x + 6, Math.min(curve[drag + 1].x - 6, x));
      }
      redraw();
      touchAsset(asset);
      schedulePaint();
    };
    svg.onpointerup = svg.onpointercancel = () => {
      if (drag < 0) return;
      drag = -1;
      log(asset, 'shaped the luminance curve', state.reviewer);
      touchAsset(asset);
    };
    return el('div', { className: 'editor-tool' }, svg,
      el('div', { className: 'editor-tool-row' }, btn('Reset curve', 'btn sm', () => {
        mutate(asset, 'reset the luminance curve', () => {
          edit.adjustments.curve = CURVE_IDENTITY.map(p => ({ ...p }));
        });
        renderReview();
      })),
      el('p', { className: 'hint' }, 'One luminance curve, four points, applied with every other adjustment.'));
  };

  if (edit.mode === 'guided') {
    wrap.append(
      slider('rotate', 'Straighten', -15, 15, 0.1),
      slider('exposure', 'Light', -1, 1, 0.05), slider('contrast', 'Contrast', -50, 50),
      slider('temperature', 'Warmth', -50, 50), slider('vibrance', 'Color', -50, 50),
      slider('denoise', 'Noise cleanup', 0, 100));
    const guidedNoiseHint = noiseSuggestion();
    if (guidedNoiseHint) wrap.append(guidedNoiseHint);
    if (asset.kind === 'image') wrap.append(healTools());
  } else {
    wrap.append(
      controlGroup('Geometry',
        slider('rotate', 'Straighten', -15, 15, 0.1)));
    if (asset.kind === 'image') wrap.append(
      controlGroup('Repair', healTools()),
      controlGroup('Selective brush', brushTools()));
    wrap.append(
      controlGroup('Tone',
        slider('exposure', 'Exposure', -2, 2, 0.05), slider('contrast', 'Contrast', -100, 100),
        slider('highlights', 'Highlights', -100, 100), slider('shadows', 'Shadows', -100, 100)),
      controlGroup('Color',
        slider('temperature', 'Temperature', -100, 100), slider('tint', 'Tint', -100, 100),
        slider('saturation', 'Saturation', -100, 100), slider('vibrance', 'Vibrance', -100, 100)),
      controlGroup('Detail and finishing',
        slider('denoise', 'Noise reduction', 0, 100), noiseSuggestion(), slider('sharpen', 'Sharpening', 0, 100),
        slider('blur', 'Optical blur', 0, 20, 0.25),
        slider('grain', 'Film grain', 0, 100), slider('vignette', 'Vignette', 0, 100)));
    if (asset.kind === 'image') wrap.append(controlGroup('Curves', curveTools()));
  }

  if (asset.kind === 'image') {
    const tattooGroup = controlGroup('Tattoo placement map', tattooTools());
    tattooGroup.open = tattooMapForAsset(asset).controlPoints.length === TATTOO_CONTROL_POINT_COUNT
      || state.editTool === 'tattoo';
    wrap.append(tattooGroup);
  }

  const gridToggle = el('input', { type: 'checkbox', checked: edit.pixelGrid.enabled });
  gridToggle.onchange = () => {
    mutate(asset, `Pixel Grid Review ${gridToggle.checked ? 'enabled' : 'disabled'}`, () => { edit.pixelGrid.enabled = gridToggle.checked; });
    renderReview();
  };
  const diagnostic = el('div', { className: 'pixel-review-controls' },
    el('label', { className: 'toggle' }, gridToggle, 'Edge Check'),
    el('p', { className: 'hint' }, 'Finds sudden changes in color or texture.'));
  if (edit.mode === 'advanced') {
    const columns = el('input', { type: 'range', min: 6, max: 32, step: 1, value: edit.pixelGrid.columns });
    const sensitivity = el('input', { type: 'range', min: 0, max: 100, step: 1, value: edit.pixelGrid.sensitivity });
    const bind = (input, output, key) => {
      let captured = false;
      input.oninput = () => {
        if (!captured) { snapshot(asset, `adjusted spatial continuity ${key}`); captured = true; }
        edit.pixelGrid[key] = Number(input.value); output.textContent = input.value;
        touchAsset(asset); if (edit.pixelGrid.enabled) schedulePaint();
      };
      input.onchange = () => { log(asset, `Spatial continuity ${key} → ${input.value}`, state.reviewer); captured = false; };
    };
    const columnsOut = el('output', {}, String(edit.pixelGrid.columns));
    const sensitivityOut = el('output', {}, String(edit.pixelGrid.sensitivity));
    bind(columns, columnsOut, 'columns'); bind(sensitivity, sensitivityOut, 'sensitivity');
    diagnostic.append(
      el('label', { className: 'editor-slider' }, el('span', {}, 'Region density'), columns, columnsOut),
      el('label', { className: 'editor-slider' }, el('span', {}, 'Sensitivity'), sensitivity, sensitivityOut));
  }
  wrap.append(diagnostic);
  return wrap;
}

const REVIEW_RAIL_OPEN_KEY = 'mlx:review-tools-open';
const REVIEW_RAIL_WIDTH_KEY = 'mlx:review-tools-width';
const REVIEW_RAIL_DEFAULT_WIDTH = 372;
const REVIEW_RAIL_MIN_WIDTH = 280;
const REVIEW_RAIL_MAX_WIDTH = 560;

function reviewRailIsOpen() {
  const saved = localStorage.getItem(REVIEW_RAIL_OPEN_KEY);
  if (saved !== null) return saved !== 'false';
  return !matchMedia('(max-width: 900px)').matches;
}

function reviewRailWidth() {
  const raw = localStorage.getItem(REVIEW_RAIL_WIDTH_KEY);
  if (raw === null) return REVIEW_RAIL_DEFAULT_WIDTH;
  const saved = Number(raw);
  return Number.isFinite(saved)
    ? Math.max(REVIEW_RAIL_MIN_WIDTH, Math.min(REVIEW_RAIL_MAX_WIDTH, saved))
    : REVIEW_RAIL_DEFAULT_WIDTH;
}

function setReviewRailOpen(open) {
  localStorage.setItem(REVIEW_RAIL_OPEN_KEY, String(open));
  renderReview();
}

function attachReviewRailResize(rail, handle) {
  const applyWidth = value => {
    const available = Math.max(REVIEW_RAIL_MIN_WIDTH, Math.min(REVIEW_RAIL_MAX_WIDTH, innerWidth - 420));
    const width = Math.max(REVIEW_RAIL_MIN_WIDTH, Math.min(available, Math.round(value)));
    rail.style.setProperty('--review-rail-width', `${width}px`);
    handle.setAttribute('aria-valuenow', String(width));
    handle.setAttribute('aria-valuetext', `${width} pixels wide`);
    localStorage.setItem(REVIEW_RAIL_WIDTH_KEY, String(width));
  };
  applyWidth(reviewRailWidth());
  handle.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Home') return applyWidth(REVIEW_RAIL_DEFAULT_WIDTH);
    const step = event.shiftKey ? 48 : 16;
    applyWidth(rail.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? step : -step));
  };
  handle.ondblclick = () => applyWidth(REVIEW_RAIL_DEFAULT_WIDTH);
  handle.onpointerdown = event => {
    if (matchMedia('(max-width: 900px)').matches) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = rail.getBoundingClientRect().width;
    handle.setPointerCapture(event.pointerId);
    rail.classList.add('resizing');
    handle.onpointermove = move => applyWidth(startWidth + startX - move.clientX);
    handle.onpointerup = handle.onpointercancel = finish => {
      if (handle.hasPointerCapture(finish.pointerId)) handle.releasePointerCapture(finish.pointerId);
      handle.onpointermove = null;
      handle.onpointerup = null;
      handle.onpointercancel = null;
      rail.classList.remove('resizing');
    };
  };
}

function renderRail(asset) {
  const rail = el('aside', { className: 'rail', id: 'rail', ariaLabel: 'Review tools' });
  const resizeHandle = el('div', {
    className: 'rail-resizer', role: 'separator', tabIndex: 0,
    ariaLabel: 'Resize Review tools', ariaOrientation: 'vertical',
    ariaValueMin: REVIEW_RAIL_MIN_WIDTH, ariaValueMax: REVIEW_RAIL_MAX_WIDTH
  });
  attachReviewRailResize(rail, resizeHandle);
  const railHeader = el('div', { className: 'rail-header' },
    el('strong', {}, 'Review tools'),
    el('span', { className: 'spacer' }),
    btn('Close', 'btn sm rail-close', () => setReviewRailOpen(false)));
  const surfaces = surfacesForAsset(asset);
  const subsection = (title, detail, body, { open = false, badge = null, name = 'review-subsection' } = {}) => el('details', {
    className: 'rail-subsection', name, open
  }, el('summary', {},
    el('span', { className: 'rail-section-label' }, el('span', {}, title), el('small', {}, detail)),
    badge), body);

  const auto = assetIssues(asset, state.assets, state.project);
  const perPlacement = Object.keys(asset.placements || {})
    .filter(sid => asset.placements[sid].decision !== 'pending')
    .flatMap(sid => placementIssues(asset, sid, state.project).map(i => ({ ...i, surface: SURFACE_BY_ID[sid]?.label })));
  const all = [...auto, ...perPlacement].sort((a, b) => ({ block: 0, warn: 1, info: 2 })[a.level] - ({ block: 0, warn: 1, info: 2 })[b.level]);

  let placementBody;
  if (!surfaces.length) {
    placementBody = el('div', { className: 'block' }, el('p', { className: 'hint' }, 'Choose placements in Workspace.'));
  } else {
    placementBody = el('div', { className: 'block' });
    const categoryFor = surface => ['instagram', 'tiktok'].includes(surface.group)
      ? ['social', 'Social media']
      : ['meta', 'google'].includes(surface.group)
        ? ['ads', 'Paid ads']
        : [surface.group, surface.groupLabel];
    const categories = new Map();
    for (const surface of surfaces) {
      const [categoryId, categoryLabel] = categoryFor(surface);
      if (!categories.has(categoryId)) categories.set(categoryId, { label: categoryLabel, platforms: new Map() });
      const platforms = categories.get(categoryId).platforms;
      if (!platforms.has(surface.group)) platforms.set(surface.group, { label: surface.groupLabel, surfaces: [] });
      platforms.get(surface.group).surfaces.push(surface);
    }
    for (const [categoryId, category] of categories) {
      const categoryCount = [...category.platforms.values()].reduce((count, platform) => count + platform.surfaces.length, 0);
      const categoryBody = el('div', { className: 'placement-group-body' });
      for (const [platformId, platform] of category.platforms) {
        const cards = el('div', { className: 'placement-platform-body' });
        for (const surface of platform.surfaces) cards.append(placementCard(asset, surface));
        categoryBody.append(el('details', { className: 'placement-platform', name: `placement-${categoryId}` },
          el('summary', {}, el('span', {}, platform.label), el('small', {}, `${platform.surfaces.length} format${platform.surfaces.length === 1 ? '' : 's'}`)),
          cards));
      }
      placementBody.append(el('details', { className: 'placement-group', name: 'placement-category' },
        el('summary', {}, el('span', {}, category.label), el('small', {}, `${categoryCount} format${categoryCount === 1 ? '' : 's'}`)),
        categoryBody));
    }
    placementBody.append(el('div', { style: 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap' },
      btn('Approve all', 'btn sm', () => {
        mutate(asset, 'approved every surface', () => {
          for (const s of surfaces) ensurePlacement(asset, s.id).decision = 'approved';
          syncStatusFromPlacements(asset);
        });
        renderReview(); renderCounters();
      }),
      btn('Reject all', 'btn sm', () => {
        mutate(asset, 'denied every surface', () => {
          for (const s of surfaces) ensurePlacement(asset, s.id).decision = 'denied';
          syncStatusFromPlacements(asset);
        });
        renderReview(); renderCounters();
      }),
      btn('Auto-reframe all', 'btn sm', () => reframeAll(asset))));
  }
  const editPanel = el('div', { className: 'rail-tab-content' }, editingBlock(asset));
  if (asset.kind === 'video') editPanel.append(subsection('Video production', 'Timing, sound, and rendering', videoBlock(asset), { open: true, name: 'edit-subsection' }));

  const reviewPanel = el('div', { className: 'rail-tab-content' },
    subsection('Automated checks', 'Items to review',
      el('div', { className: 'block', id: 'issueBlock' }, issueList(all, 'Nothing flagged. Human review still required.')),
      { open: true, badge: all.some(i => i.level === 'block') ? el('span', { className: 'chip rejected' }, 'blocking') : null }),
    subsection('QA checklist', 'Optional review checklist', qaBlock(asset)));

  const fixesPanel = el('div', { className: 'rail-tab-content' }, fixBlock(asset));
  const deliverPanel = el('div', { className: 'rail-tab-content' }, placementBody);
  const detailsPanel = el('div', { className: 'rail-tab-content' },
    subsection('Measurements', 'Resolution, color, and detail', metricsBlock(asset), { open: true, name: 'details-subsection' }),
    subsection('Asset details', 'Rating, role, and notes', metaBlock(asset), { name: 'details-subsection' }),
    subsection('Activity', 'Saved project history', logBlock(asset), { name: 'details-subsection' }));

  const definitions = [
    ['edit', 'Edit', editPanel],
    ['review', 'Review', reviewPanel],
    ['fixes', 'Fixes', fixesPanel],
    ['deliver', 'Deliver', deliverPanel],
    ['details', 'Details', detailsPanel]
  ];
  const tabList = el('div', { className: 'rail-tabs', role: 'tablist', ariaLabel: 'Studio workflow' });
  const tabs = [];
  const panels = [];
  const activate = index => {
    tabs.forEach((tab, tabIndex) => {
      const selected = tabIndex === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panels[tabIndex].hidden = !selected;
    });
  };
  definitions.forEach(([id, label, content], index) => {
    const tabId = `review-tab-${id}`;
    const panelId = `review-panel-${id}`;
    const tab = el('button', { id: tabId, type: 'button', role: 'tab' }, label);
    tab.setAttribute('aria-controls', panelId);
    tab.onclick = () => { state.reviewRailTab = id; activate(index); };
    tab.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      state.reviewRailTab = definitions[next][0];
      activate(next); tabs[next].focus();
    };
    const panel = el('section', { id: panelId, className: 'rail-tab-panel', role: 'tabpanel' }, content);
    panel.setAttribute('aria-labelledby', tabId);
    tabs.push(tab); panels.push(panel); tabList.append(tab);
  });
  const requestedTab = definitions.findIndex(([id]) => id === state.reviewRailTab);
  activate(requestedTab >= 0 ? requestedTab : 0);
  rail.append(resizeHandle, railHeader, tabList, ...panels);
  return rail;
}

/** Repaint only the automated-checks block — cheap enough to run after a drag. */
function renderIssuesOnly() {
  const asset = currentAsset();
  const host = $('#issueBlock');
  if (!asset || !host) return;
  const auto = assetIssues(asset, state.assets, state.project);
  const per = Object.keys(asset.placements || {})
    .filter(sid => asset.placements[sid].decision !== 'pending')
    .flatMap(sid => placementIssues(asset, sid, state.project).map(i => ({ ...i, surface: SURFACE_BY_ID[sid]?.label })));
  const all = [...auto, ...per].sort((a, b) => ({ block: 0, warn: 1, info: 2 })[a.level] - ({ block: 0, warn: 1, info: 2 })[b.level]);
  host.replaceChildren(issueList(all, 'Nothing flagged. Human review still required.'));
}

function reframeAll(asset) {
  if (!asset.auto?.energy) return toast('Run automated checks first — reframing uses the energy map.', true);
  mutate(asset, 'auto-reframed every surface', () => {
    for (const s of surfacesForAsset(asset)) {
      const p = ensurePlacement(asset, s.id);
      const base = defaultCrop(asset.width, asset.height, s);
      p.crop = smartCrop(asset.auto.energy, asset.width, asset.height, s, base, asset.geometry?.faces || []);
    }
  });
  renderReview();
  toast('Reframed every surface around the subject.');
}

// ---------------------------------------------------------------------------
// review shell

/**
 * First run: the campaign's direction comes before any pixel. Everything asked
 * here is what every later check reads from \u2014 goal, brand, audience, surfaces.
 */
function directionWizard() {
  const b = state.project.brief;
  const card = el('div', { className: 'wizard' });
  card.append(
    el('h2', {}, 'Where is this campaign going?'),
    el('p', { className: 'lead' },
      'Set the direction first \u2014 every crop, check, and approval downstream is judged against it. Thirty seconds now saves a re-review later.'));

  const field = (key, label, placeholder, multi = false) => {
    const i = multi ? el('textarea', { value: b[key] || '', placeholder, rows: 2 })
                    : el('input', { type: 'text', value: b[key] || '', placeholder });
    i.oninput = () => { b[key] = i.value; touchProject(); };
    return el('label', { className: 'field' }, el('span', {}, label), i);
  };
  card.append(
    field('campaignGoal', 'What is this campaign for?', 'e.g. App launch \u2014 paid social and website hero'),
    el('div', { className: 'wizard-field-row' },
      (() => { const f = field('brand', 'Brand', 'Your brand'); f.style.flex = '1'; return f; })(),
      (() => { const f = field('audience', 'Audience', 'Who has to stop scrolling'); f.style.flex = '1'; return f; })()),
    field('tone', 'Tone', 'e.g. warm, editorial, quietly confident'));

  card.append(el('label', { className: 'field' }, el('span', {}, 'Where will it run?')));
  const presets = el('div', { className: 'presets' });
  const paint = () => {
    for (const btnEl of presets.children) {
      const pr = SURFACE_PRESETS.find(x => x.id === btnEl.dataset.id);
      btnEl.classList.toggle('on', pr.surfaces.every(id => state.project.surfaces.includes(id)));
    }
  };
  for (const pr of SURFACE_PRESETS) {
    const bEl = el('button', { type: 'button', dataset: { id: pr.id } }, `${pr.label} \u00b7 ${pr.surfaces.length}`);
    bEl.onclick = () => {
      const all = pr.surfaces.every(id => state.project.surfaces.includes(id));
      state.project.surfaces = all
        ? state.project.surfaces.filter(id => !pr.surfaces.includes(id))
        : [...new Set([...state.project.surfaces, ...pr.surfaces])];
      touchProject(); paint();
    };
    presets.append(bEl);
  }
  paint();
  card.append(presets,
    el('p', { className: 'lead', style: 'margin:0 0 4px;font-size:11.5px' },
      'Fine-tune individual placements any time in the Surfaces panel.'));

  const start = btn('Set direction and add assets', 'btn primary', async () => {
    if (!b.campaignGoal.trim()) b.campaignGoal = 'Untitled campaign';
    await store.saveProject(state.project);
    render();
    $('#fileInput').click();
  });
  card.append(el('div', { className: 'foot' }, start,
    el('span', { className: 'note' }, 'Everything stays on this machine.')));
  return card;
}

/**
 * The 2K\u21924K move: push a still through the engine's upscale model
 * (Real-ESRGAN and friends), then re-measure the result like any other asset.
 */
async function upscaleAsset(asset) {
  // Prefer the local bridge: Real-ESRGAN on supported GPUs, with explicit CPU
  // recovery. A connected ComfyUI remains the secondary local engine.
  const bridge = await detectBridge();
  let engine = null, models = [];
  if (bridge.ok && bridge.upscale?.available) {
    models = bridge.upscale.models;
  } else {
    const savedBase = localStorage.getItem('cros:comfyBase') || DEFAULT_BASE;
    engine = await detectComfy(savedBase);
    if (!engine.ok) {
      return toast('Photo enhancement is not ready on this device.', true);
    }
    try { models = await listUpscaleModels(engine.base); } catch { /* handled */ }
    if (!models.length) {
      return toast('Add the Photo enhancement pack in Workspace, then try again.', true);
    }
  }
  const pick = el('select', {});
  const preferredModel = models.find(m => /realesrgan-x4plus$/.test(m))
    || models.find(m => /cpu-lanczos-x4$/.test(m))
    || models[0];
  for (const [index, m] of models.entries()) pick.append(el('option', {
    value: m,
    selected: m === preferredModel
  }, `Enhancement quality ${index + 1}`));
  dialog('Enhance photo',
    el('div', {},
      el('p', { className: 'hint' },
        'Choose the final size; MaterialLogix will add a linked copy and check it automatically.'),
      !covers(lic, 'photo') ? el('p', { className: 'hint', style: 'color:var(--warn)' },
        'Preview supports 2×; licensed Photo plans unlock 4×.') : null,
      el('label', { className: 'field' }, el('span', {}, 'Quality'), pick)),
    [btn('Cancel', 'btn', closeDialog),
     btn('Upscale', 'btn primary', async () => {
       const model = pick.value;
       closeDialog();
       const authorization = await authorizeOutbound({ product: 'photo', artifactKind: 'upload', quantity: 1 });
       if (!authorization.ok) return toast(`Online upscale authorization failed: ${authorization.reason || 'authorization_required'}.`, true);
       let completedEngine = '';
       try {
         await busy(async () => {
           toast('Enhancing photo\u2026');
           const blob = await store.getBlob(asset.id);
           const out = engine
             ? await upscaleOne(blob, asset.filename, model, () => {}, engine.base)
             : await upscaleViaBridge(blob, model);
           completedEngine = engine ? 'the ComfyUI engine' : localUpscaleEngineLabel(out.engine);
           await settleOutbound(authorization.authorization.id, await blobEvidenceHash(out.blob));
           const file = new File([out.blob], asset.filename.replace(/(\.[a-z0-9]+)?$/i, '_up$1'), { type: out.blob.type || 'image/png' });
           const up = newAsset(state.project.id, file);
           up.labels = { ...asset.labels };
           up.altText = asset.altText;
           up.provenance = `Upscaled from ${asset.filename} with ${model} on ${completedEngine}. ` + (asset.provenance || '');
           await store.addAsset(up, file);
           const url = await store.objectUrl(up.id);
           Object.assign(up, await probe(file, url));
           log(up, 'enhanced photo', state.reviewer);
           await store.saveAsset(up);
           state.assets.push(up);
           await runAnalysis(up, { quiet: true });
         });
         state.assets = await store.listAssets(state.project.id);
         render();
         toast('Enhanced photo added to Library.');
       } catch (err) {
         const release = await releaseUsage(authorization.authorization.id, 'render_failed');
         toast(`Upscale failed: ${err.message}. ${release.message}`, true);
       }
     })]);
}

/** The "make this photo right" checklist. Feeds RETOUCH_LIST.md in the export. */
function fixBlock(asset) {
  const wrap = el('div', { className: 'block' });
  asset.fixes = asset.fixes || [];
  const has = id => asset.fixes.some(f => f.id === id);

  const grid = el('div', { className: 'fixgrid' });
  for (const f of FIX_PRESETS) {
    const bEl = el('button', { className: has(f.id) ? 'on' : '', type: 'button' }, f.label);
    bEl.onclick = () => {
      mutate(asset, `${has(f.id) ? 'cleared fix' : 'marked fix'}: ${f.label}`, () => {
        if (has(f.id)) asset.fixes = asset.fixes.filter(x => x.id !== f.id);
        else asset.fixes.push({ id: f.id, label: f.label, consentRequired: !!f.consentRequired });
        if (asset.fixes.length && asset.status === 'unreviewed') asset.status = 'needs-retouch';
      });
      renderReview(); renderCounters();
    };
    grid.append(bEl);
  }
  wrap.append(grid);

  const custom = el('input', { type: 'text', placeholder: 'Anything else to fix \u2014 type and press Enter' });
  custom.onkeydown = e => {
    if (e.key !== 'Enter' || !custom.value.trim()) return;
    mutate(asset, `marked fix: ${custom.value.trim()}`, () => {
      asset.fixes.push({ id: null, label: custom.value.trim() });
      if (asset.status === 'unreviewed') asset.status = 'needs-retouch';
    });
    renderReview(); renderCounters();
  };
  wrap.append(el('label', { className: 'field' }, custom));

  for (const f of asset.fixes.filter(x => x.id === null)) {
    const row = el('div', { className: 'fixrow' }, f.label);
    const x = el('button', { className: 'x', type: 'button', title: 'Remove' }, '\u00d7');
    x.onclick = () => {
      mutate(asset, `cleared fix: ${f.label}`, () => {
        asset.fixes = asset.fixes.filter(y => y !== f);
      });
      renderReview();
    };
    row.append(x);
    wrap.append(row);
  }
  if (asset.fixes.length) {
    wrap.append(el('p', { className: 'hint', style: 'margin:10px 0 0' },
      `${asset.fixes.length} fix(es) \u2014 saved with the asset and exported as a precise RETOUCH_LIST.md work order. Appearance changes remain previews until the pictured person approves them.`));
  }
  return wrap;
}

function renderReview() {
  const main = $('#main');
  const assets = visibleAssets();

  // The start page carries no workspace chrome: Export, Jobs, Create, and
  // More only mean something once a photo exists.
  document.body.classList.toggle('start-page', !state.assets.length);
  if (!state.assets.length) {
    // The entry stamps which Studio was chosen; the start page honors it so
    // Video never greets you as Photo.
    let startProduct = 'photo';
    try { if (sessionStorage.getItem('mlx:start-product') === 'video') startProduct = 'video'; } catch { /* unavailable */ }
    if (startProduct === 'video') {
      main.replaceChildren(el('div', { className: 'empty photo-start-view' },
        el('span', { className: 'eyebrow' }, 'Video Studio'),
        el('h2', {}, 'Bring in a video'),
        el('p', {}, 'Import footage, then Studio checks the frames before you cut, refine, and deliver.'),
        el('div', { className: 'photo-start-actions' },
          btn('Import video', 'btn primary', () => {
            const input = $('#fileInput');
            const previous = input.accept;
            input.accept = 'video/*';
            input.addEventListener('cancel', () => { input.accept = previous; }, { once: true });
            input.addEventListener('change', () => { input.accept = previous; }, { once: true });
            input.click();
          }),
          btn('Switch to Photo', 'btn', () => {
            try { sessionStorage.setItem('mlx:start-product', 'photo'); } catch { /* unavailable */ }
            renderReview();
          })),
        photoWorkflowSteps(1, 'Video')));
      return;
    }
    main.replaceChildren(el('div', { className: 'empty photo-start-view' },
      el('span', { className: 'eyebrow' }, 'Photo Studio'),
      el('h2', {}, 'Create or open a photo'),
      el('p', {}, 'Generate something new or bring in a photo. Face, hand, and body mapping stays off until you give direct consent.'),
      el('div', { className: 'photo-start-actions' },
        btn('Generate photo', 'btn primary', openPhotoCreationDialog),
        btn('Import photo or video', 'btn', () => $('#fileInput').click())),
      photoWorkflowSteps(1)));
    return;
  }
  if (!assets.length) {
    main.replaceChildren(el('div', { className: 'empty' },
      el('h2', {}, 'No asset matches the filters'),
      el('p', {}, 'Open the board to change them.'),
      btn('Open board', 'btn', () => { state.mode = 'board'; render(); })));
    return;
  }

  state.index = Math.min(state.index, assets.length - 1);
  const asset = assets[state.index];
  const surfaces = asset ? surfacesForAsset(asset) : activeSurfaces();
  if (!surfaces.find(s => s.id === state.activeSurface)) state.activeSurface = surfaces[0]?.id || null;
  const surface = SURFACE_BY_ID[state.activeSurface];

  const head = el('div', { className: 'stage-head' },
    btn('← Previous', 'btn sm', () => { state.index = (state.index - 1 + assets.length) % assets.length; renderReview(); }),
    btn('Next →', 'btn sm', () => { state.index = (state.index + 1) % assets.length; renderReview(); }),
    el('span', { className: 'idx' }, `${state.index + 1} / ${assets.length}`),
    el('span', { className: 'chip ' + asset.status }, STATUS_BY_ID[asset.status]?.label || asset.status),
    el('div', { className: 'spacer' }),
    (() => {
      const seg = el('div', { className: 'seg' });
      for (const [v, label] of [['source', 'Full source'], ['placement', 'Placement'], ['compare', 'Compare']]) {
        const b = el('button', { className: state.view === v ? 'on' : '' }, label);
        b.onclick = () => { state.view = v; renderReview(); };
        seg.append(b);
      }
      return seg;
    })());

  let stageBody;
  if (state.view === 'compare') {
    const pick = el('select', { style: 'width:auto;min-width:180px' });
    pick.append(el('option', { value: '' }, 'Compare with…'));
    for (const a of state.assets) {
      if (a.id === asset.id) continue;
      pick.append(el('option', { value: a.id, selected: a.id === state.compareWith },
        `${a.role === 'reference' ? '★ ' : ''}${a.filename}`));
    }
    pick.onchange = () => { state.compareWith = pick.value; paintCompare(); };
    stageBody = el('div', { className: 'stage' },
      head,
      el('div', { className: 'compare', id: 'comparePanes' }),
      el('div', { className: 'stage-tools' },
        el('span', { className: 'note' }, 'Identity check — reference on the left, candidate on the right, both at this placement crop.'),
        el('div', { className: 'spacer' }), pick));
    setTimeout(paintCompare, 0);
  } else {
    stageBody = el('div', { className: 'stage' }, head, el('div', { className: 'viewport', id: 'viewport' }), stageTools(asset, surface, surfaces));
  }

  const rail = renderRail(asset);
  const railOpen = reviewRailIsOpen();
  rail.hidden = !railOpen;
  const railToggle = btn('Review tools', 'btn sm review-rail-toggle', () => setReviewRailOpen(true));
  railToggle.hidden = railOpen;
  railToggle.setAttribute('aria-controls', 'rail');
  railToggle.setAttribute('aria-expanded', String(railOpen));
  main.replaceChildren(el('div', { className: 'review' }, stageBody, railToggle, rail));
  if (state.view !== 'compare') paintStage();
}

function stageTools(asset, surface, surfaces) {
  const tools = el('div', { className: 'stage-tools' });
  if (!surface) {
    tools.append(el('span', { className: 'note' }, 'Select at least one surface in the sidebar to crop and approve.'));
    return tools;
  }
  const p = ensurePlacement(asset, surface.id);
  const fills = el('div', { className: 'seg' });
  for (const [v, label] of [['crop', 'Crop'], ['blur', 'Blur fill'], ['contain', 'Letterbox']]) {
    const b = el('button', { className: p.fill === v ? 'on' : '' }, label);
    b.onclick = () => {
      mutate(asset, `${surface.label} fill → ${label}`, () => {
        p.fill = v;
        p.crop = v === 'crop' && asset.width && asset.height
          ? defaultCrop(asset.width, asset.height, surface)
          : { x: 0, y: 0, w: 1, h: 1 };
      });
      renderReview();
    };
    fills.append(b);
  }
  const loupeBtn = btn('Loupe', 'btn sm' + (state.loupe ? ' on' : ''), () => {
    state.loupe = !state.loupe;
    if (!state.loupe) removeLoupe();
    renderReview();
  });
  const thirdsBtn = btn('Thirds', 'btn sm' + (state.thirds ? ' on' : ''), () => { state.thirds = !state.thirds; renderReview(); });
  const loupeZoomSeg = el('div', { className: 'seg loupe-zoom', role: 'group', ariaLabel: 'Loupe magnification' });
  for (const factor of LOUPE_ZOOMS) {
    const b = el('button', { className: state.loupeZoom === factor ? 'on' : '' }, `${factor * 100}%`);
    b.onclick = () => { setLoupeZoom(factor); renderReview(); };
    loupeZoomSeg.append(b);
  }
  const zoomOutBtn = btn('Zoom out', 'btn sm', () => { captureCropBurst(asset, `reframed ${surface.label}`); p.crop = zoomCrop(p.crop, 1 / 1.15); touchAsset(asset); schedulePaint(); renderIssuesOnly(); });
  const zoomInBtn = btn('Zoom in', 'btn sm', () => { captureCropBurst(asset, `reframed ${surface.label}`); p.crop = zoomCrop(p.crop, 1.15); touchAsset(asset); schedulePaint(); renderIssuesOnly(); });
  const resetBtn = btn('Reset view', 'btn sm', () => {
    snapshot(asset, `reset the ${surface.label} view`);
    p.crop = asset.width ? defaultCrop(asset.width, asset.height, surface) : { x: 0, y: 0, w: 1, h: 1 };
    touchAsset(asset); schedulePaint(); renderIssuesOnly();
  });
  const autoBtn = btn('Auto-reframe', 'btn sm', () => {
    if (!asset.auto?.energy) return toast('Run automated checks first.', true);
    mutate(asset, `auto-reframed ${surface.label}`, () => {
      p.crop = smartCrop(asset.auto.energy, asset.width, asset.height, surface, defaultCrop(asset.width, asset.height, surface), asset.geometry?.faces || []);
    });
    renderReview();
  });
  const viewMenu = el('details', { className: 'stage-tool-menu' },
    el('summary', { className: 'btn sm' }, 'View options'),
    el('div', { className: 'stage-tool-menu-body' }, fills, loupeBtn,
      el('label', { className: 'stage-tool-field' }, el('span', {}, 'Loupe magnification'), loupeZoomSeg),
      thirdsBtn));

  tools.append(
    el('span', { className: 'note' }, `${surface.groupLabel} · ${surface.label}`),
    resetBtn, zoomOutBtn, zoomInBtn, autoBtn, viewMenu,
    el('div', { className: 'spacer' }),
    el('span', { className: 'note direct-help' }, `Grab ${asset?.kind === 'video' ? 'frame' : 'picture'} to move · trackpad scroll to zoom · arrows nudge · 0 resets`),
    el('span', { className: 'kbd' }, 'A R D'),
    el('span', { className: 'kbd' }, '?'));
  return tools;
}

// ---------------------------------------------------------------------------
// counters, preflight, exports

function renderCounters() {
  const surfaces = activeSurfaces();
  const pairs = approvedPairs(state.assets);
  const covered = new Set(pairs.map(p => p.surface.id));
  const gaps = surfaces.filter(s => !covered.has(s.id)).length;
  const unreviewed = state.assets.filter(a => a.status === 'unreviewed').length;
  const blocks = state.assets.reduce((n, a) => n + issueCount(a).block, 0);
  const cell = (k, v, flag) => el('span', { className: flag ? 'flag' : '' },
    el('span', { className: 'k' }, k), el('b', {}, String(v)));
  $('#counters').replaceChildren(
    cell('Assets', state.assets.length),
    cell('Unreviewed', unreviewed),
    cell('Approved', pairs.length),
    cell('Gaps', gaps, gaps > 0 && state.assets.length > 0),
    cell('Blocking', blocks, blocks > 0));
}

// ---------------------------------------------------------------------------
// Pro capabilities, shown to everyone
//
// A Standard customer who cannot see what Pro does has no way to decide whether
// to buy it, and a hidden control reads as a missing feature rather than a paid
// one. Every Pro affordance therefore stays on screen in both Guided and
// Advanced, dimmed and tagged when it is not owned, and explains itself when
// pressed instead of doing nothing.

const PRO_PHOTO_FEATURES = Object.freeze({
  'generative-fill': Object.freeze({
    title: 'Generative Fill is a Photo Pro tool',
    lines: Object.freeze([
      'Select an area of the photograph and Studio rebuilds it on your own graphics card. Nothing is uploaded and the original is always preserved.',
      'Included with Single Studio Pro — Photo and with Pro Studio.'
    ])
  }),
  'export-ceiling': Object.freeze({
    title: 'Larger finished photos are Photo Pro',
    lines: Object.freeze([
      `Standard delivers a finished photo up to ${LANES.paid.imageMaxEdge} px on the long edge. Photo Pro delivers up to ${LANES.studioPro.imageMaxEdge} px, for film and commercial work.`,
      'Your photograph, your edits, and every other export are unchanged either way.'
    ])
  })
});

function proTag() {
  return el('span', { className: 'pro-tag', ariaLabel: 'Pro feature' }, 'PRO');
}

function explainProFeature(id) {
  const feature = PRO_PHOTO_FEATURES[id];
  if (!feature) return;
  dialog(feature.title, el('div', {}, ...feature.lines.map(line => el('p', {}, line)),
    el('p', { className: 'hint' }, 'Already bought it? Activate the key under Deliver in the project sidebar.')),
  [linkBtn('See plans', PRICING_URL, 'btn primary'), btn('Close', 'btn', closeDialog)]);
}

/** Marks a control as Pro without ever hiding it. */
function markProFeature(node, id, entitled = false) {
  node.classList.add('pro-only');
  node.dataset.proFeature = id;
  node.append(proTag());
  return setProEntitlement(node, entitled);
}

function setProEntitlement(node, entitled) {
  node.classList.toggle('locked', !entitled);
  if (entitled) node.removeAttribute('aria-description');
  else node.setAttribute('aria-description', 'Included with Photo Pro');
  return node;
}

function preflightDialog(onProceed) {
  const result = preflight(state.project, state.assets);
  const body = el('div', {});
  body.append(el('p', { className: 'hint' },
    result.blocks
      ? `${result.blocks} blocking issue(s) and ${result.warns} warning(s). Blocking issues are the ones that get an ad rejected or a client angry.`
      : `No blocking issues. ${result.warns} warning(s) to look at.`));
  body.append(issueList(result.items.slice(0, 60), 'Everything checks out.'));
  if (result.items.length > 60) body.append(el('p', { className: 'hint' }, `…and ${result.items.length - 60} more, all listed in the package.`));

  const override = el('input', { type: 'checkbox' });
  const proceed = btn(result.blocks ? 'Export anyway' : 'Export package', 'btn primary', () => { closeDialog(); onProceed(); });
  proceed.disabled = result.blocks > 0;
  override.onchange = () => { proceed.disabled = result.blocks > 0 && !override.checked; };

  dialog('Pre-flight', body, [
    result.blocks ? el('label', { className: 'toggle' }, override, 'I accept the blocking issues') : null,
    el('div', { className: 'spacer' }),
    btn('Cancel', 'btn', closeDialog),
    proceed
  ]);
}

/**
 * The finished photograph, at its own pixels. Everything else in Deliver
 * renders a placement, a paper size, or a contact sheet, so an edited photo
 * could be graded and never leave the application at its own size and shape.
 */
async function openFinishedPhotoDelivery() {
  const asset = currentAsset();
  if (!asset || asset.kind !== 'image') return toast('Select a photo first.', true);
  const decoded = await decode(asset);
  if (!decoded) return toast('That photo could not be prepared.', true);
  if (!asset.auto?.color) await runAnalysis(asset, { quiet: true });

  const license = await activeLicense();
  const ceiling = imageExportCeiling(license, 'photo');
  const entitled = hasProAccess(license, 'photo');
  const edit = ensureEditState(asset);
  const surface = SURFACE_BY_ID[state.activeSurface];

  const framing = el('select', { ariaLabel: 'Framing' },
    el('option', { value: 'full' }, 'Whole photograph'),
    surface ? el('option', { value: 'placement' }, `Current crop — ${surface.label}`) : null);
  const longEdge = el('input', { type: 'number', min: 256, step: 1, ariaLabel: 'Long edge in pixels' });
  const summary = el('div', { className: 'block', ariaLive: 'polite' });
  const status = el('p', { className: 'hint', role: 'status', ariaLive: 'polite' });
  const ceilingRow = el('p', { className: 'hint pro-ceiling' },
    entitled
      ? `Photo Pro — up to ${LANES.studioPro.imageMaxEdge} px on the long edge.`
      : `Photo Pro delivers up to ${LANES.studioPro.imageMaxEdge} px.`);
  markProFeature(ceilingRow, 'export-ceiling', entitled);
  if (!entitled) {
    ceilingRow.tabIndex = 0;
    ceilingRow.setAttribute('role', 'button');
    ceilingRow.onclick = () => explainProFeature('export-ceiling');
    ceilingRow.onkeydown = event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      explainProFeature('export-ceiling');
    };
  }
  const download = btn('Download finished photo', 'btn primary');
  let plan = null;

  const cropFor = () => framing.value === 'placement' && surface
    ? ensurePlacement(asset, surface.id).crop
    : { x: 0, y: 0, w: 1, h: 1 };

  const update = () => {
    const colorDelivery = colorExportDecision(asset.auto?.color || {});
    plan = planFinishedPhoto({
      sourceWidth: decoded.w, sourceHeight: decoded.h, crop: cropFor(),
      longEdge: Number(longEdge.value) || 0, ceiling
    });
    longEdge.max = Math.min(plan.nativeLongEdge, ceiling);
    setChildren(summary,
      el('p', {}, `${plan.width} × ${plan.height} px · ${plan.megapixels} MP · sRGB JPEG`),
      el('p', { className: 'hint', style: 'margin-top:6px' },
        `Your photo is ${plan.nativeWidth} × ${plan.nativeHeight} px. This license delivers up to ${ceiling} px on the long edge.`),
      plan.limitedByCeiling
        ? el('p', { style: 'color:var(--warn);margin-top:6px' },
          `Held to ${ceiling} px by your license. The photo itself is ${plan.nativeLongEdge} px.`)
        : null,
      !colorDelivery.allowed
        ? el('p', { style: 'color:var(--bad);margin-top:6px' },
          'This photo needs an accepted sRGB conversion before delivery.')
        : null);
    download.disabled = !colorDelivery.allowed;
    status.textContent = download.disabled ? 'Prepare the color first.' : '';
  };

  framing.onchange = () => { longEdge.value = ''; update(); };
  longEdge.oninput = update;

  download.onclick = async () => {
    const lic = await activeLicense();
    // A finished photo is a metered clean export, exactly like the package and
    // the print. Subscription coverage is primary; leftover local_units only
    // fulfill already-issued legacy entitlements.
    const covered = covers(lic, 'photo');
    const credits = Number(lic?.entitlements?.local_units || 0);
    if (!covered && credits < 1) {
      return dialog('A Photo license is required to download',
        el('div', {},
          el('p', {}, 'It is ready to preview. Downloading it needs Photo Single Studio, Full Studio, or Pro Studio.'),
          el('p', { className: 'hint' }, 'Already bought it? Activate the key under Deliver in the project sidebar, then reconnect for usage confirmation.')),
        [linkBtn('See plans', PRICING_URL, 'btn primary'), btn('Close', 'btn', closeDialog)]);
    }
    download.disabled = true;
    status.style.color = '';
    status.textContent = 'Rendering your photo…';
    let authorizationId = null;
    try {
      const canvas = await busy(() => renderCrop(decoded.source, decoded.w, decoded.h, plan.crop,
        { w: plan.width, h: plan.height }, 'crop', null, edit.adjustments));
      const blob = new Blob([canvasToBytes(canvas, 'image/jpeg', 0.94)], { type: 'image/jpeg' });
      canvas.width = canvas.height = 0;
      const evidenceHash = await blobEvidenceHash(blob);
      const authorization = await authorizeOutbound({
        product: 'photo', artifactKind: 'clean_export', quantity: 1, operationId: evidenceHash
      });
      if (!authorization.ok) throw new Error(authorization.reason || 'authorization_required');
      authorizationId = authorization.authorization.id;
      const stem = slug(String(asset.filename || 'photo').replace(/\.[^.]+$/, ''));
      await settleOutboundBeforeDelivery(authorizationId, evidenceHash,
        () => downloadBlob(blob, `${stem}-${plan.width}x${plan.height}.jpg`));
      if (!covered) {
        const spent = await consumeEntitlement({ entitlement: 'local_units', quantity: 1, operationId: evidenceHash });
        if (!spent.ok) console.warn('finished photo delivered but the credit did not record:', spent.reason);
      }
      recordExport(1);
      log(asset, `delivered a finished photo at ${plan.width}×${plan.height}`, state.reviewer);
      touchAsset(asset);
      status.textContent = `Downloaded ${plan.width} × ${plan.height} px.`;
    } catch (error) {
      const release = authorizationId ? await releaseUsage(authorizationId, 'finished_photo_export_failed') : null;
      status.textContent = `Photo was not downloaded: ${error.message}.${release ? ` ${release.message}` : ''}`;
      status.style.color = 'var(--bad)';
    } finally {
      download.disabled = !colorExportDecision(asset.auto?.color || {}).allowed;
    }
  };

  const body = el('div', {},
    el('p', { className: 'hint' }, 'Every edit you have made, at the photo’s own size and shape.'),
    el('label', { className: 'field' }, el('span', {}, 'Framing'), framing),
    el('label', { className: 'field' }, el('span', {}, 'Long edge (px)'), longEdge),
    el('p', { className: 'hint' }, 'Leave the long edge empty for the largest size your license allows.'),
    ceilingRow, summary, status);
  update();
  dialog('Finished photo', body, [btn('Cancel', 'btn', closeDialog), download]);
}

async function openPrintDelivery() {
  const asset = currentAsset();
  if (!asset || asset.kind !== 'image') return toast('Select a photo first.', true);
  const decoded = await decode(asset);
  if (!decoded) return toast('That photo could not be prepared.', true);
  if (!asset.auto?.color) await runAnalysis(asset, { quiet: true });

  const preset = el('select', {});
  for (const option of PRINT_PRESETS) preset.append(el('option', {
    value: option.id, selected: option.id === '8x10'
  }, option.label));
  const orientation = el('select', {},
    el('option', { value: 'portrait' }, 'Portrait'),
    el('option', { value: 'landscape' }, 'Landscape'));
  const fit = el('select', {},
    el('option', { value: 'crop' }, 'Fill · centered crop'),
    el('option', { value: 'contain' }, 'Fit · white border'));
  const bleed = el('input', { type: 'checkbox' });
  const summary = el('div', { className: 'block', ariaLive: 'polite' });
  const status = el('p', { className: 'hint', role: 'status', ariaLive: 'polite' });
  const download = btn('Download print JPEG', 'btn primary');
  let currentPlan = null;

  const update = () => {
    currentPlan = planPrint({
      presetId: preset.value, orientation: orientation.value, fit: fit.value,
      bleed: bleed.checked, sourceWidth: decoded.w, sourceHeight: decoded.h, ppi: PRINT_PPI
    });
    const color = printColorDecision(asset.auto?.color || {});
    const qualityText = currentPlan.quality === 'ready'
      ? 'Ready at 300 PPI.'
      : currentPlan.quality === 'review'
        ? `Review recommended at ${currentPlan.effectivePpi} effective PPI.`
        : `Source is too small at ${currentPlan.effectivePpi} effective PPI.`;
    setChildren(summary,
      el('p', {}, `${currentPlan.pixelWidth} × ${currentPlan.pixelHeight} px · ${currentPlan.ppi} PPI · sRGB JPEG`),
      el('p', { className: 'hint', style: 'margin-top:6px' },
        `${qualityText}${currentPlan.bleedInches ? ' Includes 0.125 in bleed.' : ''}`),
      !color.allowed ? el('p', { style: 'color:var(--bad);margin-top:6px' },
        'This photo needs an accepted sRGB conversion before print delivery.') : null);
    download.disabled = !currentPlan.canExport || !color.allowed;
    status.textContent = download.disabled ? 'Choose a smaller print size or prepare the color first.' : '';
  };

  for (const control of [preset, orientation, fit, bleed]) control.onchange = update;
  download.onclick = async () => {
    const lic = await activeLicense();
    // A print is a metered clean export, the same class as the package export.
    // Subscription coverage is primary; leftover local_units only fulfill
    // already-issued legacy entitlements. Spent on finish, below, never here.
    const printCovered = covers(lic, 'photo');
    const printCredits = Number(lic?.entitlements?.local_units || 0);
    if (!printCovered && printCredits < 1) {
      return dialog('A Photo license is required to download',
        el('div', {},
          el('p', {}, 'It is ready to preview. Downloading it needs Photo Single Studio, Full Studio, or Pro Studio.'),
          el('p', { className: 'hint' }, 'Already bought it? Activate the key under Deliver in the project sidebar, then reconnect for usage confirmation.')),
        [linkBtn('See plans', PRICING_URL, 'btn primary'), btn('Close', 'btn', closeDialog)]);
    }
    download.disabled = true;
    status.style.color = '';
    status.textContent = 'Preparing your print…';
    let authorizationId = null;
    try {
      const canvas = await busy(() => renderPrint(decoded.source, decoded.w, decoded.h,
        currentPlan, ensureEditState(asset).adjustments));
      const bytes = encodePrintJpeg(canvas, currentPlan.ppi);
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      const evidenceHash = await blobEvidenceHash(blob);
      const authorization = await authorizeOutbound({
        product: 'photo', artifactKind: 'clean_export', quantity: 1, operationId: evidenceHash
      });
      if (!authorization.ok) throw new Error(authorization.reason || 'authorization_required');
      authorizationId = authorization.authorization.id;
      const stem = slug(String(asset.filename || 'photo').replace(/\.[^.]+$/, ''));
      const suffix = `${currentPlan.presetId}-${currentPlan.orientation}-${currentPlan.ppi}ppi`;
      await settleOutboundBeforeDelivery(authorizationId, evidenceHash,
        () => downloadBlob(blob, `${stem}-${suffix}.jpg`));
      if (!printCovered) {
        const spent = await consumeEntitlement({ entitlement: 'local_units', quantity: 1, operationId: evidenceHash });
        if (!spent.ok) console.warn('print delivered but the credit did not record:', spent.reason);
      }
      recordExport(1);
      status.textContent = `Downloaded ${currentPlan.pixelWidth} × ${currentPlan.pixelHeight} px at ${currentPlan.ppi} PPI.`;
    } catch (error) {
      const release = authorizationId ? await releaseUsage(authorizationId, 'print_export_failed') : null;
      status.textContent = `Print was not downloaded: ${error.message}.${release ? ` ${release.message}` : ''}`;
      status.style.color = 'var(--bad)';
    } finally {
      download.disabled = !currentPlan?.canExport || !printColorDecision(asset.auto?.color || {}).allowed;
    }
  };

  const body = el('div', {},
    el('p', { className: 'hint' }, 'Choose the finished size; MaterialLogix preserves the photo proportions.'),
    el('label', { className: 'field' }, el('span', {}, 'Print size'), preset),
    el('label', { className: 'field' }, el('span', {}, 'Orientation'), orientation),
    el('label', { className: 'field' }, el('span', {}, 'Framing'), fit),
    el('label', { className: 'toggle' }, bleed, 'Add 0.125 in bleed'),
    summary, status);
  update();
  dialog('Print-ready photo', body, [btn('Cancel', 'btn', closeDialog), download]);
}

async function doExport(exportOpts = {}) {
  if (!state.project) return;
  if (!approvedPairs(state.assets).length) return toast('Nothing approved yet \u2014 approve at least one placement.', true);
  const product = state.assets.some(asset => asset.kind === 'video') ? 'video' : 'photo';
  const lic = await activeLicense();
  // A subscription covers the product outright. Failing that, leftover
  // local_units / clean_video_exports only fulfill already-issued legacy
  // entitlements — spent on finish, never here, so a failed export costs nothing.
  const covered = covers(lic, product);
  const exportEntitlement = product === 'video' ? 'clean_video_exports' : 'local_units';
  const credits = Number(lic?.entitlements?.[exportEntitlement] || 0);
  if (!covered && credits < 1) {
    return dialog('A matching license is required to download',
      el('div', {},
        el('p', {}, 'Free preview lets you edit, compare, and review inside MaterialLogix. It does not create downloadable files.'),
        el('p', { className: 'hint', style: 'margin-top:10px' },
          `Already bought it? Activate a ${product === 'video' ? 'Video' : 'Photo'} Single Studio or Full Studio license under Deliver in the project sidebar, then reconnect for usage confirmation.`)),
      [linkBtn('See plans', PRICING_URL, 'btn primary'), btn('Close', 'btn', closeDialog)]);
  }
  // What this licence is entitled to, from the single tier table, rather than
  // from whichever button was pressed.
  const lane = laneFor(lic, product);
  preflightDialog(async () => {
    const pairs = approvedPairs(state.assets);
    let authorizationId = null;
    const bar = el('i');
    const status = el('p', {}, `Rendering ${pairs.length} placement(s)…`);
    dialog(exportOpts.proof ? 'Export proof package — watermarked, 960px' : 'Export campaign package',
      el('div', {}, status, el('div', { className: 'progress' }, bar),
        exportOpts.proof ? el('p', { className: 'hint' }, 'Proofs carry a full-frame watermark and capped resolution — safe to send before payment clears. The licensed export renders clean.') : null),
      [btn('Close', 'btn', closeDialog)]);
    try {
      const extra = {
        'AUDIT.md': logMarkdown(state.assets),
        'PREFLIGHT.md': preflightMarkdown()
      };
      const { blob, filename, stats } = await busy(() =>
        buildPackage(state.project, state.assets, (done, total, name) => {
          status.textContent = `Rendering ${done} / ${total} — ${name}`;
          bar.style.width = `${(done / total) * 100}%`;
        }, extra, { ...exportOpts, lane }));
      const evidenceHash = await blobEvidenceHash(blob);
      const authorization = await authorizeOutbound({
        product,
        artifactKind: exportOpts.proof ? 'proof_export' : 'clean_export',
        quantity: pairs.length,
        operationId: evidenceHash
      });
      if (!authorization.ok) throw new Error(authorization.reason || 'authorization_required');
      authorizationId = authorization.authorization.id;
      await settleOutboundBeforeDelivery(authorizationId, evidenceHash, () => downloadBlob(blob, filename));
      // Delivered. Only now does a credit-funded export spend its credit, and
      // only when no subscription covered it. The evidence hash keys the
      // idempotency, so re-delivering the same artifact cannot double-charge.
      if (!covered && !exportOpts.proof) {
        const spent = await consumeEntitlement({ entitlement: exportEntitlement, quantity: 1, operationId: evidenceHash });
        if (!spent.ok) console.warn('export delivered but the credit did not record:', spent.reason);
      }
      if (!exportOpts.proof) recordExport(pairs.length);
      status.textContent = `Done — ${stats.placements} placement(s), ${stats.files} files, ${(blob.size / 1048576).toFixed(1)} MB.`;
      if (stats.failures.length) {
        status.after(el('p', { style: 'color:var(--warn)' }, `${stats.failures.length} render(s) failed. See EXPORT_WARNINGS.txt inside the zip.`));
      }
    } catch (err) {
      const release = authorizationId ? await releaseUsage(authorizationId, 'export_failed') : null;
      status.textContent = `Export was not downloaded: ${err.message}.${release ? ` ${release.message}` : ''}`;
      status.style.color = 'var(--bad)';
    }
  });
}

function preflightMarkdown() {
  const r = preflight(state.project, state.assets);
  const L = ['# Pre-flight report', '', `Generated ${new Date().toLocaleString()}.`, '',
    `- Blocking: ${r.blocks}`, `- Warnings: ${r.warns}`, ''];
  if (!r.items.length) L.push('_Nothing flagged._');
  for (const i of r.items) {
    L.push(`- **${i.level.toUpperCase()}** — ${i.asset || 'project'}${i.surface ? ` · ${i.surface}` : ''} — ${i.message}${i.fix ? ` _(${i.fix})_` : ''}`);
  }
  return L.join('\n');
}

async function exportClientPage() {
  const pairs = approvedPairs(state.assets);
  if (!pairs.length) return toast('Approve something first — the client page shows approved placements.', true);
  const bar = el('i');
  const status = el('p', {}, 'Building…');
  dialog('Client review page', el('div', {}, status, el('div', { className: 'progress' }, bar),
    el('p', { className: 'hint' }, 'One HTML file with the images embedded. Email it. The client approves in their own browser and sends back a small JSON file you import here. No hosting, no accounts.')),
    [btn('Close', 'btn', closeDialog)]);
  let authorization = null;
  try {
    const html = await busy(() => buildClientPage(state.project, state.assets, (n, total, name) => {
      status.textContent = `Embedding ${n} / ${total} — ${name}`;
      bar.style.width = `${(n / total) * 100}%`;
    }));
    const blob = new Blob([html], { type: 'text/html' });
    const evidenceHash = await blobEvidenceHash(blob);
    authorization = await authorizeOutbound({ product: 'photo', artifactKind: 'client_review', quantity: pairs.length, operationId: evidenceHash });
    if (!authorization.ok) throw new Error(authorization.reason || 'online_authorization_required');
    await settleOutboundBeforeDelivery(authorization.authorization.id, evidenceHash,
      () => downloadBlob(blob, `${slug(state.project.name)}-client-review.html`));
    status.textContent = `Done — ${(blob.size / 1048576).toFixed(1)} MB, ${pairs.length} placement(s).`;
  } catch (err) {
    const release = authorization?.ok ? await releaseUsage(authorization.authorization.id, 'export_failed') : null;
    status.textContent = `Not downloaded: ${err.message}.${release ? ` ${release.message}` : ''}`;
    status.style.color = 'var(--bad)';
  }
}

async function importVerdict(file) {
  try {
    const json = JSON.parse(await file.text());
    const { applied, missing, changed } = applyClientVerdict(json, state.assets);
    for (const a of changed) { log(a, `client decisions imported`, 'client'); await store.saveAsset(a); }
    render();
    toast(`Applied ${applied} client decision(s)${missing ? `, ${missing} skipped (asset not in this project)` : ''}.`);
  } catch (err) {
    toast('Could not read that file: ' + err.message, true);
  }
}

async function exportContactSheet() {
  const pairs = approvedPairs(state.assets);
  if (!pairs.length) return toast('Nothing approved yet.', true);
  const colorBlock = pairs.map(pair => ({ asset: pair.asset, decision: colorExportDecision(pair.asset.auto?.color || {}) }))
    .find(entry => !entry.decision.allowed);
  if (colorBlock) return toast(`${colorBlock.asset.filename} needs an accepted color conversion before export.`, true);
  const COLS = 4, CELL = 420, PAD = 24, LABEL = 46;
  const rows = Math.ceil(pairs.length / COLS);
  const canvas = el('canvas', { width: COLS * CELL + PAD * (COLS + 1), height: rows * (CELL + LABEL) + PAD * (rows + 1) + 90 });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0a0a0b'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#eeebe4';
  ctx.font = '300 34px Georgia, serif';
  ctx.fillText(state.project.name, PAD, 52);
  ctx.fillStyle = '#8b857c';
  ctx.font = '400 14px sans-serif';
  ctx.fillText(`${pairs.length} approved placements · ${new Date().toLocaleDateString()}`, PAD, 76);

  for (let i = 0; i < pairs.length; i++) {
    const { asset, surface, placement } = pairs[i];
    const d = await decode(asset);
    if (!d) continue;
    const col = i % COLS, row = Math.floor(i / COLS);
    const x = PAD + col * (CELL + PAD);
    const y = 90 + PAD + row * (CELL + LABEL + PAD);
    const thumbSurface = { ...surface, w: CELL, h: Math.round(CELL * (surface.h / surface.w)) };
    const shot = renderCrop(d.source, d.w, d.h, placement.crop, thumbSurface, placement.fill, null, ensureEditState(asset).adjustments);
    const drawH = Math.min(CELL, thumbSurface.h);
    const drawW = Math.round(drawH * (surface.w / surface.h));
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, CELL, CELL);
    ctx.drawImage(shot, x + (CELL - drawW) / 2, y + (CELL - drawH) / 2, drawW, drawH);
    ctx.fillStyle = '#c9a86a';
    ctx.font = '400 11px sans-serif';
    ctx.fillText(`${surface.groupLabel} · ${surface.label}`.slice(0, 46), x, y + CELL + 18);
    ctx.fillStyle = '#8b857c';
    ctx.fillText(`${asset.filename}`.slice(0, 52), x, y + CELL + 34);
  }
  canvas.toBlob(async b => {
    if (!b) return toast('Contact sheet rendering failed before authorization.', true);
    const evidenceHash = await blobEvidenceHash(b);
    const authorization = await authorizeOutbound({ product: 'photo', artifactKind: 'contact_sheet', quantity: pairs.length, operationId: evidenceHash });
    if (!authorization.ok) return toast(`Online export authorization failed: ${authorization.reason || 'authorization_required'}.`, true);
    try {
      await settleOutboundBeforeDelivery(authorization.authorization.id, evidenceHash,
        () => downloadBlob(b, `${slug(state.project.name)}-contact-sheet.png`));
      toast('Contact sheet saved.');
    } catch (error) {
      const release = await releaseUsage(authorization.authorization.id, 'export_failed');
      toast(`Contact sheet was not downloaded: ${error.message}. ${release.message}`, true);
    }
  }, 'image/png');
}

function showSummary() {
  const md = decisionsMarkdown(state.project, state.assets);
  dialog('Decision summary', el('pre', { className: 'report', textContent: md }), [
    btn('Close', 'btn', closeDialog),
    btn('Copy markdown', 'btn primary', () => navigator.clipboard.writeText(md).then(() => toast('Copied.')))
  ]);
}

function showHelp() {
  const keys = [
    ['← →', 'Previous / next asset'],
    ['A R D', 'Approve, revise, or deny the active placement'],
    ['1 – 9', 'Jump to that placement'],
    ['F', 'Toggle full-source view'],
    ['C', 'Toggle compare view'],
    ['L', 'Toggle the loupe'],
    ['Shift+L', 'Cycle loupe magnification 100 / 200 / 400%'],
    ['T', 'Toggle thirds grid'],
    ['G', 'Auto-reframe the active placement'],
    ['B', 'Toggle board'],
    ['Ctrl+Z', 'Undo the last decision'],
    ['?', 'This list']
  ];
  const grid = el('div', { className: 'keyhelp' });
  for (const [k, v] of keys) grid.append(el('span', { className: 'kbd' }, k), el('span', {}, v));
  dialog('Keyboard', grid, [btn('Close', 'btn', closeDialog)]);
}

function undo() {
  const entry = popUndo();
  if (!entry) return toast('Nothing to undo.');
  if (entry.kind === 'asset') {
    const i = state.assets.findIndex(a => a.id === entry.id);
    if (i >= 0) { state.assets[i] = entry.data; store.saveAsset(entry.data); }
  } else {
    state.project = entry.data;
    store.saveProject(entry.data);
  }
  render();
  toast(`Undid: ${entry.label}`);
}

// ---------------------------------------------------------------------------

function render() {
  renderSidebar();
  renderCounters();
  document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === state.mode));
  if (state.mode === 'board') renderBoard(); else renderReview();
}

/** Editing works best on the dark surface: the workspace defaults to dark
 * until the person picks a theme themselves, which then always wins. */
function applyWorkspaceTheme() {
  try {
    if (localStorage.getItem('cros:themePinned')) return;
    document.documentElement.dataset.theme = 'dark';
    localStorage.setItem('cros:theme', 'dark');
  } catch { /* storage unavailable */ }
}

async function boot(selectId) {
  clearUndo();
  // Expired or withdrawn sensitive records are purged before the workspace
  // can offer any Pack or face-map action.
  try { await sweepExpiredPersonalGeometryData(); } catch { /* dedicated storage reports failures on access */ }
  if (location.hash === '#workspace') applyWorkspaceTheme();
  state.projects = await store.listProjects();
  if (!state.projects.length) {
    const p = newProject('First campaign');
    p.brief.brand = '';
    p.brief.campaignGoal = '';
    await store.saveProject(p);
    state.projects = [p];
  }
  const wanted = selectId || localStorage.getItem('cros:project');
  state.project = state.projects.find(p => p.id === wanted) || state.projects[0];
  const recoverySafeProject = personalGeometrySafeRecoveryView(state.project);
  if (JSON.stringify(recoverySafeProject) !== JSON.stringify(state.project)) {
    state.project = recoverySafeProject;
    state.projects = state.projects.map(project => project.id === state.project.id ? state.project : project);
    await store.saveProject(state.project);
  }
  // Drop the retired provider placeholder wherever an older project still
  // carries it, credentials included. Cloud keys belong only in a server-side
  // secret store.
  if (Object.prototype.hasOwnProperty.call(state.project, 'providers')) {
    delete state.project.providers;
    await store.saveProject(state.project);
  }
  localStorage.setItem('cros:project', state.project.id);
  const loadedAssets = await store.listAssets(state.project.id);
  state.tattooMaps.clear();
  tattooMapLoads.clear();
  tattooMapDiscoveryComplete.clear();
  state.assets = [];
  for (const asset of loadedAssets) {
    if (hasLegacyPersonalGeometryLink(asset)) {
      await deletePersonalGeometryAsset(asset.id, { deletedAt: new Date().toISOString() });
      await store.deleteAsset(asset.id);
      continue;
    }
    if (stripLegacyPersonalGeometryFields(asset)) await store.saveAsset(asset);
    state.assets.push(asset);
  }
  await Promise.all(state.assets.filter(asset => asset.kind === 'image').map(async asset => {
    try {
      await hydrateTattooMap(asset);
    } catch (cause) {
      tattooMapDiscoveryComplete.add(asset.id);
      toast(cause?.message || 'A local tattoo-placement record could not be reopened.', true);
    }
  }));
  state.index = 0;
  state.decoded.clear();
  state.activeSurface = state.project.surfaces[0] || null;

  $('#projectSelect').replaceChildren(...state.projects.map(p =>
    el('option', { value: p.id, selected: p.id === state.project.id }, p.name)));
  render();
}

function wire() {
  $('#projectSelect').onchange = e => boot(e.target.value);
  $('#newProject').onclick = () => {
    const input = el('input', { type: 'text', placeholder: 'Campaign or client name' });
    dialog('New project', el('label', { className: 'field' }, el('span', {}, 'Project name'), input), [
      btn('Cancel', 'btn', closeDialog),
      btn('Create', 'btn primary', async () => {
        const p = newProject(input.value.trim() || 'Untitled project');
        await store.saveProject(p);
        closeDialog(); boot(p.id);
      })
    ]);
  };
  document.querySelectorAll('#modeSeg button').forEach(b => {
    b.onclick = () => {
      state.mode = b.dataset.mode;
      document.querySelector('.topbar-more')?.removeAttribute('open');
      render();
    };
  });
  const settingsButton = $('#menuBtn');
  const settingsPanel = $('#sidebar');
  settingsButton.textContent = 'Create';
  settingsButton.setAttribute('aria-label', 'Create or open');
  settingsPanel.classList.remove('open');
  settingsPanel.classList.add('closed');
  settingsButton.setAttribute('aria-expanded', 'false');
  settingsButton.onclick = e => {
    e.stopPropagation();
    const open = settingsPanel.classList.contains('closed');
    settingsPanel.classList.toggle('closed', !open);
    settingsPanel.classList.toggle('open', open);
    settingsButton.setAttribute('aria-expanded', String(open));
  };
  $('#main').addEventListener('pointerdown', () => {
    settingsPanel.classList.remove('open');
    settingsPanel.classList.add('closed');
    settingsButton.setAttribute('aria-expanded', 'false');
  });

  $('#themeBtn').onclick = () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('cros:theme', next);
    localStorage.setItem('cros:themePinned', '1');
  };

  $('#exportBtn').onclick = () => doExport();
  $('#exportMoreBtn').onclick = () => { document.querySelector('.topbar-more')?.removeAttribute('open'); doExport(); };
  $('#helpBtn').onclick = showHelp;
  $('#fileInput').onchange = e => { importFiles(e.target.files); e.target.value = ''; };
  $('#recoveryInput').onchange = e => { const f = e.target.files?.[0]; if (f) restoreProject(f); e.target.value = ''; };
  $('#verdictInput').onchange = e => { if (e.target.files[0]) importVerdict(e.target.files[0]); e.target.value = ''; };

  let dragDepth = 0;
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('dragenter', e => {
    e.preventDefault();
    if (++dragDepth === 1) document.querySelector('.dropzone')?.classList.add('hot');
  });
  window.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) { dragDepth = 0; document.querySelector('.dropzone')?.classList.remove('hot'); }
  });
  window.addEventListener('drop', e => {
    e.preventDefault(); dragDepth = 0;
    document.querySelector('.dropzone')?.classList.remove('hot');
    if (e.dataTransfer?.files?.length) importFiles(e.dataTransfer.files);
  });

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !settingsPanel.classList.contains('closed')) {
      settingsPanel.classList.remove('open');
      settingsPanel.classList.add('closed');
      settingsButton.setAttribute('aria-expanded', 'false');
      settingsButton.focus();
      e.preventDefault();
      return;
    }
    if (e.target.matches('input, textarea, select')) return;
    if ($('#dlg').open) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); return undo(); }
    const asset = currentAsset();
    const assets = visibleAssets();
    const surfaces = asset ? surfacesForAsset(asset) : activeSurfaces();

    if (e.shiftKey && /^[!@#$%]$/.test(e.key)) {
      const n = '!@#$%'.indexOf(e.key) + 1;
      if (asset) {
        mutate(asset, `rated ${asset.rating === n ? 0 : n}/5`, () => { asset.rating = asset.rating === n ? 0 : n; });
        renderReview();
      }
      e.preventDefault();
      return;
    }
    if (e.shiftKey && e.key.toLowerCase() === 'l') {
      const next = LOUPE_ZOOMS[(LOUPE_ZOOMS.indexOf(state.loupeZoom) + 1) % LOUPE_ZOOMS.length];
      setLoupeZoom(next);
      state.loupe = true;
      renderReview();
      toast(`Loupe magnification ${next * 100}%.`);
      e.preventDefault();
      return;
    }
    if (/^[1-9]$/.test(e.key)) {
      const s = surfaces[Number(e.key) - 1];
      if (s) { state.activeSurface = s.id; renderReview(); e.preventDefault(); }
      return;
    }
    switch (e.key.toLowerCase()) {
      case 'arrowright': if (assets.length) { state.index = (state.index + 1) % assets.length; renderReview(); } break;
      case 'arrowleft': if (assets.length) { state.index = (state.index - 1 + assets.length) % assets.length; renderReview(); } break;
      case 'a': if (asset && state.activeSurface) decidePlacement(asset, state.activeSurface, 'approved'); break;
      case 'r': if (asset && state.activeSurface) decidePlacement(asset, state.activeSurface, 'revise'); break;
      case 'd': if (asset && state.activeSurface) decidePlacement(asset, state.activeSurface, 'denied'); break;
      case 'f': state.view = state.view === 'source' ? 'placement' : 'source'; renderReview(); break;
      case 'c': state.view = state.view === 'compare' ? 'placement' : 'compare'; renderReview(); break;
      case 'l': state.loupe = !state.loupe; if (!state.loupe) removeLoupe(); renderReview(); break;
      case 't': state.thirds = !state.thirds; renderReview(); break;
      case 'g': if (asset) reframeAll(asset); break;
      case 'b': state.mode = state.mode === 'board' ? 'review' : 'board'; render(); break;
      case '?': case '/': showHelp(); break;
      default: return;
    }
    e.preventDefault();
  });

  window.addEventListener('beforeunload', e => {
    flushPendingSaves();
    if (state.busy) { e.preventDefault(); e.returnValue = ''; }
  });
}

// Automation hook for the smoke suite. Off unless ?dev is in the URL, so it
// never exists in a normal session.
if (['localhost', '127.0.0.1', '::1'].includes(location.hostname) && new URLSearchParams(location.search).has('dev')) {
  window.__cros = {
    state, render, importFiles, runAnalysis, reframeAll, decidePlacement,
    preflight: () => preflight(state.project, state.assets),
    issueCount, visibleAssets, ensurePlacement, generativeFillDialog, backupProject,
    buildVideoProPackage: buildLocalVideoTimelinePackage,
    openVideoProForTest: (asset, license, adapters = {}) => openVideoProEditor({
      license, asset, assets: state.assets,
      objectUrl: id => store.objectUrl(id), getBlob: id => store.getBlob(id),
      saveAsset: value => store.saveAsset(value),
      renderTimeline: adapters.renderTimeline || (timeline => renderVideoTimeline(asset, timeline, license)),
      requestImport: () => $('#fileInput')?.click()
    })
  };
}

wire();
boot().catch(error => {
  console.error(error);
  const viewport = $('#viewport') || document.body;
  viewport.replaceChildren(el('div', { className: 'empty' },
    el('h2', {}, 'Studio could not start'),
    el('p', {}, 'The local project store could not be opened. Close other Studio tabs, leave private browsing, or free some disk space, then reload.')));
});
