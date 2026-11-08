// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

/** Retain a caller's typed field error while measuring its complete UTF-8 envelope. */
export function assertNativeJsonByteBudget<Args extends unknown[]>(value: unknown, maximum: number,
  Failure: new (...args: Args) => Error, ...failureArgs: Args): void {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maximum) throw new Failure(...failureArgs);
}
