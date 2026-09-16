import { apiUrl } from './api-root.js';

const HOSTED = new Set(['materiallogix.com', 'studio.materiallogix.com']);

export async function cleanupRemoteMedia(fetcher = fetch) {
  try {
    const response = await fetcher(apiUrl('/api/session/logout'), {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      keepalive: true,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(8_000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function installSignOutControl({ hosted = HOSTED.has(location.hostname), fetcher = fetch } = {}) {
  if (!hosted || document.querySelector('#materiallogixSignOut')) return null;
  const topbar = document.querySelector('header.topbar');
  if (!topbar) return null;
  const button = document.createElement('button');
  button.id = 'materiallogixSignOut';
  button.className = 'btn';
  button.type = 'button';
  button.textContent = 'Sign out';
  button.title = 'Delete job-scoped remote media, end this Studio session, and require a new email code.';
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Cleaning up…';
    await cleanupRemoteMedia(fetcher);
    location.assign('/cdn-cgi/access/logout');
  });
  const primary = topbar.querySelector('.primary');
  topbar.insertBefore(button, primary || null);
  return button;
}
