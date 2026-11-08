// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeWindowsSandboxParams, nativeWindowsSandboxReadiness, nativeWindowsSandboxReadinessMethod } from '../../src/lib/native-windows-sandbox.ts';
import { sameNativeIdentity } from '../../src/lib/native-runtime-contract.ts';

export async function prepareNativeWindowsReadiness(input, context) {
  return { params: nativeWindowsSandboxParams(nativeWindowsSandboxReadinessMethod, input), identity: await context.authority() };
}
export async function reviewNativeWindowsReadiness(plan, result, context) {
  if (!sameNativeIdentity(plan.identity, await context.authority())) throw new Error('Windows readiness authority changed.');
  const value = nativeWindowsSandboxReadiness(result);
  if ((context.platform ?? process.platform) !== 'win32' && value.status !== 'notConfigured') throw new Error('Windows readiness contradicts the native host platform.');
  return value;
}
