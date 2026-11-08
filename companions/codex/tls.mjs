// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { createHash, X509Certificate } from 'node:crypto';

/** Owner configuration only. A browser cannot supply or change native TLS roots. */
export async function nativeCaCertificate(input, home, uid) {
  if (input == null || input === '') return null;
  if (typeof input !== 'string' || !isAbsolute(input)) throw new Error('Use an absolute private runtime CA certificate path.');
  const path = resolve(input);
  if (!path.startsWith(home + sep) || await realpath(path) !== path) throw new Error('Native CA certificates must use a canonical file inside the private runtime home.');
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await file.stat(), stamp = s => [s.dev, s.ino, s.uid, s.mode, s.nlink, s.size, s.mtimeMs, s.ctimeMs].join(':');
    if (!before.isFile() || before.uid !== uid || before.nlink !== 1 || before.mode & 0o022 || before.size > 65536) throw new Error();
    const bytes = await file.readFile();
    if (bytes.length !== before.size || stamp(before) !== stamp(await file.stat()) || stamp(before) !== stamp(await lstat(path))) throw new Error();
    const pem = new TextDecoder('utf-8', { fatal: true }).decode(bytes), blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    if (!blocks?.length || blocks.length > 32 || pem.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '').trim()) throw new Error();
    for (const block of blocks) new X509Certificate(block);
    return { path, sha256: createHash('sha256').update(bytes).digest('hex') };
  } catch { throw new Error('Native CA certificates require an owned, bounded PEM certificate file without links or shared write access.'); }
  finally { await file?.close(); }
}
