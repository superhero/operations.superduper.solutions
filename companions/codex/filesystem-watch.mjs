// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { nativeObject } from '../../src/lib/native-runtime-contract.ts';
import { nativeRpcId } from '../../src/lib/native-agent-contract.ts';
import { nativeFilesystemWatchParams, nativeFilesystemChangeFrame, nativeFilesystemWatchLimits as limits } from '../../src/lib/native-filesystem-watch.ts';

const within = (root, path) => { const r = relative(root, path); return !isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep); };
export async function prepareNativeFilesystemWatch(input, workspace, home) {
  const params = nativeFilesystemWatchParams('fs/watch', input), requested = resolve(workspace, params.path), path = await realpath(requested);
  if (!within(workspace, requested) || !within(workspace, path) || within(home, path) || within(path, home)) throw new Error('Watch root is outside its workspace authority.');
  const info = await stat(path);
  if (!info.isDirectory() && (!info.isFile() || info.nlink !== 1)) throw new Error('Watch root must be an ordinary workspace entry.');
  return { params: { watchId: params.watchId, path }, root: { path, dev: info.dev, ino: info.ino, directory: info.isDirectory() } };
}
export async function reviewNativeFilesystemChange(root, paths, workspace, home) {
  let current;
  try { current = await stat(root.path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!current || current.dev !== root.dev || current.ino !== root.ino || await realpath(root.path) !== root.path) {
    const parent = await realpath(dirname(root.path));
    if (paths.length !== 1 || paths[0] !== root.path || !within(workspace, parent) || within(home, parent)) throw new Error('Watch root authority changed.');
    // Only its previously authorized root name may be published after loss of
    // the inode. End the channel before any more names from that watch escape.
    return { rootLost: true };
  }
  for (const path of paths) {
    if (!isAbsolute(path) || resolve(path) !== path || path !== root.path && (!root.directory || dirname(path) !== root.path)) throw new Error('Notification is outside its non-recursive watch.');
    const parent = await realpath(dirname(path));
    if (!within(workspace, parent) || within(home, parent)) throw new Error('Notification parent escaped the workspace.');
    try {
      const canonical = await realpath(path);
      if (!within(workspace, canonical) || within(home, canonical)) throw new Error('Notification escaped the workspace.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

/** One connection owns the IDs, pending acknowledgements and notification
 * barrier. The enclosing transport owns the child and closes it on failure. */
export function createCodexFilesystemWatchSession({ prepare, review, send, end = () => {} }) {
  const watches = new Map(), pending = new Map(); let closed = false;
  const close = () => { closed = true; watches.clear(); pending.clear(); };
  async function checked(work) { try { if (closed) throw new Error('Watch channel is closed.'); return await work(); } catch (error) { close(); throw error; } }
  return { close, ownsRequest: id => !closed && (pending.has(id) || [...watches.values()].some(entry => entry.requestId === id)), async request(frame) { return checked(async () => {
    nativeObject(frame, ['id', 'method', 'params']);
    if (!nativeRpcId(frame.id) || pending.has(frame.id) || pending.size >= limits.pending) throw new Error('Invalid or excessive watch request ID.');
    const params = nativeFilesystemWatchParams(frame.method, frame.params);
    let entry = watches.get(params.watchId);
    if (frame.method === 'fs/watch') {
      if (entry || watches.size >= limits.watches) throw new Error('Duplicate or excessive owned watch.');
      const prepared = await prepare(params); if (closed) throw new Error('Watch channel closed during preparation.');
      entry = { ...prepared, requestId: frame.id, phase: 'registering', early: [] }; watches.set(params.watchId, entry);
    } else if (entry?.phase === 'registering' || entry?.phase === 'stopping') throw new Error('Watch transition is pending.');
    else if (entry) entry.phase = 'stopping';
    pending.set(frame.id, { method: frame.method, watchId: params.watchId, entry });
    return { ...frame, params: frame.method === 'fs/watch' ? entry.params : params };
  }); }, async receive(frame) { return checked(async () => {
    if (frame.method === 'fs/changed') {
      const notification = nativeFilesystemChangeFrame(frame), note = notification.params, entry = watches.get(note.watchId);
      if (!entry) throw new Error('Notification has no owned watch.');
      const authority = await review(entry.root, note.changedPaths); if (closed) throw new Error('Watch channel closed during review.');
      if (authority?.rootLost) {
        if (entry.phase === 'registering') throw new Error('Watch root was lost before registration completed.');
        send(notification); close(); end(); return true;
      }
      if (entry.phase === 'registering') {
        if (entry.early.length >= limits.earlyEvents) throw new Error('Early watch notification limit exceeded.');
        entry.early.push(notification);
      } else send(notification);
      return true;
    }
    const request = pending.get(frame.id); if (!request) return false;
    nativeObject(frame, ['id', 'result']); pending.delete(frame.id);
    if (request.method === 'fs/watch') {
      const result = nativeObject(frame.result, ['path']);
      if (result.path !== request.entry.params.path) throw new Error('Native watch acknowledgement changed its root.');
      await review(request.entry.root, []); if (closed) throw new Error('Watch channel closed during review.');
      request.entry.phase = 'watching'; send(frame);
      for (const note of request.entry.early.splice(0)) send(note);
    } else { nativeObject(frame.result, []); watches.delete(request.watchId); send(frame); }
    return true;
  }); } };
}
