// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
export const nativeRuntimeProfile = "codex-stdio-paired-v1";
export const nativeRuntimeVersion = "0.163.0";
export const nativeRuntimeLimits = { frame: 65536, pending: 8, tickets: 16, unpaired: 4,
  pairingMs: 5000, ticketMs: 30000, requestMs: 10000, sessionMs: 15 * 60 * 1000 } as const;
export const nativeAppQueryMethods = ['app/installed', 'app/list', 'app/read'] as const;
export const nativeFilesystemReadMethods = ['fs/readFile', 'fs/readDirectory', 'fs/getMetadata', 'fuzzyFileSearch'] as const;
export const nativeFilesystemWriteMethods = ['fs/writeFile', 'fs/createDirectory', 'fs/copy', 'fs/remove'] as const;
export const nativeSectionMethods = ['threadSection/list', 'threadSection/create', 'threadSection/update', 'threadSection/delete'] as const;
export const nativeSectionMutationMethods = ['threadSection/create', 'threadSection/update', 'threadSection/delete'] as const;
export type NativeSectionMethod = typeof nativeSectionMethods[number];
export const isNativeSectionMethod = (method: unknown): method is NativeSectionMethod => nativeSectionMethods.includes(method as NativeSectionMethod);
export const isNativeSectionMutationMethod = (method: unknown): method is typeof nativeSectionMutationMethods[number] => nativeSectionMutationMethods.includes(method as typeof nativeSectionMutationMethods[number]);
export const nativeStandaloneMutationMethods = [...nativeFilesystemWriteMethods, ...nativeSectionMutationMethods] as const;
export type NativeStandaloneMutationMethod = typeof nativeStandaloneMutationMethods[number];
export const isNativeStandaloneMutationMethod = (method: unknown): method is NativeStandaloneMutationMethod => nativeStandaloneMutationMethods.includes(method as NativeStandaloneMutationMethod);
export type NativeFilesystemWriteMethod = typeof nativeFilesystemWriteMethods[number];
export const isNativeFilesystemWriteMethod = (method: unknown): method is NativeFilesystemWriteMethod => nativeFilesystemWriteMethods.includes(method as NativeFilesystemWriteMethod);
export const isNativeFilesystemReadMethod = (method: unknown): method is typeof nativeFilesystemReadMethods[number] => nativeFilesystemReadMethods.includes(method as typeof nativeFilesystemReadMethods[number]);
export const isNativeFilesystemMethod = (method: unknown): boolean => isNativeFilesystemReadMethod(method) || isNativeFilesystemWriteMethod(method);
export const isNativeAppQueryMethod = (method: unknown): method is typeof nativeAppQueryMethods[number] => nativeAppQueryMethods.includes(method as typeof nativeAppQueryMethods[number]);
export const nativeQueryMethods = ['model/list', 'modelProvider/capabilities/read', 'permissionProfile/list', 'hooks/list', ...nativeAppQueryMethods, ...nativeFilesystemReadMethods] as const;
export type NativeQueryMethod = typeof nativeQueryMethods[number];
export const isNativeQueryMethod = (method: unknown): method is NativeQueryMethod => nativeQueryMethods.includes(method as NativeQueryMethod);
export const nativeStandaloneMethods = [...nativeQueryMethods, ...nativeFilesystemWriteMethods, ...nativeSectionMethods, 'mcpServerStatus/list', 'mcpServer/resource/read'] as const;
export type NativeStandaloneMethod = typeof nativeStandaloneMethods[number];
export const isNativeStandaloneMethod = (method: unknown): method is NativeStandaloneMethod => nativeStandaloneMethods.includes(method as NativeStandaloneMethod);
export type NativeRuntimeIdentity = { runtimeId: string; generation: string; version: typeof nativeRuntimeVersion;
  configuration: string; workspace: string; accountEpoch: string };
export type NativeRuntimeScope = { connectionId: string; method: "account/read" | "initialize" | "codex-workflow" | "codex-account-auth" | "codex-gateway-oauth" | "codex-account-actions" | "codex-filesystem-watch" | "codex-command" | "feedback/upload" | "mcpServer/oauth/login" | NativeStandaloneMethod; fingerprint: string };
export const nativeUuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export function nativeObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))
    || Object.values(Object.getOwnPropertyDescriptors(value)).some(field => !("value" in field))) throw new Error("Invalid native runtime contract.");
  return value as Record<string, unknown>;
}
export function nativeIdentity(value: unknown): NativeRuntimeIdentity {
  const item = nativeObject(value, ["runtimeId", "generation", "version", "configuration", "workspace", "accountEpoch"]);
  if (!nativeUuid(item.runtimeId) || !nativeUuid(item.generation) || !nativeUuid(item.accountEpoch)
    || item.version !== nativeRuntimeVersion || typeof item.configuration !== "string" || !/^[a-f0-9]{64}$/.test(item.configuration)
    || typeof item.workspace !== "string" || !/^[a-f0-9]{64}$/.test(item.workspace)) throw new Error("Invalid native runtime identity.");
  return { ...item } as NativeRuntimeIdentity;
}
export function nativeScope(value: unknown): NativeRuntimeScope {
  const item = nativeObject(value, ["connectionId", "method", "fingerprint"]);
  if (!nativeUuid(item.connectionId) || !["account/read", "initialize", "codex-workflow", "codex-account-auth", "codex-gateway-oauth", "codex-account-actions", "codex-filesystem-watch", "codex-command", "feedback/upload", "mcpServer/oauth/login", ...nativeStandaloneMethods].includes(String(item.method)) || typeof item.fingerprint !== "string"
    || !/^[a-f0-9]{64}$/.test(item.fingerprint)) throw new Error("Invalid native runtime scope.");
  return { ...item } as NativeRuntimeScope;
}
export function sameNativeIdentity(a: NativeRuntimeIdentity, b: NativeRuntimeIdentity): boolean {
  return (Object.keys(nativeIdentity(a)) as (keyof NativeRuntimeIdentity)[]).every(key => a[key] === nativeIdentity(b)[key]);
}
