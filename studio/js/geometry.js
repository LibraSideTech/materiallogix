// Human geometry via MediaPipe Tasks — Google's free, Apache-licensed
// vision models, loaded lazily from CDN and run entirely in this browser.
//
// This is the one optional network dependency in the product, and it degrades
// honestly: offline, everything else works and the heuristics stand alone.
// When it loads, the checks upgrade from "energy suggests a subject here" to
// "there is a face HERE, and this crop puts it under the caption".
//
// Honesty note on hands: the landmark model fits a 21-point hand topology to
// whatever it sees, so it cannot literally count a sixth finger. What it gives
// us is *where hands are*, so the reviewer is pointed at them with the loupe.

const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
import {
  HAND_LANDMARK_CODES, POSE_LANDMARK_CODES, humanGeometryRecord,
  foregroundMaskSummary, landmarkBounds, namedLandmarks,
  HUMAN_CANDIDATE_ASSETS, HUMAN_CANDIDATE_VERSION, mapHumanCandidateResult
} from './human-geometry.js';
import {
  PERSONAL_GEOMETRY_PURPOSES,
  personalGeometryConsentState
} from './personal-geometry-consent.js';

const MODELS = {
  face: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  hand: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  pose: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
};

// Algorithm manifest for the base MediaPipe Tasks Vision observation step,
// hash-pinned the same way js/local-face-map.js pins its own algorithm so a
// consent receipt naming this algorithm_id/sha256 pair can't silently start
// meaning something different later. Authored 2026-09-04 against this
// file's actual, verified configuration (CDN package/version and the three
// model URLs above) - not copied from elsewhere, so the exact wording may
// differ from any other copy of this constant; what matters is that this
// file's own manifest text and hash agree with each other.
export const PERSON_GEOMETRY_OBSERVATION_ALGORITHM_ID = 'materiallogix.person-geometry-observation.mediapipe-tasks.v1';
export const PERSON_GEOMETRY_OBSERVATION_MANIFEST_TEXT = [
  'schema=materiallogix.person-geometry-observation-manifest.v1',
  'implementation=js/geometry.js@mediapipe-tasks-vision-0.10.14',
  'engine=mediapipe-tasks-vision',
  'engine-version=0.10.14',
  'models=face_landmarker,hand_landmarker,pose_landmarker_lite',
  'outputs=face-landmarks,hand-landmarks-21point,pose-landmarks,foreground-mask',
  'iris=false',
  'emotion=false',
  'age=false',
  'gender=false',
  'race=false',
  'identity-verification=false',
  'biometric-identification=false',
  'surface-mesh=false',
  'execution=local-only',
  'remote-export=false',
  'training=false'
].join('\n');
export const PERSON_GEOMETRY_OBSERVATION_MANIFEST_SHA256 = '7a8858fdaad852e622758dca943c47edbfecb1ac86d3e1a6f6e31e767b99311e';
export const PERSON_GEOMETRY_OBSERVATION_MANIFEST = Object.freeze({
  algorithm_id: PERSON_GEOMETRY_OBSERVATION_ALGORITHM_ID,
  sha256: PERSON_GEOMETRY_OBSERVATION_MANIFEST_SHA256
});

let enginePromise = null;
const candidatePromises = new Map();

const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');

export function humanCandidateConfig(backend = 'webgl', modelBasePath = new URL('../assets/human/models/', import.meta.url).href,
  bodyModel = 'movenet-lightning') {
  if (!['webgl', 'cpu'].includes(backend)) throw new Error('Unsupported people-mapping backend.');
  if (!['movenet-lightning', 'blazepose-full'].includes(bodyModel)) throw new Error('Unsupported people-mapping body model.');
  return {
    backend,
    modelBasePath,
    cacheModels: false,
    validateModels: true,
    debug: false,
    // Sequential, not concurrent: BlazePose reads its pose result back from the
    // GPU three times per frame where MoveNet reads back once, so with
    // async:true (face/body/hand launched together, joined at the end) the
    // hand detector's own await points land inside BlazePose's extra
    // yields far more often. Measured: hand counts went from 1/2/1 under
    // MoveNet to 0/0/0 under BlazePose with byte-identical hand models and an
    // unchanged hand config — a scheduling signature, not a capability one.
    // warmup:'full' (Human's own documented default; this candidate shipped
    // with it off) primes every submodel with one throwaway inference before
    // the timed run, which is what the reference engine effectively gets for
    // free from its own warm-load path.
    async: false,
    warmup: 'full',
    filter: { enabled: false, return: false },
    gesture: { enabled: false },
    face: {
      enabled: true,
      detector: { modelPath: 'blazeface.json', maxDetected: 4, minConfidence: 0.5, return: false, mask: false },
      mesh: { enabled: true, modelPath: 'facemesh.json', keepInvalid: false },
      attention: { enabled: false }, iris: { enabled: false }, emotion: { enabled: false },
      description: { enabled: false }, antispoof: { enabled: false }, liveness: { enabled: false },
      gear: { enabled: false }
    },
    body: { enabled: true, modelPath: `${bodyModel}.json`, maxDetected: 1, minConfidence: 0.3 },
    hand: {
      enabled: true, maxDetected: 4, landmarks: true,
      // Matched to the MediaPipe reference's minHandDetectionConfidence
      // (0.4, line 213 below) instead of Human's own 0.5 default, which the
      // candidate was silently inheriting at three separate gates. Judging a
      // candidate against a stricter bar than the thing it has to match is
      // not parity. skipFrames/skipTime 0 turn off Human's video-oriented
      // palm-detector caching, which otherwise can suppress a redetection
      // across the three unrelated stills this harness pushes through one
      // shared engine instance.
      minConfidence: 0.4, iouThreshold: 0.2, skipFrames: 0, skipTime: 0,
      detector: { modelPath: 'handtrack.json' },
      skeleton: { modelPath: 'handlandmark-lite.json' }
    },
    object: { enabled: false },
    segmentation: { enabled: false }
  };
}

export function humanCandidateConfigAssurance(config = {}, expectedOrigin = typeof location === 'undefined' ? null : location.origin) {
  const findings = [];
  if (!['webgl', 'cpu'].includes(config.backend)) findings.push('backend_not_bounded');
  if (!['movenet-lightning.json', 'blazepose-full.json'].includes(config.body?.modelPath)) findings.push('body_model_not_pinned');
  // The body model path was pinned here but the hand pipeline never was, so a
  // future edit could silently point hand.detector/skeleton at an unreviewed
  // or remote model with nothing here to catch it.
  if (config.hand?.detector?.modelPath !== 'handtrack.json') findings.push('hand_detector_not_pinned');
  if (config.hand?.skeleton?.modelPath !== 'handlandmark-lite.json') findings.push('hand_skeleton_not_pinned');
  try {
    const url = new URL(config.modelBasePath);
    if (!expectedOrigin || url.origin !== expectedOrigin) findings.push('model_path_not_same_origin');
  } catch { findings.push('model_path_not_same_origin'); }
  const disabled = [config.gesture, config.object, config.segmentation, config.face?.iris,
    config.face?.emotion, config.face?.description, config.face?.antispoof,
    config.face?.liveness, config.face?.attention, config.face?.gear];
  if (disabled.some(section => section?.enabled !== false)) findings.push('sensitive_inference_enabled');
  if (config.cacheModels !== false) findings.push('unbounded_model_cache');
  return { accepted: findings.length === 0, findings };
}

export async function verifyHumanCandidateAssets(fetchImpl = fetch) {
  const verified = [];
  let runtimeBytes = null;
  for (const artifact of HUMAN_CANDIDATE_ASSETS) {
    const url = new URL(`../${artifact.path}`, import.meta.url);
    if (typeof location !== 'undefined' && url.origin !== location.origin) throw new Error('human_candidate_cross_origin_asset');
    const response = await fetchImpl(url.href, { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error(`human_candidate_asset_unavailable:${artifact.path}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== artifact.bytes) throw new Error(`human_candidate_asset_size_mismatch:${artifact.path}`);
    const sha256 = hex(await crypto.subtle.digest('SHA-256', bytes));
    if (sha256 !== artifact.sha256) throw new Error(`human_candidate_asset_integrity_mismatch:${artifact.path}`);
    verified.push({ path: artifact.path, bytes: bytes.byteLength, sha256 });
    if (artifact.path.endsWith('/human.esm.js')) runtimeBytes = bytes;
  }
  if (!runtimeBytes) throw new Error('human_candidate_runtime_missing');
  return { verified, runtimeBytes };
}

export async function loadHumanCandidate(backend = 'webgl', bodyModel = 'movenet-lightning') {
  const candidateKey = `${backend}:${bodyModel}`;
  if (!candidatePromises.has(candidateKey)) {
    const pending = (async () => {
      const config = humanCandidateConfig(backend, new URL('../assets/human/models/', import.meta.url).href, bodyModel);
      const assurance = humanCandidateConfigAssurance(config);
      if (!assurance.accepted) throw new Error(`human_candidate_config_blocked:${assurance.findings.join(',')}`);
      const assets = await verifyHumanCandidateAssets();
      const moduleUrl = URL.createObjectURL(new Blob([assets.runtimeBytes], { type: 'text/javascript' }));
      try {
        const module = await import(/* @vite-ignore */ moduleUrl);
        const Human = module.Human || module.default;
        if (typeof Human !== 'function') throw new Error('human_candidate_runtime_invalid');
        const engine = new Human(config);
        return { engine, backend, verified: assets.verified };
      } finally {
        URL.revokeObjectURL(moduleUrl);
      }
    })();
    candidatePromises.set(candidateKey, pending);
    pending.catch(() => candidatePromises.delete(candidateKey));
  }
  return candidatePromises.get(candidateKey);
}

const CANDIDATE_TIMEOUT_MS = 45000;

/** Proof-only candidate execution. It is never called by the production analysis path. */
export async function analyzeHumanCandidate(source, w, h, {
  backend = 'webgl', allowCpuFallback = true, bodyModel = 'movenet-lightning'
} = {}) {
  if (!source || !w || !h) return null;
  const run = async backend => {
    const loaded = await loadHumanCandidate(backend, bodyModel);
    const started = performance.now();
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('human_candidate_timeout')), CANDIDATE_TIMEOUT_MS);
    });
    let result;
    try { result = await Promise.race([loaded.engine.detect(source), timeout]); }
    finally { clearTimeout(timeoutId); }
    const mapped = mapHumanCandidateResult(result, w, h, backend);
    mapped.performance = {
      elapsedMs: +(performance.now() - started).toFixed(1),
      backend,
      bodyModel,
      modelReportedMs: Number(result?.performance?.total) || null,
      version: HUMAN_CANDIDATE_VERSION
    };
    return mapped;
  };
  try {
    return await run(backend);
  } catch (error) {
    if (!allowCpuFallback || backend === 'cpu') throw error;
    return run('cpu');
  }
}

/** Load once per session. Resolves to null (not an error) when unreachable. */
export function loadGeometry() {
  if (!enginePromise) {
    enginePromise = (async () => {
      const vision = await import(/* @vite-ignore */ `${CDN}/vision_bundle.mjs`);
      const fileset = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
      const faceLm = await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODELS.face },
        runningMode: 'IMAGE',
        numFaces: 4,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: true
      });
      const handLm = await vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODELS.hand },
        runningMode: 'IMAGE',
        numHands: 4,
        minHandDetectionConfidence: 0.4
      });
      const poseLm = await vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODELS.pose },
        runningMode: 'IMAGE',
        numPoses: 1,
        outputSegmentationMasks: true
      });
      return { faceLm, handLm, poseLm };
    })().catch(() => {
      // One offline start must not disable people mapping for the whole
      // session: forget the failure so the next call can try again.
      enginePromise = null;
      return null;
    });
  }
  return enginePromise;
}

const LOAD_TIMEOUT_MS = 25000;

const GEOMETRY_PURPOSES = new Set([
  PERSONAL_GEOMETRY_PURPOSES.singlePhotoFaceMap,
  PERSONAL_GEOMETRY_PURPOSES.multiviewGeometryPack
]);

/**
 * Enforce the sensitive-analysis boundary before model code is loaded or any
 * source pixels are read. A receipt is valid only for its exact Pack, purpose,
 * categories, notice, retention window, and observation algorithm digest.
 */
export function assertGeometryConsent({
  consentReceipt,
  packId,
  specificPurpose,
  requiredCategories = [],
  now = Date.now()
} = {}) {
  const state = personalGeometryConsentState(consentReceipt, { now });
  if (!state.allowed) {
    throw new TypeError(`Personal Geometry consent blocked: ${state.blockers.join(', ')}`);
  }
  if (!packId || consentReceipt.pack_id !== packId) {
    throw new TypeError('The consent receipt does not authorize this Personal Geometry Pack.');
  }
  if (!GEOMETRY_PURPOSES.has(specificPurpose)
      || consentReceipt.specific_purpose !== specificPurpose) {
    throw new TypeError('The consent receipt does not authorize this Personal Geometry purpose.');
  }
  const categories = new Set(consentReceipt.core_categories || []);
  if (!categories.has('source_media')
      || requiredCategories.some(category => !categories.has(category))) {
    throw new TypeError('The consent receipt does not authorize the required geometry categories.');
  }
  if (!(consentReceipt.algorithm_ids_and_digests || []).some(item =>
    item.algorithm_id === PERSON_GEOMETRY_OBSERVATION_ALGORITHM_ID
      && item.sha256 === PERSON_GEOMETRY_OBSERVATION_MANIFEST_SHA256)) {
    throw new TypeError('The consent receipt does not authorize the exact geometry algorithm.');
  }
  return true;
}

/**
 * Map faces, hands, and bodies in a decoded image or canvas. Compatibility
 * boxes and anchors remain available to the crop and capture-review tools.
 *
 * The engine load is raced against a timeout: on a blocked or crawling CDN the
 * import can hang rather than reject, and analysis must never hold up an
 * import queue. A load that finishes late is still cached for the next call.
 */
export async function analyzeGeometry(source, w, h, options = {}) {
  assertGeometryConsent(options);
  if (!source || !w || !h) return null;
  const engine = await Promise.race([
    loadGeometry(),
    new Promise(resolve => setTimeout(() => resolve(null), LOAD_TIMEOUT_MS))
  ]);
  if (!engine || !w || !h) return null;
  try {
    const faceRaw = engine.faceLm.detect(source);
    const faces = (faceRaw.faceLandmarks || []).map((pts, i) => {
      const landmarks = namedLandmarks(pts, [], 'mediapipe-face-landmarker');
      const box = landmarkBounds(landmarks) || { x: 0, y: 0, w: 0, h: 0 };
      // Preserve the six-point order used by the existing head-yaw review.
      const keypoints = [33, 263, 1, 13, 234, 454].map(index => ({
        x: landmarks[index]?.x, y: landmarks[index]?.y
      }));
      return {
        ...box,
        score: 1,
        keypoints,
        landmarks,
        transformationMatrix: faceRaw.facialTransformationMatrixes?.[i]?.data
          ? Array.from(faceRaw.facialTransformationMatrixes[i].data, n => +n.toFixed(6))
          : null
      };
    });
    const handsRaw = engine.handLm.detect(source);
    const hands = (handsRaw.landmarks || []).map((pts, i) => {
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      for (const p of pts) {
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
      return {
        x: x0, y: y0, w: x1 - x0, h: y1 - y0,
        score: +(handsRaw.handedness?.[i]?.[0]?.score || 0).toFixed(3),
        side: handsRaw.handedness?.[i]?.[0]?.categoryName || null,
        landmarks: namedLandmarks(pts, HAND_LANDMARK_CODES, 'mediapipe-hand-landmarker')
      };
    });
    // Body pose: five anchor landmarks are enough for full-circle orientation
    // (bodies, unlike faces, stay trackable from behind).
    let body = null;
    let foreground = null;
    const poses = [];
    try {
      const pose = engine.poseLm.detect(source);
      const mask = pose.segmentationMasks?.[0];
      if (mask) {
        foreground = foregroundMaskSummary(mask.getAsFloat32Array(), mask.width, mask.height);
        mask.close?.();
      }
      const lm = pose.landmarks?.[0];
      if (lm && lm.length >= 25) {
        const pick = i => ({ x: +lm[i].x.toFixed(4), y: +lm[i].y.toFixed(4),
                             v: +(lm[i].visibility ?? 1).toFixed(3) });
        body = { nose: pick(0), lShoulder: pick(11), rShoulder: pick(12),
                 lHip: pick(23), rHip: pick(24) };
        poses.push({
          landmarks: namedLandmarks(lm, POSE_LANDMARK_CODES, 'mediapipe-pose-landmarker')
        });
      }
    } catch { /* pose optional */ }
    const mapping = humanGeometryRecord({
      engine: 'mediapipe-tasks-vision', engineVersion: '0.10.14', faces, hands, poses, foreground
    });
    return { engine: 'mediapipe-tasks-0.10', at: mapping.at, faces, hands, body, poses,
      spatial: mapping.spatial, mapping };
  } catch {
    return null;
  }
}
