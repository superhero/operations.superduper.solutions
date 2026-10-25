// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject } from "../native-runtime-contract.ts";
import { dockerIdentity, dockerDigest, dockerNativeProfile, type DockerHostIdentity } from "../docker-native-contract.ts";
import { validateNativeInput, validateNativeReference, nativeReference, type NativeRuntimeInput, type NativeRuntimeReference } from "./native-runtime-config.ts";
import { VaultError, type VaultCredential } from "./types.ts";
export type DockerHostReference = NativeRuntimeReference;
export type DockerHostInput = NativeRuntimeInput;
export type DockerBinding = { host: DockerHostReference; fingerprint: string };
export type DockerConnection = DockerHostReference & DockerHostInput & { profile: typeof dockerNativeProfile;
  keyHash: string; modelFingerprint: string; identity: DockerHostIdentity };
export const dockerReference = nativeReference;
export const validateDockerReference = validateNativeReference;
export const validateDockerInput = validateNativeInput;
export function validateDockerBinding(value: unknown): DockerBinding {
  try {
    const item = nativeObject(value, ["host", "fingerprint"]);
    if (!dockerDigest(item.fingerprint)) throw new Error();
    return { host: validateDockerReference(item.host), fingerprint: item.fingerprint };
  } catch { throw new VaultError("INVALID"); }
}
export function validateDockerConnection(value: unknown): DockerConnection {
  try {
    const item = nativeObject(value, ["id", "revision", "fingerprint", "label", "host", "pairingKeyId", "profile", "keyHash", "modelFingerprint", "identity"]);
    validateDockerReference({ id: item.id, revision: item.revision, fingerprint: item.fingerprint });
    const input = validateDockerInput({ label: item.label, host: item.host, pairingKeyId: item.pairingKeyId });
    if (item.host !== input.host || item.profile !== dockerNativeProfile || !dockerDigest(item.keyHash) || !dockerDigest(item.modelFingerprint)) throw new Error();
    return { ...item, identity: dockerIdentity(item.identity) } as DockerConnection;
  } catch { throw new VaultError("INVALID"); }
}
export function storedDockerConnections(records: readonly VaultCredential[]): DockerConnection[] {
  const result = records.flatMap(record => (record.dockerConnections ?? []).map(value => {
    const connection = validateDockerConnection(value);
    if (connection.pairingKeyId !== record.id) throw new VaultError("INVALID"); return connection;
  }));
  if (result.length > 32 || new Set(result.map(value => value.id)).size !== result.length) throw new VaultError("LIMIT"); return result;
}
