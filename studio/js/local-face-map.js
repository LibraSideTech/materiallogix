// Consent-gated, local relative face mapping.
//
// The output is a 468-point face-relative landmark map. It is useful render
// conditioning, but it is not a calibrated surface reconstruction, metric
// scan, digital twin, identity proof, texture map, or back-of-head model.

import { HUMAN_GEOMETRY_SCHEMA } from './human-geometry.js';
import {
  PERSONAL_GEOMETRY_CONSENT_SCHEMA,
  PERSONAL_GEOMETRY_PURPOSES,
  personalGeometryConsentState
} from './personal-geometry-consent.js';
import {
  PERSON_GEOMETRY_OBSERVATION_ALGORITHM_ID,
  PERSON_GEOMETRY_OBSERVATION_MANIFEST_SHA256
} from './geometry.js';

export const LOCAL_FACE_MAP_SCHEMA = 'materiallogix.local-face-map.v1';
export const LOCAL_FACE_MAP_ALGORITHM_ID = 'materiallogix.local-face-map.relative468.v1';
export const LOCAL_FACE_MAP_POINT_COUNT = 468;
export const LOCAL_FACE_MAP_ALGORITHM_MANIFEST_TEXT = [
  'schema=materiallogix.local-face-map-algorithm-manifest.v1',
  'implementation=js/local-face-map.js@relative468-2026-09-04',
  'input=materiallogix.human-geometry.v2:one-consenting-face',
  'single-view=centroid-and-rms-radius-normalized-468xyz',
  'multiview=yaw-inverse-alignment,median-mad-outlier-rejection,confidence-weighted-fusion',
  'quality=leave-one-view-out-normalized-rigid-consistency',
  'coordinates=relative-non-metric-camera-depth',
  'surface-mesh=false',
  'back-of-head=false',
  'identity-verification=false',
  'execution=local-only',
  'remote-export=false',
  'training=false'
].join('\n');
export const LOCAL_FACE_MAP_ALGORITHM_SHA256 = '4c0b36feb6d10fa9bcc3f3ea3af37babfcc88cafb554e7931af723a6692505a2';
export const LOCAL_FACE_MAP_ALGORITHM_MANIFEST = Object.freeze({
  algorithm_id: LOCAL_FACE_MAP_ALGORITHM_ID,
  sha256: LOCAL_FACE_MAP_ALGORITHM_SHA256
});

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const PROHIBITED_CLAIMS = Object.freeze([
  '3d-scan',
  'calibrated-3d-reconstruction',
  'metric-face-model',
  'surface-mesh',
  'digital-twin',
  'complete-head-model',
  'back-of-head-coverage',
  'identity-verified'
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
const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const rounded = (value, places = 7) => finite(value) === null ? null : +value.toFixed(places);

function requireNoAppearancePayload(appearance, presentation) {
  if (appearance !== undefined || presentation !== undefined) {
    throw new TypeError('Appearance layers and presentation deltas must remain in their separately consented Pack records.');
  }
}

function requireActiveReceipt(receipt, { packId, now, purpose }) {
  if (receipt?.schema !== PERSONAL_GEOMETRY_CONSENT_SCHEMA) {
    throw new TypeError('An evaluated Personal Geometry Pack consent receipt is required before face mapping.');
  }
  const state = personalGeometryConsentState(receipt, { now });
  if (!state.allowed) throw new TypeError(`Face mapping consent blocked: ${state.blockers.join(', ')}`);
  if (receipt.status !== 'active') throw new TypeError('Face mapping consent is not active.');
  if (receipt.pack_id !== packId) throw new TypeError('The consent receipt does not authorize this Pack.');
  if (!(receipt.core_categories || []).includes('face_geometry')) {
    throw new TypeError('The consent receipt does not authorize face geometry.');
  }
  if (receipt.specific_purpose !== purpose) {
    throw new TypeError(`The consent receipt does not authorize the ${purpose} operation.`);
  }
  const algorithms = receipt.algorithm_ids_and_digests || [];
  const observationAlgorithm = algorithms.find(item =>
    item.algorithm_id === PERSON_GEOMETRY_OBSERVATION_ALGORITHM_ID
    && item.sha256 === PERSON_GEOMETRY_OBSERVATION_MANIFEST_SHA256);
  if (!observationAlgorithm) {
    throw new TypeError('The consent receipt does not authorize the exact local observation engine manifest.');
  }
  const algorithm = algorithms.find(item =>
    item.algorithm_id === LOCAL_FACE_MAP_ALGORITHM_MANIFEST.algorithm_id
    && item.sha256 === LOCAL_FACE_MAP_ALGORITHM_MANIFEST.sha256);
  if (!algorithm) throw new TypeError('The consent receipt does not authorize this face-map algorithm and digest.');
  return algorithm;
}

function consentBinding(receipt, algorithm) {
  return {
    receiptSchema: receipt.schema,
    consentId: receipt.consent_id,
    packId: receipt.pack_id,
    noticeVersion: receipt.notice_version,
    noticeSha256: receipt.notice_sha256,
    purpose: receipt.specific_purpose,
    processingMode: receipt.processing_mode,
    retentionPolicyId: receipt.local_retention_policy_id,
    localExpiresAt: receipt.local_expires_at,
    algorithm: { id: algorithm.algorithm_id, sha256: algorithm.sha256 }
  };
}

function transformationMatrix(value) {
  if (value === null || value === undefined) return null;
  const source = Array.isArray(value) ? value : (Array.isArray(value?.data) ? value.data : null);
  const flat = source?.flat(Infinity);
  if (!flat || flat.length !== 16 || flat.some(item => finite(item) === null)) {
    throw new TypeError('Face transformation evidence must be a finite 4x4 matrix when supplied.');
  }
  return flat.map(item => rounded(item, 9));
}

function pointConfidence(point, faceScore) {
  for (const value of [point?.presence, point?.visibility, faceScore]) {
    const number = finite(value);
    if (number !== null) return Math.max(0, Math.min(1, number));
  }
  return null;
}

function relativePointCloud(landmarks, faceScore) {
  const source = landmarks.slice(0, LOCAL_FACE_MAP_POINT_COUNT).map((landmark, index) => {
    const x = finite(landmark?.x), y = finite(landmark?.y), z = finite(landmark?.z);
    if (x === null || y === null || z === null) {
      throw new TypeError(`Face topology is incomplete at landmark ${index}; x, y, and z are required.`);
    }
    return { index, x, y, z, confidence: pointConfidence(landmark, faceScore) };
  });
  const center = {
    x: average(source.map(point => point.x)),
    y: average(source.map(point => point.y)),
    z: average(source.map(point => point.z))
  };
  const radius = Math.sqrt(average(source.map(point =>
    (point.x - center.x) ** 2 + (point.y - center.y) ** 2 + (point.z - center.z) ** 2
  )));
  if (!Number.isFinite(radius) || radius < 1e-6) throw new TypeError('Face landmark scale is degenerate.');
  return {
    center: { x: rounded(center.x), y: rounded(center.y), z: rounded(center.z) },
    sourceRmsRadius: rounded(radius),
    points: source.map(point => ({
      index: point.index,
      x: rounded((point.x - center.x) / radius),
      y: rounded((point.y - center.y) / radius),
      z: rounded((point.z - center.z) / radius),
      confidence: point.confidence === null ? null : rounded(point.confidence, 4)
    }))
  };
}

function extractObservation(input, index, { yawRequired }) {
  const geometry = input?.geometry || input;
  if (geometry?.schema !== HUMAN_GEOMETRY_SCHEMA) {
    throw new TypeError(`Observation ${index + 1} is not ${HUMAN_GEOMETRY_SCHEMA}.`);
  }
  if (geometry?.privacy?.containsBiometricGeometry !== true) {
    throw new TypeError(`Observation ${index + 1} is missing biometric-sensitive classification.`);
  }
  if (geometry?.privacy?.identityVerified === true) {
    throw new TypeError(`Observation ${index + 1} contains a forbidden identity-verification claim.`);
  }
  if (geometry?.assurance?.status !== 'complete') {
    throw new TypeError(`Observation ${index + 1} has blocked source geometry assurance.`);
  }
  if ((geometry?.faces?.length || 0) !== 1) {
    throw new TypeError(`Observation ${index + 1} must contain exactly one consenting subject face.`);
  }
  const face = geometry.faces[0];
  if (!Array.isArray(face?.landmarks) || face.landmarks.length < LOCAL_FACE_MAP_POINT_COUNT) {
    throw new TypeError(`Observation ${index + 1} requires the complete 468-point face topology.`);
  }
  const yawDeg = finite(input?.yawDeg ?? input?.view?.yawDeg);
  if (yawRequired && (yawDeg === null || yawDeg < -95 || yawDeg > 95)) {
    throw new TypeError(`Observation ${index + 1} requires a yaw tag between -95 and 95 degrees.`);
  }
  const cloud = relativePointCloud(face.landmarks, face.score);
  const matrix = transformationMatrix(face.transformationMatrix);
  const confidences = cloud.points.map(point => point.confidence).filter(value => value !== null);
  const inFrameCount = face.landmarks.slice(0, LOCAL_FACE_MAP_POINT_COUNT)
    .filter(point => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1).length;
  const lowConfidenceCount = confidences.filter(value => value < 0.5).length;
  return {
    id: SAFE_ID.test(String(input?.id || '')) ? String(input.id) : `face-view-${String(index + 1).padStart(3, '0')}`,
    yawDeg: yawDeg === null ? null : rounded(yawDeg, 3),
    source: {
      schema: geometry.schema,
      coordinateSystem: cleanString(geometry.coordinateSystem, 160),
      inference: {
        engine: cleanString(geometry.inference?.engine, 100),
        version: cleanString(geometry.inference?.version, 100),
        execution: cleanString(geometry.inference?.execution, 100)
      }
    },
    transformationEvidence: {
      available: Boolean(matrix),
      matrix4x4: matrix,
      appliedToPointCoordinates: false,
      limitation: matrix
        ? 'Recorded as local model pose evidence; fusion uses the explicit yaw tag because matrix semantics are provider-specific.'
        : 'The source geometry did not provide a transformation matrix.'
    },
    normalizationEvidence: {
      sourceCentroid: cloud.center,
      sourceRmsRadius: cloud.sourceRmsRadius,
      absoluteScaleDiscarded: true
    },
    points: cloud.points,
    quality: {
      topologyComplete: true,
      finiteRelativeDepthCount: LOCAL_FACE_MAP_POINT_COUNT,
      pointsInsideSourceFrame: inFrameCount,
      insideSourceFrameRatio: rounded(inFrameCount / LOCAL_FACE_MAP_POINT_COUNT, 5),
      confidenceEvidence: confidences.length ? 'landmark-or-face-model-confidence' : 'not-reported',
      meanReportedConfidence: confidences.length ? rounded(average(confidences), 5) : null,
      lowReportedConfidenceCount: lowConfidenceCount
    }
  };
}

function rotateY(point, degrees) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians), sine = Math.sin(radians);
  return {
    x: cosine * point.x + sine * point.z,
    y: point.y,
    z: -sine * point.x + cosine * point.z,
    confidence: point.confidence,
    index: point.index
  };
}

function robustFuse(alignedObservations) {
  return Array.from({ length: LOCAL_FACE_MAP_POINT_COUNT }, (_, index) => {
    const candidates = alignedObservations.map(observation => observation[index]);
    const center = {
      x: median(candidates.map(point => point.x)),
      y: median(candidates.map(point => point.y)),
      z: median(candidates.map(point => point.z))
    };
    const residuals = candidates.map(point => Math.hypot(
      point.x - center.x, point.y - center.y, point.z - center.z
    ));
    const residualMedian = median(residuals);
    const mad = median(residuals.map(value => Math.abs(value - residualMedian)));
    const threshold = Math.max(0.025, residualMedian + 3 * Math.max(0.004, mad));
    let inlierIndexes = residuals.map((value, candidateIndex) => ({ value, candidateIndex }))
      .filter(item => item.value <= threshold).map(item => item.candidateIndex);
    if (inlierIndexes.length < 2) inlierIndexes = candidates.map((_, candidateIndex) => candidateIndex);
    const weights = inlierIndexes.map(candidateIndex => candidates[candidateIndex].confidence ?? 1);
    const weightSum = weights.reduce((sum, value) => sum + Math.max(0.05, value), 0);
    const weighted = coordinate => inlierIndexes.reduce((sum, candidateIndex, weightIndex) =>
      sum + candidates[candidateIndex][coordinate] * Math.max(0.05, weights[weightIndex]), 0) / weightSum;
    const fused = { x: weighted('x'), y: weighted('y'), z: weighted('z') };
    const inlierResiduals = inlierIndexes.map(candidateIndex => {
      const candidate = candidates[candidateIndex];
      return Math.hypot(candidate.x - fused.x, candidate.y - fused.y, candidate.z - fused.z);
    });
    return {
      index,
      x: rounded(fused.x), y: rounded(fused.y), z: rounded(fused.z),
      confidence: rounded(average(inlierIndexes.map(candidateIndex => candidates[candidateIndex].confidence)
        .filter(value => value !== null)), 4),
      observationCount: candidates.length,
      inlierObservationCount: inlierIndexes.length,
      rejectedObservationCount: candidates.length - inlierIndexes.length,
      consensusSpread: rounded(Math.sqrt(average(inlierResiduals.map(value => value ** 2))))
    };
  });
}

function cloudRmse(expected, actual) {
  return Math.sqrt(average(expected.map((point, index) => {
    const other = actual[index];
    return (point.x - other.x) ** 2 + (point.y - other.y) ** 2 + (point.z - other.z) ** 2;
  })));
}

function fusionMetrics(observations, fusedPoints) {
  const aligned = observations.map(observation => observation.points.map(point => rotateY(point, -observation.yawDeg)));
  const perView = observations.map((observation, index) => {
    const projected = fusedPoints.map(point => rotateY(point, observation.yawDeg));
    const normalizedRigidProjectionRmse = cloudRmse(observation.points, projected);
    const heldOutAligned = aligned.filter((_, candidateIndex) => candidateIndex !== index);
    const heldOutFusion = robustFuse(heldOutAligned);
    const heldOutProjected = heldOutFusion.map(point => rotateY(point, observation.yawDeg));
    return {
      observationId: observation.id,
      yawDeg: observation.yawDeg,
      normalizedRigidProjectionRmse: rounded(normalizedRigidProjectionRmse),
      heldOutNormalizedRigidProjectionRmse: rounded(cloudRmse(observation.points, heldOutProjected))
    };
  });
  const heldOut = perView.map(view => view.heldOutNormalizedRigidProjectionRmse);
  return {
    method: 'leave-one-view-out yaw-aligned relative-landmark consistency',
    units: 'face-relative RMS-radius units',
    calibratedCameraReprojection: false,
    cameraIntrinsicsUsed: false,
    meanHeldOutRmse: rounded(average(heldOut)),
    maximumHeldOutRmse: rounded(Math.max(...heldOut)),
    perView
  };
}

function commonRecord({ mapId, packId, receipt, algorithm, createdAt, mode, points, observations }) {
  return {
    schema: LOCAL_FACE_MAP_SCHEMA,
    mapId,
    packId,
    createdAt,
    mode,
    classification: 'biometric-sensitive',
    authorization: consentBinding(receipt, algorithm),
    topology: {
      id: 'mediapipe-face-landmark-order-468',
      pointCount: LOCAL_FACE_MAP_POINT_COUNT,
      indexRange: [0, LOCAL_FACE_MAP_POINT_COUNT - 1],
      triangleTopologyIncluded: false,
      surfaceMeshClaimAllowed: false
    },
    coordinateSystem: {
      id: 'materiallogix.face-relative-rms-radius.v1',
      origin: 'centroid of the 468 source landmarks',
      axes: mode === 'single-photo'
        ? { x: 'source-image-right', y: 'source-image-down', z: 'source-camera-relative' }
        : { x: 'yaw-aligned-subject-right', y: 'source-image-down', z: 'yaw-aligned-relative-depth' },
      unit: 'root-mean-square 3D landmark radius',
      metric: false,
      cameraCalibrated: false,
      absoluteScaleRetained: false
    },
    points,
    sourceEvidence: observations.map(observation => ({
      observationId: observation.id,
      yawDeg: observation.yawDeg,
      source: observation.source,
      transformationEvidence: observation.transformationEvidence,
      normalizationEvidence: observation.normalizationEvidence,
      quality: observation.quality
    })),
    appearanceSeparation: {
      appearanceLayersIncluded: false,
      tattoosOrBodyMarksIncluded: false,
      skinTextureIncluded: false,
      hairGeometryIncluded: false,
      presentationDeltasIncluded: false,
      rule: 'Optional appearance and presentation remain separate, independently consented Pack records.'
    },
    claimControls: {
      allowedDescription: mode === 'single-photo'
        ? 'single-photo 468-point relative 3D face landmark map'
        : 'multi-view yaw-aligned 468-point relative 3D face landmark fusion',
      prohibitedClaims: [...PROHIBITED_CLAIMS]
    },
    privacy: {
      localOnly: true,
      containsBiometricGeometry: true,
      rawMediaIncluded: false,
      identityEmbeddingIncluded: false,
      identificationAllowed: false,
      modelTrainingAllowed: false,
      remoteExportAllowed: false
    }
  };
}

export function buildSinglePhotoFaceMap({
  mapId, packId, observation, consentReceipt, createdAt,
  now = Date.now(), appearance, presentation
} = {}) {
  requireNoAppearancePayload(appearance, presentation);
  if (!SAFE_ID.test(String(mapId || '')) || !SAFE_ID.test(String(packId || ''))) {
    throw new TypeError('Safe mapId and packId values are required.');
  }
  const algorithm = requireActiveReceipt(consentReceipt, {
    packId, now, purpose: PERSONAL_GEOMETRY_PURPOSES.singlePhotoFaceMap
  });
  const source = extractObservation(observation, 0, { yawRequired: false });
  const created = isIsoDate(createdAt) ? createdAt : new Date(now).toISOString();
  const transformationAvailable = source.transformationEvidence.available;
  const insideRatio = source.quality.insideSourceFrameRatio;
  const warnings = [
    'single_photo_depth_is_model_relative_not_metric',
    'self_occluded_regions_are_not_observed',
    'back_of_head_is_not_captured'
  ];
  if (!transformationAvailable) warnings.push('transformation_evidence_unavailable');
  if (insideRatio < 0.98) warnings.push('some_landmarks_extend_outside_source_frame');
  const record = commonRecord({
    mapId: String(mapId), packId: String(packId), receipt: consentReceipt, algorithm,
    createdAt: created, mode: 'single-photo', points: source.points, observations: [source]
  });
  record.coverage = {
    sourceViews: 1,
    frontVisibleFaceOnly: true,
    sideCoverageVerified: false,
    backOfHeadObserved: false,
    completeHeadCoverage: false
  };
  record.occlusion = {
    status: source.quality.confidenceEvidence === 'not-reported' ? 'unknown' : 'model-confidence-only',
    directlyVisiblePointCount: null,
    lowReportedConfidenceCount: source.quality.lowReportedConfidenceCount,
    selfOccludedGeometryRecovered: false,
    limitation: 'A face landmark model may estimate hidden points; one photo cannot prove which surface regions were directly visible.'
  };
  record.capabilities = {
    relative3dLandmarkMap: true,
    singleViewRenderConditioning: true,
    multiviewConsistencyMeasured: false,
    calibratedSurfaceReconstruction: false,
    metricMeasurements: false,
    textureOrAppearanceModel: false,
    backOfHeadModel: false,
    digitalTwin: false,
    identityVerification: false
  };
  record.quality = {
    status: 'lower-confidence-single-view',
    confidenceCeiling: 'low-to-medium',
    transformationEvidenceAvailable: transformationAvailable,
    topologyComplete: true,
    finiteRelativeDepthRatio: 1,
    sourceFrameContainmentRatio: insideRatio,
    warnings
  };
  return deepFreeze(record);
}

export function buildMultiViewFaceMap({
  mapId, packId, observations = [], consentReceipt, priorSinglePhotoMap = null,
  priorSinglePhotoConsentReceipt = null, createdAt, now = Date.now(), appearance, presentation
} = {}) {
  requireNoAppearancePayload(appearance, presentation);
  if (!SAFE_ID.test(String(mapId || '')) || !SAFE_ID.test(String(packId || ''))) {
    throw new TypeError('Safe mapId and packId values are required.');
  }
  const algorithm = requireActiveReceipt(consentReceipt, {
    packId, now, purpose: PERSONAL_GEOMETRY_PURPOSES.multiviewGeometryPack
  });
  if (!Array.isArray(observations) || observations.length < 3) {
    throw new TypeError('Multi-view fusion requires at least three yaw-tagged observations.');
  }
  const sources = observations.slice(0, 32).map((observation, index) =>
    extractObservation(observation, index, { yawRequired: true }));
  if (new Set(sources.map(source => source.id)).size !== sources.length) {
    throw new TypeError('Multi-view observation IDs must be unique.');
  }
  const yaws = sources.map(source => source.yawDeg);
  const yawMin = Math.min(...yaws), yawMax = Math.max(...yaws), yawSpan = yawMax - yawMin;
  const hasLeft = yaws.some(yaw => yaw <= -25);
  const hasFront = yaws.some(yaw => Math.abs(yaw) <= 20);
  const hasRight = yaws.some(yaw => yaw >= 25);
  if (yawSpan < 60 || !hasLeft || !hasFront || !hasRight) {
    throw new TypeError('Multi-view fusion requires left, frontal, and right observations spanning at least 60 degrees.');
  }
  if (priorSinglePhotoMap) {
    const priorValidation = validateLocalFaceMap(priorSinglePhotoMap, {
      consentReceipt: priorSinglePhotoConsentReceipt,
      now
    });
    if (!priorValidation.valid || priorSinglePhotoMap.mode !== 'single-photo'
        || priorSinglePhotoMap.packId !== packId) {
      throw new TypeError('The prior single-photo face map is not a valid upgrade source for this Pack.');
    }
  }
  const aligned = sources.map(source => source.points.map(point => rotateY(point, -source.yawDeg)));
  const fusedPoints = robustFuse(aligned);
  const consistency = fusionMetrics(sources, fusedPoints);
  const transformationEvidenceRatio = sources.filter(source => source.transformationEvidence.available).length / sources.length;
  const containmentRatio = average(sources.map(source => source.quality.insideSourceFrameRatio));
  const coverageStatus = sources.length >= 5 && yawSpan >= 120 && hasLeft && hasFront && hasRight ? 'good' : 'minimum';
  const qualityStatus = coverageStatus === 'good' && consistency.meanHeldOutRmse <= 0.08
    && transformationEvidenceRatio === 1 && containmentRatio >= 0.98
    ? 'higher-confidence-relative-map'
    : consistency.meanHeldOutRmse <= 0.18 ? 'usable-relative-map' : 'limited-relative-map';
  const created = isIsoDate(createdAt) ? createdAt : new Date(now).toISOString();
  const record = commonRecord({
    mapId: String(mapId), packId: String(packId), receipt: consentReceipt, algorithm,
    createdAt: created, mode: 'multi-view', points: fusedPoints, observations: sources
  });
  record.lineage = {
    upgradedFromSinglePhotoMapId: priorSinglePhotoMap?.mapId || null,
    replacesPriorGeometry: false,
    relationship: priorSinglePhotoMap ? 'higher-evidence local derivative' : 'direct multi-view build'
  };
  record.coverage = {
    sourceViews: sources.length,
    yawMinimumDeg: yawMin,
    yawMaximumDeg: yawMax,
    yawSpanDeg: yawSpan,
    leftFrontalRightPresent: true,
    status: coverageStatus,
    frontAndSideVisibleFaceOnly: true,
    backOfHeadObserved: false,
    completeHeadCoverage: false
  };
  record.occlusion = {
    status: 'multi-view-model-confidence-and-consensus',
    directlyVisiblePointCount: null,
    rejectedPointObservations: fusedPoints.reduce((sum, point) => sum + point.rejectedObservationCount, 0),
    pointsWithAllViewsInConsensus: fusedPoints.filter(point => point.rejectedObservationCount === 0).length,
    backOfHeadRecovered: false,
    limitation: 'Multiple front/side views reduce self-occlusion uncertainty but do not observe or reconstruct the back of the head.'
  };
  record.capabilities = {
    relative3dLandmarkMap: true,
    singleViewRenderConditioning: true,
    multiviewYawAlignedFusion: true,
    multiviewConsistencyMeasured: true,
    calibratedSurfaceReconstruction: false,
    metricMeasurements: false,
    textureOrAppearanceModel: false,
    backOfHeadModel: false,
    digitalTwin: false,
    identityVerification: false
  };
  record.quality = {
    status: qualityStatus,
    confidenceCeiling: qualityStatus === 'higher-confidence-relative-map' ? 'medium' : 'low-to-medium',
    topologyComplete: true,
    finiteRelativeDepthRatio: 1,
    transformationEvidenceRatio: rounded(transformationEvidenceRatio, 5),
    meanSourceFrameContainmentRatio: rounded(containmentRatio, 5),
    consistency,
    warnings: [
      'consistency_metric_is_not_calibrated_camera_reprojection',
      'relative_landmarks_are_not_a_surface_mesh',
      'back_of_head_is_not_captured'
    ]
  };
  return deepFreeze(record);
}

export function upgradeSinglePhotoFaceMap(options = {}) {
  if (!options.priorSinglePhotoMap) throw new TypeError('A prior single-photo map is required for an upgrade.');
  return buildMultiViewFaceMap(options);
}

export function validateLocalFaceMap(faceMap, { consentReceipt, now = Date.now() } = {}) {
  const findings = [];
  if (faceMap?.schema !== LOCAL_FACE_MAP_SCHEMA) findings.push('unsupported_face_map_schema');
  if (faceMap?.classification !== 'biometric-sensitive') findings.push('biometric_classification_missing');
  let algorithm = null;
  try {
    const purpose = faceMap?.mode === 'single-photo'
      ? PERSONAL_GEOMETRY_PURPOSES.singlePhotoFaceMap
      : PERSONAL_GEOMETRY_PURPOSES.multiviewGeometryPack;
    algorithm = requireActiveReceipt(consentReceipt, { packId: faceMap?.packId, now, purpose });
  } catch (error) {
    findings.push(`consent:${error.message}`);
  }
  if (faceMap?.authorization?.receiptSchema !== PERSONAL_GEOMETRY_CONSENT_SCHEMA
      || faceMap?.authorization?.consentId !== consentReceipt?.consent_id
      || faceMap?.authorization?.packId !== consentReceipt?.pack_id
      || faceMap?.authorization?.retentionPolicyId !== consentReceipt?.local_retention_policy_id
      || faceMap?.authorization?.localExpiresAt !== consentReceipt?.local_expires_at
      || faceMap?.authorization?.algorithm?.id !== algorithm?.algorithm_id
      || faceMap?.authorization?.algorithm?.sha256 !== algorithm?.sha256) {
    findings.push('consent_binding_mismatch');
  }
  if (faceMap?.topology?.pointCount !== LOCAL_FACE_MAP_POINT_COUNT
      || !Array.isArray(faceMap?.points) || faceMap.points.length !== LOCAL_FACE_MAP_POINT_COUNT
      || faceMap.points.some((point, index) => point.index !== index
        || finite(point.x) === null || finite(point.y) === null || finite(point.z) === null)) {
    findings.push('relative_face_topology_invalid');
  }
  if (faceMap?.coordinateSystem?.metric !== false
      || faceMap?.coordinateSystem?.cameraCalibrated !== false
      || faceMap?.topology?.surfaceMeshClaimAllowed !== false) findings.push('unsupported_metric_or_surface_claim');
  if (faceMap?.coverage?.backOfHeadObserved !== false
      || faceMap?.coverage?.completeHeadCoverage !== false) findings.push('unsupported_head_coverage_claim');
  if (faceMap?.capabilities?.digitalTwin !== false
      || faceMap?.capabilities?.identityVerification !== false
      || faceMap?.capabilities?.metricMeasurements !== false) findings.push('unsupported_capability_claim');
  if (faceMap?.appearanceSeparation?.appearanceLayersIncluded !== false
      || faceMap?.appearanceSeparation?.tattoosOrBodyMarksIncluded !== false
      || faceMap?.appearanceSeparation?.skinTextureIncluded !== false
      || faceMap?.appearanceSeparation?.hairGeometryIncluded !== false) findings.push('appearance_data_must_remain_separate');
  if (!PROHIBITED_CLAIMS.every(claim => faceMap?.claimControls?.prohibitedClaims?.includes(claim))) {
    findings.push('prohibited_claim_controls_incomplete');
  }
  if (faceMap?.privacy?.localOnly !== true || faceMap?.privacy?.remoteExportAllowed !== false
      || faceMap?.privacy?.rawMediaIncluded !== false || faceMap?.privacy?.modelTrainingAllowed !== false) {
    findings.push('local_privacy_boundary_invalid');
  }
  return { valid: findings.length === 0, findings: [...new Set(findings)] };
}
