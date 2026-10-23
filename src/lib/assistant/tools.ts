// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Operation } from "../catalog.ts";
import type { WorkflowDocument } from "../workflow-document.ts";
import type { AssistantSettings } from "./config.ts";
import { readAssistantSkill } from "./skills.ts";

export type AssistantPort = { nodeId: string; handle: string | null; direction: "input" | "output"; label: string; available: boolean };
export type AssistantEdit = { workflowId: string } & (
  { kind: "add_operation"; operationId: string; x: number; y: number } |
  { kind: "move_nodes"; moves: { nodeId: string; x: number; y: number }[] } |
  { kind: "connect_nodes"; source: string; target: string; sourceHandle?: string; targetHandle?: string });
export type AssistantHost = {
  application: () => Record<string, unknown>;
  operations: () => readonly Operation[];
  operation: (id: string) => Promise<unknown>;
  schema: (id: string) => Promise<Record<string, unknown>>;
  workflow: (id?: string) => WorkflowDocument;
  ports: (nodeId: string) => Promise<AssistantPort[]>;
  edit: (edit: AssistantEdit, signal: AbortSignal) => Promise<unknown>;
};
const text = { type: "string", maxLength: 512 };
const coordinate = { type: "number", minimum: -100000, maximum: 100000 };
const paging = { offset: { type: "integer", minimum: 0, maximum: 100000 }, limit: { type: "integer", minimum: 1, maximum: 20 } };
const object = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });
export const assistantToolDefinitions = [
  { name: "read_application", description: "Read application summary, settings, catalogs or saved workflow summaries.", parameters: object({ section: { enum: ["summary", "settings", "catalogs", "workflows"] }, ...paging }, ["section"]) },
  { name: "search_operations", description: "Find available operations by words in name, method, path or description. Returns exact IDs.", parameters: object({ query: text, catalogId: text, ...paging }, ["query"]) },
  { name: "read_operation", description: "Read an operation's documentation, inputs and response schemas by exact operation ID.", parameters: object({ operationId: text }, ["operationId"]) },
  { name: "read_schema", description: "Read schema data at an exact JSON pointer. Object/array children are paged. Empty pointer lists root keys.", parameters: object({ catalogId: text, pointer: { type: "string", maxLength: 2048 }, ...paging }, ["catalogId", "pointer"]) },
  { name: "read_workflow", description: "Read current or saved workflow summary, nodes or connections. Filter by nodeId to inspect a node and its connections.", parameters: object({ workflowId: text, section: { enum: ["summary", "nodes", "connections"] }, nodeId: text, ...paging }, ["section"]) },
  { name: "read_ports", description: "Read the current node's actual visible input/output ports with exact handles, labels and availability.", parameters: object({ nodeId: text }, ["nodeId"]) },
  { name: "read_skill", description: "Read an available skill instruction file by its exact path.", parameters: object({ path: text }, ["path"]) },
  { name: "add_operation", description: "Add a catalog operation and its schema panels to the current workflow at canvas x/y. Does not run it.", parameters: object({ workflowId: text, operationId: text, x: coordinate, y: coordinate }, ["workflowId", "operationId", "x", "y"]) },
  { name: "move_nodes", description: "Move up to 20 visible nodes in the current workflow. Existing connections follow the nodes.", parameters: object({ workflowId: text, moves: { type: "array", minItems: 1, maxItems: 20, items: object({ nodeId: text, x: coordinate, y: coordinate }, ["nodeId", "x", "y"]) } }, ["workflowId", "moves"]) },
  { name: "connect_nodes", description: "Connect an available output to a compatible unoccupied input. Use exact handles from read_ports; omit a handle only for a null port.", parameters: object({ workflowId: text, source: text, target: text, sourceHandle: text, targetHandle: text }, ["workflowId", "source", "target"]) },
] as const;
const edits = new Set(["add_operation", "move_nodes", "connect_nodes"]);
export function enabledAssistantTools(settings: Pick<AssistantSettings, "tools" | "editing" | "skills">) {
  return assistantToolDefinitions.filter(tool => settings.tools && (tool.name !== "read_skill" || settings.skills) && (!edits.has(tool.name) || settings.editing));
}

function page(items: unknown[], args: Record<string, unknown>) {
  const offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 10);
  return { total: items.length, offset, nextOffset: offset + limit < items.length ? offset + limit : null, items: items.slice(offset, offset + limit) };
}

/** Omit credential bindings and uploaded file payloads from all read results. */
export function assistantReadable(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (key, value) => {
    if (key === "file" && value && typeof value === "object" && "source" in value && "format" in value)
      return { name: value.name, format: value.format, payload: "[omitted]" };
    return /^(credentialBinding|credentialId|base64|secret|password|token|authorization|cookie|api[_-]?key)$/i.test(key) ? "[omitted]" : value;
  }));
}

function schemaAt(root: unknown, pointer: string): unknown {
  if (pointer === "") return root;
  if (!pointer.startsWith("/") || /~(?:[^01]|$)/.test(pointer)) throw new Error("Use an RFC 6901 JSON pointer.");
  let value = root;
  for (const part of pointer.slice(1).split("/")) {
    const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!value || typeof value !== "object" || !Object.hasOwn(value, key)) throw new Error("Schema pointer not found.");
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** The allowlist is enforced again on the UI side; model text cannot add capabilities. */
export async function executeAssistantTool(host: AssistantHost, settings: Pick<AssistantSettings, "tools" | "editing" | "skills">,
  name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  const definition = enabledAssistantTools(settings).find(tool => tool.name === name);
  if (!definition) throw new Error("This assistant tool is not available.");
  validateToolObject(definition.parameters, args);
  let result: unknown;
  if (edits.has(name)) result = await host.edit({ ...args, kind: name } as AssistantEdit, signal);
  else if (name === "read_skill") result = readAssistantSkill(String(args.path));
  else if (name === "read_application") {
    const state = host.application();
    const section = state[String(args.section)];
    result = Array.isArray(section) ? page(section, args) : section;
  } else if (name === "search_operations") {
    const words = String(args.query).toLowerCase().trim().split(/\s+/).filter(Boolean);
    const operations = host.operations().filter(operation => (!args.catalogId || operation.id.startsWith(`${args.catalogId}:`)) &&
      words.every(word => `${operation.name} ${operation.method} ${operation.path} ${operation.group} ${operation.description}`.toLowerCase().includes(word)));
    result = page(operations.map(({ id, name, method, path, group, description, unavailableReason }) => ({ id, name, method, path, group, description: description.slice(0, 500), unavailableReason })), args);
  } else if (name === "read_operation") result = await host.operation(String(args.operationId));
  else if (name === "read_schema") {
    const value = schemaAt(await host.schema(String(args.catalogId)), String(args.pointer));
    result = value && typeof value === "object" ? page(Object.entries(value).map(([key, value]) => ({ key,
      pointer: String(args.pointer) + "/" + key.replaceAll("~", "~0").replaceAll("/", "~1"),
      value: value && typeof value === "object" ? { type: Array.isArray(value) ? "array" : "object", keys: Object.keys(value).slice(0, 20) } : value })), args) : value;
  } else if (name === "read_workflow") {
    const document = host.workflow(args.workflowId as string | undefined);
    if (args.section === "summary") result = { workflowId: document.id, name: document.name, description: document.description,
      nodes: document.nodes.length, connections: document.edges.length, viewport: document.viewport };
    else result = page(args.section === "nodes" ? document.nodes.filter(node => !args.nodeId || node.id === args.nodeId) :
      document.edges.filter(edge => !args.nodeId || edge.source === args.nodeId || edge.target === args.nodeId), args);
  } else result = await host.ports(String(args.nodeId));
  signal.throwIfAborted();
  const safe = assistantReadable(result);
  if (JSON.stringify(safe).length > 12000) throw new Error("Result is too large. Use a smaller page, a node ID or a more specific schema pointer.");
  return safe;
}

/** Small closed JSON-schema subset used on both sides of the worker boundary. */
export function validateToolObject(schema: Record<string, unknown>, value: unknown): void {
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) throw new Error("Invalid tool choice.");
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Tool arguments must be an object.");
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const input = value as Record<string, unknown>;
    if ((schema.required as string[]).some(key => !Object.hasOwn(input, key)) || Object.keys(input).some(key => !Object.hasOwn(properties, key))) throw new Error("Missing or unknown tool argument.");
    for (const key of Object.keys(input)) validateToolObject(properties[key]!, input[key]);
  } else if (schema.type === "array") {
    if (!Array.isArray(value) || value.length < Number(schema.minItems) || value.length > Number(schema.maxItems)) throw new Error("Invalid tool list length.");
    for (const item of value) validateToolObject(schema.items as Record<string, unknown>, item);
  } else if (schema.type === "string") {
    if (typeof value !== "string" || value.length > Number(schema.maxLength)) throw new Error("Invalid tool text argument.");
  } else if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value) || value < Number(schema.minimum) || value > Number(schema.maximum) ||
      schema.type === "integer" && !Number.isInteger(value)) throw new Error("Invalid tool numeric argument.");
  }
}
