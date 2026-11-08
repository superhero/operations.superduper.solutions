// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeThreadLifecycleParams } from '../../src/lib/native-thread-lifecycle.ts';
import { nativeUuid, nativeObject } from '../../src/lib/native-runtime-contract.ts';
import { inspectNativeStoredThread, nativeStoredThreadDirectory } from './stored-thread.mjs';
import { nativeThreadTree } from './thread-tree.mjs';

/** Private preparation inspects storage without granting execution on it. */
export async function prepareNativeThreadLifecycle(method, input, context) {
  const params = nativeThreadLifecycleParams(method, input), thread = await inspectNativeStoredThread(params.threadId, context);
  if (params.beforeThreadId != null) await inspectNativeStoredThread(params.beforeThreadId, context);
  const ids = ['thread/archive', 'thread/delete'].includes(method)
    ? (await nativeThreadTree(params.threadId, context)).ids : [params.threadId];
  return { method, input: params, ids, params: method === 'thread/fork' ? { ...params,
    cwd: await nativeStoredThreadDirectory(thread.cwd, context),
    approvalPolicy: 'on-request', approvalsReviewer: 'user' } : params };
}
export async function reviewNativeThreadLifecycle(plan, value, context) {
  const { method, input } = plan;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid thread lifecycle result.');
  nativeObject(value, Object.keys(value));
  if (method === 'thread/fork' || method === 'thread/unarchive' || method === 'thread/metadata/update') {
    const thread = value.thread;
    if (!nativeUuid(thread?.id) || (method === 'thread/fork'
      ? thread.id === input.threadId || thread.forkedFromId !== input.threadId
      : thread.id !== input.threadId)) throw new Error('Thread lifecycle result did not match its request.');
    await nativeStoredThreadDirectory(thread.cwd, context);
    if (method === 'thread/fork' && (value.cwd !== plan.params.cwd || thread.cwd !== plan.params.cwd
      || value.approvalPolicy !== 'on-request' || value.approvalsReviewer !== 'user'
      || value.activePermissionProfile?.id !== 'operations')) throw new Error('Fork permission authority did not match the host.');
  } else if (method === 'thread/unsubscribe') {
    nativeObject(value, ['status']);
    if (!['notLoaded', 'notSubscribed', 'unsubscribed'].includes(value.status)) throw new Error('Invalid native subscription status.');
  } else nativeObject(value, []);
  if (['thread/name/set', 'thread/metadata/update', 'thread/section/move'].includes(method)) {
    const stored = await inspectNativeStoredThread(input.threadId, context);
    if (method === 'thread/name/set' && stored.name !== input.name
      || method === 'thread/section/move' && (stored.section?.id ?? null) !== input.sectionId
      || method === 'thread/metadata/update' && Object.entries(input.gitInfo).some(([key, value]) => (stored.gitInfo?.[key] ?? null) !== value))
      throw new Error('Native thread metadata did not match its mutation.');
  }
  return value;
}
