// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import type { CastData, SwitchGate, WorkflowDocument, WorkflowDocumentEdge, WorkflowDocumentNode, WorkflowField } from "./workflow-document.ts";

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
  { value: "Text", label: "Text" }, { value: "Number", label: "Number" }, { value: "Boolean", label: "Boolean" }
] satisfies { value: CastData["targetType"]; label: string }[];
export type RoutingType = "Text" | "Number" | "Boolean" | "Object" | "Array" | "Null" | "Unknown" | "Mixed";

export function numericValue(value: unknown): value is string
{
  return typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) && Number.isFinite(Number(value));
}

export function castValue(value: unknown, type: CastData["targetType"]): string | number | boolean
{
  if (!["string", "number", "boolean"].includes(typeof value) || typeof value === "number" && !Number.isFinite(value))
    throw new Error("Only text, finite numbers and booleans can be cast.");
  if (type === "Text") return String(value);
  if (type === "Number")
  {
    if (typeof value !== "string" || numericValue(value)) return Number(value);
    throw new Error("Enter a valid number to cast text to Number.");
  }
  if (type === "Boolean")
  {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : value;
    if (normalized === true || normalized === 1 || normalized === "true" || normalized === "1") return true;
    if (normalized === false || normalized === 0 || normalized === "false" || normalized === "0") return false;
    throw new Error("Boolean casts accept only true, false, 1 or 0.");
  }
  throw new Error("Unsupported cast type.");
}

export function operatorsForType(type: RoutingType)
{
  if (type === "Unknown" || type === "Number") return switchOperators;
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
  const types = new Map(nodes.filter(node => node.type === "switch" || node.type === "cast").map(node => [node.id, new Set<RoutingType>()]));
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
        if (source?.type === "cast") outputs = [source.data.targetType];
        else if (source?.type === "switch") outputs = types.get(source.id)!;
        else if (source?.type === "data" && source.data.direction === "outputs")
        {
          const type = source.data.fields.find(field => field.id === edge.sourceHandle)?.type ?? "Unknown";
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

export function isValueConnection(connection: { sourceHandle?: string | null; targetHandle?: string | null },
  source: WorkflowDocumentNode, target: WorkflowDocumentNode, edges: WorkflowDocumentEdge[] = []): boolean
{
  if (source.id === target.id || source.hidden || target.hidden) return false;
  const sourceField = source.type === "data" && source.data.direction === "outputs"
    ? source.data.fields.find(field => field.id === connection.sourceHandle && field.connectable) : undefined;
  const sourceUtility = source.type === "cast" ? connection.sourceHandle === "result" : source.type === "switch" &&
    source.data.gates.some(gate => gate.id === connection.sourceHandle);
  if (!sourceField && !sourceUtility) return false;
  if (target.type === "data") return target.data.direction === "inputs" &&
    target.data.fields.some(field => field.id === connection.targetHandle && field.connectable);
  if (target.type === "cast") return connection.targetHandle === "value" &&
    (sourceUtility || !!sourceField && ["Text", "Integer", "Number", "Boolean"].includes(sourceField.type));
  if (target.type !== "switch") return false;
  const gate = target.data.gates.find(gate => switchGateInput(gate.id) === connection.targetHandle);
  if (connection.targetHandle !== "value" && !gate) return false;
  if (gate && (gate.operator === "is_set" || gate.operator === "is_not_set" || edges.some(edge => !edge.hidden && !edge.detached &&
    edge.target === target.id && edge.targetHandle === connection.targetHandle))) return false;
  return sourceUtility || !!sourceField && ["Text", "Integer", "Number", "Boolean"].includes(sourceField.type);
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
