// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Bundled and served only by the browser test server, never the production app.
import LightningFS from '@isomorphic-git/lightning-fs';
import * as git from 'isomorphic-git';
import { openDB } from 'idb';
import { workflowRepository, workflowRepositoryDatabaseName, workflowFilesystemName, workflowRepositoryPath } from '../../src/lib/workflow-repository';
import { validateWorkflowDocument } from '../../src/lib/workflow-document';
export { collectStorageReport } from '../../src/lib/storage-metrics';

let inspectionFilesystem: LightningFS;
let releaseWriteLock: (() => void) | undefined;

async function gitState(id: string, dirty = false) {
  const database = await openDB(workflowRepositoryDatabaseName);
  try {
    const entry = await database.get('catalog', id);
    inspectionFilesystem ??= new LightningFS(workflowFilesystemName, { defer: true });
    const fs = inspectionFilesystem;
    const dir = entry.repositoryPath;
    if (dirty) {
      for (const filepath of ['modified.txt', 'deleted.txt', 'staged.txt']) {
        await fs.promises.writeFile(`${dir}/${filepath}`, 'Original content\n');
        await git.add({ fs, dir, filepath });
      }
      await git.commit({ fs, dir, message: 'Prepare storage status fixture', author: { name: 'Browser test', email: 'test@example.com' } });
      await fs.promises.writeFile(`${dir}/modified.txt`, 'Changed working content\n');
      await fs.promises.writeFile(`${dir}/staged.txt`, 'Changed staged content\n');
      await git.add({ fs, dir, filepath: 'staged.txt' });
      await fs.promises.unlink(`${dir}/deleted.txt`);
      await fs.promises.writeFile(`${dir}/untracked.txt`, 'Untracked content\n');
      await fs.promises.flush();
    }
    const files = await Promise.all((await fs.promises.readdir(dir)).filter(name => name !== '.git').sort()
      .map(async name => ({ name, text: await fs.promises.readFile(`${dir}/${name}`, 'utf8') })));
    return { head: await git.resolveRef({ fs, dir, ref: 'HEAD' }),
      index: Array.from(await fs.promises.readFile(`${dir}/.git/index`) as Uint8Array), files };
  } finally { database.close(); }
}

async function inspect(id: string) {
  const database = await openDB(workflowRepositoryDatabaseName);
  try {
    const entry = await database.get('catalog', id);
    if (!entry) return null;
    inspectionFilesystem ??= new LightningFS(workflowFilesystemName, { defer: true });
    const fs = inspectionFilesystem;
    const dir = entry.repositoryPath;
    const working = await fs.promises.readFile(`${dir}/workflow.json`, 'utf8');
    const commits = await git.log({ fs, dir });
    const versions = await Promise.all(commits.map(async ({ oid, commit }) => ({
      oid, parent: commit.parent, message: commit.message.trim(),
      text: new TextDecoder().decode((await git.readBlob({ fs, dir, oid, filepath: 'workflow.json' })).blob),
    })));
    return { entry, working, versions, gitFiles: await fs.promises.readdir(`${dir}/.git`),
      trackedFiles: await git.listFiles({ fs, dir, ref: 'HEAD' }), status: await git.statusMatrix({ fs, dir, refresh: false }),
      preferences: await database.get('preferences', id) };
  } finally { database.close(); }
}

async function inspectGraph(id: string) {
  const database = await openDB(workflowRepositoryDatabaseName);
  try {
    const entry = await database.get('catalog', id);
    inspectionFilesystem ??= new LightningFS(workflowFilesystemName, { defer: true });
    const fs = inspectionFilesystem;
    const dir = entry.repositoryPath;
    const branches = Object.fromEntries(await Promise.all((await git.listBranches({ fs, dir })).sort()
      .map(async branch => [branch, await git.resolveRef({ fs, dir, ref: `refs/heads/${branch}` })])));
    let redo: string | null = null;
    try { redo = await git.resolveRef({ fs, dir, ref: 'refs/workflow/redo' }); }
    catch (error) { if ((error as { code?: string }).code !== 'NotFoundError') throw error; }
    const reachable = new Map<string, { oid: string; parent: string[]; message: string; timestamp: number; text: string }>();
    for (const ref of new Set([...Object.values(branches), ...(redo ? [redo] : [])]))
      for (const { oid, commit } of await git.log({ fs, dir, ref })) if (!reachable.has(oid))
        reachable.set(oid, { oid, parent: commit.parent, message: commit.message.trim(), timestamp: commit.committer.timestamp,
          text: new TextDecoder().decode((await git.readBlob({ fs, dir, oid, filepath: 'workflow.json' })).blob) });
    return { branches, redo, head: await git.resolveRef({ fs, dir, ref: 'HEAD' }),
      headRef: await fs.promises.readFile(`${dir}/.git/HEAD`, 'utf8'),
      working: await fs.promises.readFile(`${dir}/workflow.json`, 'utf8'),
      index: Array.from(await fs.promises.readFile(`${dir}/.git/index`) as Uint8Array),
      commits: [...reachable.values()].sort((a, b) => a.oid.localeCompare(b.oid)),
      navigation: await database.get('navigation', id), pending: await database.get('pending', id) };
  } finally { database.close(); }
}

export async function callRepository(method: string, args: unknown[]) {
  await workflowRepository.initialize();
  if (method === 'holdWrites') {
    if (releaseWriteLock) throw new Error('A repository write lock is already held.');
    await new Promise<void>((acquired, reject) => {
      void navigator.locks.request(`workflow-repository:${workflowFilesystemName}:${workflowRepositoryPath(args[0] as string)}`, () =>
        new Promise<void>(release => { releaseWriteLock = release; acquired(); })).catch(reject);
    });
    return;
  }
  if (method === 'releaseWrites') { releaseWriteLock?.(); releaseWriteLock = undefined; return; }
  if (method === 'dropWorkingFile') {
    inspectionFilesystem ??= new LightningFS(workflowFilesystemName, { defer: true });
    await inspectionFilesystem.promises.unlink(`${workflowRepositoryPath(args[0] as string)}/workflow.json`);
    await inspectionFilesystem.promises.flush();
    return;
  }
  if (method === 'sameSecondFork') {
    const [document, original, latest] = args as [{ id: string }, string, string];
    inspectionFilesystem ??= new LightningFS(workflowFilesystemName, { defer: true });
    const { commit } = await git.readCommit({ fs: inspectionFilesystem, dir: workflowRepositoryPath(document.id), oid: latest });
    const message = (await workflowRepository.history(document.id)).find(version => version.oid === latest)!.message;
    await workflowRepository.undo(document.id, latest);
    const now = Date.now;
    Date.now = () => commit.committer.timestamp * 1000;
    try { return await workflowRepository.save(document as never, original, message); }
    finally { Date.now = now; }
  }
  if (method === 'legacyPendingUndo') {
    const [id, original, latest] = args as [string, string, string];
    const database = await openDB(workflowRepositoryDatabaseName);
    try {
      inspectionFilesystem ??= new LightningFS(workflowFilesystemName, { defer: true });
      const fs = inspectionFilesystem;
      const dir = workflowRepositoryPath(id);
      const text = new TextDecoder().decode((await git.readBlob({ fs, dir, oid: original, filepath: 'workflow.json' })).blob);
      await fs.promises.writeFile(`${dir}/workflow.json`, text);
      await git.add({ fs, dir, filepath: 'workflow.json' });
      const revision = await git.commit({ fs, dir, message: 'Undo workflow change',
        author: { name: 'Local workflow editor', email: 'workflow@localhost' } });
      await fs.promises.flush();
      const { oid: blob } = await git.hashBlob({ object: text });
      const preferences = await database.get('preferences', id);
      const transaction = database.transaction(['navigation', 'pending'], 'readwrite');
      await transaction.objectStore('navigation').put({ revision: latest, undo: [original], redo: [] }, id);
      await transaction.objectStore('pending').put({ id, blob, message: 'Undo workflow change', baseRevision: latest,
        undo: [], redo: [latest], preferences, forceCommit: true }, id);
      await transaction.done;
      return revision;
    } finally { database.close(); }
  }
  if (method === 'legacyGenericVersion') {
    const document = validateWorkflowDocument(args[0]);
    const { viewport: _viewport, snap: _snap, curved: _curved, dashed: _dashed, ...content } = document;
    inspectionFilesystem ??= new LightningFS(workflowFilesystemName, { defer: true });
    const fs = inspectionFilesystem;
    const dir = workflowRepositoryPath(document.id);
    await fs.promises.writeFile(`${dir}/workflow.json`, `${JSON.stringify(content, null, 2)}\n`);
    await git.add({ fs, dir, filepath: 'workflow.json' });
    const revision = await git.commit({ fs, dir, message: 'Update workflow',
      author: { name: 'Local workflow editor', email: 'workflow@localhost' } });
    await fs.promises.flush();
    await workflowRepository.load(document.id);
    return revision;
  }
  if (method === 'inspect') return inspect(args[0] as string);
  if (method === 'gitState') return gitState(args[0] as string);
  if (method === 'dirtyGit') return gitState(args[0] as string, true);
  if (method === 'inspectGraph') return inspectGraph(args[0] as string);
  if (method === 'interruptCatalogFinish') {
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, ...options) {
      if (this.name === workflowRepositoryDatabaseName && Array.isArray(stores) && stores.includes('catalog') && stores.includes('pending'))
        throw new Error('Interrupted catalogue update after Git commit');
      return transaction.call(this, stores, ...options);
    };
    try {
      const action = typeof args[2] === 'string' ? args[2] : 'save';
      await Reflect.apply(Reflect.get(workflowRepository, action), workflowRepository, args.slice(0, 2));
    }
    catch (error) { return String(error); }
    // Keep the outage active until reload. A broadcast-triggered catalogue read
    // may otherwise recover the journal before the test can inspect the crash.
    IDBDatabase.prototype.transaction = transaction;
    throw new Error('The fixture must interrupt the catalogue update.');
  }
  if (method === 'concurrentSave') {
    const [first, second, expectedRevision] = args;
    const results = await Promise.allSettled([
      workflowRepository.save(first as never, expectedRevision as string, 'First concurrent edit'),
      workflowRepository.save(second as never, expectedRevision as string, 'Second concurrent edit'),
    ]);
    return results.map(result => result.status === 'fulfilled' ? { status: result.status, value: result.value }
      : { status: result.status, message: String(result.reason) });
  }
  return Reflect.apply(Reflect.get(workflowRepository, method), workflowRepository, args);
}
