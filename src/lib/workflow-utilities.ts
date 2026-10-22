// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import type { CastData, SwitchGate, WorkflowDocument, WorkflowDocumentEdge, WorkflowDocumentNode, WorkflowField } from "./workflow-document.ts";

import { fileValueType } from "./workflow-file.ts";
import { numericValue } from "./workflow-cast.ts";
export { numericValue, castValue } from "./workflow-cast.ts";
import { processingDefinition, processingInputTypes, processingOutputType, processingTypeAlternatives } from "./workflow-processing.ts";
import { isArrayFilter, isArrayFilterReturn } from "./workflow-array-filter.ts";

export const switchGateLimit = 32;
export const switchValueLimit = 4096;
export const commentTextLimit = 16000;
export const workflowDescriptionLimit = 4000;
export const switchGateInput = (id: string) => `gate-value:${id}`;
export const switchOperators = [
  { value: "==", symbol: "=", label: "Equals" },
  { value: "!=", symbol: "≠", label: "Does not equal" },
  { value: ">", symbol: ">", label: "Greater than" },
  { value: ">=", symbol: "≥", label: "Greater than or equal to" },
  { value: "<", symbol: "<", label: "Less than" },
  { value: "<=", symbol: "≤", label: "Less than or equal to" },
  { value: "is_set", symbol: "∃", label: "Is set", unary: true },
  { value: "is_not_set", symbol: "∄", label: "Is not set", unary: true }
] satisfies { value: SwitchGate["operator"]; symbol: string; label: string; unary?: boolean }[];
export const castTypes = [
  { value: "Text", label: "Text" }, { value: "Number", label: "Number" }, { value: "Boolean", label: "Boolean" }, { value: "Binary", label: "Binary" }
] satisfies { value: CastData["targetType"]; label: string }[];
export type RoutingType = "Text" | "Number" | "Boolean" | "Object" | "Array" | "Null" | "Unknown" | "Mixed" | "Binary" | "JSON";

export function operatorsForType(type: RoutingType)
{
  if (type === "Unknown" || type === "Number" || type === "JSON") return switchOperators;
  return switchOperators.filter(operator => "unary" in operator ||
    ["Text", "Boolean", "Mixed"].includes(type) && ["==", "!="].includes(operator.value));
}

export function gateForType(gate: SwitchGate, type: RoutingType, preserveValue = false): SwitchGate
{
  const operators = operatorsForType(type);
  const operator = operators.some(option => option.value === gate.operator) ? gate.operator : operators[0]!.value;
  let value = gate.value;
  if (!preserveValue && type === "Boolean" && !["true", "false"].includes(value)) value = "true";
  if (!preserveValue && type === "Number" && value !== "" && !numericValue(value)) value = "";
  return operator === gate.operator && value === gate.value ? gate : { ...gate, operator, value };
}

function valueType(input: unknown): RoutingType
{
  if (input === null) return "Null";
  if (Array.isArray(input)) return "Array";
  if (typeof input === "string") return "Text";
  if (typeof input === "number") return "Number";
  if (typeof input === "boolean") return "Boolean";
  if (typeof input === "object") return "Object";
  return "Unknown";
}

export function matchesSwitchGate(input: unknown, gate: SwitchGate, type: RoutingType = valueType(input),
  gateValues: Map<string, unknown> = new Map()): boolean
{
  if (type === "JSON") type = valueType(input);
  if (!operatorsForType(type).some(option => option.value === gate.operator)) return false;
  if (gate.operator === "is_set") return input !== undefined && input !== null;
  if (gate.operator === "is_not_set") return input === undefined || input === null;
  const connected = gateValues.has(gate.id);
  let value: unknown = connected ? gateValues.get(gate.id) : gate.value;
  if (connected && value !== null && value !== undefined &&
    (!["string", "number", "boolean"].includes(typeof value) || typeof value === "number" && !Number.isFinite(value))) return false;
  if (!connected && type === "Boolean")
  {
    if (value !== "true" && value !== "false") return false;
    value = value === "true";
  }
  else if (!connected && type === "Number")
  {
    if (!numericValue(value)) return false;
    value = Number(value);
  }
  if (input === undefined || input === null) return false;
  if (gate.operator === "==") return input == value;
  if (gate.operator === "!=") return input != value;
  const left = typeof input === "string" && typeof value === "string" ? input : Number(input);
  const right = typeof input === "string" && typeof value === "string" ? value : Number(value);
  if (gate.operator === ">") return left > right;
  if (gate.operator === ">=") return left >= right;
  if (gate.operator === "<") return left < right;
  return left <= right;
}

export function matchingSwitchGates(input: unknown, gates: SwitchGate[], type: RoutingType = valueType(input),
  gateValues: Map<string, unknown> = new Map()): string[]
{
  const gate = gates.find(gate => matchesSwitchGate(input, gate, type, gateValues));
  return gate ? [gate.id] : [];
}

export function routingInputTypes(nodes: WorkflowDocumentNode[], edges: WorkflowDocumentEdge[]): Map<string, RoutingType>
{
  const byId = new Map(nodes.map(node => [node.id, node]));
  const types = new Map(nodes.filter(node => ["switch", "cast", "transform", "filter", "assert", "stop"].includes(node.type!)).map(node => [node.id, new Set<RoutingType>()]));
  const incoming = edges.filter(edge => edge.kind === "mapping" && types.has(edge.target) && edge.targetHandle === "value" &&
    !edge.hidden && !edge.detached && !byId.get(edge.source)?.hidden && !byId.get(edge.target)?.hidden);
  for (const fallback of [false, true])
  {
    if (fallback) for (const values of types.values()) if (!values.size) values.add("Unknown");
    let changed: boolean;
    do {
      changed = false;
      for (const edge of incoming)
      {
        const source = byId.get(edge.source);
        let outputs: Iterable<RoutingType> = [];
        if (source?.type === "file") { const type = fileValueType(source.data.file); outputs = [type === "Integer" ? "Number" : type]; }
        else if (source?.type === "vault") outputs = ["Text"];
        else if (source?.type === "cast") outputs = [source.data.targetType];
        else if (source?.type === "transform" || source?.type === "filter" || source?.type === "assert") {
          const inputs = processingDefinition(source.type, source.data).output === "input" ? types.get(source.id)! : ["Unknown" as const];
          outputs = [...inputs].map(type => {
            if (isArrayFilter(source) && edge.sourceHandle === "item") return "Unknown";
            const output = processingOutputType(source.type, source.data, type);
            return output === "Integer" ? "Number" : output;
          });
        }
        else if (source?.type === "switch") outputs = types.get(source.id)!;
        else if (source?.type === "data" && source.data.direction === "outputs")
        {
          const field = source.data.fields.find(field => field.id === edge.sourceHandle);
          const type = isFileRowConnection(edge, nodes, edges) ? field!.itemType! : field?.type ?? "Unknown";
          outputs = [type === "Integer" ? "Number" : type];
        }
        for (const type of outputs) if (!types.get(edge.target)!.has(type))
        {
          types.get(edge.target)!.add(type);
          changed = true;
        }
      }
    } while (changed);
  }
  return new Map([...types].map(([id, values]) => [id, values.size > 1 ? "Mixed" : [...values][0]! ]));
}

export function adaptRoutingGates(nodes: WorkflowDocumentNode[], edges: WorkflowDocumentEdge[]): WorkflowDocumentNode[]
{
  const types = routingInputTypes(nodes, edges);
  const wired = new Set(edges.filter(edge => !edge.hidden && !edge.detached).map(edge => JSON.stringify([edge.target, edge.targetHandle])));
  return nodes.map(node => node.type !== "switch" ? node : { ...node, data: { gates: node.data.gates.map(gate =>
    gateForType(gate, types.get(node.id)!, wired.has(JSON.stringify([node.id, switchGateInput(gate.id)])))) } });
}

export function workflowInputConnected(targetId: string, targetHandle: string | null | undefined,
  edges: WorkflowDocumentEdge[]): boolean
{
  return edges.some(edge => edge.kind !== "schema" && edge.kind !== "response" && !edge.hidden && !edge.detached &&
    edge.target === targetId && (edge.targetHandle ?? null) === (targetHandle ?? null));
}

type ValueConnection = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null };
/** The original node sends bytes to a binary port while its panels keep parsed data. */
export function isFileBinaryConnection(connection: ValueConnection, nodes: WorkflowDocumentNode[]): boolean {
  const source = nodes.find(node => node.id === connection.source);
  const target = nodes.find(node => node.id === connection.target);
  return source?.type === "file" && connection.sourceHandle === "value" && !!source.data.file
    && (source.data.file.format === "binary" || !!source.data.file.original)
    && (target?.type === "cast" && target.data.targetType === "Binary" && connection.targetHandle === "value"
      || target?.type === "transform" && connection.targetHandle === "value" && processingDefinition(target.type, target.data).inputs.every(type => type === "Binary")
      || target?.type === "data" && target.data.direction === "inputs" && target.data.fields.some(field => field.id === connection.targetHandle && field.type === "Binary"));
}
type ConnectionValueType = WorkflowField["type"] | "Mixed" | "JSON";
const scalarConnectionType = (type: ConnectionValueType) => ["Text", "Integer", "Number", "Boolean"].includes(type);
const numericConnectionType = (type: ConnectionValueType) => type === "Integer" || type === "Number";

/** Item outputs feed scalar ports row-by-row; explicit array inputs keep whole-column mappings. */
export function isFileRowConnection(connection: ValueConnection, nodes: WorkflowDocumentNode[], edges: WorkflowDocumentEdge[] = []): boolean {
  const source = nodes.find(node => node.id === connection.source);
  if (source?.type !== "data" || !nodes.some(node => node.id === source.data.ownerId && node.type === "file")) return false;
  const field = source.data.fields.find(field => field.id === connection.sourceHandle);
  if (!field?.itemType) return false;
  const target = nodes.find(node => node.id === connection.target);
  if ((target?.type === "transform" || target?.type === "filter" || target?.type === "assert") && connection.targetHandle === "value") {
    const accepted = processingDefinition(target.type, target.data).inputs;
    if (accepted.includes("Array") && !accepted.includes(field.itemType) && !(field.itemType === "Integer" && accepted.includes("Number"))) return false;
  }
  let ancestor = target;
  const seen = new Set<string>();
  while (ancestor?.type === "data" && !seen.has(ancestor.id)) {
    if (ancestor.data.array) return false;
    seen.add(ancestor.id);
    const id = ancestor.id;
    const parent = edges.find(edge => edge.kind === "schema" && edge.source === id);
    ancestor = nodes.find(node => node.id === parent?.target);
  }
  return target?.type !== "data" || target.data.fields.find(field => field.id === connection.targetHandle)?.type !== "Array" || field.itemType === "Array";
}

// Interactive checks stay separate from document validation so old saved graphs
// remain readable. Switch outputs retain the precise input type, including Integer.
export function isWorkflowConnectionTypeCompatible(connection: ValueConnection,
  nodes: WorkflowDocumentNode[], edges: WorkflowDocumentEdge[]): boolean
{
  const byId = new Map(nodes.map(node => [node.id, node]));
  const active = edges.filter(edge => edge.kind === "mapping" && !edge.hidden && !edge.detached &&
    !byId.get(edge.source)!.hidden && !byId.get(edge.target)!.hidden);
  const mainInputs = (nodeId: string) => active.filter(edge => edge.target === nodeId && edge.targetHandle === "value");
  const outputType = (nodeId: string, handle: string | null | undefined, seen = new Set<string>()): ConnectionValueType => {
    const node = byId.get(nodeId)!;
    if (node.type === "data") { const field = node.data.fields.find(field => field.id === handle)!; return byId.get(node.data.ownerId)?.type === "file" ? field.itemType ?? field.type : field.type; }
    if (node.type === "cast") return node.data.targetType;
    if (node.type === "transform" || node.type === "filter" || node.type === "assert") {
      if (isArrayFilter(node) && handle === "item") return "Unknown";
      if (seen.has(nodeId)) return "Unknown";
      const ancestors = new Set([...seen, nodeId]);
      const input = mainInputs(nodeId).map(edge => outputType(edge.source, edge.sourceHandle, ancestors));
      return processingOutputType(node.type, node.data, input.length === 1 ? input[0]! : "Unknown");
    }
    if (node.type === "vault") return "Text";
    if (node.type === "file") return fileValueType(node.data.file);
    if (seen.has(nodeId)) return "Unknown";
    const ancestors = new Set([...seen, nodeId]);
    const types = new Set(mainInputs(nodeId).map(edge => outputType(edge.source, edge.sourceHandle, ancestors)));
    return types.size === 1 ? [...types][0]! : types.size ? "Mixed" : "Unknown";
  };
  const compatible = (candidate: ValueConnection): boolean => {
    const source = byId.get(candidate.source)!, target = byId.get(candidate.target)!;
    if (isArrayFilterReturn(target, candidate.targetHandle))
      return source.type === "assert" && (candidate.sourceHandle === "success" || candidate.sourceHandle === "failure");
    if (isArrayFilter(source) && candidate.sourceHandle === "item")
      return candidate.targetHandle === "value" && !isArrayFilter(target) && ["cast", "transform", "filter", "assert"].includes(target.type!);
    if (byId.get(candidate.target)?.type === "stop") return true;
    if (isFileBinaryConnection(candidate, nodes)) return true;
    const output = outputType(candidate.source, candidate.sourceHandle);
    if (output === "Unknown" || output === "Mixed") return false;
    // A known union can connect under the receiving port's type assumption.
    // The executor checks the actual value; connecting never casts it.
    return processingTypeAlternatives(output).some(type => compatibleType(candidate, type));
  };
  const compatibleType = (candidate: ValueConnection, type: ConnectionValueType): boolean => {
    const target = byId.get(candidate.target)!;
    if (target.type === "transform" || target.type === "filter" || target.type === "assert") {
      const main = mainInputs(target.id);
      const accepted = processingInputTypes(target.type, target.data, candidate.targetHandle, main.length === 1 ? outputType(main[0]!.source, main[0]!.sourceHandle) : "Unknown");
      if (!accepted) return false;
      const source = byId.get(candidate.source)!;
      if (accepted.includes("Array") && source.type === "data" && source.data.fields.find(field => field.id === candidate.sourceHandle)?.itemType
        && !isFileRowConnection(candidate, nodes, edges)) return true;
      return accepted.includes(type) || type === "Integer" && accepted.includes("Number");
    }
    if (target.type === "cast" && target.data.targetType === "Binary") return true;
    if (target.type === "data")
    {
      const expected = target.data.fields.find(field => field.id === candidate.targetHandle)!.type;
      if (expected === "Array" && !isFileRowConnection(candidate, nodes, edges)) {
        const source = byId.get(candidate.source)!;
        if (source.type === "data" && source.data.fields.find(field => field.id === candidate.sourceHandle)?.itemType) return true;
      }
      return type === expected || type === "Integer" && expected === "Number";
    }
    if (!scalarConnectionType(type)) return false;
    if (target.type === "cast" || candidate.targetHandle === "value" || !mainInputs(target.id).length) return true;
    return processingTypeAlternatives(outputType(target.id, undefined)).some(expected =>
      type === expected || numericConnectionType(type) && numericConnectionType(expected));
  };
  if (!compatible(connection)) return false;
  if (!["switch", "transform", "filter", "assert"].includes(byId.get(connection.target)!.type!) || connection.targetHandle !== "value") return true;

  active.push({ ...connection, id: "pending-connection", kind: "mapping",
    sourceHandle: connection.sourceHandle!, targetHandle: connection.targetHandle });
  const pending = [connection.target];
  const visited = new Set<string>();
  for (const nodeId of pending)
  {
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    for (const edge of active)
    {
      if (edge.target === nodeId && edge.targetHandle !== "value" && !compatible(edge)) return false;
      if (edge.source !== nodeId) continue;
      if (!compatible(edge)) return false;
      if (["switch", "transform", "filter", "assert"].includes(byId.get(edge.target)!.type!) && edge.targetHandle === "value") pending.push(edge.target);
    }
  }
  return true;
}

export function isValueConnection(connection: { sourceHandle?: string | null; targetHandle?: string | null },
  source: WorkflowDocumentNode, target: WorkflowDocumentNode, edges: WorkflowDocumentEdge[] = []): boolean
{
  if (source.id === target.id || source.hidden || target.hidden) return false;
  if (isArrayFilterReturn(target, connection.targetHandle))
    return source.type === "assert" && (connection.sourceHandle === "success" || connection.sourceHandle === "failure");
  const sourceField = source.type === "data" && source.data.direction === "outputs"
    ? source.data.fields.find(field => field.id === connection.sourceHandle && field.connectable) : undefined;
  if (source.type === "vault") return connection.sourceHandle === "value" && (target.type === "data" &&
    target.data.direction === "inputs" && target.data.fields.some(field => field.id === connection.targetHandle && field.connectable && field.type === "Text")
    || target.type === "stop" && connection.targetHandle === "value"
    || (target.type === "transform" || target.type === "filter" || target.type === "assert")
      && !!processingInputTypes(target.type, target.data, connection.targetHandle));
  const processingSource = source.type === "transform" || source.type === "filter" ? connection.sourceHandle === "result" || isArrayFilter(source) && connection.sourceHandle === "item"
    : source.type === "assert" && (connection.sourceHandle === "success" || connection.sourceHandle === "failure");
  const sourceUtility = source.type === "file" ? !!source.data.file && connection.sourceHandle === "value" : source.type === "cast" ? connection.sourceHandle === "result" : source.type === "switch" &&
    source.data.gates.some(gate => gate.id === connection.sourceHandle);
  if (!sourceField && !sourceUtility && !processingSource) return false;
  if (target.type === "stop") return connection.targetHandle === "value";
  if (target.type === "transform" || target.type === "filter" || target.type === "assert")
    return !!processingInputTypes(target.type, target.data, connection.targetHandle);
  if (target.type === "data") return target.data.direction === "inputs" &&
    target.data.fields.some(field => field.id === connection.targetHandle && field.connectable);
  if (target.type === "cast") return connection.targetHandle === "value" &&
    (sourceUtility || processingSource || !!sourceField && (target.data.targetType === "Binary" || ["Text", "Integer", "Number", "Boolean"].includes(sourceField.itemType ?? sourceField.type)));
  if (target.type !== "switch") return false;
  const gate = target.data.gates.find(gate => switchGateInput(gate.id) === connection.targetHandle);
  if (connection.targetHandle !== "value" && !gate) return false;
  if (gate && (gate.operator === "is_set" || gate.operator === "is_not_set" || edges.some(edge => !edge.hidden && !edge.detached &&
    edge.target === target.id && edge.targetHandle === connection.targetHandle))) return false;
  return sourceUtility || processingSource || !!sourceField && ["Text", "Integer", "Number", "Boolean"].includes(sourceField.itemType ?? sourceField.type);
}

// Keep snapshot endpoint identities separate from the outer diagram's handles.
// A supplied object supplies its descendants; a partly supplied object cannot be
// exposed as an external whole-object input that would overwrite those values.
export function workflowInterface(document: WorkflowDocument): { node: Extract<WorkflowDocumentNode, { type: "data" }>; fields: WorkflowField[] }[]
{
  const byId = new Map(document.nodes.map(node => [node.id, node]));
  const parents = new Map<string, { nodeId: string; fieldId: string }>();
  const children = new Map<string, string>();
  const supplied = new Set<string>();
  const key = (nodeId: string, fieldId: string) => JSON.stringify([nodeId, fieldId]);
  for (const edge of document.edges)
  {
    if (edge.hidden || edge.detached) continue;
    if (edge.kind === "mapping") { supplied.add(key(edge.target, edge.targetHandle!)); continue; }
    if (edge.kind !== "schema") continue;
    const source = byId.get(edge.source);
    const input = source?.type === "data" && source.data.direction === "inputs";
    const childId = input ? edge.source : edge.target;
    const parentId = input ? edge.target : edge.source;
    const handle = input ? edge.targetHandle : edge.sourceHandle;
    if (byId.get(parentId)?.type === "data")
    {
      parents.set(childId, { nodeId: parentId, fieldId: handle! });
      children.set(key(parentId, handle!), childId);
    }
  }
  const hasSuppliedDescendant = (nodeId: string, seen = new Set<string>()): boolean => {
    if (seen.has(nodeId)) return false;
    seen.add(nodeId);
    const node = byId.get(nodeId);
    return node?.type === "data" && node.data.fields.some(field => {
      const endpoint = key(nodeId, field.id);
      return supplied.has(endpoint) || children.has(endpoint) && hasSuppliedDescendant(children.get(endpoint)!, seen);
    });
  };
  return document.nodes.flatMap(node => {
    if (node.type !== "data" || node.hidden) return [];
    const fields = node.data.fields.filter(field => {
      if (node.data.direction === "outputs") return true;
      const endpoint = key(node.id, field.id);
      if (supplied.has(endpoint)) return false;
      let current = node.id;
      const seen = new Set<string>();
      while (parents.has(current) && !seen.has(current))
      {
        seen.add(current);
        const parent = parents.get(current)!;
        if (supplied.has(key(parent.nodeId, parent.fieldId))) return false;
        current = parent.nodeId;
      }
      const child = children.get(endpoint);
      return !child || !hasSuppliedDescendant(child);
    });
    return fields.length || node.data.notice ? [{ node, fields }] : [];
  });
}
