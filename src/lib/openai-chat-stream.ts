// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { WorkflowBodyError } from "./workflow-body-error.ts";
type Value = Record<string, any>;
type Choice = { metadata: Value; message: Value; tools: Map<number, Value>; finish: string | null };
const object = (value: unknown): value is Value => !!value && typeof value === "object" && !Array.isArray(value);
const fragments = Symbol("chat fragments");
const set = (target: Value, name: string, value: unknown) => Object.defineProperty(target, name, { value, enumerable: true, writable: true, configurable: true });
/** Keep string fragments separate until completion, including tool arguments. */
function merge(target: Value, delta: Value): void {
  for (const [name, value] of Object.entries(delta)) {
    const previous = Object.hasOwn(target, name) ? target[name] : undefined;
    if (typeof value === "string") {
      if (name === "role" || name === "type") {
        if (previous !== undefined && previous !== value) throw new WorkflowBodyError("FRAME");
        set(target, name, value);
      } else if (previous?.[fragments]) previous[fragments].push(value);
      else {
        if (previous !== undefined && previous !== null) throw new WorkflowBodyError("FRAME");
        set(target, name, { [fragments]: [value] });
      }
    } else if (Array.isArray(value)) {
      if (previous !== undefined && previous !== null && !Array.isArray(previous)) throw new WorkflowBodyError("FRAME");
      set(target, name, [...(Array.isArray(previous) ? previous : []), ...value]);
    }
    else if (object(value)) {
      if (previous !== undefined && previous !== null && (!object(previous) || Object.hasOwn(previous, fragments))) throw new WorkflowBodyError("FRAME");
      const next = object(previous) ? previous : Object.create(null);
      merge(next, value); set(target, name, next);
    } else if (value !== null || previous === undefined) set(target, name, value);
  }
}
function materialize(value: any): any {
  if (value?.[fragments]) return value[fragments].join("");
  if (Array.isArray(value)) return value.map(materialize);
  return object(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, materialize(item)])) : value;
}
/** One finite chat completion, preserving choices, tool calls, usage and metadata. */
export function openaiChatAccumulator() {
  let metadata: Value | undefined;
  const choices = new Map<number, Choice>();
  return {
    frame(value: Value) {
      if (value.error != null) throw new WorkflowBodyError("PROVIDER");
      if (value.object !== "chat.completion.chunk" || typeof value.id !== "string" || !value.id || typeof value.model !== "string" || !value.model
        || !Number.isSafeInteger(value.created) || value.created < 0 || !Array.isArray(value.choices)) throw new WorkflowBodyError("FRAME");
      if (metadata && ["id", "model", "created"].some(key => metadata![key] !== value[key])) throw new WorkflowBodyError("FRAME");
      const { choices: _choices, ...next } = value;
      metadata = { ...metadata, ...next };
      for (const choice of value.choices) {
        if (!object(choice) || !Number.isSafeInteger(choice.index) || choice.index < 0 || !object(choice.delta)
          || choice.finish_reason !== null && typeof choice.finish_reason !== "string") throw new WorkflowBodyError("FRAME");
        const state: Choice = choices.get(choice.index) ?? { metadata: {}, message: Object.create(null), tools: new Map<number, Value>(), finish: null };
        if (state.finish && Object.keys(choice.delta).length) throw new WorkflowBodyError("FRAME");
        if (choice.finish_reason !== null) {
          if (!choice.finish_reason || state.finish && state.finish !== choice.finish_reason) throw new WorkflowBodyError("FRAME");
          state.finish = choice.finish_reason;
        }
        const { delta, ...extra } = choice;
        const previousProbabilities = state.metadata.logprobs;
        state.metadata = { ...state.metadata, ...extra };
        if (object(previousProbabilities)) {
          const probabilities = object(extra.logprobs) ? extra.logprobs : {};
          state.metadata.logprobs = { ...previousProbabilities, ...probabilities };
          for (const key of ["content", "refusal"]) {
            if (probabilities[key] !== undefined && probabilities[key] !== null && !Array.isArray(probabilities[key])) throw new WorkflowBodyError("FRAME");
            if (Array.isArray(previousProbabilities[key]) || Array.isArray(probabilities[key]))
              state.metadata.logprobs[key] = [...(previousProbabilities[key] ?? []), ...(probabilities[key] ?? [])];
          }
        }
        const { tool_calls, ...message } = delta;
        merge(state.message, message);
        if (tool_calls !== undefined) {
          if (!Array.isArray(tool_calls)) throw new WorkflowBodyError("FRAME");
          for (const tool of tool_calls) {
            if (!object(tool) || !Number.isSafeInteger(tool.index) || tool.index < 0) throw new WorkflowBodyError("FRAME");
            const { index, ...part } = tool, target = state.tools.get(index) ?? Object.create(null);
            merge(target, part); state.tools.set(index, target);
          }
        }
        choices.set(choice.index, state);
      }
    },
    finish(): Value {
      if (!metadata || !choices.size || [...choices.values()].some(choice => !choice.finish)) throw new WorkflowBodyError("INCOMPLETE");
      return { ...metadata, object: "chat.completion", choices: [...choices].sort(([a], [b]) => a - b).map(([index, choice]) => {
        const message = materialize(choice.message);
        message.role ??= "assistant"; message.content ??= null;
        if (choice.tools.size) message.tool_calls = [...choice.tools].sort(([a], [b]) => a - b).map(([, tool]) => materialize(tool));
        return { ...choice.metadata, index, finish_reason: choice.finish, message };
      }) };
    },
  };
}
