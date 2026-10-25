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
  connections?: HttpConnection[];
  nativeConnections?: import("./native-runtime-config.ts").NativeRuntimeConnection[];
  dockerConnections?: import("./docker-config.ts").DockerConnection[];
  /** Encrypted managed-token payload; never part of key/value reads or summaries. */
  oauthState?: string;
};
export type VaultKey = Pick<VaultCredential, "id" | "label" | "kind">;
export type CredentialSummary = Omit<VaultCredential, "value" | "oauthState">;
export type BasicCredentialReference = { username: string; password: string };
export type OAuth1CredentialReference = { consumerKey: string; consumerSecret: string; accessToken: string; tokenSecret: string };
export type CredentialReference = string | BasicCredentialReference | OAuth1CredentialReference;
export type HttpConnectionReference = { id: string; revision: number; fingerprint: string };
export type GitlabOAuthMetadata = { profile: "gitlab-public-pkce-v1"; clientId: string; redirectUri: string; scope: "read_user"; accountId: string };
export type JiraOAuthMetadata = { profile: "atlassian-jira-3lo-v1"; host: string; hostId: string; configuration: string; clientId: string;
  redirectUri: string; scope: "read:jira-user offline_access"; cloudId: string; siteUrl: string; accountId: string };
export type HttpTokenFormat = "schema" | "discord-bot" | "opsgenie-key" | "gitlab-oauth" | "jira-companion";
export type HttpConnection = HttpConnectionReference & {
  label: string; account: string; provider: string; endpoint: string; runtime: "browser-http";
  alternative: number; security: import("../operation-security.ts").OperationSecurityScheme[];
  credentials: Record<string, CredentialReference>; format: HttpTokenFormat; expiresAt?: number; oauth?: GitlabOAuthMetadata | JiraOAuthMetadata;
};
export type HttpConnectionInput = { label: string; account: string; format: HttpTokenFormat;
  reference?: HttpConnectionReference; expiresAt?: number };
export type CredentialBinding = {
  alternative: number; credentials: Record<string, CredentialReference>; fingerprint: string;
  connection?: HttpConnectionReference;
};
export type CredentialExecutionContext = {
  binding: CredentialBinding; runId: string; nodeId: string;
  variables?: import("./variables.ts").VaultVariableInput[];
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
  | "DUPLICATE_KEY" | "PERMISSION" | "CANCELLED" | "LIMIT" | "NETWORK" | "REDACTED" | "AUTHORIZATION" | "NATIVE_FAILED" | "NATIVE_UNKNOWN"
  | "DOCKER_UNAVAILABLE" | "DOCKER_VERSION" | "DOCKER_AUTHORITY" | "DOCKER_DUPLEX";
const messages: Record<VaultErrorCode, string> = {
  DOCKER_UNAVAILABLE: "The paired Docker host could not complete its read. Check the companion and configured daemon socket.",
  DOCKER_VERSION: "The Docker daemon does not support the paired API version 1.57.",
  DOCKER_AUTHORITY: "The Docker host, daemon, socket or approved source changed. Pair the selected host again.",
  DOCKER_DUPLEX: "Docker streaming and upgraded connections are unavailable in this native read mode.",
  NATIVE_FAILED: "The native operation failed. Check the thread before starting another turn.",
  NATIVE_UNKNOWN: "The native connection ended without a confirmed result. A dispatched turn may have taken effect; it will not be retried automatically.",
  LOCKED: "Unlock the secrets vault to continue.",
  AUTHORIZATION: "Connect this account again to continue.",
  AUTHENTICATION: "The vault could not be unlocked. Check the unlock method and saved data.",
  INVALID: "The vault data or request is invalid or unsupported.",
  DUPLICATE_KEY: "A value is already saved with this key. Choose a different key.",
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
