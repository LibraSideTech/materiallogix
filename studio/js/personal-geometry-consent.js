// Consent and retention gate for the local Personal Geometry Pack.
//
// This module deliberately contains no media, landmark, embedding, or
// rendering code. A caller must obtain an allowed decision before it
// invokes any person-analysis code. The returned receipt is a small policy
// record, not part of the Pack.

export const PERSONAL_GEOMETRY_CONSENT_SCHEMA = 'materiallogix.personal-geometry-consent.v1';
export const PERSONAL_GEOMETRY_NOTICE_VERSION = '2026-09-11.2';
export const PERSONAL_GEOMETRY_RETENTION_POLICY_ID = 'materiallogix.personal-geometry.local-retention.2026-09-04.1';

export const PERSONAL_GEOMETRY_PURPOSES = Object.freeze({
  singlePhotoFaceMap: 'single_photo_face_map',
  multiviewGeometryPack: 'multiview_geometry_pack',
  tattooPlacement: 'tattoo_placement',
  skinDetailReview: 'skin_detail_review'
});

export const TATTOO_PLACEMENT_ALGORITHM_ID = 'materiallogix.tattoo-placement-map.v2';
export const TATTOO_PLACEMENT_ALGORITHM_SHA256 = 'ba83dabacb25c8cd9b2c0ad351159a97270f30e86f333b284d801e55025c0464';
export const TATTOO_PLACEMENT_ALGORITHM_MANIFEST = Object.freeze({
  algorithm_id: TATTOO_PLACEMENT_ALGORITHM_ID,
  sha256: TATTOO_PLACEMENT_ALGORITHM_SHA256
});

export const SKIN_DETAIL_CONTINUITY_ALGORITHM_ID = 'materiallogix.skin-detail-continuity.v1';
export const SKIN_DETAIL_CONTINUITY_ALGORITHM_SHA256 = 'd23149d688efc337436e3e033d10b14d683b37f6f05cb09c97c14a5a1f808237';

export const PERSONAL_GEOMETRY_NOTICE_TEXT = [
  'Before MaterialLogix Studio analyzes a person to create a single-photo face map, multi-view Personal Geometry reference Pack, tattoo-placement guide, or skin-detail continuity review, the person using this flow must confirm they are the adult shown, read this notice, and sign this release directly. Studio records that statement but does not independently verify identity.',
  'What Studio analyzes: selected photos or video of one adult and, only after consent, normalized face, hand, or body-pose landmarks needed for the selected operation. A skin-detail review instead uses an approximate skin-color rule and local high-frequency contrast; it can be wrong and does not identify the person or infer a sensitive trait.',
  'Sensitive data: face or body geometry may be biometric or sensitive information under some laws even though Studio does not use the Pack to identify or authenticate anyone.',
  'The one purpose: the signed receipt is limited to the selected face-map, reference-Pack, tattoo-placement, or skin-detail-review operation and its named local record. Outputs are not used for identification, authentication, surveillance, sensitive-trait inference, advertising, sale, or shared-model training.',
  'Where processing happens: Personal Geometry Pack creation and storage are local-only in this release. Remote processing is not available.',
  'Optional tattoo placement: tattoo artwork and its normalized placement anchors are off by default. Enabling them requires a separate tattoo-placement purpose, direct self-subject consent, a named target asset, and confirmation of source and artwork rights.',
  'Supported source boundary: the source must show only the adult account holder. Group sources, bystanders, and another person’s media are unavailable in this release and are not analyzed.',
  'Retention: unfinished local capture material and temporary analysis data are deleted when the flow ends and have a one-hour inactivity ceiling. A saved local Pack is deleted on withdrawal, Pack or project deletion, purpose completion, or account closure on this device, and expires no later than twelve months after its last authorized use unless the subject renews consent.',
  'Device boundary: local project data can remain on this device after sign-out until it is deleted through tested Pack or application-data controls. Studio cannot erase copies the holder exported or stored elsewhere.',
  'Rights and withdrawal: the account holder may refuse, withdraw, or request deletion. Withdrawing ends further processing and starts local deletion. An uploader cannot consent for another person.'
].join('\n');

// This value is intentionally fixed beside the versioned notice. The test suite
// recomputes it so a wording change cannot silently reuse an earlier release.
export const PERSONAL_GEOMETRY_NOTICE_SHA256 = 'b872f6c10d4c0d495ed9e0963e50b6a5221dfd94bc22cafa29a3352dce40f669';

export const OPTIONAL_APPEARANCE_LAYERS = Object.freeze([
  'tattoos'
]);

export const CORE_GEOMETRY_CATEGORIES = Object.freeze([
  'source_media',
  'face_geometry',
  'hand_geometry',
  'pose_geometry',
  'body_geometry',
  'tattoo_mapping',
  'skin_detail'
]);

export const PERSONAL_GEOMETRY_US_JURISDICTIONS = Object.freeze([
  ['US-AL', 'Alabama'], ['US-AK', 'Alaska'], ['US-AZ', 'Arizona'], ['US-AR', 'Arkansas'],
  ['US-CA', 'California'], ['US-CO', 'Colorado'], ['US-CT', 'Connecticut'], ['US-DE', 'Delaware'],
  ['US-DC', 'District of Columbia'], ['US-FL', 'Florida'], ['US-GA', 'Georgia'], ['US-HI', 'Hawaii'],
  ['US-ID', 'Idaho'], ['US-IL', 'Illinois'], ['US-IN', 'Indiana'], ['US-IA', 'Iowa'],
  ['US-KS', 'Kansas'], ['US-KY', 'Kentucky'], ['US-LA', 'Louisiana'], ['US-ME', 'Maine'],
  ['US-MD', 'Maryland'], ['US-MA', 'Massachusetts'], ['US-MI', 'Michigan'], ['US-MN', 'Minnesota'],
  ['US-MS', 'Mississippi'], ['US-MO', 'Missouri'], ['US-MT', 'Montana'], ['US-NE', 'Nebraska'],
  ['US-NV', 'Nevada'], ['US-NH', 'New Hampshire'], ['US-NJ', 'New Jersey'], ['US-NM', 'New Mexico'],
  ['US-NY', 'New York'], ['US-NC', 'North Carolina'], ['US-ND', 'North Dakota'], ['US-OH', 'Ohio'],
  ['US-OK', 'Oklahoma'], ['US-OR', 'Oregon'], ['US-PA', 'Pennsylvania'], ['US-RI', 'Rhode Island'],
  ['US-SC', 'South Carolina'], ['US-SD', 'South Dakota'], ['US-TN', 'Tennessee'], ['US-TX', 'Texas'],
  ['US-UT', 'Utah'], ['US-VT', 'Vermont'], ['US-VA', 'Virginia'], ['US-WA', 'Washington'],
  ['US-WV', 'West Virginia'], ['US-WI', 'Wisconsin'], ['US-WY', 'Wyoming']
].map(([value, label]) => Object.freeze({ value, label })));

const PURPOSES = new Set(Object.values(PERSONAL_GEOMETRY_PURPOSES));
const PROCESSING_MODE = 'local_only';
const SIGNATURE_METHODS = new Set([
  'affirmative_release_button'
]);
const SUBJECT_ROLES = new Set(['self', 'third_party']);
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SAFE_ALGORITHM_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const LOCALE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;
const JURISDICTION = /^[A-Z]{2}(?:-[A-Z0-9]{2,3})?$/;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const REMOTE_FIELDS = Object.freeze([
  'remote_notice_version',
  'remote_categories',
  'processor_class',
  'execution_region',
  'model_id_digest',
  'selected_ttl_seconds',
  'terminal_cleanup_trigger',
  'residual_record_categories',
  'no_training_term_version',
  'remote_subject_signed_at'
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function unique(values) {
  return [...new Set(values)];
}

function isIsoDate(value) {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function addUtcYear(isoDate) {
  const value = new Date(isoDate);
  value.setUTCFullYear(value.getUTCFullYear() + 1);
  return value.getTime();
}

export function personalGeometryRetentionExpiry(signedAt) {
  if (!isIsoDate(signedAt)) throw new TypeError('signedAt must be an ISO timestamp.');
  return new Date(addUtcYear(signedAt)).toISOString();
}

function normalizeOptionalLayers(value, blockers) {
  const supplied = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const unknown = Object.keys(supplied).filter(key => !OPTIONAL_APPEARANCE_LAYERS.includes(key));
  if (unknown.length) blockers.push('unrecognized_optional_layer');
  const normalized = {};
  for (const layer of OPTIONAL_APPEARANCE_LAYERS) {
    const setting = supplied[layer];
    if (setting !== undefined && typeof setting !== 'boolean') {
      blockers.push(`optional_layer_${layer}_must_be_boolean`);
    }
    normalized[layer] = setting === true;
  }
  return normalized;
}

function normalizeCoreCategories(value, blockers) {
  if (!Array.isArray(value)) {
    blockers.push('core_categories_required');
    return [];
  }
  const categories = unique(value.filter(item => typeof item === 'string'));
  if (categories.length !== value.length || categories.some(item => !CORE_GEOMETRY_CATEGORIES.includes(item))) {
    blockers.push('core_categories_invalid');
  }
  if (!categories.includes('source_media')) blockers.push('source_media_category_required');
  if (!categories.some(item => item !== 'source_media')) blockers.push('geometry_category_required');
  return categories.filter(item => CORE_GEOMETRY_CATEGORIES.includes(item));
}

function normalizeAlgorithms(value, blockers) {
  if (!Array.isArray(value) || value.length < 1) {
    blockers.push('algorithm_ids_and_digests_required');
    return [];
  }
  const normalized = [];
  for (const item of value) {
    const algorithmId = String(item?.algorithm_id || '');
    const sha256 = String(item?.sha256 || '').toLowerCase();
    if (!SAFE_ALGORITHM_ID.test(algorithmId) || !SHA256.test(sha256)) {
      blockers.push('algorithm_id_or_digest_invalid');
      continue;
    }
    normalized.push({ algorithm_id: algorithmId, sha256 });
  }
  if (normalized.length !== value.length) blockers.push('algorithm_manifest_incomplete');
  if (new Set(normalized.map(item => `${item.algorithm_id}:${item.sha256}`)).size !== normalized.length) {
    blockers.push('duplicate_algorithm_manifest');
  }
  return normalized;
}

function tattooPlacementBinding(input, { coreCategories, optionalLayers, algorithms, blockers }) {
  const tattooPurpose = input.specific_purpose === PERSONAL_GEOMETRY_PURPOSES.tattooPlacement;
  if (!tattooPurpose) {
    if (coreCategories.includes('tattoo_mapping')) blockers.push('tattoo_mapping_purpose_required');
    return null;
  }

  if (input.subject_role !== 'self' || input.subject_ref !== input.account_ref) {
    blockers.push('tattoo_placement_third_party_unsupported');
  }
  if (optionalLayers.tattoos !== true) blockers.push('tattoo_placement_scope_required');
  if (!coreCategories.includes('tattoo_mapping')) blockers.push('tattoo_mapping_category_required');
  if (!algorithms.some(item => item.algorithm_id === TATTOO_PLACEMENT_ALGORITHM_ID
      && item.sha256 === TATTOO_PLACEMENT_ALGORITHM_SHA256)) {
    blockers.push('tattoo_placement_algorithm_not_authorized');
  }

  const targetAssetId = String(input.target_asset_id || '');
  if (!SAFE_REF.test(targetAssetId)) blockers.push('tattoo_target_asset_binding_required');

  const hasSourcePackId = Object.prototype.hasOwnProperty.call(input, 'source_pack_id');
  const hasSourcePackSubjectRef = Object.prototype.hasOwnProperty.call(input, 'source_pack_subject_ref');
  if (!hasSourcePackId || !hasSourcePackSubjectRef) {
    blockers.push('tattoo_source_pack_binding_fields_required');
    return { target_asset_id: targetAssetId, source_pack_id: null, source_pack_subject_ref: null };
  }

  const manualPlacement = input.source_pack_id === null && input.source_pack_subject_ref === null;
  const packPlacement = SAFE_REF.test(String(input.source_pack_id || ''))
    && SAFE_REF.test(String(input.source_pack_subject_ref || ''));
  if (!manualPlacement && !packPlacement) blockers.push('tattoo_source_pack_binding_invalid');
  if (packPlacement && input.source_pack_subject_ref !== input.subject_ref) {
    blockers.push('tattoo_source_pack_subject_mismatch');
  }
  return {
    target_asset_id: targetAssetId,
    source_pack_id: packPlacement ? String(input.source_pack_id) : null,
    source_pack_subject_ref: packPlacement ? String(input.source_pack_subject_ref) : null
  };
}

function skinDetailBinding(input, { coreCategories, optionalLayers, algorithms, blockers }) {
  const skinDetailPurpose = input.specific_purpose === PERSONAL_GEOMETRY_PURPOSES.skinDetailReview;
  if (!skinDetailPurpose) {
    if (coreCategories.includes('skin_detail') || optionalLayers.skin_detail === true) {
      blockers.push('skin_detail_purpose_required');
    }
    return;
  }
  if (!coreCategories.includes('skin_detail')) blockers.push('skin_detail_category_required');
  if (!algorithms.some(item => item.algorithm_id === SKIN_DETAIL_CONTINUITY_ALGORITHM_ID
      && item.sha256 === SKIN_DETAIL_CONTINUITY_ALGORITHM_SHA256)) {
    blockers.push('skin_detail_algorithm_not_authorized');
  }
}

function hasRemoteRequest(input) {
  if (input.remote_processing_requested === true) return true;
  return REMOTE_FIELDS.some(field => input[field] !== undefined && input[field] !== null);
}

export async function personalGeometryNoticeDigest(
  text = PERSONAL_GEOMETRY_NOTICE_TEXT,
  subtle = globalThis.crypto?.subtle
) {
  if (!subtle?.digest) throw new Error('SHA-256 support is required for the consent gate.');
  const bytes = new TextEncoder().encode(text);
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Evaluate the pre-analysis gate and, only on success, create a minimal receipt.
 * No caller-controlled text is copied to the receipt.
 */
export async function evaluatePersonalGeometryConsent(input = {}, {
  now = Date.now(),
  subtle = globalThis.crypto?.subtle
} = {}) {
  const blockers = [];
  const exactDigest = await personalGeometryNoticeDigest(PERSONAL_GEOMETRY_NOTICE_TEXT, subtle);
  if (exactDigest !== PERSONAL_GEOMETRY_NOTICE_SHA256) {
    throw new Error('The Personal Geometry Pack notice digest does not match its versioned text.');
  }

  if (input.consent_granted === false) blockers.push('consent_refused');
  else if (input.consent_granted !== true) blockers.push('affirmative_consent_required');

  for (const field of ['consent_id', 'pack_id', 'subject_ref', 'account_ref']) {
    if (!SAFE_REF.test(String(input[field] || ''))) blockers.push(`${field}_required`);
  }
  if (input.notice_version !== PERSONAL_GEOMETRY_NOTICE_VERSION) blockers.push('stale_notice_version');
  if (String(input.notice_sha256 || '').toLowerCase() !== PERSONAL_GEOMETRY_NOTICE_SHA256) {
    blockers.push('notice_digest_mismatch');
  }
  if (!LOCALE.test(String(input.locale || ''))) blockers.push('locale_required');
  if (!JURISDICTION.test(String(input.subject_state_or_region || ''))) blockers.push('jurisdiction_required');
  if (!SUBJECT_ROLES.has(input.subject_role)) blockers.push('subject_role_required');
  if (input.adult_confirmed !== true) blockers.push('adult_confirmation_required');
  if (!PURPOSES.has(input.specific_purpose)) blockers.push('specific_purpose_mismatch');
  if (input.processing_mode !== PROCESSING_MODE) blockers.push('local_only_processing_required');
  if (hasRemoteRequest(input)) blockers.push('remote_processing_forbidden');

  const coreCategories = normalizeCoreCategories(input.core_categories, blockers);
  const optionalLayers = normalizeOptionalLayers(input.optional_layers, blockers);
  const algorithms = normalizeAlgorithms(input.algorithm_ids_and_digests, blockers);
  const tattooBinding = tattooPlacementBinding(input, {
    coreCategories, optionalLayers, algorithms, blockers
  });
  skinDetailBinding(input, { coreCategories, optionalLayers, algorithms, blockers });

  const signature = input.subject_signature || {};
  const signatureIsDirect = signature.signed_by === 'subject'
    && signature.direct_subject_action === true
    && String(signature.subject_ref || '') === String(input.subject_ref || '')
    && SAFE_REF.test(String(signature.signature_event_ref || ''))
    && SIGNATURE_METHODS.has(signature.signature_method)
    && signature.notice_version === PERSONAL_GEOMETRY_NOTICE_VERSION
    && String(signature.notice_sha256 || '').toLowerCase() === PERSONAL_GEOMETRY_NOTICE_SHA256
    && isIsoDate(signature.signed_at);
  if (!signatureIsDirect) blockers.push('direct_subject_signature_required');

  if (input.subject_role === 'self' && input.subject_ref !== input.account_ref) {
    blockers.push('self_subject_reference_mismatch');
  }
  if (input.subject_role === 'third_party') {
    blockers.push('third_party_subject_unsupported');
  }

  if (input.source_rights_confirmed !== true) blockers.push('source_rights_confirmation_required');
  if (optionalLayers.tattoos && input.appearance_rights_confirmed !== true) {
    blockers.push('tattoo_artwork_rights_confirmation_required');
  }

  const groupSource = input.group_source === true;
  if (groupSource) blockers.push('group_source_unsupported');
  if (input.bystander_inference_requested === true) blockers.push('bystander_inference_forbidden');

  if (input.local_retention_policy_id !== PERSONAL_GEOMETRY_RETENTION_POLICY_ID) {
    blockers.push('retention_policy_mismatch');
  }
  if (!isIsoDate(input.local_expires_at)) blockers.push('local_expiry_required');

  const signedAtMs = isIsoDate(signature.signed_at) ? Date.parse(signature.signed_at) : NaN;
  const expiresAtMs = isIsoDate(input.local_expires_at) ? Date.parse(input.local_expires_at) : NaN;
  if (Number.isFinite(signedAtMs) && signedAtMs > now + MAX_CLOCK_SKEW_MS) {
    blockers.push('subject_signature_in_future');
  }
  if (Number.isFinite(expiresAtMs)) {
    if (expiresAtMs <= now || (Number.isFinite(signedAtMs) && expiresAtMs <= signedAtMs)) {
      blockers.push('local_retention_expired');
    }
    if (Number.isFinite(signedAtMs) && expiresAtMs > addUtcYear(signature.signed_at)) {
      blockers.push('local_retention_exceeds_twelve_month_ceiling');
    }
  }

  const decisionBlockers = unique(blockers);
  if (decisionBlockers.length) {
    return deepFreeze({
      allowed: false,
      processing_mode: PROCESSING_MODE,
      blockers: decisionBlockers,
      receipt: null
    });
  }

  const receipt = {
    schema: PERSONAL_GEOMETRY_CONSENT_SCHEMA,
    status: 'active',
    consent_id: input.consent_id,
    pack_id: input.pack_id,
    subject_ref: input.subject_ref,
    account_ref: input.account_ref,
    notice_version: PERSONAL_GEOMETRY_NOTICE_VERSION,
    notice_sha256: PERSONAL_GEOMETRY_NOTICE_SHA256,
    locale: input.locale,
    subject_role: input.subject_role,
    subject_identity_assurance: 'self_attested_not_verified',
    subject_state_or_region: input.subject_state_or_region,
    adult_confirmed: true,
    specific_purpose: input.specific_purpose,
    core_categories: coreCategories,
    optional_layers: optionalLayers,
    identification_prohibited: true,
    training_prohibited: true,
    sale_prohibited: true,
    bystander_inference_prohibited: true,
    processing_mode: PROCESSING_MODE,
    local_retention_policy_id: PERSONAL_GEOMETRY_RETENTION_POLICY_ID,
    local_expires_at: input.local_expires_at,
    group_source: groupSource,
    manual_subject_crop_confirmed: groupSource,
    source_rights_confirmed: true,
    appearance_rights_confirmed: input.appearance_rights_confirmed === true,
    subject_signed_at: signature.signed_at,
    signature_method: signature.signature_method,
    signature_event_ref: signature.signature_event_ref,
    algorithm_ids_and_digests: algorithms,
    ...(tattooBinding || {}),
    withdrawn_at: null,
    deletion_requested_at: null,
    deletion_verified_at: null,
    receipt_created_at: new Date(now).toISOString()
  };

  return deepFreeze({
    allowed: true,
    processing_mode: PROCESSING_MODE,
    blockers: [],
    receipt
  });
}

export function withdrawPersonalGeometryConsent(receipt, {
  withdrawn_at = new Date().toISOString()
} = {}) {
  if (receipt?.schema !== PERSONAL_GEOMETRY_CONSENT_SCHEMA) {
    throw new TypeError('A Personal Geometry Pack consent receipt is required.');
  }
  if (!isIsoDate(withdrawn_at)) throw new TypeError('withdrawn_at must be an ISO timestamp.');
  if (receipt.status === 'withdrawn') return receipt;
  return deepFreeze({
    ...receipt,
    status: 'withdrawn',
    withdrawn_at,
    deletion_requested_at: withdrawn_at,
    deletion_verified_at: null
  });
}

export function personalGeometryConsentState(receipt, { now = Date.now() } = {}) {
  const blockers = [];
  if (receipt?.schema !== PERSONAL_GEOMETRY_CONSENT_SCHEMA) blockers.push('consent_receipt_invalid');
  if (receipt?.notice_version !== PERSONAL_GEOMETRY_NOTICE_VERSION
    || receipt?.notice_sha256 !== PERSONAL_GEOMETRY_NOTICE_SHA256) blockers.push('consent_notice_stale');
  if (receipt?.local_retention_policy_id !== PERSONAL_GEOMETRY_RETENTION_POLICY_ID) {
    blockers.push('consent_retention_policy_stale');
  }
  if (receipt?.processing_mode !== PROCESSING_MODE) blockers.push('remote_processing_forbidden');
  if (receipt?.subject_role !== 'self' || receipt?.subject_ref !== receipt?.account_ref) {
    blockers.push('self_subject_required');
  }
  if (receipt?.subject_identity_assurance !== 'self_attested_not_verified') {
    blockers.push('subject_identity_assurance_invalid');
  }
  if (receipt?.signature_method !== 'affirmative_release_button') {
    blockers.push('direct_subject_signature_required');
  }
  if (receipt?.group_source === true || receipt?.manual_subject_crop_confirmed === true) {
    blockers.push('group_source_unsupported');
  }
  if (receipt?.status === 'withdrawn' || receipt?.withdrawn_at) blockers.push('consent_withdrawn');
  if (!isIsoDate(receipt?.local_expires_at) || Date.parse(receipt.local_expires_at) <= now) {
    blockers.push('consent_expired');
  }
  if (receipt?.specific_purpose === PERSONAL_GEOMETRY_PURPOSES.tattooPlacement) {
    if (receipt.subject_role !== 'self' || receipt.subject_ref !== receipt.account_ref) {
      blockers.push('tattoo_placement_third_party_unsupported');
    }
    if (receipt.optional_layers?.tattoos !== true
        || !receipt.core_categories?.includes('tattoo_mapping')) {
      blockers.push('tattoo_placement_scope_invalid');
    }
    if (!(receipt.algorithm_ids_and_digests || []).some(item =>
      item.algorithm_id === TATTOO_PLACEMENT_ALGORITHM_ID
      && item.sha256 === TATTOO_PLACEMENT_ALGORITHM_SHA256)) {
      blockers.push('tattoo_placement_algorithm_not_authorized');
    }
    if (!SAFE_REF.test(String(receipt.target_asset_id || ''))) {
      blockers.push('tattoo_target_asset_binding_required');
    }
    const manualPlacement = receipt.source_pack_id === null && receipt.source_pack_subject_ref === null;
    const packPlacement = SAFE_REF.test(String(receipt.source_pack_id || ''))
      && SAFE_REF.test(String(receipt.source_pack_subject_ref || ''));
    if (!manualPlacement && !packPlacement) blockers.push('tattoo_source_pack_binding_invalid');
    if (packPlacement && receipt.source_pack_subject_ref !== receipt.subject_ref) {
      blockers.push('tattoo_source_pack_subject_mismatch');
    }
  }
  if (receipt?.specific_purpose === PERSONAL_GEOMETRY_PURPOSES.skinDetailReview) {
    if (!receipt.core_categories?.includes('skin_detail')) {
      blockers.push('skin_detail_scope_invalid');
    }
    if (!(receipt.algorithm_ids_and_digests || []).some(item =>
      item.algorithm_id === SKIN_DETAIL_CONTINUITY_ALGORITHM_ID
      && item.sha256 === SKIN_DETAIL_CONTINUITY_ALGORITHM_SHA256)) {
      blockers.push('skin_detail_algorithm_not_authorized');
    }
  }
  return deepFreeze({ allowed: blockers.length === 0, blockers: unique(blockers) });
}
