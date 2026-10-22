// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import { commentTextLimit, isValueConnection, switchGateLimit, switchOperators, switchValueLimit,
  workflowDescriptionLimit, workflowInterface } from "./workflow-utilities.ts";
import { validateWorkflowFileData, type WorkflowFileData } from "./workflow-file.ts";
import { normalizeManualRoute } from "./flow-routing/manual.js";
import { validateCredentialBinding } from "./secrets/bindings.ts";
import type { CredentialBinding } from "./secrets/types.ts";
import { processingDefinition, validateProcessingData, type ProcessingData } from "./workflow-processing.ts";
import { isWorkflowLineStyle, type WorkflowLineStyle } from "./workflow-line-style.ts";

export type OperationData = {
  operationId: string;
  name: string;
  description: string;
  method: string;
  path: string;
  /** Optional local references in supported versions; portable documents omit them. No authorization is stored here. */
  credentialBinding?: CredentialBinding;
};

export type ArrayBounds = { min: number; max?: number };
export type WorkflowField = {
  id: string;
  label: string;
  type: "Text" | "Integer" | "Number" | "Boolean" | "Object" | "Array" | "Null" | "Unknown" | "Binary";
  required: boolean;
  description: string;
  connectable: boolean;
  array?: ArrayBounds;
  itemType?: WorkflowField["type"];
  endpoint?: { nodeId: string; fieldId: string };
};
export type WorkflowData = {
  array?: ArrayBounds;
  ownerId: string;
  direction: "inputs" | "outputs";
  label: string;
  fields: WorkflowField[];
  notice?: string;
};
export type SwitchGate = { id: string; operator: "==" | "!=" | ">" | ">=" | "<" | "<=" | "is_set" | "is_not_set"; value: string };
export type SwitchData = { gates: SwitchGate[] };
export type CastData = { targetType: "Text" | "Number" | "Boolean" | "Binary" };
export type StopData = Record<string, never>;
export type VaultVariableData = { credentialId?: string };
export type CommentData = { text: string; width?: number; height?: number };
export type WorkflowReferenceData = { workflowId: string; name: string; description: string; snapshot: WorkflowDocument };
export type WorkflowNodeData = OperationData | WorkflowData | SwitchData | CastData | StopData | CommentData | VaultVariableData | WorkflowFileData | WorkflowReferenceData | ProcessingData;
type ProcessingNode = { type: "transform"; data: ProcessingData } | { type: "filter"; data: ProcessingData } | { type: "assert"; data: ProcessingData };
export type WorkflowDocumentNode = {
  id: string;
  position: { x: number; y: number };
  hidden?: boolean;
} & ({ type?: "operation"; data: OperationData } | { type: "data"; data: WorkflowData } |
  { type: "switch"; data: SwitchData } | { type: "cast"; data: CastData } | { type: "comment"; data: CommentData } |
  ProcessingNode | { type: "stop"; data: StopData } |
  { type: "workflow"; data: WorkflowReferenceData } | { type: "vault"; data: VaultVariableData } | { type: "file"; data: WorkflowFileData });
export type WorkflowDocumentEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  kind?: "schema" | "mapping";
  hidden?: boolean;
  detached?: boolean;
  manualRoute?: { x: number; y: number }[];
};
export type WorkflowDocument = {
  version: 1 | 2 | 3;
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowDocumentNode[];
  edges: WorkflowDocumentEdge[];
  viewport: { x: number; y: number; zoom: number };
  snap: boolean;
  curved: boolean;
  lineStyle?: WorkflowLineStyle;
  dashed: boolean;
};

export const maxWorkflowFileSize = 2_000_000;

function record(value: unknown): Record<string, unknown>
{
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a workflow document object.");
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, limit: number, empty = false): string
{
  if (typeof value !== "string" || (!empty && !value.trim()) || value.length > limit)
    throw new Error(`${field} must be ${empty ? "a" : "a nonempty"} text value of at most ${limit} characters.`);
  return value;
}

function coordinate(value: unknown): number
{
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1_000_000)
    throw new Error("Workflow coordinates must be finite numbers between -1000000 and 1000000.");
  return value;
}

function flag(value: unknown): boolean
{
  if (typeof value !== "boolean") throw new Error("Workflow view options must be booleans.");
  return value;
}

function uniqueIds(items: Array<{ id: string }>): void
{
  if (new Set(items.map(item => item.id)).size !== items.length)
    throw new Error("Workflow node and edge IDs must be unique within each collection.");
}

function operationData(value: Record<string, unknown>): OperationData
{
  const method = text(value.method, "Operation method", 7);
  if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"].includes(method))
    throw new Error(`Unsupported operation method: ${method}.`);
  return {
    operationId: text(value.operationId, "Operation ID", 512),
    name: text(value.name, "Operation name", 200),
    description: text(value.description, "Operation description", 4000, true),
    method,
    path: text(value.path, "Operation path", 2048),
    ...(value.credentialBinding === undefined ? {} : { credentialBinding: validateCredentialBinding(value.credentialBinding) })
  };
}

function arrayBounds(value: unknown): ArrayBounds {
  const bounds = record(value);
  if (typeof bounds.min !== "number" || !Number.isSafeInteger(bounds.min) || bounds.min < 0 ||
    bounds.max !== undefined && (typeof bounds.max !== "number" || !Number.isSafeInteger(bounds.max) || bounds.max < bounds.min))
    throw new Error("Array bounds must be nonnegative integers with maximum at least minimum.");
  return { min: bounds.min, ...(bounds.max === undefined ? {} : { max: bounds.max as number }) };
}

function workflowData(value: Record<string, unknown>, extended: boolean): WorkflowData
{
  if (value.direction !== "inputs" && value.direction !== "outputs") throw new Error("Data direction must be inputs or outputs.");
  if (!Array.isArray(value.fields) || value.fields.length > 200)
    throw new Error("A data panel supports at most 200 fields.");
  const fields = value.fields.map(value => {
    const field = record(value);
    if (!["Text", "Integer", "Number", "Boolean", "Object", "Array", "Null", "Unknown", "Binary"].includes(String(field.type)))
      throw new Error("Unsupported workflow field type.");
    const result: WorkflowField = {
      id: text(field.id, "Field ID", 2048), label: text(field.label, "Field label", 200),
      type: field.type as WorkflowField["type"], required: flag(field.required),
      description: text(field.description, "Field description", 4000, true), connectable: flag(field.connectable)
    };
    if (field.itemType !== undefined) {
      if (result.type !== "Array" || !["Text", "Integer", "Number", "Boolean", "Object", "Array", "Null", "Unknown"].includes(String(field.itemType)))
        throw new Error("Array item types must name a supported workflow type.");
      result.itemType = field.itemType as WorkflowField["type"];
    }
    if (field.array !== undefined) result.array = arrayBounds(field.array);
    if (result.id === "value" || result.type === "Unknown" && result.connectable)
      throw new Error("Unknown fields and structural value ports cannot be mapping handles.");
    if (extended && field.endpoint !== undefined)
    {
      const endpoint = record(field.endpoint);
      result.endpoint = { nodeId: text(endpoint.nodeId, "Interface node ID", 2048), fieldId: text(endpoint.fieldId, "Interface field ID", 2048) };
    }
    return result;
  });
  uniqueIds(fields);
  return {
    ownerId: text(value.ownerId, "Data owner ID", 2048), direction: value.direction,
    label: text(value.label, "Data label", 200), fields,
    ...(value.array === undefined ? {} : { array: arrayBounds(value.array) }),
    ...(value.notice === undefined ? {} : { notice: text(value.notice, "Data notice", 4000) })
  };
}

function validateGraph(nodes: WorkflowDocumentNode[], edges: WorkflowDocumentEdge[]): void
{
  const byId = new Map(nodes.map(node => [node.id, node]));
  const parents = new Map<string, string>();
  const ports = new Set<string>();
  const mappings = new Set<string>();
  const richOwners = new Set<string>();
  const interfaces = new Map(nodes.filter(node => node.type === "workflow").map(node =>
    [node.id, new Map(workflowInterface(node.data.snapshot).flatMap(group => group.fields.map(field =>
      [JSON.stringify([group.node.id, field.id]), { field, direction: group.node.data.direction }] as const)))]));
  const interfacePorts = new Set<string>();
  let fieldCount = 0;
  for (const node of nodes)
  {
    if (node.type !== "data") continue;
    const owner = byId.get(node.data.ownerId);
    if (!owner || owner.type !== "file" && owner.type !== "workflow" && owner.type !== "operation" && owner.type !== undefined)
      throw new Error("Every data owner must refer to an operation, workflow or file in this document.");
    if (owner.type === "file" && node.data.direction !== "outputs") throw new Error("File panels must be outputs.");
    richOwners.add(owner.id);
    fieldCount += node.data.fields.length;
    for (const field of node.data.fields)
    {
      if (owner.type !== "workflow")
      {
        if (field.endpoint) throw new Error("Only nested workflow fields may declare interface endpoints.");
        continue;
      }
      const identity = field.endpoint && JSON.stringify([field.endpoint.nodeId, field.endpoint.fieldId]);
      const original = identity && interfaces.get(owner.id)!.get(identity);
      const port = JSON.stringify([owner.id, identity]);
      if (!original || original.direction !== node.data.direction || original.field.type !== field.type ||
          original.field.connectable !== field.connectable || interfacePorts.has(port))
        throw new Error("Nested interface endpoints must uniquely match available snapshot fields, types and directions.");
      interfacePorts.add(port);
    }
  }
  if (fieldCount > 5000) throw new Error("A workflow supports at most 5000 fields.");
  for (const edge of edges)
  {
    const source = byId.get(edge.source)!;
    const target = byId.get(edge.target)!;
    if (edge.kind === "schema")
    {
      const input = source.type === "data" && source.data.direction === "inputs";
      const child = input ? source : target;
      const parent = input ? target : source;
      const parentHandle = input ? edge.targetHandle : edge.sourceHandle;
      if (child.type !== "data" || child.data.direction !== (input ? "inputs" : "outputs") ||
          edge.id !== `schema:${child.id}` || (input ? edge.sourceHandle : edge.targetHandle) !== "value")
        throw new Error("Schema connections must attach a data panel through its structural value port.");
      if (parent.type === "data")
      {
        const field = parent.data.fields.find(field => field.id === parentHandle);
        if (parent.data.ownerId !== child.data.ownerId || parent.data.direction !== child.data.direction ||
            !field?.connectable || !["Object", "Array"].includes(field.type))
          throw new Error("Schema connections must use a declared object or array field of the same owner and direction.");
      }
      else if (parent.type === "file") {
        if (parent.id !== child.data.ownerId || parentHandle !== "value" && parentHandle !== edge.id)
          throw new Error("File structures must attach to their owner's output.");
        // Older file nodes used a separate structure handle. Share the value output now.
        edge.sourceHandle = "value";
      }
      else if (parent.id !== child.data.ownerId || parentHandle !== edge.id)
        throw new Error("Root schema connections must use their owner's named schema handle.");
      const port = JSON.stringify([parent.id, parent.type === "file" ? "value" : parentHandle]);
      if (parents.has(child.id) || ports.has(port)) throw new Error("Each schema branch must have one parent and a unique field handle.");
      parents.set(child.id, parent.id);
      ports.add(port);
      if ((parent.hidden || edge.detached) && !child.hidden ||
          Boolean(edge.hidden) !== Boolean(source.hidden || target.hidden || edge.detached))
        throw new Error("Schema branch visibility must agree with its nodes and attachment.");
    }
    else if (edge.kind === "mapping")
    {
      if (!isValueConnection(edge, source, target, edges.filter(other => other.id !== edge.id)) || edge.hidden || edge.detached)
        throw new Error("Mappings must connect visible, named output fields to input fields.");
      const identity = JSON.stringify([edge.source, edge.sourceHandle, edge.target, edge.targetHandle]);
      if (mappings.has(identity)) throw new Error("Duplicate field mappings are not allowed.");
      mappings.add(identity);
    }
    else if (source.type !== undefined && source.type !== "operation" || target.type !== undefined && target.type !== "operation" ||
      richOwners.has(source.id) || richOwners.has(target.id) ||
      edge.sourceHandle !== undefined || edge.targetHandle !== undefined || edge.detached)
      throw new Error("Legacy connections must join operations without field handles or schema panels.");
  }
  for (const node of nodes)
  {
    if (node.type !== "data") continue;
    const ancestors = new Set<string>([node.id]);
    let ancestor = node.id;
    while (parents.has(ancestor))
    {
      ancestor = parents.get(ancestor)!;
      if (ancestors.has(ancestor)) throw new Error("Schema branch ancestry must not contain cycles.");
      ancestors.add(ancestor);
    }
    if (ancestor !== node.data.ownerId) throw new Error("Every data panel must have a schema branch leading to its owner.");
  }
}

type ValidationContext = { ancestors: Set<object>; nodes: number; edges: number; fields: number };

function validateDocument(value: unknown, context: ValidationContext, depth: number): WorkflowDocument
{
  const document = record(value);
  if (depth > 4 || context.ancestors.has(document)) throw new Error("Nested workflows must be acyclic snapshots no more than four levels deep.");
  context.ancestors.add(document);
  if (document.version !== 1 && document.version !== 2 && document.version !== 3)
    throw new Error("Unsupported workflow document version; expected version 1, 2 or 3.");
  const rich = document.version !== 1;
  const extended = document.version === 3;
  if (!Array.isArray(document.nodes) || document.nodes.length > 500 ||
      !Array.isArray(document.edges) || document.edges.length > 1000)
    throw new Error("A workflow document supports at most 500 nodes and 1000 connections.");
  context.nodes += document.nodes.length;
  context.edges += document.edges.length;
  if (context.nodes > 2000 || context.edges > 4000) throw new Error("Embedded workflows support at most 2000 total nodes and 4000 total connections.");
  const nodes: WorkflowDocumentNode[] = document.nodes.map(value => {
    const node = record(value);
    const position = record(node.position);
    const data = record(node.data);
    const common = {
      id: text(node.id, "Node ID", rich ? 2048 : 128),
      position: { x: coordinate(position.x), y: coordinate(position.y) },
      ...(rich && node.hidden !== undefined ? { hidden: flag(node.hidden) } : {})
    };
    if (rich && node.type === "data")
    {
      const result = workflowData(data, extended);
      context.fields += result.fields.length;
      if (context.fields > 20000) throw new Error("Embedded workflows support at most 20000 total fields.");
      return { ...common, type: "data", data: result };
    }
    if (extended && node.type === "switch")
    {
      if (!Array.isArray(data.gates) || !data.gates.length || data.gates.length > switchGateLimit)
        throw new Error("A switch must have between 1 and 32 gates.");
      const gates = data.gates.map(value => {
        const gate = record(value);
        const id = text(gate.id, "Gate ID", 128);
        if (id === "value" || id.startsWith("gate-value:") || !switchOperators.some(operator => operator.value === gate.operator))
          throw new Error("Switch gates require a supported operator and distinct output handle.");
        return { id, operator: gate.operator as SwitchGate["operator"], value: text(gate.value, "Gate value", switchValueLimit, true) };
      });
      uniqueIds(gates);
      return { ...common, type: "switch", data: { gates } };
    }
    if (extended && node.type === "cast")
    {
      if (data.targetType !== "Text" && data.targetType !== "Number" && data.targetType !== "Boolean" && data.targetType !== "Binary")
        throw new Error("A cast target must be Text, Number or Boolean.");
      return { ...common, type: "cast", data: { targetType: data.targetType } };
    }
    if (extended && (node.type === "transform" || node.type === "filter" || node.type === "assert")) {
      const configuration = validateProcessingData(node.type, data);
      return { ...common, type: processingDefinition(node.type, configuration).kind, data: configuration };
    }
    if (extended && node.type === "stop") {
      if (Object.keys(data).length) throw new Error("Stop nodes do not have configuration fields.");
      return { ...common, type: "stop", data: {} };
    }
    if (extended && node.type === "file") return { ...common, type: "file", data: validateWorkflowFileData(data) };
    if (extended && node.type === "vault") {
      if (data.credentialId !== undefined && (typeof data.credentialId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(data.credentialId)))
        throw new Error("Vault variables require a valid local entry reference.");
      return { ...common, type: "vault", data: data.credentialId === undefined ? {} : { credentialId: data.credentialId } };
    }
    if (extended && node.type === "comment") {
      const size: { width?: number; height?: number } = {};
      for (const key of ["width", "height"] as const) {
        if (data[key] === undefined) continue;
        const minimum = key === "width" ? 200 : 140;
        if (typeof data[key] !== "number" || !Number.isFinite(data[key]) || data[key] < minimum || data[key] > 2000)
          throw new Error("Comment dimensions are outside the supported range.");
        size[key] = data[key];
      }
      return { ...common, type: "comment", data: { text: text(data.text, "Comment", commentTextLimit, true), ...size } };
    }
    if (extended && node.type === "workflow")
    {
      const snapshot = validateDocument(data.snapshot, context, depth + 1);
      const workflowId = text(data.workflowId, "Referenced workflow ID", 128);
      if (snapshot.id !== workflowId) throw new Error("A nested workflow ID must match its embedded snapshot.");
      return { ...common, type: "workflow", data: { workflowId, name: text(data.name, "Workflow name", 100),
        description: text(data.description, "Workflow description", workflowDescriptionLimit, true), snapshot } };
    }
    if (rich && node.type !== undefined && node.type !== "operation") throw new Error("Unsupported workflow node type.");
    return { ...common, ...(rich && node.type === "operation" ? { type: "operation" as const } : {}), data: operationData(data) };
  });
  const nodeIds = new Set(nodes.map(node => node.id));
  const edges: WorkflowDocumentEdge[] = document.edges.map(value => {
    const edge = record(value);
    const source = text(edge.source, "Connection source", rich ? 2048 : 128);
    const target = text(edge.target, "Connection target", rich ? 2048 : 128);
    if (!nodeIds.has(source) || !nodeIds.has(target))
      throw new Error("Every workflow connection must refer to nodes in this document.");
    if (rich && edge.kind !== undefined && edge.kind !== "schema" && edge.kind !== "mapping")
      throw new Error("Unsupported workflow connection kind.");
    const manualRoute = edge.manualRoute === undefined ? undefined : normalizeManualRoute(edge.manualRoute);
    if (manualRoute === null)
      throw new Error("Manual connection routes must contain 2 to 128 points with finite coordinates between -1000000 and 1000000, orthogonal segments and no immediate reversals.");
    return {
      id: text(edge.id, "Connection ID", rich ? 4096 : 256), source, target,
      ...(manualRoute ? { manualRoute } : {}),
      ...(rich && edge.kind !== undefined ? { kind: edge.kind as "schema" | "mapping" } : {}),
      ...(rich && edge.sourceHandle !== undefined ? { sourceHandle: text(edge.sourceHandle, "Source handle", 4096) } : {}),
      ...(rich && edge.targetHandle !== undefined ? { targetHandle: text(edge.targetHandle, "Target handle", 4096) } : {}),
      ...(rich && edge.hidden !== undefined ? { hidden: flag(edge.hidden) } : {}),
      ...(rich && edge.detached !== undefined ? { detached: flag(edge.detached) } : {})
    };
  });
  uniqueIds(nodes);
  uniqueIds(edges);
  if (rich) validateGraph(nodes, edges);
  const viewport = record(document.viewport);
  const zoom = coordinate(viewport.zoom);
  if (zoom < 0.25 || zoom > 2) throw new Error("Workflow zoom must be between 0.25 and 2.");
  context.ancestors.delete(document);
  if (document.lineStyle !== undefined && !isWorkflowLineStyle(document.lineStyle)) throw new Error("Unsupported connection line style.");
  return {
    version: document.version,
    id: text(document.id, "Document ID", 128), name: text(document.name, "Document name", 100), nodes, edges,
    ...(extended && document.description !== undefined ? { description: text(document.description, "Workflow description", workflowDescriptionLimit, true) } : {}),
    viewport: { x: coordinate(viewport.x), y: coordinate(viewport.y), zoom },
    snap: flag(document.snap), curved: flag(document.curved), dashed: flag(document.dashed),
    ...(isWorkflowLineStyle(document.lineStyle) ? { lineStyle: document.lineStyle, curved: document.lineStyle !== "orthogonal" } : {})
  };
}

export function validateWorkflowDocument(value: unknown): WorkflowDocument
{
  const document = validateDocument(value, { ancestors: new Set(), nodes: 0, edges: 0, fields: 0 }, 0);
  if (document.version === 3 && new TextEncoder().encode(JSON.stringify(document)).byteLength > maxWorkflowFileSize)
    throw new Error("Workflow documents must be smaller than 2 MB, including embedded snapshots.");
  return document;
}

/**
 * Entry point for future migrations keyed by workflow document version.
 * Supported formats currently need no conversion. Reading a document never
 * rewrites its working file or historical Git commits.
 */
export function migrateWorkflowDocument(value: unknown): WorkflowDocument
{
  return validateWorkflowDocument(value);
}

export function parseWorkflowDocument(json: string): WorkflowDocument
{
  if (json.length > maxWorkflowFileSize) throw new Error("Workflow documents must be smaller than 2 MB.");
  return portableWorkflowDocument(migrateWorkflowDocument(JSON.parse(json)));
}

/** Imports/exports cannot transfer locally approved credential selections, including nested snapshots. */
export function portableWorkflowDocument(value: WorkflowDocument): WorkflowDocument {
  const document = validateWorkflowDocument(value);
  for (const node of document.nodes) {
    if (node.type === "workflow") node.data.snapshot = portableWorkflowDocument(node.data.snapshot);
    else if (node.type === "vault") delete node.data.credentialId;
    else if (node.type === "operation" || node.type === undefined) delete node.data.credentialBinding;
  }
  return document;
}
