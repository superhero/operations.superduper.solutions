// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { nativeObject } from '../../src/lib/native-runtime-contract.ts';
import { nativeStoredThreadReadParams } from '../../src/lib/native-stored-thread.ts';

class ThreadScopeError extends Error {}
const within = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };
async function directory(value, { workspace, home }) {
  if (typeof value !== 'string') throw new Error('Invalid stored-thread workspace.');
  const path = resolve(workspace, value);
  if (!within(workspace, path) || within(home, path)) throw new ThreadScopeError('Stored-thread workspace is outside the pairing.');
  const canonical = await realpath(path);
  if (!within(workspace, canonical) || within(home, canonical) || !(await stat(canonical)).isDirectory()) throw new ThreadScopeError('Stored-thread workspace is outside the pairing.');
  return canonical;
}
async function inspectThread(id, context) {
  const raw = await context.inspect(id), result = nativeObject(raw, ['thread', ...(Object.hasOwn(raw ?? {}, 'readState') ? ['readState'] : [])]);
  if (!result.thread || typeof result.thread !== 'object' || result.thread.id !== id) throw new Error('Stored-thread inspection did not match the requested thread.');
  await directory(result.thread.cwd, context);
  return result.thread;
}
/** Reading the private local store never enrolls a thread for agent execution. */
export async function prepareNativeStoredThreadRead(method, input, context) {
  const params = nativeStoredThreadReadParams(method, input);
  if (method === 'thread/list') {
    if (Array.isArray(params.cwd)) params.cwd = await Promise.all(params.cwd.map(path => directory(path, context)));
    else params.cwd = await directory(params.cwd ?? context.workspace, context);
  }
  if (typeof params.threadId === 'string') await inspectThread(params.threadId, context);
  return params;
}
export async function reviewNativeStoredThreadRead(method, params, value, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stored-thread result.');
  nativeObject(value, Object.keys(value));
  if (method === 'thread/read') {
    if (value.thread?.id !== params.threadId) throw new Error('Stored-thread result did not match its request.');
    await directory(value.thread.cwd, context);
  } else if (params.threadId) await inspectThread(params.threadId, context);
  if (method === 'thread/goal/get' && value.goal != null && value.goal.threadId !== params.threadId) throw new Error('Stored goal belongs to another thread.');
  if (!Object.hasOwn(value, 'data')) return value;
  if (!Array.isArray(value.data) || value.data.length > Math.max(1, params.limit ?? 8)) throw new Error('Stored-thread result exceeded its requested page.');
  if (method === 'thread/list') {
    const expected = Array.isArray(params.cwd) ? params.cwd : [params.cwd];
    for (const thread of value.data) if (!expected.includes(await directory(thread?.cwd, context))) throw new Error('Stored-thread listing returned another workspace.');
  }
  if (method !== 'thread/loaded/list' && method !== 'thread/attachmentOwner/list') return value;
  const data = [];
  for (const row of value.data) {
    const id = method === 'thread/loaded/list' ? row : row?.threadId;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,192}$/.test(id)) throw new Error('Invalid stored-thread result identity.');
    try { await inspectThread(id, context); data.push(row); }
    catch (error) { if (!(error instanceof ThreadScopeError)) throw error; }
  }
  // Native pagination still advances across excluded workspaces. Cursors are
  // opaque continuation positions, not thread execution capabilities.
  return { ...value, data };
}
export { directory as nativeStoredThreadDirectory, inspectThread as inspectNativeStoredThread };
