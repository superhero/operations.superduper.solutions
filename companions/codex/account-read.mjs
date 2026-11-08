// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { nativeAccountReadParams, nativeAccountReadNeedsChatgpt } from '../../src/lib/native-account-read.ts';
import { publicNativeAccountResult } from '../../src/lib/native-account.ts';
import { nativeCommandReview } from '../../src/lib/secrets/native-command.ts';

async function credentials(home) {
  const path = join(home, 'auth.json');
  let file;
  try { file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) { if (error.code === 'ENOENT') return { witness: 'absent', secrets: [] }; throw error; }
  try {
    const before = await file.stat();
    if (!before.isFile() || before.uid !== process.getuid?.() || before.mode & 0o077 || before.nlink !== 1 || before.size > 1024 * 1024
      || await realpath(path) !== path) throw new Error('Invalid private account credential store.');
    const bytes = await file.readFile(), after = await file.stat(), current = await lstat(path);
    const stamp = s => [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs, s.mode, s.uid, s.nlink].join(':');
    if (stamp(before) !== stamp(after) || stamp(after) !== stamp(current) || current.isSymbolicLink()) throw new Error('Account credential store changed.');
    const auth = JSON.parse(bytes.toString('utf8')), secrets = [];
    const collect = (value, depth = 0) => {
      if (depth > 8) throw new Error('Invalid account credentials.');
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (typeof child === 'string' && /(?:token|api.?key|secret|password)/i.test(key) && child) secrets.push(child);
        else if (child && typeof child === 'object') collect(child, depth + 1);
      }
    };
    collect(auth);
    return { witness: stamp(current) + ':' + createHash('sha256').update(bytes).digest('hex'), secrets };
  } finally { await file.close(); }
}
export async function prepareNativeAccountRead(method, input, context) {
  const params = nativeAccountReadParams(method, input), store = await credentials(context.home);
  const account = publicNativeAccountResult(await context.account());
  if (nativeAccountReadNeedsChatgpt(method) && account.account?.type !== 'chatgpt') throw new Error('This account read requires ChatGPT sign-in.');
  return { method, params, store, accountId: account.workspaceRouting?.chatgptAccountId };
}
export async function reviewNativeAccountRead(plan, result, context) {
  const current = await credentials(context.home);
  if (current.witness !== plan.store.witness) throw new Error('Account read authority changed.');
  const account = publicNativeAccountResult(await context.account());
  if (nativeAccountReadNeedsChatgpt(plan.method) && (account.account?.type !== 'chatgpt' || account.workspaceRouting?.chatgptAccountId !== plan.accountId))
    throw new Error('Account read identity changed.');
  if (plan.method === 'account/rateLimits/read' && result?.accountId != null && plan.accountId != null && result.accountId !== plan.accountId)
    throw new Error('Rate limits belong to another account.');
  if (plan.method === 'account/usage/read' && result?.threadUsage != null
    && (!plan.params.threadId || result.threadUsage.threadId !== plan.params.threadId.toLowerCase())) throw new Error('Usage belongs to another thread.');
  const secrets = [...plan.store.secrets, ...current.secrets];
  reviewNativeAccountCredentialEcho(result, secrets);
  return result;
}
function reviewNativeAccountCredentialEcho(result, secrets) {
  // Include URL and URL-safe base64 forms alongside the shared raw/UTF encodings.
  const variants = secrets.flatMap(value => [value, encodeURIComponent(value), Buffer.from(value).toString('base64url')]);
  const review = nativeCommandReview(variants);
  let nodes = 0;
  const inspect = (value, depth = 0) => {
    if (++nodes > 16384 || depth > 48) throw new Error('Account response exceeds its privacy boundary.');
    if (typeof value === 'string') { review.value(value); review.bytes(new TextEncoder().encode(value)); }
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) { inspect(key, depth + 1); inspect(item, depth + 1); }
  };
  inspect(result); review.bytes(new TextEncoder().encode(JSON.stringify(result)));
}
export async function reviewNativeAccountMetadata(result, home) {
  const before = await credentials(home);
  reviewNativeAccountCredentialEcho(result, before.secrets);
  const metadata = publicNativeAccountResult(result), after = await credentials(home);
  if (before.witness !== after.witness) throw new Error('Account metadata authority changed.');
  return metadata;
}
export async function reviewNativeAccountPrivateEcho(result, home) {
  const before = await credentials(home);
  reviewNativeAccountCredentialEcho(result, before.secrets);
  if (before.witness !== (await credentials(home)).witness) throw new Error('Account credential authority changed.');
}
