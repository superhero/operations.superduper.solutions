// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { VaultMethod } from './protocol.ts';
import { nativeFilesystemWatchLimits } from '../native-filesystem-watch.ts';

/** Persistent watches share a worker with one ordinary command at a time.
 * Credential writes revoke watches before changing their pinned state epoch. */
export function canStartVaultRequest(active: Iterable<VaultMethod>, method: VaultMethod): boolean {
  let watches = 0, commands = 0;
  for (const running of active) {
    if (running === 'executeNativeWatch') watches++;
    else if (running === 'executeNativeCommand') commands++;
    else if (running !== 'executeNativeRuntime' || !['cancelNativeAccountLogin', 'cancelNativeGatewayLogin', 'controlNativeTurn'].includes(method)) return false;
  }
  return (method !== 'executeNativeWatch' || watches < nativeFilesystemWatchLimits.watches) && (method !== 'executeNativeCommand' || commands < 8);
}
