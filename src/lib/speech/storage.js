// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import { openDB, deleteDB } from 'idb';
import { speechRecordingsDatabaseName } from '../storage-names.ts';
import { largeModelCache } from './config.js';
import {loadContinuous} from './continuous-module.js';
let database;
const opened = () => database ||= openDB(speechRecordingsDatabaseName, 1, { upgrade(db) { db.createObjectStore('sessions', { keyPath: 'id' }); } });
export async function saveRecording(record) {
  const db = await opened();
  await db.put('sessions', record);
  // Bound local retention; exported files remain under the user's control.
  const records = (await db.getAll('sessions')).sort((a,b)=>b.created.localeCompare(a.created));
  // The retention unit is a physical recording, never an ASR segment. Pending
  // continuous captures remain recoverable even when twenty have finished.
  const finished=records.filter(record=>record.metadata?.continuous?record.status==='complete':['complete','cancelled','error'].includes(record.status));
  const staleRecords=finished.slice(20);if(!staleRecords.length)return;
  const{inactiveRecording,removeArchivedRecording}=await loadContinuous();
  for(const stale of staleRecords)await inactiveRecording(stale.id,async()=>{
    if(stale.metadata?.continuous)await removeArchivedRecording(stale.id);await db.delete('sessions',stale.id);
  },true);
}
export async function listRecordings() {
  const{recoverRecordings}=await loadContinuous();
  return recoverRecordings((await (await opened()).getAll('sessions')).sort((a, b) => b.created.localeCompare(a.created)));
}
export async function deleteRecordings() {
  const{inactiveRecording,removeArchivedRecording}=await loadContinuous();
  const db=await opened();for(const record of await listRecordings())await inactiveRecording(record.id,async()=>{
    if(record.metadata?.continuous)await removeArchivedRecording(record.id);await db.delete('sessions',record.id);
  });
}
export async function clearSpeechCache() {
  const {installedModels,removeModel}=await import('../assistant/model-storage/storage.ts');
  if((await installedModels()).includes('speech:parakeet-continuous'))await removeModel('speech:parakeet-continuous');
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
