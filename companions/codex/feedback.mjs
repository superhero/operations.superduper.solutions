// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { nativeFeedbackParams, nativeFeedbackLimits as limits } from '../../src/lib/native-feedback-contract.ts';

/** Freeze consented regular workspace files before the SDK can upload them. */
export async function prepareNativeFeedback(input, { workspace, home, allowDiagnostics, pairingKey }) {
  const params = nativeFeedbackParams(input), files = params.extraLogFiles ?? [];
  if ((params.includeLogs || files.length) && allowDiagnostics !== true) throw new Error('Feedback diagnostics require the host opt-in.');
  const within = (root, path) => { const r = relative(root, path); return !isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep); };
  let directory, total = 0; const snapshots = [], seen = new Set();
  const close = async () => { if (directory) await rm(directory, { recursive: true, force: true }); };
  try {
    for (const file of files) {
      const requested = resolve(workspace, file), path = await realpath(requested);
      if (!within(workspace, requested) || !within(workspace, path) || within(home, path)) throw new Error('Feedback attachments must remain inside the workspace.');
      if (process.platform !== 'linux') throw new Error('Feedback file attachments require the qualified Linux host.');
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const opened = await realpath('/proc/self/fd/' + handle.fd);
        if (!within(workspace, opened) || within(home, opened)) throw new Error('Feedback attachment authority changed.');
        if (seen.has(opened)) continue;
        seen.add(opened);
        const before = await handle.stat();
        if (!before.isFile() || before.nlink !== 1 || before.size > limits.fileBytes || total + before.size > limits.attachmentBytes) throw new Error('Feedback attachment limits exceeded.');
        const bytes = Buffer.alloc(before.size + 1); let count = 0;
        while (count < bytes.length) { const result = await handle.read(bytes, count, bytes.length - count, count); if (!result.bytesRead) break; count += result.bytesRead; }
        const after = await handle.stat();
        if (count !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.ino !== before.ino
          || pairingKey && bytes.subarray(0, count).includes(Buffer.from(pairingKey))) throw new Error('Feedback attachment changed or contains the pairing credential.');
        if (!directory) {
          const root = join(home, 'operations-feedback'); await mkdir(root, { mode: 0o700, recursive: true });
          const info = await lstat(root); if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077) throw new Error('Invalid feedback snapshot home.');
          directory = await mkdtemp(join(root, 'upload-'));
        }
        const part = join(directory, String(snapshots.length + 1)); await mkdir(part, { mode: 0o700 });
        const destination = join(part, basename(path));
        await writeFile(destination, bytes.subarray(0, count), { mode: 0o600, flag: 'wx' });
        snapshots.push(destination); total += count;
      } finally { await handle.close(); }
    }
    return { params: { ...params, ...(params.extraLogFiles == null ? {} : { extraLogFiles: snapshots }) }, close };
  } catch (error) { await close(); throw error; }
}
