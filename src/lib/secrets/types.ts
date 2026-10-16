// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Operation } from "../catalog.ts";

export const vaultFormatVersion = 1 as const;
export const vaultDatabaseName = "v1/secrets";
export const vaultLimits = { records: 1000, recordBytes: 256 * 1024, backupBytes: 32 * 1024 * 1024,
  secretBytes: 16 * 1024, responseBytes: 8 * 1024 * 1024, diagnosticBytes: 16 * 1024 } as const;
export const passwordProfile = { algorithm: "argon2id", version: 19, memoryKiB: 65536,
  iterations: 3, parallelism: 1, outputBytes: 32 } as const;
export type PasswordProfile = typeof passwordProfile;
export type Ciphertext = { iv: string; data: string };
export type CryptoContext = { vaultId: string; epoch: number; kind: string; id: string; revision: number };
export type UnlockKind = "password" | "recovery" | "passkey";
export type KeyEnvelope = {
  id: string; kind: UnlockKind; revision: number; salt: string; wrappedKey: Ciphertext;
  profile?: PasswordProfile; credentialId?: string; prfSalt?: string;
};
export type EncryptedRecord = { id: string; kind: "credential"; revision: number; ciphertext: Ciphertext };
export type VaultSnapshot = {
  version: 1; id: string; epoch: number; revision: number; envelopes: KeyEnvelope[];
  manifest: Ciphertext; records: EncryptedRecord[];
};
export type VaultManifest = {
  version: 1; vaultId: string; epoch: number; revision: number;
  envelopes: { id: string; digest: string }[];
  records: { id: string; revision: number; digest: string }[];
};
export type ApprovedOperation = { fingerprint: string; origin: string; operation: Operation };
export type CredentialGrant = { id: string; scheme: string; descriptor: ApprovedOperation };
export type VaultCredential = {
  id: string; label: string; kind: "bearer" | "apiKey" | "secret"; value: string; grants: CredentialGrant[];
};
export type CredentialSummary = Omit<VaultCredential, "value">;
export type CredentialBinding = {
  alternative: number; credentials: Record<string, string>; fingerprint: string;
};
export type CredentialExecutionContext = {
  binding: CredentialBinding; runId: string; nodeId: string;
};
export const recoveryKeyBytes = 128;
export const recoveryKeyCharacters = Math.ceil(recoveryKeyBytes / 3) * 4;
export type UnlockProof = { methodId: string; secret: string } | { methodId: string; prf: Uint8Array };
export type Enrollment = { kind: "password"; secret: string } | { kind: "recovery"; secret: string }
  | { kind: "passkey"; prf: Uint8Array; credentialId: string; prfSalt: string };
export type VaultPreferences = { idleLockEnabled: boolean; idleLockMinutes: number };
export const defaultVaultPreferences: Readonly<VaultPreferences> = { idleLockEnabled: false, idleLockMinutes: 10 };
export type VaultStatus = { exists: boolean; unlocked: boolean; revision: number; epoch: number;
  methods: { id: string; kind: UnlockKind; credentialId?: string; prfSalt?: string }[] };
export type VaultErrorCode = "LOCKED" | "AUTHENTICATION" | "INVALID" | "UNAVAILABLE" | "CONFLICT"
  | "PERMISSION" | "CANCELLED" | "LIMIT" | "NETWORK" | "REDACTED";
const messages: Record<VaultErrorCode, string> = {
  LOCKED: "Unlock the secrets vault to continue.",
  AUTHENTICATION: "The vault could not be unlocked. Check the unlock method and saved data.",
  INVALID: "The vault data or request is invalid or unsupported.",
  UNAVAILABLE: "The secrets vault is unavailable. No plaintext fallback was created.",
  CONFLICT: "The vault changed in another tab. Unlock it again before continuing.",
  PERMISSION: "This credential has not been approved for the requested operation.",
  CANCELLED: "The credential operation was cancelled. A dispatched request may already have taken effect.",
  LIMIT: "The credential operation exceeded its supported size limit.",
  NETWORK: "The credentialed request could not be completed. Check the endpoint and browser access policy.",
  REDACTED: "Sensitive response data was removed. Dependent workflow steps cannot use that value.",
};
/** Never attach raw errors, requests, password input or native cause chains here. */
export class VaultError extends Error {
  readonly code: VaultErrorCode;
  constructor(code: VaultErrorCode) { super(messages[code]); this.name = "VaultError"; this.code = code; }
}
export function safeVaultError(error: unknown): VaultError {
  return error instanceof VaultError ? new VaultError(error.code) : new VaultError("UNAVAILABLE");
}
