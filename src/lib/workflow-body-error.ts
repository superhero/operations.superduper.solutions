// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
export class WorkflowBodyError extends Error {
  readonly code: "LIMIT" | "CANCELLED" | "MEDIA" | "FRAME" | "INCOMPLETE" | "PROVIDER" | "IDLE" | "TIMEOUT";
  constructor(code: WorkflowBodyError["code"]) {
    super(code === "LIMIT" ? "The response exceeds the supported size limit. Check the completed request before retrying."
      : code === "CANCELLED" ? "The request was cancelled."
      : code === "FRAME" ? "The endpoint returned an invalid stream frame. Check the completed request before retrying."
      : code === "INCOMPLETE" ? "The stream ended before a successful final result. Check the completed request before retrying."
      : code === "PROVIDER" ? "The provider did not complete the streamed response successfully. Check the completed request before retrying."
      : code === "IDLE" ? "The response stream stopped sending data. Check the completed request before retrying."
      : code === "TIMEOUT" ? "The response stream exceeded its run deadline. Check the completed request before retrying."
      : "The endpoint returned an unsupported or undeclared response type. Check the completed request before retrying.");
    this.code = code;
  }
}
