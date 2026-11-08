// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeHostFixture } from './native-runtime.fixture.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export const nativeFilesystemText = 'Native filesystem fixture\n';
export const nativeFilesystemBytes = Buffer.concat([Buffer.from(nativeFilesystemText), Buffer.from(Array.from({ length: 256 }, (_, i) => i))]);

export function nativeMetadataResults(workspace = '/owned/workspace') {
  const hook = { currentHash: 'fixture-hash', displayOrder: 0, enabled: true, eventName: 'sessionStart', isManaged: false,
    key: 'fixture-hook', source: 'project', sourcePath: workspace + '/hooks.json', timeoutSec: 30, trustStatus: 'trusted',
    handlerType: 'command', command: 'echo fixture', async: false };
  return {
    'model/list': { data: [{ id: 'fixture-model', model: 'fixture-model', displayName: 'Fixture model', description: 'A local metadata fixture.',
      hidden: false, isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }] }], nextCursor: 'next-page' },
    'modelProvider/capabilities/read': { imageGeneration: true, webSearch: false },
    'permissionProfile/list': { data: [{ id: 'read-only', allowed: true, description: null }], nextCursor: null },
    'hooks/list': { data: [{ cwd: workspace, errors: [], warnings: [], hooks: [hook] }] },
    'app/installed': { apps: [{ id: 'fixture-app', runtimeName: 'Fixture app', enabled: true, callable: false }] },
    'app/list': { data: [{ id: 'fixture-app', name: 'Fixture app', labels: { purpose: 'test' }, appMetadata: { categories: ['test'], review: null } }], nextCursor: 'next-page' },
    'app/read': { apps: [{ id: 'fixture-app', name: 'Fixture app', toolSummaries: [{ name: 'read', description: 'A public display-only summary.', isReadOnly: true, isEnabled: true }] }], missingAppIds: ['missing-app'] },
    'fs/readFile': { dataBase64: nativeFilesystemBytes.toString('base64') },
    'fs/getMetadata': { isDirectory: false, isFile: true, isSymlink: false, createdAtMs: 0, modifiedAtMs: 1 },
    'fs/readDirectory': { entries: [{ fileName: 'fixture.txt', isDirectory: false, isFile: true }] },
    'fuzzyFileSearch': { files: [{ file_name: 'fixture.txt', root: workspace, path: 'fixture.txt', match_type: 'file', score: 1, indices: [0, 1] }] }
  };
}
export async function nativeQueryFixture(options = {}) {
  const fixture = await nativeHostFixture({ ...options, allowMetadata: options.allowMetadata ?? true, allowApps: options.allowApps ?? true, allowFilesystemRead: options.allowFilesystemRead ?? true, onFrame(frame, f, receive) {
    const results = f.metadataResults ??= nativeMetadataResults(f.workspace);
    if (!Object.hasOwn(results, frame.method)) return options.onFrame?.(frame, f, receive);
    const send = () => receive(f.failQuery ? { id: frame.id, error: { code: -32000, message: 'Private SDK failure details never reach the page.' } }
      : { id: frame.id, result: structuredClone(results[frame.method]) });
    if (f.holdQuery) f.release.push(send); else queueMicrotask(send);
    return true;
  } });
  if (fixture.workspace) await writeFile(join(fixture.workspace, 'fixture.txt'), nativeFilesystemBytes);
  return fixture;
}
