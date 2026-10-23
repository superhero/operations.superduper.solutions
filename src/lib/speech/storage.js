// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import { openDB, deleteDB } from 'idb';
import { speechRecordingsDatabaseName } from '../storage-names.ts';
import { largeModelCache } from './config.js';
let database;
const opened = () => database ||= openDB(speechRecordingsDatabaseName, 1, { upgrade(db) { db.createObjectStore('sessions', { keyPath: 'id' }); } });
export async function saveRecording(record) {
  const db = await opened();
  await db.put('sessions', record);
  // Bound local retention; exported files remain under the user's control.
  const records = await listRecordings();
  for (const stale of records.slice(20)) await db.delete('sessions', stale.id);
}
export async function listRecordings() {
  return (await (await opened()).getAll('sessions')).sort((a, b) => b.created.localeCompare(a.created));
}
export async function deleteRecordings() { await (await opened()).clear('sessions'); }
export async function clearSpeechCache() {
  await caches.delete('operations-parakeet-ort-1.30.0');
  if (navigator.storage?.getDirectory) {
    const root = await navigator.storage.getDirectory();
    try { await root.removeEntry(largeModelCache, { recursive: true }); }
    catch (error) { if (error.name !== 'NotFoundError') throw error; }
  }
  // This database belongs to parakeet.js; no Bonsai or application data is touched.
  await new Promise((resolve, reject) => {
    let blocked = false;
    deleteDB('parakeet-cache-db', { blocked() { blocked = true; reject(new Error('Close other speech tabs before clearing the cache.')); } })
      .then(() => { if (!blocked) resolve(); }, reject);
  });
}
