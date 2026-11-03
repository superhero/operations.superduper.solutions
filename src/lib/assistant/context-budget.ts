// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

/** Output/template headroom is an application policy, not model capacity. */
export const contextReserveTokens = 128;
export type ContextMeasurement = { inputTokens: number; contextTokens: number; kind: "native" | "estimate"; method: string };
export type ContextBudget = ContextMeasurement & { reserveTokens: number; maxTokens: number };

export class ContextLimitError extends Error {
  readonly measurement: ContextMeasurement;
  readonly reserveTokens: number;
  constructor(measurement: ContextMeasurement, reserveTokens: number) {
    super(`The ${measurement.kind === "native" ? "native" : "estimated"} prompt uses ${measurement.inputTokens} tokens in a ${measurement.contextTokens}-token context, with ${reserveTokens} tokens reserved. There is no room for a reply. No messages were removed. Start a new conversation or reduce the input and enabled tools.`);
    this.name = "ContextLimitError";
    this.measurement = measurement;
    this.reserveTokens = reserveTokens;
  }
}

export function budgetContext(measurement: ContextMeasurement, requested: number, reserveTokens = contextReserveTokens): ContextBudget {
  if (!Number.isSafeInteger(measurement.inputTokens) || measurement.inputTokens < 0
    || !Number.isSafeInteger(measurement.contextTokens) || measurement.contextTokens < 1
    || !["native", "estimate"].includes(measurement.kind)
    || !Number.isSafeInteger(requested) || requested < 1 || !Number.isSafeInteger(reserveTokens) || reserveTokens < 0)
    throw new Error("The model returned an invalid context measurement.");
  const available = measurement.contextTokens - measurement.inputTokens - reserveTokens;
  if (available < 1) throw new ContextLimitError(measurement, reserveTokens);
  return { ...measurement, reserveTokens, maxTokens: Math.min(requested, available) };
}

/** Current Gemma/Wllama bindings have no prospective native token counter.
 * Include every request field; this estimate cannot guarantee native token fit.
 * Native formatters still own their trained templates and final capacity checks. */
export function estimateRequestContext(messages: readonly unknown[], tools: readonly unknown[], contextTokens: number, thinking: boolean): ContextMeasurement {
  const bytes = new TextEncoder().encode(JSON.stringify({ messages, tools, enable_thinking: thinking })).byteLength;
  return { inputTokens: Math.ceil(bytes / 3) + 16 * (messages.length + 1), contextTokens, kind: "estimate",
    method: "UTF-8 request bytes / 3 plus message framing; native template/tokenizer unavailable" };
}
