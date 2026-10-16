// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { VaultSession } from "./session.ts";
import type { VaultErrorCode } from "./types.ts";
import type { WorkflowResponse } from "../workflow-execution.ts";

export type VaultMethod = "status" | "unlock" | "prepareCreate" | "confirmCreate" | "list" | "copyCredential" | "put" | "remove"
  | "grant" | "revoke" | "execute" | "backup" | "restore" | "addMethod" | "removeMethod" | "rotate";
export type VaultArguments<M extends VaultMethod> = Parameters<VaultSession[M]>;
export type VaultResult<M extends VaultMethod> = Awaited<ReturnType<VaultSession[M]>>;
export type VaultFailure = { kind: "vault"; code: VaultErrorCode }
  | { kind: "field"; field: string; message: string }
  | { kind: "response"; response: WorkflowResponse; message: string };
export type VaultReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: VaultFailure }
  | { event: "locked" };
