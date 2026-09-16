// Local-first Personal Geometry Pack contract.
//
// This module packages normalized reference-view landmark observations and
// records their capability limits. Every record produced here is
// biometric-sensitive even when it contains no name, photograph, or reusable
// identity embedding.

import {
  HUMAN_GEOMETRY_SCHEMA,
  NORMALIZED_IMAGE_COORDINATES,
  NORMALIZED_REFERENCE_VIEW_SCOPE
} from './human-geometry.js';
import {
  PERSONAL_GEOMETRY_CONSENT_SCHEMA,
  PERSONAL_GEOMETRY_PURPOSES,
  PERSONAL_GEOMETRY_RETENTION_POLICY_ID,
  personalGeometryConsentState
} from './personal-geometry-consent.js';
import {
  PERSON_GEOMETRY_OBSERVATION_ALGORITHM_ID,
  PERSON_GEOMETRY_OBSERVATION_MANIFEST_SHA256
} from './geometry.js';

export const PERSONAL_GEOMETRY_PACK_SCHEMA = 'materiallogix.personal-geometry-pack.v1';
export const BIOMETRIC_SENSITIVITY = 'biometric-sensitive';

const CAPTURE_MODES = new Set(['face', 'body', 'combined']);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PACK_INPUT_FIELDS = new Set([
  'packId', 'revision', 'captureMode', 'frames', 'consentReceipt',
  'retentionPolicyId', 'createdAt', 'now'
]);

const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const cleanString = (value, max = 160) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const isIsoDate = value => typeof value === 'string'
  && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;
const deepFreeze = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
};

function requireActiveConsentReceipt(receipt, { packId, retentionPolicyId, now }) {
  if (receipt?.schema !== PERSONAL_GEOMETRY_CONSENT_SCHEMA) {
    throw new TypeError('An evaluated Personal Geometry Pack consent receipt is required.');
  }
  const state = personalGeometryConsentState(receipt, { now });
  if (!state.allowed) {
    throw new TypeError(`Personal Geometry Pack consent blocked: ${state.blockers.join(', ')}`);
  }
  if (receipt.status !== 'active') throw new TypeError('The Personal Geometry Pack consent receipt is not active.');
  if (receipt.pack_id !== packId) throw new TypeError('The consent receipt does not authorize this pack.');
  if (receipt.specific_purpose !== PERSONAL_GEOMETRY_PURPOSES.multiviewGeometryPack) {
    throw new TypeError('The consent receipt does not authorize a multi-view Personal Geometry Pack.');
  }
  if (!(receipt.algorithm_ids_and_digests || []).some(item =>
    item.algorithm_id === PERSON_GEOMETRY_OBSERVATION_ALGORITHM_ID
    && item.sha256 === PERSON_GEOMETRY_OBSERVATION_MANIFEST_SHA256)) {
    throw new TypeError('The consent receipt does not authorize the exact local observation engine manifest.');
  }
  if (retentionPolicyId !== receipt.local_retention_policy_id
      || retentionPolicyId !== PERSONAL_GEOMETRY_RETENTION_POLICY_ID) {
    throw new TypeError('The Pack retention policy must match the active consent receipt.');
  }
  return receipt;
}

function point(point = {}) {
  const x = finite(point.x), y = finite(point.y), z = finite(point.z);
  if (x === null || y === null || x < 0 || x > 1 || y < 0 || y > 1) return null;
  return {
    ...(cleanString(point.code, 80) ? { code: cleanString(point.code, 80) } : {}),
    x, y, z,
    ...(finite(point.visibility) !== null ? { visibility: finite(point.visibility) } : {}),
    ...(finite(point.presence) !== null ? { presence: finite(point.presence) } : {})
  };
}

function points(values = []) {
  if (!Array.isArray(values)) return [];
  return values.slice(0, 2048).map(point).filter(Boolean);
}

function frameInput(value, index, { captureMode, coreCategories }) {
  const geometry = value?.geometry || value;
  const id = SAFE_ID.test(String(value?.id || '')) ? String(value.id) : `view-${index + 1}`;
  const includeFace = (captureMode === 'face' || captureMode === 'combined')
    && coreCategories.has('face_geometry');
  const includeBody = (captureMode === 'body' || captureMode === 'combined')
    && (coreCategories.has('body_geometry') || coreCategories.has('pose_geometry'));
  const includeHands = (captureMode === 'body' || captureMode === 'combined')
    && coreCategories.has('hand_geometry');
  const face = includeFace ? geometry?.faces?.[0] : null;
  const pose = includeBody ? geometry?.poses?.[0] : null;
  const hands = includeHands && Array.isArray(geometry?.hands) ? geometry.hands.map(hand => ({
    side: cleanString(hand?.side, 24) || null,
    landmarks: points(hand?.landmarks)
  })) : [];
  const faceLandmarks = points(face?.landmarks);
  const bodyLandmarks = points(pose?.landmarks);
  const issues = [];
  if (geometry?.schema !== HUMAN_GEOMETRY_SCHEMA) issues.push('unsupported_human_geometry_schema');
  if (geometry?.coordinateSystem !== NORMALIZED_IMAGE_COORDINATES) {
    issues.push('unsupported_geometry_coordinate_system');
  }
  if (geometry?.privacy?.containsBiometricGeometry !== true) issues.push('biometric_classification_missing');
  if ((geometry?.faces?.length || 0) > 1 || (geometry?.poses?.length || 0) > 1) {
    issues.push('multiple_subjects_detected');
  }
  if (face && (faceLandmarks.length < 468 || faceLandmarks.slice(0, 468).some(item => !item))) {
    issues.push('face_topology_incomplete');
  }
  if (pose && (bodyLandmarks.length < 33 || bodyLandmarks.slice(0, 33).some(item => !item))) {
    issues.push('body_topology_incomplete');
  }
  if (hands.some(hand => hand.landmarks.length !== 21)) issues.push('hand_topology_incomplete');
  if (geometry?.assurance?.status !== 'complete') issues.push('source_geometry_assurance_blocked');
  const yawDeg = finite(value?.yawDeg ?? value?.view?.yawDeg);
  const pitchDeg = finite(value?.pitchDeg ?? value?.view?.pitchDeg);
  return {
    id,
    capturedAt: isIsoDate(value?.capturedAt) ? value.capturedAt : (isIsoDate(geometry?.at) ? geometry.at : null),
    view: {
      yawDeg: yawDeg === null ? null : Math.max(-180, Math.min(360, yawDeg)),
      pitchDeg: pitchDeg === null ? null : Math.max(-90, Math.min(90, pitchDeg)),
      measured: yawDeg !== null || pitchDeg !== null
    },
    coordinateSystem: cleanString(geometry?.coordinateSystem, 120),
    inference: {
      engine: cleanString(geometry?.inference?.engine, 80),
      version: cleanString(geometry?.inference?.version, 80),
      execution: cleanString(geometry?.inference?.execution, 80)
    },
    face: face ? {
      landmarks: faceLandmarks,
      coordinateScope: NORMALIZED_REFERENCE_VIEW_SCOPE,
      depthScope: 'camera-relative-normalized-only'
    } : null,
    body: pose ? {
      landmarks: bodyLandmarks,
      coordinateScope: NORMALIZED_REFERENCE_VIEW_SCOPE,
      depthScope: 'camera-relative-normalized-only'
    } : null,
    hands: hands.map(hand => ({
      ...hand,
      coordinateScope: NORMALIZED_REFERENCE_VIEW_SCOPE,
      depthScope: 'camera-relative-normalized-only'
    })),
    issues: [...new Set(issues)]
  };
}

function angleCoverage(referenceViews, mode) {
  const yaws = referenceViews
    .filter(view => mode === 'face' ? view.face : view.body)
    .map(view => view.view.yawDeg).filter(value => value !== null);
  if (yaws.length < 3) return { status: 'unverified', measuredViews: yaws.length, spreadDeg: null };
  const spreadDeg = Math.max(...yaws) - Math.min(...yaws);
  const recommended = mode === 'face' ? 120 : 300;
  return { status: spreadDeg >= recommended ? 'good' : 'partial', measuredViews: yaws.length, spreadDeg };
}

function requireAuthorizedCoreScopes(receipt, captureMode) {
  const categories = new Set(receipt.core_categories || []);
  const needsFace = captureMode === 'face' || captureMode === 'combined';
  const needsBody = captureMode === 'body' || captureMode === 'combined';
  if (needsFace && !categories.has('face_geometry')) {
    throw new TypeError('The consent receipt does not authorize face geometry.');
  }
  if (needsBody && !categories.has('body_geometry') && !categories.has('pose_geometry')) {
    throw new TypeError('The consent receipt does not authorize body or pose geometry.');
  }
}

function consentBinding(receipt) {
  return {
    receiptSchema: receipt.schema,
    consentId: receipt.consent_id,
    subjectRef: receipt.subject_ref,
    noticeVersion: receipt.notice_version,
    noticeSha256: receipt.notice_sha256,
    specificPurpose: receipt.specific_purpose,
    processingMode: receipt.processing_mode,
    retentionPolicyId: receipt.local_retention_policy_id,
    localExpiresAt: receipt.local_expires_at,
    coreCategories: [...receipt.core_categories],
    optionalLayers: { ...receipt.optional_layers },
    algorithmManifest: receipt.algorithm_ids_and_digests.map(item => ({ ...item }))
  };
}

export function buildPersonalGeometryPack(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Personal Geometry Pack input must be an object.');
  }
  const unsupportedFields = Object.keys(input).filter(key => !PACK_INPUT_FIELDS.has(key));
  if (unsupportedFields.length) {
    throw new TypeError(`Unsupported Personal Geometry Pack input: ${unsupportedFields.join(', ')}.`);
  }
  const {
    packId, revision = 1, captureMode = 'combined', frames = [], consentReceipt,
    retentionPolicyId, createdAt, now = Date.now()
  } = input;
  if (!SAFE_ID.test(String(packId || ''))) throw new TypeError('A safe local packId is required.');
  if (!CAPTURE_MODES.has(captureMode)) throw new TypeError('captureMode must be face, body, or combined.');
  if (!Number.isSafeInteger(revision) || revision < 1) throw new TypeError('revision must be a positive integer.');
  if (!Array.isArray(frames) || frames.length < 1) throw new TypeError('At least one geometry frame is required.');
  if (!SAFE_ID.test(String(retentionPolicyId || ''))) throw new TypeError('A versioned retentionPolicyId is required.');
  const activeReceipt = requireActiveConsentReceipt(consentReceipt, { packId, retentionPolicyId, now });
  requireAuthorizedCoreScopes(activeReceipt, captureMode);
  const coreCategories = new Set(activeReceipt.core_categories);
  const referenceViews = frames.slice(0, 64)
    .map((frame, index) => frameInput(frame, index, { captureMode, coreCategories }));
  const faceViews = referenceViews.filter(view => view.face).length;
  const bodyViews = referenceViews.filter(view => view.body).length;
  const handViews = referenceViews.filter(view => view.hands.length).length;
  const blockers = referenceViews.flatMap(view => view.issues.map(issue => `${view.id}:${issue}`));
  if ((captureMode === 'face' || captureMode === 'combined') && faceViews < 3) blockers.push('face:at_least_three_views_required');
  if ((captureMode === 'body' || captureMode === 'combined') && bodyViews < 3) blockers.push('body:at_least_three_views_required');
  const warnings = [];
  const faceCoverage = angleCoverage(referenceViews, 'face');
  const bodyCoverage = angleCoverage(referenceViews, 'body');
  if ((captureMode === 'face' || captureMode === 'combined') && faceCoverage.status !== 'good') {
    warnings.push('face_angle_coverage_not_verified');
  }
  if ((captureMode === 'body' || captureMode === 'combined') && bodyCoverage.status !== 'good') {
    warnings.push('body_angle_coverage_not_verified');
  }
  const pack = {
    schema: PERSONAL_GEOMETRY_PACK_SCHEMA,
    packId: String(packId),
    revision,
    createdAt: isIsoDate(createdAt) ? createdAt : new Date(now).toISOString(),
    captureMode,
    classification: BIOMETRIC_SENSITIVITY,
    authorization: consentBinding(activeReceipt),
    policy: {
      retentionPolicyId: String(retentionPolicyId),
      storage: 'local-owner-controlled',
      rawMediaIncluded: false,
      restrictions: {
        identifyOrSearchForPerson: false,
        crossSubjectMatching: false,
        modelTraining: false,
        saleOrSharing: false,
        diagnosticsOrAnalytics: false,
        remoteTransferByDefault: false
      }
    },
    canonical: {
      sourceSchema: HUMAN_GEOMETRY_SCHEMA,
      representation: 'multiview-normalized-reference-landmarks',
      identityVerified: false,
      coordinateScope: 'normalized-reference-views-only',
      faceDepthScope: 'camera-relative-normalized-only',
      bodyDepthScope: 'camera-relative-normalized-only',
      referenceViews
    },
    capabilities: {
      faceReferenceViews: faceViews,
      bodyReferenceViews: bodyViews,
      handReferenceViews: handViews,
      faceAngleCoverage: faceCoverage,
      bodyAngleCoverage: bodyCoverage,
      normalizedLandmarkConditioningReady: blockers.length === 0,
      identityEmbeddingIncluded: false,
      crossViewPhysicalScaleAvailable: false,
      bodyDimensionsAvailable: false
    },
    assurance: {
      status: blockers.length ? 'blocked' : (warnings.length ? 'limited' : 'ready'),
      blockers: [...new Set(blockers)],
      warnings: [...new Set(warnings)],
      limitation: 'Only normalized landmarks from separate reference views are retained; physical dimensions and cross-view scale are not established.'
    }
  };
  return deepFreeze(pack);
}

export function validatePersonalGeometryPack(pack, { consentReceipt, now = Date.now() } = {}) {
  const findings = [];
  const expectedTopFields = new Set([
    'schema', 'packId', 'revision', 'createdAt', 'captureMode', 'classification',
    'authorization', 'policy', 'canonical', 'capabilities', 'assurance'
  ]);
  const expectedCanonicalFields = new Set([
    'sourceSchema', 'representation', 'identityVerified', 'coordinateScope',
    'faceDepthScope', 'bodyDepthScope', 'referenceViews'
  ]);
  const expectedViewFields = new Set([
    'id', 'capturedAt', 'view', 'coordinateSystem', 'inference',
    'face', 'body', 'hands', 'issues'
  ]);
  const expectedLandmarkRecordFields = new Set(['landmarks', 'coordinateScope', 'depthScope']);
  const expectedHandRecordFields = new Set(['side', ...expectedLandmarkRecordFields]);
  const expectedCapabilityFields = new Set([
    'faceReferenceViews', 'bodyReferenceViews', 'handReferenceViews',
    'faceAngleCoverage', 'bodyAngleCoverage', 'normalizedLandmarkConditioningReady',
    'identityEmbeddingIncluded', 'crossViewPhysicalScaleAvailable', 'bodyDimensionsAvailable'
  ]);
  const unsupportedTopFields = Object.keys(pack || {}).filter(key => !expectedTopFields.has(key));
  if (unsupportedTopFields.length) findings.push('unsupported_pack_payload');
  if (pack?.schema !== PERSONAL_GEOMETRY_PACK_SCHEMA) findings.push('unsupported_pack_schema');
  if (pack?.classification !== BIOMETRIC_SENSITIVITY) findings.push('biometric_classification_missing');
  if (pack?.policy?.rawMediaIncluded !== false) findings.push('raw_media_must_not_be_in_geometry_pack');
  if (pack?.policy?.storage !== 'local-owner-controlled') findings.push('local_owner_control_required');
  if (pack?.policy?.restrictions?.modelTraining !== false) findings.push('model_training_must_be_disabled');
  if (pack?.canonical?.identityVerified !== false) findings.push('identity_verification_claim_forbidden');
  if (pack?.canonical?.sourceSchema !== HUMAN_GEOMETRY_SCHEMA) findings.push('unsupported_source_schema');
  if (pack?.canonical?.representation !== 'multiview-normalized-reference-landmarks') {
    findings.push('unsupported_canonical_representation');
  }
  if (Object.keys(pack?.canonical || {}).some(key => !expectedCanonicalFields.has(key))) {
    findings.push('unsupported_canonical_field');
  }
  if (pack?.canonical?.coordinateScope !== 'normalized-reference-views-only') {
    findings.push('unsupported_coordinate_scope');
  }
  if (pack?.canonical?.faceDepthScope !== 'camera-relative-normalized-only') {
    findings.push('unsupported_face_depth_claim');
  }
  if (pack?.canonical?.bodyDepthScope !== 'camera-relative-normalized-only') {
    findings.push('unsupported_body_depth_claim');
  }
  if (!Array.isArray(pack?.canonical?.referenceViews)) findings.push('reference_views_required');
  for (const view of pack?.canonical?.referenceViews || []) {
    if (Object.keys(view || {}).some(key => !expectedViewFields.has(key))) {
      findings.push(`reference_view:${view?.id || 'unknown'}:unsupported_field`);
    }
    if (view?.coordinateSystem !== NORMALIZED_IMAGE_COORDINATES) {
      findings.push(`reference_view:${view?.id || 'unknown'}:unsupported_coordinate_system`);
    }
    if (view?.face && (view.face.coordinateScope !== NORMALIZED_REFERENCE_VIEW_SCOPE
        || view.face.depthScope !== 'camera-relative-normalized-only')) {
      findings.push(`reference_view:${view?.id || 'unknown'}:unsupported_face_depth_claim`);
    }
    if (view?.body && (view.body.coordinateScope !== NORMALIZED_REFERENCE_VIEW_SCOPE
        || view.body.depthScope !== 'camera-relative-normalized-only')) {
      findings.push(`reference_view:${view?.id || 'unknown'}:unsupported_body_depth_claim`);
    }
    const hands = Array.isArray(view?.hands) ? view.hands : [];
    if (!Array.isArray(view?.hands)) findings.push(`reference_view:${view?.id || 'unknown'}:hands_invalid`);
    for (const record of [view?.face, view?.body, ...hands].filter(Boolean)) {
      const expectedFields = hands.includes(record)
        ? expectedHandRecordFields : expectedLandmarkRecordFields;
      if (Object.keys(record).some(key => !expectedFields.has(key))) {
        findings.push(`reference_view:${view?.id || 'unknown'}:unsupported_landmark_field`);
      }
      if (record.coordinateScope !== NORMALIZED_REFERENCE_VIEW_SCOPE
          || record.depthScope !== 'camera-relative-normalized-only') {
        findings.push(`reference_view:${view?.id || 'unknown'}:unsupported_landmark_scope`);
      }
      if (!Array.isArray(record.landmarks) || record.landmarks.some(item =>
        finite(item?.x) === null || finite(item?.y) === null
        || item.x < 0 || item.x > 1 || item.y < 0 || item.y > 1)) {
        findings.push(`reference_view:${view?.id || 'unknown'}:non_normalized_landmark`);
      }
    }
    if (view?.face && view.face.landmarks?.length !== 468) {
      findings.push(`reference_view:${view?.id || 'unknown'}:face_topology_incomplete`);
    }
    if (view?.body && view.body.landmarks?.length !== 33) {
      findings.push(`reference_view:${view?.id || 'unknown'}:body_topology_incomplete`);
    }
    if (hands.some(hand => hand.landmarks?.length !== 21)) {
      findings.push(`reference_view:${view?.id || 'unknown'}:hand_topology_incomplete`);
    }
  }
  if (Object.keys(pack?.capabilities || {}).some(key => !expectedCapabilityFields.has(key))) {
    findings.push('unsupported_capability_field');
  }
  if (pack?.capabilities?.crossViewPhysicalScaleAvailable !== false
      || pack?.capabilities?.bodyDimensionsAvailable !== false) {
    findings.push('unsupported_scale_capability_claim');
  }
  try {
    requireActiveConsentReceipt(consentReceipt, {
      packId: pack?.packId,
      retentionPolicyId: pack?.policy?.retentionPolicyId,
      now
    });
  } catch (error) {
    findings.push(`consent:${error.message}`);
  }
  const binding = pack?.authorization;
  if (binding?.receiptSchema !== PERSONAL_GEOMETRY_CONSENT_SCHEMA
      || binding?.consentId !== consentReceipt?.consent_id
      || binding?.subjectRef !== consentReceipt?.subject_ref
      || binding?.processingMode !== 'local_only'
      || binding?.retentionPolicyId !== consentReceipt?.local_retention_policy_id
      || binding?.localExpiresAt !== consentReceipt?.local_expires_at
      || binding?.noticeSha256 !== consentReceipt?.notice_sha256) {
    findings.push('consent_receipt_binding_mismatch');
  }
  try {
    requireAuthorizedCoreScopes(consentReceipt || {}, pack?.captureMode);
  } catch (error) {
    findings.push(`consent_scope:${error.message}`);
  }
  if (pack?.assurance?.blockers?.length) findings.push(...pack.assurance.blockers);
  return { valid: findings.length === 0, findings: [...new Set(findings)] };
}
