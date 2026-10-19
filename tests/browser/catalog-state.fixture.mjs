// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import descriptors from '../../src/catalogs/services/index.json' with { type: 'json' };
import { catalogsIndexDatabaseName } from '../../src/lib/storage-names.ts';

/** Isolate examples through persisted installation state, without app test hooks. */
export function exampleCatalogState(origin, indexedDB = []) {
  const origins = [new URL(origin).origin];
  const url = new URL(origin);
  if (['127.0.0.1', 'localhost'].includes(url.hostname)) {
    for (const hostname of ['127.0.0.1', 'localhost', 'restore.localhost']) {
      url.hostname = hostname;
      if (!origins.includes(url.origin)) origins.push(url.origin);
    }
  }
  return { cookies: [], origins: origins.map(origin => ({ origin, localStorage: [], indexedDB: [...indexedDB,
    { name: catalogsIndexDatabaseName, version: 1,
      stores: ['catalog', 'pending', 'removed', 'state'].map(name => ({ name, autoIncrement: false, indexes: [],
        records: name === 'state' ? [{ key: 'serviceDefaults', value: descriptors.map(item => item.id) }] : [] })) }
  ] })) };
}
