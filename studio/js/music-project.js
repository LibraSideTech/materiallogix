// The bridge between Music and the project the rest of the Studio shares.
//
// Music kept its own database and never touched `cros:project`, so a song could
// not be placed under a cut and a cut's audio could not be worked on. Photo and
// Video already share one project; Voice reads video durations from it. This
// gives Music both directions: bring project audio in, and hand a finished
// master back so another Studio can use it.
//
// The pure parts live here so they can be tested without a browser; the page
// does the IndexedDB work through js/store.js.

/** Kinds Music can take in. Video counts: its audio is what a song sits under. */
const IMPORTABLE = new Set(['audio', 'video']);

/** Which of a project's assets Music can open, oldest first as stored. */
export function importableAssets(assets = []) {
  return assets.filter(asset => asset && IMPORTABLE.has(asset.kind));
}

/** The project the rest of the Studio currently has open, if any. */
export function activeProjectId(search = '', stored = null) {
  const fromUrl = new URLSearchParams(search).get('project');
  return fromUrl || stored || null;
}

/**
 * The asset record a finished master becomes. Written to the shared schema
 * rather than Music's own, so Video lists it like any other clip. `role` is
 * 'selected' because a master is a finished deliverable, not a candidate
 * someone still has to review.
 */
export function masterAsset({ projectId, filename, mime = 'audio/wav', bytes = 0, duration = 0, studio = 'music' }) {
  if (!projectId) throw new Error('Open a Studio project before sending a master to it.');
  if (!filename) throw new Error('A master needs a filename.');
  return {
    id: globalThis.crypto?.randomUUID?.() || `asset-${Math.random().toString(36).slice(2)}`,
    projectId: String(projectId),
    filename: String(filename),
    mime,
    kind: 'audio',
    bytes: Math.max(0, Number(bytes) || 0),
    addedAt: new Date().toISOString(),
    role: 'selected',
    status: 'approved',
    rating: 0,
    source: studio,
    labels: { campaign: '', audience: '', lane: '' },
    notes: '',
    altText: '',
    provenance: 'Mixed and mastered in Music Studio on this device.',
    qa: {},
    duration: Math.max(0, Number(duration) || 0),
    width: 0,
    height: 0
  };
}

/** A label for the picker: what it is, how long, and where it came from. */
export function assetLabel(asset) {
  const seconds = Number(asset?.duration) || 0;
  const length = seconds ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}` : '';
  return [asset?.filename || 'Untitled', asset?.kind, length].filter(Boolean).join(' · ');
}
