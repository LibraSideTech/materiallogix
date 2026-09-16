export const CANONICAL_APP_ORIGIN = 'https://materiallogix.com';
export const API_ORIGIN_META_NAME = 'materiallogix-api-origin';

const isLoopback = hostname => hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname);

function runtimeApiOrigin() {
  const runtime = globalThis.__MATERIALLOGIX_CONFIG__;
  if (runtime && typeof runtime === 'object' && Object.prototype.hasOwnProperty.call(runtime, 'apiOrigin')) {
    return runtime.apiOrigin;
  }
  return globalThis.document?.querySelector?.(`meta[name="${API_ORIGIN_META_NAME}"]`)?.content;
}

/**
 * Production always uses the canonical page origin. Test and local clients may
 * opt in to another API origin through the runtime object or meta tag; without
 * one they remain same-origin and can never silently send credentials to prod.
 */
export function resolveApiOrigin({
  pageUrl = globalThis.location?.href,
  configuredOrigin = runtimeApiOrigin()
} = {}) {
  const page = pageUrl ? new URL(pageUrl) : null;
  if (page?.origin === CANONICAL_APP_ORIGIN) return '';
  if (configuredOrigin == null || configuredOrigin === '') return '';
  if (typeof configuredOrigin !== 'string') throw new Error('invalid_materiallogix_api_origin');

  let configured;
  try {
    configured = new URL(configuredOrigin);
  } catch {
    throw new Error('invalid_materiallogix_api_origin');
  }
  if (!['http:', 'https:'].includes(configured.protocol) || configured.username || configured.password ||
      configured.pathname !== '/' || configured.search || configured.hash ||
      (configured.protocol !== 'https:' && !isLoopback(configured.hostname))) {
    throw new Error('invalid_materiallogix_api_origin');
  }
  if (configured.origin === CANONICAL_APP_ORIGIN) {
    throw new Error('nonproduction_api_origin_points_to_production');
  }
  return configured.origin === page?.origin ? '' : configured.origin;
}

export const API_ORIGIN = resolveApiOrigin();

export function apiUrl(path) {
  const normalized = String(path || '').startsWith('/api/')
    ? String(path)
    : `/api/${String(path || '').replace(/^\/+/, '')}`;
  return `${API_ORIGIN}${normalized}`;
}
