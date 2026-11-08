// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { githubArchiveAddress, githubArchiveLimit, githubArchiveProfile, isGithubArchive } from '../github-archive.ts';
import { validateWorkflowBinary, workflowBinaryBlob } from '../workflow-binary.ts';
import { resolveAwsGetBodyKey, type AwsGetBodyRelay } from './aws-get-body.ts';
import { VaultError, type ApprovedOperation, type VaultCredential } from './types.ts';

export const githubArchiveEligible = (descriptor: ApprovedOperation): boolean => isGithubArchive(descriptor.operation)
  && descriptor.origin === 'https://api.github.com';
export async function fetchGithubArchive(descriptor: ApprovedOperation, relay: AwsGetBodyRelay,
  records: readonly VaultCredential[], address: string, init: RequestInit, fetchRequest: typeof fetch,
  guard: () => void | Promise<void>): Promise<Response> {
  if (!githubArchiveEligible(descriptor) || init.method !== 'GET' || init.body != null) throw new VaultError('PERMISSION');
  githubArchiveAddress(address);
  const key = await resolveAwsGetBodyKey(relay, records), headers = new Headers(init.headers);
  if (!/^Bearer [\x21-\x7e]+$/.test(headers.get('Authorization') ?? '')
    || [...headers.keys()].some(name => !['accept', 'authorization'].includes(name))) throw new VaultError('PERMISSION');
  await guard(); if (init.signal?.aborted) throw new VaultError('CANCELLED');
  const response = await fetchRequest(relay.host + '/v1/github/migration-archive', {
    method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    ...(init.signal ? { signal: init.signal } : {}),
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ profile: githubArchiveProfile, fingerprint: descriptor.fingerprint, address,
      authorization: headers.get('Authorization') }),
  });
  await guard(); if (init.signal?.aborted) throw new VaultError('CANCELLED');
  if (response.status !== 200 || response.redirected || response.headers.get('Content-Type')?.split(';')[0] !== 'application/json')
    throw new VaultError('NETWORK');
  const reader = response.body?.getReader(); if (!reader) throw new VaultError('NETWORK');
  const parts: Uint8Array[] = []; let size = 0;
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => { abort = () => reject(new VaultError('CANCELLED')); });
  init.signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (init.signal?.aborted) throw new VaultError('CANCELLED');
      const part = await Promise.race([reader.read(), cancelled]); if (part.done) break;
      size += part.value.length; if (size > Math.ceil(githubArchiveLimit / 3) * 4 + 4096) throw new VaultError('LIMIT');
      parts.push(part.value);
    }
  } finally { init.signal?.removeEventListener('abort', abort); void reader.cancel().catch(() => {}); reader.releaseLock(); }
  await guard(); if (init.signal?.aborted) throw new VaultError('CANCELLED');
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!result || Object.keys(result).sort().join(',') !== 'body,fingerprint,profile,status'
    || result.profile !== githubArchiveProfile || result.fingerprint !== descriptor.fingerprint
    || !Number.isInteger(result.status) || result.status !== 200 && (result.status < 400 || result.status > 599)) throw new VaultError('NETWORK');
  if (result.status !== 200) {
    if (result.body !== null) throw new VaultError('NETWORK');
    return new Response(null, { status: result.status, headers: { 'Content-Type': 'text/plain' } });
  }
  const file = validateWorkflowBinary(result.body);
  if (file.mediaType !== 'application/gzip' || file.name !== 'migration.tar.gz') throw new VaultError('NETWORK');
  const blob = workflowBinaryBlob(file);
  const magic = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (magic[0] !== 0x1f || magic[1] !== 0x8b) throw new VaultError('NETWORK');
  return new Response(blob, { status: 200, headers: { 'Content-Type': 'application/gzip',
    'Content-Disposition': 'attachment; filename="migration.tar.gz"', 'X-Operations-Source-Status': '302' } });
}
