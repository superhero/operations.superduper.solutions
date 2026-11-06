// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
export const multipartFileSources: Record<string, string> = {
  anthropic: "c23b4e84fb0d699275f74767c41af4d3c62f1f9457a75bf55e02559abf44e1cd",
  elevenlabs: "8cee136ec627a5557c61fca7650f69feeeb63d45fc4b1aea097f6f76b69f5c9e",
};
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
function requireContract(value: unknown): asserts value {
  if (!value) throw new Error("Multipart file fields require their reviewed provider source contract.");
}
/** These corrections describe form wire values, while retaining the full original
 * schema. Anthropic uses files[] parts; ElevenLabs JSON-encodes labels as text. */
export function bindMultipartFiles(document: Record<string, any>): void {
  const anthropic = document.info?.title === "Anthropic API";
  requireContract(document.openapi === "3.1.0" && (anthropic ? document.info.version === "sdk-v0.120.0"
    : document.info?.title === "ElevenLabs API Documentation" && document.info.version === "1.0"));
  const origin = anthropic ? "https://api.anthropic.com" : "https://api.elevenlabs.io";
  requireContract(document.servers?.length === 1 && document.servers[0].url === origin);
  const routes = anthropic ? [["/v1/skills", "create_skill_v1_skills_post"], ["/v1/skills/{skill_id}/versions", "create_skill_version_v1_skills__skill_id__versions_post"],
    ["/v1/skills?beta=true", "beta_create_skill_v1_skills_post"], ["/v1/skills/{skill_id}/versions?beta=true", "beta_create_skill_version_v1_skills__skill_id__versions_post"]]
    : [["/v1/voices/add", "add_voice"], ["/v1/voices/{voice_id}/edit", "edit_voice"]];
  for (const [path, id] of routes) {
    const item = document.paths?.[path!], operation = item?.post;
    const media = operation?.requestBody?.content;
    requireContract(operation?.operationId === id && operation.servers === undefined && item.servers === undefined
      && object(media) && Object.keys(media).length === 1 && object(media["multipart/form-data"]));
    const reference = media["multipart/form-data"].schema?.$ref;
    requireContract(typeof reference === "string" && /^#\/components\/schemas\/[A-Za-z0-9_]+$/.test(reference));
    const schema = document.components?.schemas?.[reference.slice("#/components/schemas/".length)];
    requireContract(schema?.type === "object" && object(schema.properties) && schema["x-upstream-form-schema"] === undefined);
    const original = structuredClone(schema);
    if (anthropic) {
      const files = schema.properties.files;
      requireContract(files?.type === "array" && files.items?.type === "string" && files.items.format === "binary"
        && schema.properties["files[]"] === undefined && schema.required?.includes("files"));
      schema.properties = Object.fromEntries(Object.entries(schema.properties).map(([name, value]) => [name === "files" ? "files[]" : name, value]));
      schema.required = schema.required.map((name: string) => name === "files" ? "files[]" : name);
    } else {
      const labels = schema.properties.labels, variants = labels?.anyOf;
      requireContract(object(labels) && Object.keys(labels).every(key => ["anyOf", "title", "description", "examples"].includes(key))
        && Array.isArray(variants) && variants.length === 3
        && variants[0]?.type === "object" && Object.keys(variants[0]).length === 2
        && variants[0].additionalProperties?.type === "string" && Object.keys(variants[0].additionalProperties).length === 1
        && variants[1]?.type === "string" && Object.keys(variants[1]).length === 1
        && variants[2]?.type === "null" && Object.keys(variants[2]).length === 1);
      const { anyOf: _variants, ...annotations } = labels;
      schema.properties.labels = { ...annotations, type: "string",
        description: `${labels.description}\n\nEnter JSON text representing a string-to-string map, a string or null. The API receives this JSON-encoded form value.` };
    }
    schema["x-upstream-form-schema"] = original;
  }
}
