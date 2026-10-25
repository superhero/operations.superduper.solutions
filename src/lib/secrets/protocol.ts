// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { VaultSession } from "./session.ts";
import type { VaultErrorCode } from "./types.ts";
import type { WorkflowResponse } from "../workflow-execution.ts";
import type { ResponseProgress } from "../workflow-response-stream.ts";
import type { NativeAgentProgress } from "../native-agent-contract.ts";

export type VaultMethod = "status" | "unlock" | "prepareCreate" | "confirmCreate" | "keys" | "list" | "copyCredential" | "put" | "remove"
  | "grant" | "revoke" | "connections" | "connectionBinding" | "putConnection" | "removeConnection"
  | "beginJiraOAuth" | "pollJiraOAuth" | "completeJiraOAuth" | "cancelJiraOAuth"
  | "beginAtprotoOAuth" | "completeAtprotoOAuth" | "cancelAtprotoOAuth"
  | "beginGitlabOAuth" | "completeGitlabOAuth" | "cancelGitlabOAuth"
  | "nativeConnections" | "pairNativeRuntime" | "checkNativeRuntime" | "disconnectNativeRuntime"
  | "enableNativeWorkflow" | "loginNativeRuntime" | "executeNativeRuntime"
  | "dockerConnections" | "pairDockerHost" | "checkDockerHost" | "disconnectDockerHost" | "executeDockerRead"
  | "execute" | "checkAssertion" | "backup" | "restore" | "addMethod" | "removeMethod" | "rotate";
export type VaultArguments<M extends VaultMethod> = Parameters<VaultSession[M]>;
export type VaultResult<M extends VaultMethod> = Awaited<ReturnType<VaultSession[M]>>;
export type VaultFailure = { kind: "vault"; code: VaultErrorCode }
  | { kind: "field"; field: string; message: string }
  | { kind: "response"; response: WorkflowResponse; message: string };
export type VaultReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: VaultFailure }
  | { event: "locked" } | { event: "response-progress"; id: number; progress: ResponseProgress }
  | { event: "native-progress"; id: number; progress: NativeAgentProgress };
