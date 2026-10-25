// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Operation } from "./catalog.ts";
import { securityRequiresCredentials, supportedSecurityAlternative } from "./operation-security.ts";
import { nativeRuntimeVersion } from "./native-runtime-contract.ts";

export type CapabilityArea = "schema" | "endpoint" | "request" | "authentication" | "response" | "runtime";
export type CapabilityIssue = { area: CapabilityArea; code: string; message: string };
export type CapabilityRequirement = { code: "credentials" | "server" | "native-host" | "native-account" | "native-workspace" | "native-method" | "native-terminal" | "docker-destination"; message: string };
export type AuthenticationCapability = { id: string; index: number; names: string[]; supported: boolean; reasons?: string[] };
export type OperationCapabilities = { issues: CapabilityIssue[]; alternatives?: AuthenticationCapability[]; requirements?: CapabilityRequirement[] };
/** Navigation retains codes and source positions, without repeating shared prose. */
export type CapabilitySummary = { i: [CapabilityArea, string, string?][];
  a?: [string[], boolean, (string | number)[]?][]; r?: (CapabilityRequirement["code"] | [CapabilityRequirement["code"], string])[] };
const requirementMessages: Record<CapabilityRequirement["code"], string> = {
  credentials: "Select and authorize credentials or a matching connection for a supported alternative.",
  server: "Configure an absolute server URL for this schema.",
  "native-host": "Pair a compatible runtime using the trusted companion and exact allowed application origin.",
  "native-account": "Connect an authorized public account; internal authentication modes remain unavailable.",
  "native-workspace": "Select the runtime's authorized private workspace.",
  "native-method": "Enable the selected workflow method and approve any supported interaction explicitly.",
  "native-terminal": "The owned turn must produce a terminal result before the workflow continues.",
  "docker-destination": "Select a separately paired Docker host or a configured absolute HTTP server.",
};
export const capabilityAreaLabels: Record<CapabilityArea, string> = { schema: "Schema", endpoint: "Endpoint", request: "Request", authentication: "Authentication", response: "Response", runtime: "Runtime" };

export function nativeCapabilityIssues(supportedMethod: boolean, version: string, limitation: string): CapabilityIssue[] {
  return [...(!supportedMethod ? [{ area: "runtime" as const, code: "unsupported-native-method", message: limitation }] : []),
    ...(version !== nativeRuntimeVersion ? [{ area: "runtime" as const, code: "runtime-version", message: `This native schema uses ${version}; the qualified runtime contract is ${nativeRuntimeVersion}.` }] : [])];
}

/** Presentation metadata never grants authority. IDs retain original source positions;
 * their meaning is scoped to the current canonical source and policy fingerprint. */
export function withOperationCapabilities<T extends Operation>(operation: T, issues: CapabilityIssue[] = []): T {
  const unique = issues.filter((issue, index) => issues.findIndex(value => value.area === issue.area && value.code === issue.code && value.message === issue.message) === index);
  const alternatives = operation.security?.map((alternative, index) => {
    const reasons = [...new Set(alternative.flatMap(scheme => scheme.kind === "unsupported" ? [scheme.reason] : []))];
    return { id: `security-${index}`, index, names: alternative.map(scheme => scheme.name), supported: supportedSecurityAlternative(alternative), ...(reasons.length ? { reasons } : {}) };
  });
  const requirements: CapabilityRequirement[] = [];
  if (securityRequiresCredentials(operation.security) && operation.security?.some(supportedSecurityAlternative)) requirements.push({ code: "credentials", message: operation.privatePath
    ? "Select a private connection for this operation." : "Select and authorize credentials or a matching connection for a supported alternative." });
  if (unique.some(issue => issue.code === "configuration-required")) requirements.push({ code: "server", message: "Configure an absolute server URL for this schema." });
  if (operation.method === "RPC") requirements.push(
    { code: "native-host", message: "Pair a compatible runtime using the trusted companion and exact allowed application origin." },
    { code: "native-account", message: "Connect an authorized public account; internal authentication modes remain unavailable." },
    { code: "native-workspace", message: "Select the runtime's authorized private workspace." },
    { code: "native-method", message: "Enable the selected workflow method and approve any supported interaction explicitly." },
    { code: "native-terminal", message: "The owned turn must produce a terminal result before the workflow continues." });
  if (operation.dockerNative) requirements.push({ code: "docker-destination", message: "Select a separately paired Docker host or a configured absolute HTTP server." });
  if (unique.length || alternatives?.length || requirements.length) operation.capabilities = {
    issues: unique, ...(alternatives?.length ? { alternatives } : {}), ...(requirements.length ? { requirements } : {}) };
  if (unique.length) operation.unavailableReason ??= unique[0]!.message;
  return operation;
}

/** Always call this on the current canonical model before execution. */
export function operationBlockReason(operation: Operation): string | undefined {
  return operation.capabilities?.issues[0]?.message ?? operation.capabilitySummary?.i[0]?.[2] ?? operation.unavailableReason;
}
export function operationCapabilityHint(operation: Operation): string | undefined {
  const issues = readOperationCapabilities(operation)?.issues;
  return issues?.length && issues.length > 1 ? issues.map(issue => `${capabilityAreaLabels[issue.area]}: ${issue.message}`).join("\n") : operationBlockReason(operation);
}

export function summarizeOperationCapabilities(operation: Operation): CapabilitySummary | undefined {
  const caps = operation.capabilities;
  if (!caps) return;
  const reference = (message: string): string | number => message === operation.unavailableReason ? 0
    : caps.issues.some(issue => issue.message === message) ? caps.issues.findIndex(issue => issue.message === message) + 1 : message;
  return { i: caps.issues.map(issue => issue.message === operation.unavailableReason ? [issue.area, issue.code] : [issue.area, issue.code, issue.message]),
    ...(caps.alternatives?.length ? { a: caps.alternatives.map(alternative => [[...alternative.names], alternative.supported,
      ...(alternative.reasons?.length ? [alternative.reasons.map(reference)] : [])] as NonNullable<CapabilitySummary["a"]>[number]) } : {}),
    ...(caps.requirements?.length ? { r: caps.requirements.map(requirement => requirement.message === requirementMessages[requirement.code]
      ? requirement.code : [requirement.code, requirement.message] as [CapabilityRequirement["code"], string]) } : {}) };
}

/** Expand only an operation being inspected, never every descriptor at startup. */
export function readOperationCapabilities(operation: Operation): OperationCapabilities | undefined {
  if (operation.capabilities) return operation.capabilities;
  const summary = operation.capabilitySummary;
  if (!summary) return;
  const issues = summary.i.map(([area, code, message]) => ({ area, code, message: message ?? operation.unavailableReason! }));
  return { issues, ...(summary.a?.length ? { alternatives: summary.a.map(([names, supported, reasons], index) => ({ id: `security-${index}`, index, names, supported,
    ...(reasons?.length ? { reasons: reasons.map(value => typeof value === "string" ? value : value === 0 ? operation.unavailableReason! : issues[value - 1]!.message) } : {}) })) } : {}),
    ...(summary.r?.length ? { requirements: summary.r.map(value => typeof value === "string" ? { code: value, message: requirementMessages[value] }
      : { code: value[0], message: value[1] }) } : {}) };
}

export function validateCapabilitySummary(value: unknown, legacy?: string): asserts value is CapabilitySummary {
  const summary = value as CapabilitySummary;
  if (!summary || !Array.isArray(summary.i)) throw new Error("Operation capability diagnostics are invalid or outdated.");
  const invalidIssue = summary.i.some(issue => !Array.isArray(issue) || issue.length < 2 || issue.length > 3
    || !Object.hasOwn(capabilityAreaLabels, issue[0]) || typeof issue[1] !== "string" || !issue[1]
    || (issue[2] === undefined ? !legacy : typeof issue[2] !== "string" || !issue[2]));
  const invalidAlternative = summary.a !== undefined && (!Array.isArray(summary.a) || summary.a.some(alternative => !Array.isArray(alternative)
    || alternative.length < 2 || alternative.length > 3 || !Array.isArray(alternative[0]) || alternative[0].some(name => typeof name !== "string")
    || typeof alternative[1] !== "boolean" || alternative[2] !== undefined && (!Array.isArray(alternative[2]) || alternative[2].some(reason =>
      typeof reason === "string" ? !reason : !Number.isInteger(reason) || reason < 0 || reason > summary.i.length || reason === 0 && !legacy))));
  const invalidRequirement = summary.r !== undefined && (!Array.isArray(summary.r) || summary.r.some(value => typeof value === "string"
    ? !Object.hasOwn(requirementMessages, value) : !Array.isArray(value) || value.length !== 2 || !Object.hasOwn(requirementMessages, value[0]) || typeof value[1] !== "string"));
  if (invalidIssue || invalidAlternative || invalidRequirement) throw new Error("Operation capability diagnostics are invalid or outdated.");
}

/** Persisted navigation data must have the current compact diagnostics shape. */
export function validateOperationCapabilities(value: unknown): asserts value is OperationCapabilities {
  const caps = value as OperationCapabilities;
  if (!caps || !Array.isArray(caps.issues) || caps.issues.some(issue => !issue || !Object.hasOwn(capabilityAreaLabels, issue.area)
    || typeof issue.code !== "string" || !issue.code || typeof issue.message !== "string" || !issue.message)
    || caps.alternatives !== undefined && (!Array.isArray(caps.alternatives) || caps.alternatives.some((alternative, index) => !alternative
      || alternative.id !== `security-${index}` || alternative.index !== index || !Array.isArray(alternative.names)
      || alternative.names.some(name => typeof name !== "string") || typeof alternative.supported !== "boolean"
      || alternative.reasons !== undefined && (!Array.isArray(alternative.reasons) || alternative.reasons.some(reason => typeof reason !== "string"))))
    || caps.requirements !== undefined && (!Array.isArray(caps.requirements) || caps.requirements.some(requirement => !requirement
      || !["credentials", "server", "native-host", "native-account", "native-workspace", "native-method", "native-terminal", "docker-destination"].includes(requirement.code)
      || typeof requirement.message !== "string" || !requirement.message))) throw new Error("Operation capability diagnostics are invalid or outdated.");
}
