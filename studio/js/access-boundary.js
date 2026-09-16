const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

export function studioAccessMode({ hostname, explicitDemo = false, authenticated = false }) {
  if (LOOPBACK.has(String(hostname || '').toLowerCase())) return 'local';
  if (explicitDemo) return 'demo';
  return authenticated ? 'authenticated' : 'blocked';
}

export function oneTimeCodeLoginUrl(currentHref) {
  const current = new URL(currentHref);
  if (LOOPBACK.has(current.hostname.toLowerCase())) throw new Error('hosted_login_not_required');
  const login = new URL(`/cdn-cgi/access/login/${current.hostname}`, current.origin);
  login.searchParams.set('redirect_url', current.href);
  return login.href;
}

export async function installBootstrapLicense(session, activateLicense) {
  if (!session?.authenticated || typeof session?.bootstrapLicenseKey !== 'string') return false;
  if (typeof activateLicense !== 'function') throw new Error('license_activator_required');
  const activated = await activateLicense(session.bootstrapLicenseKey);
  if (!activated) throw new Error('bootstrap_license_activation_failed');
  return true;
}
