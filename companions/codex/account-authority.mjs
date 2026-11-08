// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const sameFile = (left, right) => ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs', 'uid', 'mode', 'nlink'].every(key => left[key] === right[key]);
const sameDirectory = (left, right) => ['dev', 'ino', 'uid', 'mode'].every(key => left[key] === right[key]);
async function credentialHash(path, uid, plaintext = false) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await file.stat();
    if (!before.isFile() || before.uid !== uid || before.nlink !== 1 || before.size > 1024 * 1024
      || plaintext && before.mode & 0o077 || await realpath(path) !== path) throw new Error('Invalid native credential authority file.');
    const buffer = Buffer.alloc(before.size + 1), { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead), after = await file.stat(), current = await lstat(path);
    if (bytes.length !== before.size || !sameFile(before, after) || !sameFile(after, current)) throw new Error('Native credential authority changed during inspection.');
    return createHash('sha256').update(bytes).digest('hex');
  } catch (error) { if (error.code === 'ENOENT' && !file) return 'absent'; throw error; }
  finally { await file?.close(); }
}

/** Pin every native credential store, without reading the OS keyring or exposing values.
 * Sidecar locks and directory creation alone never advance credential authority. */
export async function nativeAccountAuthority(home, uid, retry = true) {
  const directory = join(home, 'secrets');
  let owner;
  try { owner = await lstat(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (owner && (!owner.isDirectory() || owner.isSymbolicLink() || owner.uid !== uid || owner.mode & 0o022
    || await realpath(directory) !== directory)) throw new Error('Invalid native encrypted credential directory.');
  const auth = await credentialHash(join(home, 'auth.json'), uid, true);
  const codex = owner ? await credentialHash(join(directory, 'codex_auth.age'), uid) : 'absent';
  const gateway = owner ? await credentialHash(join(directory, 'gateway_oauth.age'), uid) : 'absent';
  let after;
  try { after = await lstat(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!owner && after && retry) return nativeAccountAuthority(home, uid, false);
  if (Boolean(owner) !== Boolean(after) || owner && (!after.isDirectory() || after.isSymbolicLink() || !sameDirectory(owner, after)))
    throw new Error('Native encrypted credential directory changed during inspection.');
  return { auth, codex, gateway };
}
