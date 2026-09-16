// Dedicated local persistence for consented Personal Geometry records.
// The database holds JSON-only consent and derived geometry records. Source
// media belongs to the ordinary asset store and is never accepted here.

import { HUMAN_GEOMETRY_SCHEMA } from './human-geometry.js';
import {
  CORE_GEOMETRY_CATEGORIES,
  OPTIONAL_APPEARANCE_LAYERS,
  PERSONAL_GEOMETRY_CONSENT_SCHEMA,
  PERSONAL_GEOMETRY_NOTICE_SHA256,
  PERSONAL_GEOMETRY_NOTICE_VERSION,
  PERSONAL_GEOMETRY_PURPOSES,
  PERSONAL_GEOMETRY_RETENTION_POLICY_ID,
  personalGeometryConsentState,
  withdrawPersonalGeometryConsent
} from './personal-geometry-consent.js';
import {
  LOCAL_FACE_MAP_SCHEMA,
  validateLocalFaceMap
} from './local-face-map.js';
import {
  PERSONAL_GEOMETRY_PACK_SCHEMA,
  validatePersonalGeometryPack
} from './personal-geometry-pack.js';
import {
  TATTOO_MAPPING_SCHEMA,
  validateTattooPlacementMap
} from './tattoo-mapping.js';

export const PERSONAL_GEOMETRY_STORAGE_SCHEMA = 'materiallogix.personal-geometry-local-store.v1';
export const PERSONAL_GEOMETRY_RECEIPT_RECORD_SCHEMA = 'materiallogix.personal-geometry-receipt-record.v1';
export const PERSONAL_GEOMETRY_DERIVED_RECORD_SCHEMA = 'materiallogix.personal-geometry-derived-record.v1';
export const PERSONAL_GEOMETRY_ASSOCIATION_SCHEMA = 'materiallogix.personal-geometry-association.v1';
export const PERSONAL_GEOMETRY_DELETION_RESULT_SCHEMA = 'materiallogix.personal-geometry-deletion-result.v1';
export const PERSONAL_GEOMETRY_TEMPORARY_TTL_MS = 60 * 60 * 1000;

const DB_NAME = 'materiallogix-personal-geometry';
const DB_VERSION = 1;
const STORE_NAME = 'state';
const STATE_KEY = 'current';
const MAX_DERIVED_JSON_BYTES = 8 * 1024 * 1024;
const MAX_STORAGE_JSON_BYTES = 64 * 1024 * 1024;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SAFE_RECEIPT_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const LOCALE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;
const JURISDICTION = /^[A-Z]{2}(?:-[A-Z0-9]{2,3})?$/;
const PURPOSES = new Set(Object.values(PERSONAL_GEOMETRY_PURPOSES));
const CORE_CATEGORIES = new Set(CORE_GEOMETRY_CATEGORIES);
const SIGNATURE_METHODS = new Set([
  'affirmative_release_button', 'typed_release', 'drawn_signature',
  'authenticated_subject_release'
]);
const RETENTION_CLASSES = new Set(['temporary', 'saved']);
const DERIVED_KINDS = new Set(['pack', 'face_map', 'geometry', 'tattoo_map']);
const LIFECYCLES = new Set([
  'active', 'withdrawn', 'asset_deleted', 'pack_deleted', 'project_deleted',
  'purpose_completed', 'account_closed', 'local_data_deleted', 'expired', 'invalid_receipt'
]);
const BINARY_FIELD_NAMES = new Set([
  'base64', 'bitmap', 'blob', 'canvas', 'dataurl', 'file', 'filedata',
  'filename', 'framedata', 'framebytes', 'imagedata', 'mediabytes', 'objecturl',
  'pixeldata', 'pixels', 'preview', 'rawmedia', 'rawmediaincluded',
  'rawmediauploaded', 'rgb', 'rgba',
  'sourcebytes', 'sourcemedia', 'thumbnail', 'texturepixels'
]);
const FALSE_POLICY_FIELDS = new Set(['rawmediaincluded', 'rawmediauploaded']);
const RECOVERY_KEYS = new Set([
  'facemap', 'facegeometry', 'geometry', 'geometryconsentid', 'geometrypackid',
  'humanGeometry'.toLowerCase(), 'identitycapturemode', 'identitypackid', 'localfacemapconsentid',
  'localfacemaps', 'peopleReview'.toLowerCase(), 'personalgeometry',
  'personalgeometryaccountref', 'personalgeometrycapturemode',
  'personalgeometryconsentid', 'personalgeometryconsentreceipts',
  'personalgeometrypack', 'personalgeometrypackid', 'tattoomap', 'tattoomapref'
]);
const SENSITIVE_ASSET_KEYS = new Set([
  'facemap', 'facegeometry', 'geometry', 'geometryconsentid', 'geometrypackid',
  'humangeometry', 'identitycapturemode', 'identitypackid',
  'localfacemapconsentid', 'localfacemaps', 'personalgeometrycapturemode',
  'personalgeometryconsentid', 'personalgeometrypack', 'personalgeometrypackid'
]);
const REMOTE_RECEIPT_FIELDS = new Set([
  'remote_processing_requested', 'remote_notice_version', 'remote_categories',
  'processor_class', 'execution_region', 'model_id_digest',
  'selected_ttl_seconds', 'terminal_cleanup_trigger',
  'residual_record_categories', 'no_training_term_version',
  'remote_subject_signed_at'
]);
const deletionSubscribers = new Set();

/**
 * Observe only verified local deletion results. This lets live consumers purge
 * sensitive in-memory readback caches when Privacy, asset, project, expiry, or
 * Pack controls close data through the shared storage module.
 */
export function subscribePersonalGeometryDeletion(listener) {
  if (typeof listener !== 'function') throw new TypeError('A deletion listener is required.');
  deletionSubscribers.add(listener);
  return () => deletionSubscribers.delete(listener);
}

function publishVerifiedDeletion(result) {
  if (result?.verified !== true || !Array.isArray(result?.affectedPackIds)) return;
  for (const listener of [...deletionSubscribers]) {
    try { listener(result); } catch { /* deletion remains authoritative */ }
  }
}

export class PersonalGeometryStorageError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'PersonalGeometryStorageError';
    this.code = code;
  }
}

function storageError(code, message) {
  return new PersonalGeometryStorageError(code, message);
}

function isIsoDate(value) {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function isoNow(clock) {
  const value = Number(clock());
  if (!Number.isFinite(value)) throw storageError('clock_invalid', 'The storage clock is invalid.');
  return new Date(value).toISOString();
}

function addUtcYear(value) {
  const date = new Date(value);
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.getTime();
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function jsonClone(value, {
  label = 'record', enforceNoMedia = false, maxBytes = MAX_DERIVED_JSON_BYTES
} = {}) {
  let nodeCount = 0;
  const visit = (item, path, depth) => {
    if (++nodeCount > 150_000 || depth > 48) {
      throw storageError('record_too_complex', `${label} is too complex to store safely.`);
    }
    if (item === null || typeof item === 'string' || typeof item === 'boolean') {
      if (typeof item === 'string' && (/^data:image\//i.test(item) || /^blob:/i.test(item))) {
        throw storageError('raw_pixels_forbidden', `${label} contains a media payload.`);
      }
      return item;
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw storageError('record_not_json', `${label} contains a non-finite number.`);
      return item;
    }
    if (typeof item !== 'object') {
      throw storageError('record_not_json', `${label} must contain JSON values only.`);
    }
    if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer
        || (typeof Blob !== 'undefined' && item instanceof Blob)) {
      throw storageError('raw_pixels_forbidden', `${label} contains binary or media data.`);
    }
    if (Array.isArray(item)) return item.map((child, index) => visit(child, `${path}[${index}]`, depth + 1));
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== Object.prototype && prototype !== null) {
      throw storageError('record_not_json', `${label} contains an unsupported object.`);
    }
    const result = {};
    for (const [key, child] of Object.entries(item)) {
      const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
      if (enforceNoMedia && BINARY_FIELD_NAMES.has(normalizedKey)) {
        if (!(FALSE_POLICY_FIELDS.has(normalizedKey) && child === false)) {
          throw storageError('raw_pixels_forbidden', `${label} contains the forbidden field ${path}.${key}.`);
        }
      }
      result[key] = visit(child, `${path}.${key}`, depth + 1);
    }
    return result;
  };
  const clone = visit(value, label, 0);
  const serialized = JSON.stringify(clone);
  if (new TextEncoder().encode(serialized).byteLength > maxBytes) {
    throw storageError('record_too_large', `${label} exceeds the local record size limit.`);
  }
  return clone;
}

function blankState() {
  return {
    key: STATE_KEY,
    schema: PERSONAL_GEOMETRY_STORAGE_SCHEMA,
    revision: 0,
    receipts: [],
    derived: [],
    associations: []
  };
}

function assertState(state) {
  if (!state || state.key !== STATE_KEY || state.schema !== PERSONAL_GEOMETRY_STORAGE_SCHEMA
      || !Number.isSafeInteger(state.revision) || state.revision < 0
      || !Array.isArray(state.receipts) || !Array.isArray(state.derived)
      || !Array.isArray(state.associations)) {
    throw storageError('storage_state_invalid', 'Personal Geometry local storage is malformed.');
  }
  const unique = (values, key) => values.every((value, index) =>
    typeof value?.[key] === 'string'
      && values.findIndex(candidate => candidate?.[key] === value[key]) === index);
  if (!unique(state.receipts, 'packId') || !unique(state.derived, 'id')
      || !unique(state.associations, 'id')) {
    throw storageError('storage_state_invalid', 'Personal Geometry local storage has duplicate or invalid keys.');
  }
  return state;
}

function minimalReceipt(input) {
  return {
    schema: input.schema,
    status: input.status,
    consent_id: input.consent_id,
    pack_id: input.pack_id,
    subject_ref: input.subject_ref,
    account_ref: input.account_ref,
    notice_version: input.notice_version,
    notice_sha256: input.notice_sha256,
    locale: input.locale,
    subject_role: input.subject_role,
    subject_identity_assurance: input.subject_identity_assurance,
    subject_state_or_region: input.subject_state_or_region,
    adult_confirmed: input.adult_confirmed,
    specific_purpose: input.specific_purpose,
    core_categories: Array.isArray(input.core_categories) ? [...input.core_categories] : input.core_categories,
    optional_layers: input.optional_layers && typeof input.optional_layers === 'object'
      ? Object.fromEntries(OPTIONAL_APPEARANCE_LAYERS.map(layer => [layer, input.optional_layers[layer]]))
      : input.optional_layers,
    identification_prohibited: input.identification_prohibited,
    training_prohibited: input.training_prohibited,
    sale_prohibited: input.sale_prohibited,
    bystander_inference_prohibited: input.bystander_inference_prohibited,
    processing_mode: input.processing_mode,
    local_retention_policy_id: input.local_retention_policy_id,
    local_expires_at: input.local_expires_at,
    group_source: input.group_source,
    manual_subject_crop_confirmed: input.manual_subject_crop_confirmed,
    source_rights_confirmed: input.source_rights_confirmed,
    appearance_rights_confirmed: input.appearance_rights_confirmed,
    target_asset_id: input.target_asset_id ?? null,
    source_pack_id: input.source_pack_id ?? null,
    source_pack_subject_ref: input.source_pack_subject_ref ?? null,
    subject_signed_at: input.subject_signed_at,
    signature_method: input.signature_method,
    signature_event_ref: input.signature_event_ref,
    algorithm_ids_and_digests: Array.isArray(input.algorithm_ids_and_digests)
      ? input.algorithm_ids_and_digests.map(item => ({
        algorithm_id: item?.algorithm_id,
        sha256: item?.sha256
      }))
      : input.algorithm_ids_and_digests,
    withdrawn_at: input.withdrawn_at ?? null,
    deletion_requested_at: input.deletion_requested_at ?? null,
    deletion_verified_at: input.deletion_verified_at ?? null,
    receipt_created_at: input.receipt_created_at
  };
}

function validateReceipt(input, { now, requireActive = true } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw storageError('consent_receipt_invalid', 'Personal Geometry consent is blocked: receipt shape.');
  }
  if ([...REMOTE_RECEIPT_FIELDS].some(field => input[field] !== undefined && input[field] !== null)) {
    throw storageError('consent_receipt_invalid', 'Personal Geometry consent is blocked: remote fields.');
  }
  const receipt = minimalReceipt(input || {});
  const invalid = [];
  if (receipt.schema !== PERSONAL_GEOMETRY_CONSENT_SCHEMA) invalid.push('schema');
  if (!['active', 'withdrawn'].includes(receipt.status)) invalid.push('status');
  for (const key of ['consent_id', 'pack_id', 'subject_ref', 'account_ref', 'signature_event_ref']) {
    if (!SAFE_RECEIPT_REF.test(String(receipt[key] || ''))) invalid.push(key);
  }
  if (receipt.notice_version !== PERSONAL_GEOMETRY_NOTICE_VERSION
      || receipt.notice_sha256 !== PERSONAL_GEOMETRY_NOTICE_SHA256) invalid.push('notice');
  if (receipt.local_retention_policy_id !== PERSONAL_GEOMETRY_RETENTION_POLICY_ID) invalid.push('retention_policy');
  if (receipt.processing_mode !== 'local_only') invalid.push('processing_mode');
  if (!PURPOSES.has(receipt.specific_purpose)) invalid.push('specific_purpose');
  if (!LOCALE.test(String(receipt.locale || ''))) invalid.push('locale');
  if (!JURISDICTION.test(String(receipt.subject_state_or_region || ''))) invalid.push('jurisdiction');
  if (!SIGNATURE_METHODS.has(receipt.signature_method)) invalid.push('signature_method');
  if (receipt.adult_confirmed !== true || receipt.source_rights_confirmed !== true) invalid.push('required_confirmation');
  if (typeof receipt.appearance_rights_confirmed !== 'boolean') invalid.push('appearance_rights_confirmation');
  if (receipt.identification_prohibited !== true || receipt.training_prohibited !== true
      || receipt.sale_prohibited !== true || receipt.bystander_inference_prohibited !== true) {
    invalid.push('prohibition_controls');
  }
  if (!['self', 'third_party'].includes(receipt.subject_role)) invalid.push('subject_role');
  if (receipt.subject_identity_assurance !== 'self_attested_not_verified') {
    invalid.push('subject_identity_assurance');
  }
  if (receipt.subject_role === 'self' && receipt.subject_ref !== receipt.account_ref) invalid.push('self_reference');
  if (receipt.subject_role === 'third_party' && receipt.subject_ref === receipt.account_ref) invalid.push('third_party_reference');
  if (!Array.isArray(receipt.core_categories) || receipt.core_categories.length < 2
      || !receipt.core_categories.includes('source_media')
      || new Set(receipt.core_categories).size !== receipt.core_categories.length
      || receipt.core_categories.some(category => !CORE_CATEGORIES.has(category))) invalid.push('core_categories');
  if (!receipt.optional_layers || OPTIONAL_APPEARANCE_LAYERS.some(
    layer => typeof receipt.optional_layers[layer] !== 'boolean'
  )) invalid.push('optional_layers');
  if (receipt.group_source !== true && receipt.group_source !== false) invalid.push('group_source');
  if (receipt.manual_subject_crop_confirmed !== true && receipt.manual_subject_crop_confirmed !== false) {
    invalid.push('subject_isolation');
  }
  if (receipt.group_source === true && receipt.manual_subject_crop_confirmed !== true) invalid.push('subject_isolation');
  if (!Array.isArray(receipt.algorithm_ids_and_digests) || receipt.algorithm_ids_and_digests.length < 1
      || receipt.algorithm_ids_and_digests.some(item => !SAFE_ID.test(String(item?.algorithm_id || ''))
        || !SHA256.test(String(item?.sha256 || '')))
      || new Set((receipt.algorithm_ids_and_digests || []).map(item => item?.algorithm_id)).size
        !== (receipt.algorithm_ids_and_digests || []).length) invalid.push('algorithm_manifest');
  for (const field of ['subject_signed_at', 'local_expires_at', 'receipt_created_at']) {
    if (!isIsoDate(receipt[field])) invalid.push(field);
  }
  const signedAt = Date.parse(receipt.subject_signed_at);
  const expiresAt = Date.parse(receipt.local_expires_at);
  const createdAt = Date.parse(receipt.receipt_created_at);
  if (Number.isFinite(signedAt) && Number.isFinite(expiresAt)
      && (expiresAt <= signedAt || expiresAt > addUtcYear(receipt.subject_signed_at))) invalid.push('retention_ceiling');
  if (Number.isFinite(signedAt) && Number.isFinite(createdAt) && createdAt + MAX_CLOCK_SKEW_MS < signedAt) {
    invalid.push('receipt_time');
  }
  if (requireActive) {
    const state = personalGeometryConsentState(receipt, { now });
    if (!state.allowed || receipt.status !== 'active') invalid.push(...state.blockers, 'receipt_inactive');
    if (signedAt > now + MAX_CLOCK_SKEW_MS || createdAt > now + MAX_CLOCK_SKEW_MS) invalid.push('receipt_time');
  }
  if (receipt.status === 'active'
      && [receipt.withdrawn_at, receipt.deletion_requested_at, receipt.deletion_verified_at]
        .some(value => value !== null)) {
    invalid.push('active_receipt_deletion_state');
  }
  if (receipt.status === 'withdrawn'
      && (!isIsoDate(receipt.withdrawn_at) || !isIsoDate(receipt.deletion_requested_at))) {
    invalid.push('withdrawal_state');
  }
  if (receipt.deletion_verified_at !== null && !isIsoDate(receipt.deletion_verified_at)) {
    invalid.push('deletion_verification_time');
  }
  if (invalid.length) {
    throw storageError('consent_receipt_invalid', `Personal Geometry consent is blocked: ${[...new Set(invalid)].join(', ')}.`);
  }
  return deepFreeze(jsonClone(receipt, { label: 'consent receipt' }));
}

function receiptEnvelope(receipt, projectId, storedAt) {
  return {
    schema: PERSONAL_GEOMETRY_RECEIPT_RECORD_SCHEMA,
    packId: receipt.pack_id,
    projectId,
    consentId: receipt.consent_id,
    accountRef: receipt.account_ref,
    purpose: receipt.specific_purpose,
    lifecycle: 'active',
    storedAt,
    closedAt: null,
    closeReason: null,
    deletionVerifiedAt: null,
    receipt
  };
}

function requireSafeId(value, field) {
  const normalized = String(value || '');
  if (!SAFE_ID.test(normalized)) throw storageError('identifier_invalid', `${field} is invalid.`);
  return normalized;
}

function assertEnvelope(envelope) {
  if (envelope?.schema !== PERSONAL_GEOMETRY_RECEIPT_RECORD_SCHEMA
      || !SAFE_ID.test(String(envelope.packId || ''))
      || !SAFE_ID.test(String(envelope.projectId || ''))
      || !SAFE_ID.test(String(envelope.consentId || ''))
      || !SAFE_ID.test(String(envelope.accountRef || ''))
      || !PURPOSES.has(envelope.purpose)
      || !LIFECYCLES.has(envelope.lifecycle)
      || !isIsoDate(envelope.storedAt)) {
    throw storageError('consent_receipt_record_invalid', 'The stored consent record is malformed.');
  }
  return envelope;
}

function requireActiveEnvelope(state, packId, now) {
  const envelope = state.receipts.find(item => item?.packId === packId);
  if (!envelope) throw storageError('consent_receipt_missing', 'No consent receipt is stored for this Pack.');
  assertEnvelope(envelope);
  if (envelope.lifecycle !== 'active') {
    throw storageError('consent_receipt_inactive', `The Pack is closed: ${envelope.lifecycle}.`);
  }
  const receipt = validateReceipt(envelope.receipt, { now, requireActive: true });
  if (receipt.pack_id !== envelope.packId || receipt.consent_id !== envelope.consentId
      || receipt.account_ref !== envelope.accountRef || receipt.specific_purpose !== envelope.purpose) {
    throw storageError('consent_receipt_binding_mismatch', 'The stored consent record does not match its Pack binding.');
  }
  return { envelope, receipt };
}

function validateAssociationInput(value, index) {
  const type = String(value?.type || 'geometry');
  const resourceId = requireSafeId(value?.resourceId || value?.id, `associations[${index}].resourceId`);
  if (!['asset', 'capture', 'geometry', 'project'].includes(type)) {
    throw storageError('association_type_invalid', `associations[${index}].type is invalid.`);
  }
  return { type, resourceId };
}

function assertNoRawMedia(value, label) {
  const clone = jsonClone(value, { label, enforceNoMedia: true });
  if (clone?.policy?.rawMediaIncluded !== undefined && clone.policy.rawMediaIncluded !== false) {
    throw storageError('raw_pixels_forbidden', `${label} does not declare raw media exclusion.`);
  }
  if (clone?.privacy?.rawMediaIncluded !== undefined && clone.privacy.rawMediaIncluded !== false) {
    throw storageError('raw_pixels_forbidden', `${label} does not declare raw media exclusion.`);
  }
  if (clone?.source?.rawMediaUploaded !== undefined && clone.source.rawMediaUploaded !== false) {
    throw storageError('raw_pixels_forbidden', `${label} does not declare raw media exclusion.`);
  }
  return clone;
}

function normalizeDerivedValue(kind, value, receipt, now, { sourcePackRecord = null } = {}) {
  const clone = assertNoRawMedia(value, `${kind} record`);
  if (kind === 'pack') {
    if (clone?.schema !== PERSONAL_GEOMETRY_PACK_SCHEMA) {
      throw storageError('pack_invalid', 'The derived Pack schema is invalid.');
    }
    const result = validatePersonalGeometryPack(clone, { consentReceipt: receipt, now });
    if (!result.valid) throw storageError('pack_invalid', `The derived Pack is blocked: ${result.findings.join(', ')}.`);
  } else if (kind === 'face_map') {
    if (clone?.schema !== LOCAL_FACE_MAP_SCHEMA) {
      throw storageError('face_map_invalid', 'The derived face-map schema is invalid.');
    }
    const result = validateLocalFaceMap(clone, { consentReceipt: receipt, now });
    if (!result.valid) throw storageError('face_map_invalid', `The derived face map is blocked: ${result.findings.join(', ')}.`);
  } else if (kind === 'geometry') {
    if (clone?.schema !== HUMAN_GEOMETRY_SCHEMA
        || clone?.privacy?.containsBiometricGeometry !== true
        || clone?.privacy?.identityVerified === true
        || clone?.source?.rawMediaUploaded !== false) {
      throw storageError('geometry_record_invalid', 'The temporary geometry record is invalid.');
    }
  } else {
    if (clone?.schema !== TATTOO_MAPPING_SCHEMA) {
      throw storageError('tattoo_map_invalid', 'The tattoo-placement map schema is invalid.');
    }
    const result = validateTattooPlacementMap(clone, {
      consentReceipt: receipt,
      targetAssetId: clone.targetAssetId,
      sourcePackRecord,
      now
    });
    if (!result.valid) {
      throw storageError('tattoo_map_invalid', `The tattoo-placement map is blocked: ${result.findings.join(', ')}.`);
    }
  }
  return deepFreeze(clone);
}

function normalizeRetention({ retentionClass, createdAt, expiresAt, receipt, now, kind }) {
  if (!RETENTION_CLASSES.has(retentionClass)) {
    throw storageError('retention_class_invalid', 'retentionClass must be temporary or saved.');
  }
  if (kind === 'geometry' && retentionClass !== 'temporary') {
    throw storageError('geometry_must_be_temporary', 'Standalone geometry records must use temporary retention.');
  }
  const created = createdAt || new Date(now).toISOString();
  if (!isIsoDate(created) || Date.parse(created) > now + MAX_CLOCK_SKEW_MS) {
    throw storageError('created_at_invalid', 'createdAt is invalid.');
  }
  const maximum = retentionClass === 'temporary'
    ? Math.min(
      Date.parse(created) + PERSONAL_GEOMETRY_TEMPORARY_TTL_MS,
      now + PERSONAL_GEOMETRY_TEMPORARY_TTL_MS,
      Date.parse(receipt.local_expires_at)
    )
    : Math.min(addUtcYear(new Date(now).toISOString()), Date.parse(receipt.local_expires_at));
  const expiry = expiresAt || new Date(maximum).toISOString();
  if (!isIsoDate(expiry) || Date.parse(expiry) <= now || Date.parse(expiry) > maximum) {
    throw storageError(
      retentionClass === 'temporary' ? 'temporary_retention_exceeds_one_hour' : 'saved_retention_exceeds_twelve_months',
      retentionClass === 'temporary'
        ? 'Temporary Personal Geometry may not be retained for more than one hour.'
        : 'Saved Personal Geometry may not be retained beyond the active receipt or twelve months.'
    );
  }
  return { retentionClass, createdAt: created, expiresAt: expiry };
}

function derivedRecord({ id, kind, projectId, receipt, retention, value, nowIso }) {
  return {
    schema: PERSONAL_GEOMETRY_DERIVED_RECORD_SCHEMA,
    id,
    kind,
    packId: receipt.pack_id,
    projectId,
    consentId: receipt.consent_id,
    accountRef: receipt.account_ref,
    purpose: receipt.specific_purpose,
    retentionClass: retention.retentionClass,
    createdAt: retention.createdAt,
    lastAuthorizedAt: nowIso,
    expiresAt: retention.expiresAt,
    value
  };
}

function associationRecord({ record, association, index }) {
  return {
    schema: PERSONAL_GEOMETRY_ASSOCIATION_SCHEMA,
    id: `${record.id}:${association.type}:${association.resourceId}:${index}`,
    derivedId: record.id,
    packId: record.packId,
    projectId: record.projectId,
    consentId: record.consentId,
    accountRef: record.accountRef,
    purpose: record.purpose,
    type: association.type,
    resourceId: association.resourceId,
    retentionClass: record.retentionClass,
    expiresAt: record.expiresAt
  };
}

function validateStoredDerived(record, state, now) {
  if (record?.schema !== PERSONAL_GEOMETRY_DERIVED_RECORD_SCHEMA
      || !DERIVED_KINDS.has(record.kind) || !RETENTION_CLASSES.has(record.retentionClass)
      || !SAFE_ID.test(String(record.id || '')) || !SAFE_ID.test(String(record.packId || ''))
      || !SAFE_ID.test(String(record.projectId || '')) || !isIsoDate(record.createdAt)
      || !isIsoDate(record.lastAuthorizedAt) || !isIsoDate(record.expiresAt)
      || Date.parse(record.lastAuthorizedAt) > now + MAX_CLOCK_SKEW_MS
      || Date.parse(record.expiresAt) <= now
      || (record.retentionClass === 'temporary'
        && Date.parse(record.expiresAt) > Math.min(
          Date.parse(record.createdAt) + PERSONAL_GEOMETRY_TEMPORARY_TTL_MS,
          Date.parse(record.lastAuthorizedAt) + PERSONAL_GEOMETRY_TEMPORARY_TTL_MS
        ))
      || (record.retentionClass === 'saved'
        && Date.parse(record.expiresAt) > addUtcYear(record.lastAuthorizedAt))
      || (record.kind === 'geometry' && record.retentionClass !== 'temporary')) {
    throw storageError('derived_record_invalid', 'A stored Personal Geometry record is malformed or expired.');
  }
  const { receipt } = requireActiveEnvelope(state, record.packId, now);
  if (Date.parse(record.expiresAt) > Date.parse(receipt.local_expires_at)) {
    throw storageError('derived_record_invalid', 'A stored Personal Geometry record exceeds its consent expiry.');
  }
  if (record.consentId !== receipt.consent_id || record.accountRef !== receipt.account_ref
      || record.purpose !== receipt.specific_purpose || record.projectId !== state.receipts
        .find(item => item.packId === record.packId)?.projectId) {
    throw storageError('derived_record_binding_mismatch', 'A stored Personal Geometry record has an invalid binding.');
  }
  const sourcePackRecord = record.kind === 'tattoo_map'
    ? sourcePackRecordForTattoo(state, record.value, record.projectId, now)
    : null;
  return normalizeDerivedValue(record.kind, record.value, receipt, now, { sourcePackRecord });
}

function sourcePackRecordForTattoo(state, map, projectId, now) {
  const sourcePackId = map?.sourcePackId || null;
  if (!sourcePackId) return null;
  const record = state.derived
    .filter(item => item?.kind === 'pack' && item.packId === sourcePackId && item.projectId === projectId)
    .sort((left, right) => Number(right.value?.revision || 0) - Number(left.value?.revision || 0))[0];
  if (!record) throw storageError('tattoo_source_pack_missing', 'The tattoo-placement source Pack is unavailable.');
  const pack = validateStoredDerived(record, state, now);
  const { receipt } = requireActiveEnvelope(state, sourcePackId, now);
  return { pack, receipt, expiresAt: record.expiresAt };
}

function normalizedKeys(value) {
  return Object.keys(value || {}).map(key => key.replace(/[^a-z0-9]/gi, '').toLowerCase());
}

function isSensitiveGeometryValue(value) {
  if (!value || typeof value !== 'object') return false;
  const schema = String(value.schema || '');
  return schema.startsWith('materiallogix.personal-geometry') || schema === LOCAL_FACE_MAP_SCHEMA
    || value.classification === 'biometric-sensitive'
    || value?.privacy?.containsBiometricGeometry === true
    || value?.authorization?.receiptSchema === PERSONAL_GEOMETRY_CONSENT_SCHEMA;
}

export function personalGeometryRecoveryAssetAllowed(asset) {
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) return false;
  if (isSensitiveGeometryValue(asset)) return false;
  return !Object.entries(asset).some(([key, value]) =>
    value !== undefined && value !== null
      && SENSITIVE_ASSET_KEYS.has(key.replace(/[^a-z0-9]/gi, '').toLowerCase()));
}

function sanitizeRecoveryValue(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map(sanitizeRecoveryValue).filter(item => item !== undefined);
  }
  if (isSensitiveGeometryValue(value)) return undefined;
  const keys = normalizedKeys(value);
  const assetLike = typeof value.id === 'string'
    && keys.some(key => ['filename', 'kind', 'placements', 'role'].includes(key));
  if (assetLike && !personalGeometryRecoveryAssetAllowed(value)) return undefined;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (RECOVERY_KEYS.has(key.replace(/[^a-z0-9]/gi, '').toLowerCase())) continue;
    const sanitized = sanitizeRecoveryValue(child);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  return output;
}

/**
 * Creates the ordinary project-recovery view. Sensitive records are excluded;
 * this module intentionally provides no switch that adds them back.
 */
export function personalGeometrySafeRecoveryView(value) {
  return jsonClone(sanitizeRecoveryValue(value), {
    label: 'recovery view', maxBytes: MAX_STORAGE_JSON_BYTES
  });
}

/**
 * IndexedDB adapter contract:
 * - read(visitor) supplies an isolated state snapshot.
 * - write(mutator) supplies a mutable state inside one serialized transaction.
 * Visitors and mutators must be synchronous.
 */
export function createIndexedDbPersonalGeometryAdapter({
  indexedDB = globalThis.indexedDB,
  dbName = DB_NAME
} = {}) {
  let databasePromise = null;

  const openDatabase = () => {
    if (!indexedDB?.open) {
      return Promise.reject(storageError('indexeddb_unavailable', 'Local Personal Geometry storage is unavailable.'));
    }
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          databasePromise = null;
        };
        database.onclose = () => { databasePromise = null; };
        resolve(database);
      };
      request.onerror = () => {
        databasePromise = null;
        reject(request.error || storageError('indexeddb_open_failed', 'Local Personal Geometry storage could not open.'));
      };
      request.onblocked = () => {
        databasePromise = null;
        reject(storageError('indexeddb_blocked', 'Close other Studio tabs and try local Personal Geometry storage again.'));
      };
    });
    return databasePromise;
  };

  const operate = async (mode, visitor) => {
    if (typeof visitor !== 'function') throw new TypeError('A synchronous storage visitor is required.');
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      let result;
      let settled = false;
      let transaction;
      const fail = error => {
        if (settled) return;
        settled = true;
        reject(error || storageError('indexeddb_transaction_failed', 'Local Personal Geometry storage failed.'));
      };
      try {
        transaction = database.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(STATE_KEY);
        request.onerror = () => fail(request.error);
        request.onsuccess = () => {
          try {
            const state = request.result === undefined
              ? blankState()
              : assertState(jsonClone(request.result, {
                label: 'storage state', maxBytes: MAX_STORAGE_JSON_BYTES
              }));
            result = visitor(state);
            if (result && typeof result.then === 'function') {
              throw new TypeError('Storage visitors must be synchronous.');
            }
            if (mode === 'readwrite') {
              assertState(state);
              state.revision += 1;
              store.put(state);
            }
          } catch (error) {
            fail(error);
            try { transaction.abort(); } catch { /* transaction already stopped */ }
          }
        };
        transaction.oncomplete = () => {
          if (settled) return;
          settled = true;
          resolve(deepFreeze(jsonClone(result, {
            label: 'storage result', maxBytes: MAX_STORAGE_JSON_BYTES
          })));
        };
        transaction.onerror = () => fail(transaction.error);
        transaction.onabort = () => fail(transaction.error || storageError(
          'indexeddb_transaction_aborted', 'Local Personal Geometry storage was not changed.'
        ));
      } catch (error) {
        fail(error);
      }
    });
  };

  return Object.freeze({
    read: visitor => operate('readonly', visitor),
    write: mutator => operate('readwrite', mutator)
  });
}

function verifyAdapter(adapter) {
  if (!adapter || typeof adapter.read !== 'function' || typeof adapter.write !== 'function') {
    throw new TypeError('A Personal Geometry storage adapter with read and write is required.');
  }
  return adapter;
}

function scopeDescriptor(scope) {
  return Object.fromEntries(Object.entries(scope).filter(([, value]) => value !== undefined));
}

function scopeMatches(value, scope) {
  if (scope.assetId !== undefined
      && (value?.type !== 'asset' || value?.resourceId !== scope.assetId)) return false;
  if (scope.packId !== undefined && value?.packId !== scope.packId) return false;
  if (scope.projectId !== undefined && value?.projectId !== scope.projectId) return false;
  if (scope.accountRef !== undefined && value?.accountRef !== scope.accountRef) return false;
  if (scope.purpose !== undefined && value?.purpose !== scope.purpose) return false;
  return true;
}

export function createPersonalGeometryStorage({
  adapter = createIndexedDbPersonalGeometryAdapter(),
  now = () => Date.now()
} = {}) {
  verifyAdapter(adapter);

  const read = visitor => adapter.read(state => visitor(assertState(state)));
  const write = mutator => adapter.write(state => mutator(assertState(state)));

  async function saveReceipt(receiptInput, { projectId } = {}) {
    const current = Number(now());
    const receipt = validateReceipt(receiptInput, { now: current, requireActive: true });
    const project = requireSafeId(projectId, 'projectId');
    const storedAt = new Date(current).toISOString();
    return write(state => {
      const consentConflict = state.receipts.find(item => item?.consentId === receipt.consent_id
        && item?.packId !== receipt.pack_id);
      if (consentConflict) {
        throw storageError('consent_id_conflict', 'The consent identifier is already bound to another Pack.');
      }
      const existing = state.receipts.find(item => item?.packId === receipt.pack_id);
      if (existing) {
        assertEnvelope(existing);
        if (existing.lifecycle !== 'active') {
          throw storageError('pack_closed', `This Pack is closed: ${existing.lifecycle}.`);
        }
        if (existing.projectId !== project || existing.consentId !== receipt.consent_id
            || JSON.stringify(existing.receipt) !== JSON.stringify(receipt)) {
          throw storageError('pack_receipt_conflict', 'This Pack already has a different consent binding.');
        }
        return receipt;
      }
      state.receipts.push(receiptEnvelope(receipt, project, storedAt));
      return receipt;
    });
  }

  async function getReceipt(packId) {
    const pack = requireSafeId(packId, 'packId');
    const current = Number(now());
    return read(state => {
      const envelope = state.receipts.find(item => item?.packId === pack);
      if (!envelope) return null;
      return requireActiveEnvelope(state, pack, current).receipt;
    });
  }

  async function saveDerived({
    id, kind, packId, projectId, value,
    retentionClass = 'saved', createdAt, expiresAt,
    associations = []
  } = {}) {
    const recordId = requireSafeId(id, 'id');
    const recordKind = String(kind || '');
    if (!DERIVED_KINDS.has(recordKind)) throw storageError('derived_kind_invalid', 'The derived record kind is invalid.');
    const pack = requireSafeId(packId, 'packId');
    const project = requireSafeId(projectId, 'projectId');
    const current = Number(now());
    const nowIso = new Date(current).toISOString();
    return write(state => {
      const { envelope, receipt } = requireActiveEnvelope(state, pack, current);
      if (envelope.projectId !== project) {
        throw storageError('project_binding_mismatch', 'The Pack is not bound to this project.');
      }
      const sourcePackRecord = recordKind === 'tattoo_map'
        ? sourcePackRecordForTattoo(state, value, project, current)
        : null;
      const normalized = normalizeDerivedValue(recordKind, value, receipt, current, { sourcePackRecord });
      const retention = normalizeRetention({
        retentionClass, createdAt, expiresAt, receipt, now: current, kind: recordKind
      });
      const record = derivedRecord({
        id: recordId, kind: recordKind, projectId: project,
        receipt, retention, value: normalized, nowIso
      });
      const prior = state.derived.find(item => item?.id === recordId);
      if (prior && (prior.packId !== pack || prior.kind !== recordKind)) {
        throw storageError('derived_id_conflict', 'The derived identifier is already used by another record.');
      }
      state.derived = state.derived.filter(item => item?.id !== recordId);
      state.derived.push(record);
      state.associations = state.associations.filter(item => item?.derivedId !== recordId);
      const normalizedAssociations = associations.map(validateAssociationInput);
      state.associations.push(...normalizedAssociations.map((association, index) =>
        associationRecord({ record, association, index })));
      return record;
    });
  }

  async function saveFaceMap(faceMap, {
    projectId, assetId, retentionClass = 'saved', createdAt, expiresAt, associations = []
  } = {}) {
    const linked = assetId
      ? [{ type: 'asset', resourceId: requireSafeId(assetId, 'assetId') }, ...associations]
      : associations;
    return saveDerived({
      id: `face-map:${requireSafeId(faceMap?.mapId, 'faceMap.mapId')}`,
      kind: 'face_map', packId: faceMap?.packId, projectId, value: faceMap,
      retentionClass, createdAt: createdAt || faceMap?.createdAt, expiresAt,
      associations: linked
    });
  }

  async function savePack(pack, {
    projectId, assetId, retentionClass = 'saved', createdAt, expiresAt, associations = []
  } = {}) {
    const revision = Number(pack?.revision);
    if (!Number.isSafeInteger(revision) || revision < 1) {
      throw storageError('pack_revision_invalid', 'The Pack revision is invalid.');
    }
    const linked = assetId
      ? [{ type: 'asset', resourceId: requireSafeId(assetId, 'assetId') }, ...associations]
      : associations;
    return saveDerived({
      id: `pack:${requireSafeId(pack?.packId, 'pack.packId')}:r${revision}`,
      kind: 'pack', packId: pack?.packId, projectId, value: pack,
      retentionClass, createdAt: createdAt || pack?.createdAt, expiresAt,
      associations: linked
    });
  }

  async function saveTattooMap(tattooMap, {
    projectId, assetId, retentionClass = 'saved', createdAt, expiresAt, associations = []
  } = {}) {
    const targetAssetId = requireSafeId(assetId, 'assetId');
    if (tattooMap?.targetAssetId !== targetAssetId) {
      throw storageError('tattoo_target_asset_mismatch', 'The tattoo-placement map is bound to a different target asset.');
    }
    return saveDerived({
      id: `tattoo-map:${requireSafeId(tattooMap?.mapId, 'tattooMap.mapId')}`,
      kind: 'tattoo_map', packId: tattooMap?.packId, projectId, value: tattooMap,
      retentionClass, createdAt: createdAt || tattooMap?.updatedAt, expiresAt,
      associations: [{ type: 'asset', resourceId: targetAssetId }, ...associations]
    });
  }

  async function saveTemporaryGeometry({
    id, packId, projectId, geometry, createdAt, expiresAt, assetId, associations = []
  } = {}) {
    const linked = assetId
      ? [{ type: 'asset', resourceId: requireSafeId(assetId, 'assetId') }, ...associations]
      : associations;
    return saveDerived({
      id, kind: 'geometry', packId, projectId, value: geometry,
      retentionClass: 'temporary', createdAt, expiresAt, associations: linked
    });
  }

  async function getDerived(id) {
    const recordId = requireSafeId(id, 'id');
    const current = Number(now());
    return read(state => {
      const record = state.derived.find(item => item?.id === recordId);
      if (!record) return null;
      const value = validateStoredDerived(record, state, current);
      return { ...record, value };
    });
  }

  async function getFaceMaps(packId, { assetId } = {}) {
    const pack = packId === undefined || packId === null ? null : requireSafeId(packId, 'packId');
    const asset = assetId === undefined ? null : requireSafeId(assetId, 'assetId');
    if (!pack && !asset) throw storageError('lookup_scope_required', 'A Pack or asset identifier is required.');
    const current = Number(now());
    return read(state => state.derived
      .filter(record => record?.kind === 'face_map' && (!pack || record.packId === pack))
      .filter(record => !asset || state.associations.some(association =>
        association?.derivedId === record.id && association.type === 'asset' && association.resourceId === asset))
      .map(record => {
        const value = validateStoredDerived(record, state, current);
        const receipt = requireActiveEnvelope(state, record.packId, current).receipt;
        return {
          packId: record.packId,
          mapId: value.mapId,
          expiresAt: record.expiresAt,
          faceMap: value,
          receipt
        };
      })
      .sort((left, right) => right.faceMap.createdAt.localeCompare(left.faceMap.createdAt)));
  }

  async function getTattooMapsForAsset(assetId) {
    const asset = requireSafeId(assetId, 'assetId');
    const current = Number(now());
    return read(state => state.derived
      .filter(record => record?.kind === 'tattoo_map')
      .filter(record => state.associations.some(association => association?.derivedId === record.id
        && association.type === 'asset' && association.resourceId === asset))
      .map(record => {
        const sourcePackRecord = sourcePackRecordForTattoo(state, record.value, record.projectId, current);
        const tattooMap = validateStoredDerived(record, state, current);
        const receipt = requireActiveEnvelope(state, record.packId, current).receipt;
        return {
          packId: record.packId,
          mapId: tattooMap.mapId,
          expiresAt: record.expiresAt,
          tattooMap,
          receipt,
          sourcePackRecord
        };
      })
      .sort((left, right) => String(right.tattooMap.updatedAt || '')
        .localeCompare(String(left.tattooMap.updatedAt || ''))));
  }

  async function getPack(packId) {
    const pack = requireSafeId(packId, 'packId');
    const current = Number(now());
    return read(state => {
      const records = state.derived.filter(record => record?.kind === 'pack' && record.packId === pack)
        .sort((left, right) => Number(right.value?.revision || 0) - Number(left.value?.revision || 0));
      if (!records.length) return null;
      const record = records[0];
      return {
        pack: validateStoredDerived(record, state, current),
        receipt: requireActiveEnvelope(state, pack, current).receipt,
        expiresAt: record.expiresAt
      };
    });
  }

  async function getPacksForAsset(assetId) {
    const asset = requireSafeId(assetId, 'assetId');
    const current = Number(now());
    return read(state => {
      const linkedIds = new Set(state.associations
        .filter(association => association?.type === 'asset' && association.resourceId === asset)
        .map(association => association.derivedId));
      const seenPackIds = new Set();
      return state.derived
        .filter(record => record?.kind === 'pack' && linkedIds.has(record.id))
        .sort((left, right) => {
          const revision = Number(right.value?.revision || 0) - Number(left.value?.revision || 0);
          return revision || String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
        })
        .flatMap(record => {
          if (seenPackIds.has(record.packId)) return [];
          try {
            const pack = validateStoredDerived(record, state, current);
            const receipt = requireActiveEnvelope(state, record.packId, current).receipt;
            seenPackIds.add(record.packId);
            return [{ pack, receipt, expiresAt: record.expiresAt }];
          } catch {
            return [];
          }
        });
    });
  }

  async function getPacksForProject(projectId) {
    const project = requireSafeId(projectId, 'projectId');
    const current = Number(now());
    return read(state => {
      const seenPackIds = new Set();
      return state.derived
        .filter(record => record?.kind === 'pack' && record.projectId === project)
        .sort((left, right) => {
          const revision = Number(right.value?.revision || 0) - Number(left.value?.revision || 0);
          return revision || String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
        })
        .flatMap(record => {
          if (seenPackIds.has(record.packId)) return [];
          try {
            const pack = validateStoredDerived(record, state, current);
            const receipt = requireActiveEnvelope(state, record.packId, current).receipt;
            seenPackIds.add(record.packId);
            return [{ pack, receipt, expiresAt: record.expiresAt }];
          } catch {
            return [];
          }
        });
    });
  }

  async function linkPackToAsset(packId, { projectId, assetId } = {}) {
    const pack = requireSafeId(packId, 'packId');
    const project = requireSafeId(projectId, 'projectId');
    const asset = requireSafeId(assetId, 'assetId');
    const current = Number(now());
    return write(state => {
      const record = state.derived
        .filter(item => item?.kind === 'pack' && item.packId === pack)
        .sort((left, right) => Number(right.value?.revision || 0) - Number(left.value?.revision || 0))[0];
      if (!record) throw storageError('pack_missing', 'The selected local Pack is unavailable.');
      if (record.projectId !== project) {
        throw storageError('project_binding_mismatch', 'The selected Pack belongs to a different project.');
      }
      const packValue = validateStoredDerived(record, state, current);
      const { receipt } = requireActiveEnvelope(state, pack, current);
      if (receipt.optional_layers?.tattoos !== true || !['body', 'combined'].includes(packValue.captureMode)) {
        throw storageError('tattoo_pack_scope_required', 'The selected Pack is not authorized for tattoo placement.');
      }
      const existing = state.associations.find(item => item?.derivedId === record.id
        && item.type === 'asset' && item.resourceId === asset);
      if (existing) return { packId: pack, assetId: asset, associationId: existing.id, verified: true };
      const association = validateAssociationInput({ type: 'asset', resourceId: asset });
      const index = state.associations.filter(item => item?.derivedId === record.id).length;
      const linked = associationRecord({ record, association, index });
      state.associations.push(linked);
      const verified = state.associations.some(item => item.id === linked.id
        && item.derivedId === record.id && item.resourceId === asset);
      if (!verified) throw storageError('association_readback_failed', 'The local Pack link could not be verified.');
      return { packId: pack, assetId: asset, associationId: linked.id, verified: true };
    });
  }

  async function closeScope(scopeInput, { reason, at, withdrawal = false } = {}) {
    const scope = scopeDescriptor(scopeInput);
    const timestamp = at || isoNow(now);
    if (!isIsoDate(timestamp)) throw storageError('deletion_time_invalid', 'The deletion time is invalid.');
    const mutation = await write(state => {
      const packIds = new Set();
      for (const collection of [state.receipts, state.derived, state.associations]) {
        for (const item of collection) if (scopeMatches(item, scope) && item?.packId) packIds.add(item.packId);
      }
      // A tattoo-placement receipt depends on its source body Pack. Closing the
      // source must also remove every map derived from it, even when the map has
      // a distinct purpose-bound receipt.
      let dependencyAdded = true;
      while (dependencyAdded) {
        dependencyAdded = false;
        for (const record of state.derived) {
          if (record?.kind !== 'tattoo_map' || !packIds.has(record.value?.sourcePackId)
              || packIds.has(record.packId)) continue;
          packIds.add(record.packId);
          dependencyAdded = true;
        }
      }
      let removedDerived = 0;
      let removedAssociations = 0;
      for (const envelope of state.receipts) {
        if (!packIds.has(envelope?.packId)) continue;
        if (envelope.lifecycle === 'active' || !LIFECYCLES.has(envelope.lifecycle) || withdrawal) {
          envelope.lifecycle = reason;
          envelope.closedAt = timestamp;
          envelope.closeReason = reason;
          envelope.deletionVerifiedAt = null;
          if (withdrawal) {
            const source = minimalReceipt(envelope.receipt || {});
            if (source.schema === PERSONAL_GEOMETRY_CONSENT_SCHEMA) {
              envelope.receipt = withdrawPersonalGeometryConsent(source, { withdrawn_at: timestamp });
            }
          }
        }
      }
      state.derived = state.derived.filter(record => {
        if (!packIds.has(record?.packId)) return true;
        removedDerived += 1;
        return false;
      });
      state.associations = state.associations.filter(association => {
        if (!packIds.has(association?.packId)) return true;
        removedAssociations += 1;
        return false;
      });
      return { packIds: [...packIds].sort(), removedDerived, removedAssociations };
    });

    const affected = item => mutation.packIds.includes(item?.packId);
    const readback = await read(state => ({
      derivedRecords: state.derived.filter(affected).length,
      associations: state.associations.filter(affected).length,
      activeReceipts: state.receipts.filter(item => affected(item) && item?.lifecycle === 'active').length
    }));
    if (readback.derivedRecords || readback.associations || readback.activeReceipts) {
      throw storageError('deletion_readback_failed', 'Personal Geometry deletion could not be verified.');
    }

    const verifiedAt = isoNow(now);
    await write(state => {
      for (const envelope of state.receipts) {
        if (!mutation.packIds.includes(envelope?.packId)) continue;
        envelope.deletionVerifiedAt = verifiedAt;
        if (withdrawal && envelope.receipt?.status === 'withdrawn') {
          envelope.receipt = deepFreeze({ ...envelope.receipt, deletion_verified_at: verifiedAt });
        }
      }
      return true;
    });
    const finalReadback = await read(state => ({
      derivedRecords: state.derived.filter(affected).length,
      associations: state.associations.filter(affected).length,
      activeReceipts: state.receipts.filter(item => affected(item) && item?.lifecycle === 'active').length,
      verifiedReceipts: state.receipts.filter(item => mutation.packIds.includes(item?.packId)
        && isIsoDate(item?.deletionVerifiedAt)).length
    }));
    if (finalReadback.derivedRecords || finalReadback.associations || finalReadback.activeReceipts
        || finalReadback.verifiedReceipts !== mutation.packIds.length) {
      throw storageError('deletion_readback_failed', 'Personal Geometry deletion could not be verified.');
    }
    const result = deepFreeze({
      schema: PERSONAL_GEOMETRY_DELETION_RESULT_SCHEMA,
      reason,
      scope,
      requestedAt: timestamp,
      verifiedAt,
      verified: true,
      affectedPackIds: mutation.packIds,
      removed: {
        derivedRecords: mutation.removedDerived,
        associations: mutation.removedAssociations
      },
      readback: finalReadback
    });
    publishVerifiedDeletion(result);
    return result;
  }

  const deletePack = (packId, options = {}) => closeScope(
    { packId: requireSafeId(packId, 'packId') },
    { reason: 'pack_deleted', at: options.deletedAt }
  );
  const deleteAsset = (assetId, options = {}) => closeScope(
    { assetId: requireSafeId(assetId, 'assetId') },
    { reason: 'asset_deleted', at: options.deletedAt }
  );
  const deleteProject = (projectId, options = {}) => closeScope(
    { projectId: requireSafeId(projectId, 'projectId') },
    { reason: 'project_deleted', at: options.deletedAt }
  );
  const completePurpose = (packId, options = {}) => closeScope(
    { packId: requireSafeId(packId, 'packId') },
    { reason: 'purpose_completed', at: options.completedAt }
  );
  const closeAccount = (accountRef, options = {}) => closeScope(
    { accountRef: requireSafeId(accountRef, 'accountRef') },
    { reason: 'account_closed', at: options.closedAt }
  );
  const withdraw = (packId, options = {}) => closeScope(
    { packId: requireSafeId(packId, 'packId') },
    { reason: 'withdrawn', at: options.withdrawnAt, withdrawal: true }
  );
  const closeAllLocal = (options = {}) => closeScope(
    {},
    { reason: 'local_data_deleted', at: options.deletedAt }
  );
  const closeAllLocalAccount = (options = {}) => closeScope(
    {},
    { reason: 'account_closed', at: options.closedAt }
  );

  async function sweepExpired({ at } = {}) {
    const timestamp = at || isoNow(now);
    if (!isIsoDate(timestamp)) throw storageError('sweep_time_invalid', 'The expiry sweep time is invalid.');
    const current = Date.parse(timestamp);
    const mutation = await write(state => {
      const closedPackIds = new Set();
      const affectedPackIds = new Set();
      for (const envelope of state.receipts) {
        if (envelope?.lifecycle !== 'active') continue;
        try {
          assertEnvelope(envelope);
          validateReceipt(envelope.receipt, { now: current, requireActive: true });
        } catch (error) {
          const expired = isIsoDate(envelope?.receipt?.local_expires_at)
            && Date.parse(envelope.receipt.local_expires_at) <= current;
          envelope.lifecycle = expired ? 'expired' : 'invalid_receipt';
          envelope.closedAt = timestamp;
          envelope.closeReason = envelope.lifecycle;
          envelope.deletionVerifiedAt = null;
          closedPackIds.add(envelope.packId);
        }
      }
      let dependencyAdded = true;
      while (dependencyAdded) {
        dependencyAdded = false;
        for (const record of state.derived) {
          if (record?.kind !== 'tattoo_map' || !closedPackIds.has(record.value?.sourcePackId)
              || closedPackIds.has(record.packId)) continue;
          closedPackIds.add(record.packId);
          dependencyAdded = true;
        }
      }
      let removedDerived = 0;
      let removedAssociations = 0;
      const removedDerivedIds = new Set();
      state.derived = state.derived.filter(record => {
        const remove = closedPackIds.has(record?.packId)
          || !isIsoDate(record?.expiresAt) || Date.parse(record.expiresAt) <= current;
        if (remove) {
          removedDerived += 1;
          if (record?.id) removedDerivedIds.add(record.id);
          if (record?.packId) affectedPackIds.add(record.packId);
        }
        return !remove;
      });
      state.associations = state.associations.filter(association => {
        const remove = closedPackIds.has(association?.packId)
          || removedDerivedIds.has(association?.derivedId)
          || !state.derived.some(record => record?.id === association?.derivedId)
          || !isIsoDate(association?.expiresAt) || Date.parse(association.expiresAt) <= current;
        if (remove) {
          removedAssociations += 1;
          if (association?.packId) affectedPackIds.add(association.packId);
        }
        return !remove;
      });
      for (const packId of closedPackIds) affectedPackIds.add(packId);
      return {
        closedPackIds: [...closedPackIds].sort(),
        affectedPackIds: [...affectedPackIds].sort(),
        removedDerived,
        removedAssociations
      };
    });

    const readback = await read(state => {
      let invalidActiveReceipts = 0;
      for (const envelope of state.receipts.filter(item => item?.lifecycle === 'active')) {
        try {
          assertEnvelope(envelope);
          validateReceipt(envelope.receipt, { now: current, requireActive: true });
        } catch { invalidActiveReceipts += 1; }
      }
      return {
        invalidActiveReceipts,
        expiredDerivedRecords: state.derived.filter(record =>
          !isIsoDate(record?.expiresAt) || Date.parse(record.expiresAt) <= current).length,
        expiredOrOrphanedAssociations: state.associations.filter(association =>
          !isIsoDate(association?.expiresAt) || Date.parse(association.expiresAt) <= current
          || !state.derived.some(record => record?.id === association?.derivedId)).length
      };
    });
    if (Object.values(readback).some(Boolean)) {
      throw storageError('expiry_readback_failed', 'The expiry sweep could not be verified.');
    }
    if (mutation.closedPackIds.length) {
      const verifiedAt = isoNow(now);
      await write(state => {
        for (const envelope of state.receipts) {
          if (!mutation.closedPackIds.includes(envelope?.packId)) continue;
          envelope.deletionVerifiedAt = verifiedAt;
        }
        return true;
      });
    }
    const result = deepFreeze({
      at: timestamp,
      closedPackIds: mutation.closedPackIds,
      affectedPackIds: mutation.affectedPackIds,
      removed: {
        derivedRecords: mutation.removedDerived,
        associations: mutation.removedAssociations
      },
      readback,
      verified: true
    });
    publishVerifiedDeletion({ ...result, reason: 'expired', scope: {} });
    return result;
  }

  return Object.freeze({
    saveReceipt,
    getReceipt,
    saveDerived,
    saveFaceMap,
    savePack,
    saveTattooMap,
    saveTemporaryGeometry,
    getDerived,
    getFaceMaps,
    getFaceMapsForAsset: assetId => getFaceMaps(null, { assetId }),
    getTattooMapsForAsset,
    getPack,
    getPacksForAsset,
    getPacksForProject,
    linkPackToAsset,
    sweepExpired,
    withdraw,
    deleteAsset,
    deletePack,
    deleteProject,
    completePurpose,
    closeAccount,
    closeAllLocal,
    closeAllLocalAccount,
    recoveryView: personalGeometrySafeRecoveryView
  });
}

let defaultStorage = null;

function localStorageService() {
  if (!defaultStorage) defaultStorage = createPersonalGeometryStorage();
  return defaultStorage;
}

export const savePersonalGeometryConsentReceipt = (receipt, options) =>
  localStorageService().saveReceipt(receipt, options);
export const getPersonalGeometryConsentReceipt = packId =>
  localStorageService().getReceipt(packId);
export const savePersonalGeometryFaceMap = (faceMap, options) =>
  localStorageService().saveFaceMap(faceMap, options);
export const getPersonalGeometryFaceMaps = (packId, options) =>
  localStorageService().getFaceMaps(packId, options);
export const getPersonalGeometryFaceMapsForAsset = assetId =>
  localStorageService().getFaceMapsForAsset(assetId);
export const savePersonalGeometryPack = (pack, options) =>
  localStorageService().savePack(pack, options);
export const savePersonalGeometryTattooMap = (tattooMap, options) =>
  localStorageService().saveTattooMap(tattooMap, options);
export const getPersonalGeometryPacksForAsset = assetId =>
  localStorageService().getPacksForAsset(assetId);
export const getPersonalGeometryPacksForProject = projectId =>
  localStorageService().getPacksForProject(projectId);
export const getPersonalGeometryTattooMapsForAsset = assetId =>
  localStorageService().getTattooMapsForAsset(assetId);
export const linkPersonalGeometryPackToAsset = (packId, options) =>
  localStorageService().linkPackToAsset(packId, options);
export const saveTemporaryPersonalGeometry = options =>
  localStorageService().saveTemporaryGeometry(options);
export const sweepExpiredPersonalGeometryData = options =>
  localStorageService().sweepExpired(options);
export const withdrawAndDeletePersonalGeometry = (packId, options) =>
  localStorageService().withdraw(packId, options);
export const deletePersonalGeometryPack = (packId, options) =>
  localStorageService().deletePack(packId, options);
export const deletePersonalGeometryAsset = (assetId, options) =>
  localStorageService().deleteAsset(assetId, options);
export const deletePersonalGeometryProject = (projectId, options) =>
  localStorageService().deleteProject(projectId, options);
export const completePersonalGeometryPurpose = (packId, options) =>
  localStorageService().completePurpose(packId, options);
export const closePersonalGeometryAccount = (accountRef, options) =>
  localStorageService().closeAccount(accountRef, options);
export const closeAllLocalPersonalGeometryData = options =>
  localStorageService().closeAllLocal(options);
export const closeAllLocalPersonalGeometryAccount = options =>
  localStorageService().closeAllLocalAccount(options);
