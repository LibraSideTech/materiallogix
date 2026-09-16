// Local-only tattoo placement mapping.
//
// The mapping is a non-destructive 2D guide: sixteen normalized source-image
// anchors drive bicubic interpolation, and a selectable sample density expands
// that interpolation to as many as 121 review points. These are non-metric
// landmark observations, never a scan, calibrated surface, or digital double.
// The record contains no tattoo pixels, identity inference, or upload authority.
// A map is valid only when it is bound to a current direct-self Personal
// Geometry consent receipt for this exact target asset. Sensitive map data is
// stored by personal-geometry-storage.js, never in the ordinary asset record.

import {
  PERSONAL_GEOMETRY_CONSENT_SCHEMA,
  PERSONAL_GEOMETRY_NOTICE_SHA256,
  PERSONAL_GEOMETRY_PURPOSES,
  personalGeometryConsentState
} from './personal-geometry-consent.js';

export const TATTOO_MAPPING_SCHEMA = 'materiallogix.tattoo-mapping.v2';
export const TATTOO_PLACEMENT_ALGORITHM_ID = 'materiallogix.tattoo-placement-map.v2';
export const TATTOO_PLACEMENT_ALGORITHM_MANIFEST = [
  'schema=materiallogix.tattoo-placement-map-manifest.v1',
  'implementation=js/tattoo-mapping.js:manualTattooControlLattice,tattooControlLatticeForRegion',
  'execution=local-browser',
  'input=direct-self target asset and optional active normalized-landmark body Pack',
  'output=16 normalized 2D control anchors and interpolated review mesh',
  'coordinate-system=normalized-source-image-2d',
  'metric=false',
  'surface=false',
  'identity=false',
  'remote=false'
].join('\n');
export const TATTOO_PLACEMENT_ALGORITHM_SHA256 = 'ba83dabacb25c8cd9b2c0ad351159a97270f30e86f333b284d801e55025c0464';
export const TATTOO_CONTROL_GRID_SIZE = 4;
export const TATTOO_CONTROL_POINT_COUNT = TATTOO_CONTROL_GRID_SIZE ** 2;
export const TATTOO_MESH_MIN_DENSITY = 3;
export const TATTOO_MESH_MAX_DENSITY = 11;
export const TATTOO_MESH_DEFAULT_DENSITY = 7;
export const TATTOO_SPATIAL_MEANING = Object.freeze({
  coordinateSpace: 'normalized-source-image-2d',
  nonMetricLandmarkObservations: true,
  metricCalibration: false,
  threeDimensionalReconstruction: false,
  calibratedSurface: false,
  digitalDouble: false
});

export const TATTOO_REGIONS = Object.freeze([
  Object.freeze({ id: 'upper-torso', label: 'Upper torso' }),
  Object.freeze({ id: 'full-torso', label: 'Full torso' }),
  Object.freeze({ id: 'upper-back', label: 'Upper back · confirm image orientation' }),
  Object.freeze({ id: 'left-upper-arm', label: 'Left upper arm' }),
  Object.freeze({ id: 'right-upper-arm', label: 'Right upper arm' }),
  Object.freeze({ id: 'left-forearm', label: 'Left forearm' }),
  Object.freeze({ id: 'right-forearm', label: 'Right forearm' }),
  Object.freeze({ id: 'left-thigh', label: 'Left thigh' }),
  Object.freeze({ id: 'right-thigh', label: 'Right thigh' }),
  Object.freeze({ id: 'left-calf', label: 'Left calf' }),
  Object.freeze({ id: 'right-calf', label: 'Right calf' }),
  Object.freeze({ id: 'custom', label: 'Custom / manual' })
]);

const REGION_IDS = new Set(TATTOO_REGIONS.map(region => region.id));
const MAPPING_METHODS = new Set(['manual', 'local-pose-preset']);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const finite = value => value !== null && value !== '' && Number.isFinite(Number(value));
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number(value)));
const rounded = value => +Number(value).toFixed(6);
const boundedText = (value, max) => String(value || '').trim().slice(0, max);
const isIsoDate = value => typeof value === 'string'
  && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;

function authorizedAlgorithm(receipt) {
  return (receipt?.algorithm_ids_and_digests || []).find(item =>
    item?.algorithm_id === TATTOO_PLACEMENT_ALGORITHM_ID
      && item?.sha256 === TATTOO_PLACEMENT_ALGORITHM_SHA256);
}

/**
 * Validate the direct-self authorization for one exact target asset. When a
 * body Pack seeds the map, its subject reference must be the same pseudonymous
 * subject named by the new tattoo-placement receipt.
 */
export function tattooPlacementConsentState(receipt, {
  targetAssetId,
  sourcePackRecord = null,
  now = Date.now()
} = {}) {
  const blockers = [...personalGeometryConsentState(receipt, { now }).blockers];
  if (receipt?.schema !== PERSONAL_GEOMETRY_CONSENT_SCHEMA) blockers.push('tattoo_consent_receipt_invalid');
  if (receipt?.specific_purpose !== PERSONAL_GEOMETRY_PURPOSES.tattooPlacement) {
    blockers.push('tattoo_placement_purpose_required');
  }
  if (receipt?.subject_role !== 'self' || !receipt?.subject_ref
      || receipt.subject_ref !== receipt.account_ref) {
    blockers.push('direct_self_subject_required');
  }
  if (receipt?.target_asset_id !== targetAssetId || !SAFE_ID.test(String(targetAssetId || ''))) {
    blockers.push('target_asset_binding_mismatch');
  }
  if (receipt?.optional_layers?.tattoos !== true || receipt?.appearance_rights_confirmed !== true) {
    blockers.push('tattoo_scope_not_authorized');
  }
  if (!authorizedAlgorithm(receipt)) blockers.push('tattoo_algorithm_not_authorized');

  const sourcePackId = receipt?.source_pack_id || null;
  const sourceSubjectRef = receipt?.source_pack_subject_ref || null;
  if (Boolean(sourcePackId) !== Boolean(sourceSubjectRef)) blockers.push('source_pack_binding_incomplete');
  if (sourcePackId) {
    const sourcePack = sourcePackRecord?.pack;
    const sourceReceipt = sourcePackRecord?.receipt;
    const sourceState = personalGeometryConsentState(sourceReceipt, { now });
    if (!sourcePack || !sourceReceipt || !sourceState.allowed) blockers.push('source_pack_inactive');
    if (sourcePack?.packId !== sourcePackId || sourceReceipt?.pack_id !== sourcePackId) {
      blockers.push('source_pack_binding_mismatch');
    }
    if (sourceReceipt?.subject_ref !== receipt?.subject_ref
        || sourceSubjectRef !== receipt?.subject_ref) {
      blockers.push('source_pack_subject_mismatch');
    }
    if (!['body', 'combined'].includes(sourcePack?.captureMode)
        || sourceReceipt?.optional_layers?.tattoos !== true) {
      blockers.push('tattoo_authorized_body_pack_required');
    }
  } else if (sourcePackRecord) {
    blockers.push('unexpected_source_pack');
  }
  return Object.freeze({ allowed: blockers.length === 0, blockers: [...new Set(blockers)] });
}

export function clampTattooMeshDensity(value) {
  const numeric = finite(value) ? Math.round(Number(value)) : TATTOO_MESH_DEFAULT_DENSITY;
  return Math.min(TATTOO_MESH_MAX_DENSITY, Math.max(TATTOO_MESH_MIN_DENSITY, numeric));
}

function normalizePoint(point, index, source = 'manual') {
  return {
    index,
    row: Math.floor(index / TATTOO_CONTROL_GRID_SIZE),
    column: index % TATTOO_CONTROL_GRID_SIZE,
    x: rounded(clamp(point.x)),
    y: rounded(clamp(point.y)),
    source: source === 'local-pose-preset' ? source : 'manual'
  };
}

/** Build the editable 4x4 control lattice from four boundary corners. */
export function tattooControlLatticeFromQuad(quad, source = 'manual') {
  if (!Array.isArray(quad) || quad.length !== 4 || quad.some(point => !finite(point?.x) || !finite(point?.y))) {
    return [];
  }
  const [topLeft, topRight, bottomRight, bottomLeft] = quad;
  const points = [];
  for (let row = 0; row < TATTOO_CONTROL_GRID_SIZE; row++) {
    const v = row / (TATTOO_CONTROL_GRID_SIZE - 1);
    for (let column = 0; column < TATTOO_CONTROL_GRID_SIZE; column++) {
      const u = column / (TATTOO_CONTROL_GRID_SIZE - 1);
      const x = (1 - v) * ((1 - u) * topLeft.x + u * topRight.x)
        + v * ((1 - u) * bottomLeft.x + u * bottomRight.x);
      const y = (1 - v) * ((1 - u) * topLeft.y + u * topRight.y)
        + v * ((1 - u) * bottomLeft.y + u * bottomRight.y);
      points.push(normalizePoint({ x, y }, points.length, source));
    }
  }
  return points;
}

/** A centered fallback that can be positioned entirely by hand. */
export function manualTattooControlLattice(bounds = {}) {
  const width = clamp(finite(bounds.w) ? bounds.w : 0.28, 0.04, 0.9);
  const height = clamp(finite(bounds.h) ? bounds.h : 0.28, 0.04, 0.9);
  const x = clamp(finite(bounds.x) ? bounds.x : (1 - width) / 2, 0, 1 - width);
  const y = clamp(finite(bounds.y) ? bounds.y : (1 - height) / 2, 0, 1 - height);
  return tattooControlLatticeFromQuad([
    { x, y }, { x: x + width, y },
    { x: x + width, y: y + height }, { x, y: y + height }
  ]);
}

function posePoints(geometry) {
  const pose = geometry?.poses?.[0] || geometry?.mapping?.poses?.[0];
  const landmarks = pose?.landmarks;
  if (Array.isArray(landmarks)) {
    return new Map(landmarks
      .filter(point => typeof point?.code === 'string' && finite(point.x) && finite(point.y))
      .map(point => [point.code, point]));
  }
  // Compatibility with the smaller body record produced by older projects.
  const body = geometry?.body;
  if (!body) return new Map();
  return new Map([
    ['left_shoulder', body.lShoulder], ['right_shoulder', body.rShoulder],
    ['left_hip', body.lHip], ['right_hip', body.rHip]
  ].filter(([, point]) => finite(point?.x) && finite(point?.y)));
}

function usableLandmark(points, code) {
  const point = points.get(code);
  if (!point || !finite(point.x) || !finite(point.y)) return null;
  const confidence = finite(point.visibility) ? Number(point.visibility)
    : finite(point.presence) ? Number(point.presence)
      : finite(point.v) ? Number(point.v) : 1;
  return confidence >= 0.35 ? { x: Number(point.x), y: Number(point.y) } : null;
}

const interpolate = (a, b, amount) => ({
  x: a.x + (b.x - a.x) * amount,
  y: a.y + (b.y - a.y) * amount
});

function torsoQuad(points, upperOnly = false) {
  const shoulders = [usableLandmark(points, 'left_shoulder'), usableLandmark(points, 'right_shoulder')];
  const hips = [usableLandmark(points, 'left_hip'), usableLandmark(points, 'right_hip')];
  if ([...shoulders, ...hips].some(point => !point)) return null;
  shoulders.sort((a, b) => a.x - b.x);
  hips.sort((a, b) => a.x - b.x);
  const lower = upperOnly
    ? [interpolate(shoulders[0], hips[0], 0.55), interpolate(shoulders[1], hips[1], 0.55)]
    : hips;
  // Pull the boundary slightly inward so initial anchors sit on the torso,
  // not directly on the joint centers.
  const topCenter = interpolate(shoulders[0], shoulders[1], 0.5);
  const lowerCenter = interpolate(lower[0], lower[1], 0.5);
  return [
    interpolate(shoulders[0], topCenter, 0.12),
    interpolate(shoulders[1], topCenter, 0.12),
    interpolate(lower[1], lowerCenter, 0.08),
    interpolate(lower[0], lowerCenter, 0.08)
  ];
}

function segmentQuad(points, startCode, endCode, widthRatio) {
  const first = usableLandmark(points, startCode);
  const last = usableLandmark(points, endCode);
  if (!first || !last) return null;
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.025) return null;
  const start = interpolate(first, last, 0.12);
  const end = interpolate(first, last, 0.88);
  const halfWidth = Math.max(0.012, length * widthRatio / 2);
  const px = -dy / length * halfWidth;
  const py = dx / length * halfWidth;
  return [
    { x: start.x - px, y: start.y - py },
    { x: start.x + px, y: start.y + py },
    { x: end.x + px, y: end.y + py },
    { x: end.x - px, y: end.y - py }
  ];
}

const SEGMENT_REGIONS = Object.freeze({
  'left-upper-arm': ['left_shoulder', 'left_elbow', 0.38],
  'right-upper-arm': ['right_shoulder', 'right_elbow', 0.38],
  'left-forearm': ['left_elbow', 'left_wrist', 0.34],
  'right-forearm': ['right_elbow', 'right_wrist', 0.34],
  'left-thigh': ['left_hip', 'left_knee', 0.44],
  'right-thigh': ['right_hip', 'right_knee', 0.44],
  'left-calf': ['left_knee', 'left_ankle', 0.34],
  'right-calf': ['right_knee', 'right_ankle', 0.34]
});

/**
 * Seed anchors from pose coordinates produced in the browser. This does not
 * infer identity, age, image orientation, or skin; null means use the manual
 * fallback and tell the reviewer which evidence was unavailable.
 */
export function tattooControlLatticeForRegion(geometry, region = 'upper-torso') {
  const points = posePoints(geometry);
  let quad = null;
  if (region === 'upper-torso' || region === 'upper-back') quad = torsoQuad(points, true);
  else if (region === 'full-torso') quad = torsoQuad(points, false);
  else if (SEGMENT_REGIONS[region]) quad = segmentQuad(points, ...SEGMENT_REGIONS[region]);
  if (!quad) return null;
  const controlPoints = tattooControlLatticeFromQuad(quad, 'local-pose-preset');
  return controlPoints.length === TATTOO_CONTROL_POINT_COUNT ? controlPoints : null;
}

/**
 * Select a current tattoo-authorized body observation from validated,
 * asset-associated Personal Geometry Pack records. The returned geometry is
 * ephemeral and contains landmarks only; callers must never copy it into the
 * ordinary asset or project recovery record.
 */
export function tattooPoseGeometryFromPackRecords(records = []) {
  if (!Array.isArray(records)) return null;
  const candidates = [];
  for (const record of records) {
    const pack = record?.pack;
    const receipt = record?.receipt;
    if (!pack || !receipt || receipt.status !== 'active' || receipt.optional_layers?.tattoos !== true) continue;
    if (!['body', 'combined'].includes(pack.captureMode)) continue;
    if (pack.authorization?.consentId !== receipt.consent_id
        || pack.packId !== receipt.pack_id) continue;
    for (const view of pack.canonical?.referenceViews || []) {
      if (!view?.body || !Array.isArray(view.body.landmarks) || view.body.landmarks.length < 33) continue;
      const yaw = Number(view.view?.yawDeg);
      const frontDistance = Number.isFinite(yaw) ? Math.min(Math.abs(yaw), Math.abs(360 - Math.abs(yaw))) : 181;
      candidates.push({
        issues: Array.isArray(view.issues) ? view.issues.length : 999,
        frontDistance,
        capturedAt: String(view.capturedAt || ''),
        value: {
          schema: pack.canonical.sourceSchema,
          coordinateSystem: view.coordinateSystem,
          poses: [{ landmarks: view.body.landmarks }],
          authorization: {
            packId: pack.packId,
            consentId: receipt.consent_id,
            viewId: view.id,
            tattooScope: true
          }
        }
      });
    }
  }
  candidates.sort((left, right) => left.issues - right.issues
    || left.frontDistance - right.frontDistance
    || right.capturedAt.localeCompare(left.capturedAt));
  return candidates[0]?.value || null;
}

const bernstein3 = t => {
  const inverse = 1 - t;
  return [inverse ** 3, 3 * t * inverse ** 2, 3 * t ** 2 * inverse, t ** 3];
};

/** Evaluate the 2D bicubic interpolation at density² review points. */
export function generateTattooMesh(controlPoints, density = TATTOO_MESH_DEFAULT_DENSITY) {
  if (!Array.isArray(controlPoints) || controlPoints.length !== TATTOO_CONTROL_POINT_COUNT
      || controlPoints.some(point => !finite(point?.x) || !finite(point?.y))) return [];
  const normalized = controlPoints.map((point, index) => normalizePoint(point, index, point.source));
  const size = clampTattooMeshDensity(density);
  const mesh = [];
  for (let row = 0; row < size; row++) {
    const v = row / (size - 1);
    const by = bernstein3(v);
    for (let column = 0; column < size; column++) {
      const u = column / (size - 1);
      const bx = bernstein3(u);
      let x = 0;
      let y = 0;
      for (let controlRow = 0; controlRow < TATTOO_CONTROL_GRID_SIZE; controlRow++) {
        for (let controlColumn = 0; controlColumn < TATTOO_CONTROL_GRID_SIZE; controlColumn++) {
          const weight = by[controlRow] * bx[controlColumn];
          const point = normalized[controlRow * TATTOO_CONTROL_GRID_SIZE + controlColumn];
          x += point.x * weight;
          y += point.y * weight;
        }
      }
      mesh.push({
        index: mesh.length, row, column,
        u: rounded(u), v: rounded(v),
        x: rounded(clamp(x)), y: rounded(clamp(y))
      });
    }
  }
  return mesh;
}

export function defaultTattooMap() {
  return {
    schema: TATTOO_MAPPING_SCHEMA,
    mapId: '',
    packId: '',
    targetAssetId: '',
    sourcePackId: null,
    subjectRef: '',
    enabled: false,
    region: 'upper-torso',
    method: 'manual',
    meshDensity: TATTOO_MESH_DEFAULT_DENSITY,
    controlPoints: [],
    selectedAnchor: 0,
    authorization: null,
    artworkReference: '',
    notes: '',
    localOnly: true,
    networkUpload: false,
    identityInference: false,
    artworkBakedIntoImage: false,
    updatedAt: ''
  };
}

export function sanitizeTattooMap(value) {
  const raw = value && typeof value === 'object' ? value : {};
  if (raw.schema !== TATTOO_MAPPING_SCHEMA) return defaultTattooMap();
  const source = MAPPING_METHODS.has(raw.method) ? raw.method : 'manual';
  const authorization = raw.authorization && typeof raw.authorization === 'object'
    ? {
      receiptSchema: boundedText(raw.authorization.receiptSchema, 100),
      consentId: boundedText(raw.authorization.consentId, 160),
      noticeSha256: boundedText(raw.authorization.noticeSha256, 64),
      specificPurpose: boundedText(raw.authorization.specificPurpose, 100),
      algorithmId: boundedText(raw.authorization.algorithmId, 160),
      algorithmSha256: boundedText(raw.authorization.algorithmSha256, 64),
      localExpiresAt: boundedText(raw.authorization.localExpiresAt, 40)
    }
    : null;
  const bindingValid = SAFE_ID.test(String(raw.mapId || ''))
    && SAFE_ID.test(String(raw.packId || ''))
    && SAFE_ID.test(String(raw.targetAssetId || ''))
    && SAFE_ID.test(String(raw.subjectRef || ''))
    && (!raw.sourcePackId || SAFE_ID.test(String(raw.sourcePackId)))
    && authorization?.receiptSchema === PERSONAL_GEOMETRY_CONSENT_SCHEMA
    && SAFE_ID.test(authorization?.consentId || '')
    && authorization?.noticeSha256 === PERSONAL_GEOMETRY_NOTICE_SHA256
    && authorization?.specificPurpose === PERSONAL_GEOMETRY_PURPOSES.tattooPlacement
    && authorization?.algorithmId === TATTOO_PLACEMENT_ALGORITHM_ID
    && authorization?.algorithmSha256 === TATTOO_PLACEMENT_ALGORITHM_SHA256
    && isIsoDate(authorization?.localExpiresAt);
  const points = Array.isArray(raw.controlPoints) && raw.controlPoints.length === TATTOO_CONTROL_POINT_COUNT
    && raw.controlPoints.every(point => finite(point?.x) && finite(point?.y))
    && bindingValid
    ? raw.controlPoints.map((point, index) => normalizePoint(point, index, source))
    : [];
  return {
    ...defaultTattooMap(),
    mapId: bindingValid ? String(raw.mapId) : '',
    packId: bindingValid ? String(raw.packId) : '',
    targetAssetId: bindingValid ? String(raw.targetAssetId) : '',
    sourcePackId: bindingValid && raw.sourcePackId ? String(raw.sourcePackId) : null,
    subjectRef: bindingValid ? String(raw.subjectRef) : '',
    enabled: raw.enabled === true && points.length === TATTOO_CONTROL_POINT_COUNT,
    region: REGION_IDS.has(raw.region) ? raw.region : 'custom',
    method: source,
    meshDensity: clampTattooMeshDensity(raw.meshDensity),
    controlPoints: points,
    selectedAnchor: Math.min(TATTOO_CONTROL_POINT_COUNT - 1, Math.max(0, Math.trunc(Number(raw.selectedAnchor) || 0))),
    authorization: bindingValid ? authorization : null,
    artworkReference: boundedText(raw.artworkReference, 180),
    notes: boundedText(raw.notes, 1000),
    updatedAt: boundedText(raw.updatedAt, 40)
  };
}

export function createTattooPlacementMap({
  mapId,
  targetAssetId,
  consentReceipt,
  sourcePackRecord = null,
  controlPoints,
  region = 'upper-torso',
  method = sourcePackRecord ? 'local-pose-preset' : 'manual',
  meshDensity = TATTOO_MESH_DEFAULT_DENSITY,
  artworkReference = '',
  notes = '',
  now = Date.now()
} = {}) {
  const consent = tattooPlacementConsentState(consentReceipt, { targetAssetId, sourcePackRecord, now });
  if (!consent.allowed) {
    throw new TypeError(`Tattoo placement consent blocked: ${consent.blockers.join(', ')}`);
  }
  const algorithm = authorizedAlgorithm(consentReceipt);
  const map = sanitizeTattooMap({
    schema: TATTOO_MAPPING_SCHEMA,
    mapId,
    packId: consentReceipt.pack_id,
    targetAssetId,
    sourcePackId: consentReceipt.source_pack_id || null,
    subjectRef: consentReceipt.subject_ref,
    enabled: true,
    region,
    method,
    meshDensity,
    controlPoints,
    selectedAnchor: 0,
    authorization: {
      receiptSchema: consentReceipt.schema,
      consentId: consentReceipt.consent_id,
      noticeSha256: consentReceipt.notice_sha256,
      specificPurpose: consentReceipt.specific_purpose,
      algorithmId: algorithm.algorithm_id,
      algorithmSha256: algorithm.sha256,
      localExpiresAt: consentReceipt.local_expires_at
    },
    artworkReference,
    notes,
    updatedAt: new Date(now).toISOString()
  });
  const validation = validateTattooPlacementMap(map, {
    consentReceipt, targetAssetId, sourcePackRecord, now
  });
  if (!validation.valid) {
    throw new TypeError(`Tattoo placement map blocked: ${validation.findings.join(', ')}`);
  }
  return Object.freeze(map);
}

export function validateTattooPlacementMap(value, {
  consentReceipt,
  targetAssetId = value?.targetAssetId,
  sourcePackRecord = null,
  now = Date.now()
} = {}) {
  const map = sanitizeTattooMap(value);
  const findings = [];
  const consent = tattooPlacementConsentState(consentReceipt, { targetAssetId, sourcePackRecord, now });
  findings.push(...consent.blockers);
  if (map.schema !== TATTOO_MAPPING_SCHEMA || !map.mapId || !map.packId || !map.targetAssetId) {
    findings.push('tattoo_map_shape_invalid');
  }
  if (map.packId !== consentReceipt?.pack_id
      || map.targetAssetId !== targetAssetId
      || map.subjectRef !== consentReceipt?.subject_ref
      || map.sourcePackId !== (consentReceipt?.source_pack_id || null)) {
    findings.push('tattoo_map_receipt_binding_mismatch');
  }
  if (map.authorization?.consentId !== consentReceipt?.consent_id
      || map.authorization?.noticeSha256 !== consentReceipt?.notice_sha256
      || map.authorization?.localExpiresAt !== consentReceipt?.local_expires_at) {
    findings.push('tattoo_map_authorization_binding_mismatch');
  }
  if (map.controlPoints.length !== TATTOO_CONTROL_POINT_COUNT) findings.push('tattoo_control_lattice_incomplete');
  if (map.localOnly !== true || map.networkUpload !== false || map.identityInference !== false) {
    findings.push('tattoo_local_only_policy_invalid');
  }
  return Object.freeze({ valid: findings.length === 0, findings: [...new Set(findings)], map });
}

/** Return the ordinary-store view; the sensitive map never crosses this API. */
export function tattooSafeOrdinaryAssetView(asset) {
  const clone = structuredClone(asset);
  if (!clone || typeof clone !== 'object') return clone;
  for (const key of ['tattooMap', 'tattooMapRef', 'tattooMapping', 'tattooPlacement', 'tattooSummary']) {
    delete clone[key];
  }
  if (clone.edit && typeof clone.edit === 'object') {
    for (const key of ['tattooMap', 'tattooMapRef', 'tattooMapping', 'tattooPlacement', 'tattooSummary']) {
      delete clone.edit[key];
    }
  }
  // Older builds wrote tattoo placement activity into the ordinary asset audit
  // trail. Remove those semantic traces as well as the coordinate fields. The
  // current mapping UI does not create ordinary audit entries.
  if (Array.isArray(clone.log)) {
    clone.log = clone.log.filter(entry => !/tattoo/i.test(String(entry?.what || '')));
  }
  return clone;
}
