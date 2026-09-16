import { MUSIC_PROJECT_SCHEMA, sanitizeMusicProject } from './music.js';

const DB_NAME = 'materiallogix-music';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const ASSETS = 'assets';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Music storage failed.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('Music storage was interrupted.'));
    transaction.onerror = () => reject(transaction.error || new Error('Music storage failed.'));
  });
}

export function openMusicStore(indexedDBFactory = globalThis.indexedDB) {
  if (!indexedDBFactory) return Promise.reject(new Error('This browser cannot save Music projects.'));
  return new Promise((resolve, reject) => {
    const request = indexedDBFactory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECTS)) {
        const projects = database.createObjectStore(PROJECTS, { keyPath: 'id' });
        projects.createIndex('updatedAt', 'updatedAt');
      }
      if (!database.objectStoreNames.contains(ASSETS)) {
        const assets = database.createObjectStore(ASSETS, { keyPath: 'id' });
        assets.createIndex('projectId', 'projectId');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Music storage could not open.'));
    request.onblocked = () => reject(new Error('Close the other Music Studio tab, then try again.'));
  });
}

export async function saveMusicProject(database, project, entitledTier = project?.tier) {
  const clean = sanitizeMusicProject(project, entitledTier);
  clean.schema = MUSIC_PROJECT_SCHEMA;
  clean.updatedAt = new Date().toISOString();
  clean.revision = Math.max(1, Number(project.revision) || 1) + 1;
  const transaction = database.transaction(PROJECTS, 'readwrite');
  transaction.objectStore(PROJECTS).put(clean);
  await transactionDone(transaction);
  return clean;
}

export async function loadMusicProject(database, projectId, entitledTier = 'standard') {
  const transaction = database.transaction(PROJECTS, 'readonly');
  const value = await requestResult(transaction.objectStore(PROJECTS).get(String(projectId)));
  await transactionDone(transaction);
  return value ? sanitizeMusicProject(value, entitledTier) : null;
}

export async function listMusicProjects(database, entitledTier = 'standard') {
  const transaction = database.transaction(PROJECTS, 'readonly');
  const values = await requestResult(transaction.objectStore(PROJECTS).getAll());
  await transactionDone(transaction);
  return values.map(value => sanitizeMusicProject(value, entitledTier)).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function saveMusicAsset(database, { id, projectId, name, type, blob, duration, sampleRate, channels }) {
  if (!id || !projectId || !(blob instanceof Blob)) throw new Error('Music assets need a project, an id, and audio data.');
  const record = {
    id: String(id),
    projectId: String(projectId),
    name: String(name || 'Audio').slice(0, 160),
    type: String(type || blob.type || 'audio/wav').slice(0, 80),
    blob,
    duration: Math.max(0, Number(duration) || 0),
    sampleRate: Math.max(1, Number(sampleRate) || 48_000),
    channels: Math.max(1, Math.min(2, Number(channels) || 1)),
    savedAt: new Date().toISOString()
  };
  const transaction = database.transaction(ASSETS, 'readwrite');
  transaction.objectStore(ASSETS).put(record);
  await transactionDone(transaction);
  return record;
}

export async function loadMusicAsset(database, assetId) {
  const transaction = database.transaction(ASSETS, 'readonly');
  const value = await requestResult(transaction.objectStore(ASSETS).get(String(assetId)));
  await transactionDone(transaction);
  return value || null;
}

export async function deleteMusicProject(database, projectId) {
  const transaction = database.transaction([PROJECTS, ASSETS], 'readwrite');
  transaction.objectStore(PROJECTS).delete(String(projectId));
  const assets = transaction.objectStore(ASSETS).index('projectId');
  const range = globalThis.IDBKeyRange?.only(String(projectId));
  if (!range) throw new Error('This browser cannot complete project cleanup safely.');
  const cursor = assets.openKeyCursor(range);
  cursor.onsuccess = () => {
    const result = cursor.result;
    if (!result) return;
    transaction.objectStore(ASSETS).delete(result.primaryKey);
    result.continue();
  };
  await transactionDone(transaction);
}
