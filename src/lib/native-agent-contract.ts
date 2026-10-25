// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject } from "./native-runtime-contract.ts";

/** Reviewed public 0.163.0 methods. Login and interruption are private controls. */
export const nativeWorkflowMethods = ["thread/start", "thread/resume", "turn/start"] as const;
export type NativeWorkflowMethod = typeof nativeWorkflowMethods[number];
export const nativeAgentMethods = ["initialize", "account/read", "account/login/start", "account/login/cancel",
  ...nativeWorkflowMethods, "turn/interrupt"] as const;
export type NativeAgentMethod = typeof nativeAgentMethods[number];
export type NativeLoginKind = "apiKey" | "chatgpt" | "chatgptDeviceCode";
export type NativeDecision = "accept" | "decline" | "cancel";
export type NativeInteraction = { token: string; kind: "command" | "fileChange"; threadId: string; turnId: string;
  itemId: string; command?: string; cwd?: string; reason?: string };
export type NativeAgentProgress = { kind: "login"; login: "chatgpt"; loginId: string; authUrl: string }
  | { kind: "login"; login: "chatgptDeviceCode"; loginId: string; verificationUrl: string; userCode: string }
  | { kind: "approval"; interaction: NativeInteraction }
  | { kind: "running"; threadId: string; turnId: string };
export type NativeProgressCallback = (progress: NativeAgentProgress) => void;
export type NativeRequest = { protocol: "json-rpc"; method: NativeWorkflowMethod; params: Record<string, unknown> };
export type NativeResponse = { protocol: "json-rpc"; result: unknown };
export type NativeExecutionResult = { request: NativeRequest; response: NativeResponse };
export type NativeRpcId = string | number;
export const nativeRpcId = (id: unknown): id is NativeRpcId => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id)
  || Number.isSafeInteger(id) && (id as number) >= 0;
export const nativeOwnedId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,192}$/.test(id);
export const isNativeWorkflowMethod = (method: unknown): method is NativeWorkflowMethod => nativeWorkflowMethods.includes(method as NativeWorkflowMethod);
export const nativeWorkflowResultTypes: Record<NativeWorkflowMethod, string> = {
  "thread/start": "ThreadStartResponse", "thread/resume": "ThreadResumeResponse", "turn/start": "TurnCompletedNotification"
};
/** The reviewed input subset; the complete pinned wire schema is retained too. */
export function nativeWorkflowInputSchema(method: NativeWorkflowMethod) {
  return { type: "object", additionalProperties: false, properties: {
    ...(method !== "thread/start" ? { threadId: { type: "string", minLength: 1, maxLength: 192, pattern: "^[A-Za-z0-9_-]+$" } } : {}),
    ...(method === "turn/start" ? { input: { type: "array", minItems: 1, maxItems: 16, items: { type: "object", additionalProperties: false,
      properties: { type: { type: "string", enum: ["text"] }, text: { type: "string", minLength: 1, maxLength: 24576 } }, required: ["type", "text"] } } } : {}),
    model: { type: "string", minLength: 1, maxLength: 128 }
  }, required: method === "thread/start" ? [] : method === "thread/resume" ? ["threadId"] : ["threadId", "input"] };
}

/** No cwd, sandbox, provider, environment, config, history or credential overrides. */
export function nativeWorkflowParams(method: NativeWorkflowMethod, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid native parameters.");
  const item = value as Record<string, unknown>, keys = Object.keys(item);
  const allowed = method === "thread/start" ? ["model"] : method === "thread/resume" ? ["threadId", "model"] : ["threadId", "input", "model"];
  nativeObject(item, keys);
  if (keys.some(key => !allowed.includes(key)) || item.model !== undefined && (typeof item.model !== "string"
    || !item.model.trim() || item.model.length > 128 || /[\u0000-\u001f\u007f]/.test(item.model))) throw new Error("Unsupported native parameters.");
  if (method !== "thread/start" && !nativeOwnedId(item.threadId)) throw new Error("A native thread is required.");
  if (method === "turn/start") {
    if (!Array.isArray(item.input) || !item.input.length || item.input.length > 16) throw new Error("Text input is required.");
    let bytes = 0;
    for (const input of item.input) {
      const text = nativeObject(input, ["type", "text"]);
      if (text.type !== "text" || typeof text.text !== "string" || !text.text.trim()) throw new Error("Only text input is supported.");
      bytes += new TextEncoder().encode(text.text).byteLength;
    }
    if (bytes > 24 * 1024) throw new Error("Native text input is too large.");
  }
  return structuredClone(item);
}
export function nativeLoginParams(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid native login.");
  const item = value as Record<string, unknown>;
  nativeObject(item, item.type === "apiKey" ? ["type", "apiKey"] : ["type"]);
  if (!["apiKey", "chatgpt", "chatgptDeviceCode"].includes(String(item.type)) || item.type === "apiKey"
    && (typeof item.apiKey !== "string" || !item.apiKey.trim() || item.apiKey.length > 4096 || /[\u0000-\u001f\u007f]/.test(item.apiKey))) throw new Error("Unsupported native login.");
  return { ...item };
}
