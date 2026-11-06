// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Operation } from "./catalog.ts";
import type { InputValues } from "./operation-input.ts";
type Route = { method: string; path: string; stream?: "mistral-conversation" | "mistral-transcription" };
const routes: Record<string, Route> = {
  "mistral:agents_api_v1_conversations_start_stream": { method: "POST", path: "/v1/conversations#stream", stream: "mistral-conversation" },
  "mistral:agents_api_v1_conversations_append_stream": { method: "POST", path: "/v1/conversations/{conversation_id}#stream", stream: "mistral-conversation" },
  "mistral:agents_api_v1_conversations_restart_stream": { method: "POST", path: "/v1/conversations/{conversation_id}/restart#stream", stream: "mistral-conversation" },
  "mistral:audio_api_v1_transcriptions_post_stream": { method: "POST", path: "/v1/audio/transcriptions#stream", stream: "mistral-transcription" },
  "mistral:connector_get_v1": { method: "GET", path: "/v1/connectors/{connector_id_or_name}#idOrName" },
  "mistral:connector_update_v1": { method: "PATCH", path: "/v1/connectors/{connector_id}#id" },
  "mistral:connector_delete_v1": { method: "DELETE", path: "/v1/connectors/{connector_id}#id" },
};
export const mistralVariantProfile = "mistral-fragments-v1";
export function configureMistralVariant(operation: Pick<Operation, "id" | "method" | "path" | "mistralVariant" | "responseStream">, marker: unknown, stream: unknown): void {
  if (marker === undefined) return;
  const route = routes[operation.id];
  if (marker !== mistralVariantProfile || route?.method !== operation.method || route.path !== operation.path || stream !== route.stream)
    throw new Error("Mistral variants require their reviewed native ID, method, path and response stream.");
  operation.mistralVariant = marker;
  if (route.stream) operation.responseStream = route.stream;
}
/** Catalog paths retain native selectors; only an exact reviewed route loses its fragment. */
export function mistralVariantRoute(operation: Operation): { path: string; stream: boolean } | undefined {
  if (operation.mistralVariant === undefined) return;
  configureMistralVariant({ ...operation }, operation.mistralVariant, operation.responseStream);
  return { path: operation.path.split("#", 1)[0]!, stream: !!routes[operation.id]!.stream };
}
export function mistralVariantInputs(operation: Operation, values: InputValues): InputValues {
  if (!mistralVariantRoute(operation)?.stream) return values;
  const field = operation.fields.find(field => field.key === "body:stream" && field.type === "boolean");
  if (!field || operation.bodyValue) throw new Error("Mistral streaming requires its named Boolean stream input.");
  const value = values[field.key];
  if (value === undefined || value !== null && !value.trim()) return { ...values, [field.key]: "true" };
  if (value === null || value.trim() !== "true") throw new Error('Mistral stream variants require body parameter "stream" to be true.');
  return values;
}
