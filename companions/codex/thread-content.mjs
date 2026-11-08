// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeThreadContentParams } from '../../src/lib/native-thread-content.ts';
import { nativeObject, nativeUuid } from '../../src/lib/native-runtime-contract.ts';
import { inspectNativeStoredThread, nativeStoredThreadDirectory } from './stored-thread.mjs';

export async function prepareNativeThreadContent(method, input, context) {
  const params = nativeThreadContentParams(method, input);
  await inspectNativeStoredThread(params.threadId, context);
  return { method, input: params, params, ids: [params.threadId] };
}
export async function reviewNativeThreadContent(plan, value, context) {
  const { method, input } = plan;
  if (method === 'thread/attachment/add') {
    const result = nativeObject(value, ['attachment', 'outcome']), attachment = nativeObject(result.attachment, ['id', 'attachmentType', 'identityKey', 'payload', 'createdAt']);
    if (!['created', 'existing'].includes(result.outcome) || !nativeUuid(attachment.id) || attachment.attachmentType !== input.attachmentType || attachment.identityKey !== input.identityKey)
      throw new Error('Native attachment did not match its requested identity.');
  } else if (method === 'thread/goal/set') {
    const result = nativeObject(value, ['goal']);
    if (!result.goal || typeof result.goal !== 'object' || result.goal.threadId !== input.threadId
      || typeof input.objective === 'string' && result.goal.objective !== input.objective.trim()
      || Object.hasOwn(input, 'tokenBudget') && result.goal.tokenBudget !== input.tokenBudget) throw new Error('Native goal did not match its mutation.');
  } else if (method === 'thread/goal/clear') {
    const result = nativeObject(value, ['cleared']);
    if (typeof result.cleared !== 'boolean' || (await context.inspectGoal(input.threadId)).goal !== null) throw new Error('Native goal clear was not verified.');
  } else if (method === 'thread/revert') {
    const result = nativeObject(value, Object.keys(value ?? {}));
    if (result.thread?.id !== input.threadId || !Array.isArray(result.thread.turns) || result.thread.turns.length) throw new Error('Native revert did not return matching paginated thread metadata.');
    await nativeStoredThreadDirectory(result.thread.cwd, context);
  } else nativeObject(value, []);
  await inspectNativeStoredThread(input.threadId, context);
  return value;
}
