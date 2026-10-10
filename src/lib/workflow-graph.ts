// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import type { Operation } from "./catalog.ts";
import { validateWorkflowDocument, type SwitchGate, type WorkflowData, type WorkflowDocument,
  type WorkflowDocumentEdge, type WorkflowDocumentNode, type WorkflowField } from "./workflow-document.ts";
import { gateForType, isValueConnection, routingInputTypes, switchGateInput, switchGateLimit,
  switchOperators, switchValueLimit, workflowInterface } from "./workflow-utilities.ts";

type Schema = Record<string, unknown>;
type Shape = { schema: Schema; seen: string[]; type: WorkflowField["type"]; notice?: string };
type Tree = { label: string; fields: WorkflowField[]; children: { fieldId: string; path: string; tree: Tree }[]; notice?: string; height: number; span: number };
type Graph = { nodes: WorkflowDocumentNode[]; edges: WorkflowDocumentEdge[] };
export type SchemaBranch = { id: string; childId: string; direction: "inputs" | "outputs"; label: string; hidden: boolean };
const labels: Record<string, WorkflowField["type"]> = { string: "Text", integer: "Integer", number: "Number", boolean: "Boolean", object: "Object", array: "Array", null: "Null" };
const panelWidth = 260;
const gap = 64;
const pointer = (value: string) => value.replace(/~/g, "~0").replace(/\//g, "~1");
const identity = (group: string, path: string) => encodeURIComponent(JSON.stringify([group, path]));
const object = (value: unknown): value is Schema => value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown, fallback = "") => typeof value === "string" && value.trim() ? value : fallback;

// Only documented schemas participate. Examples never provide field names or types.
function resolve(value: unknown, document: Schema, seen: string[] = []): { schema: Schema; seen: string[]; notice?: string }
{
  if (!object(value)) return { schema: {}, seen, notice: "Schema not documented" };
  if (value.$ref === undefined) return { schema: value, seen };
  const ref = value.$ref;
  if (typeof ref !== "string" || !ref.startsWith("#/") || /~(?:[^01]|$)/.test(ref))
    return { schema: {}, seen, notice: "Reference unavailable" };
  if (seen.includes(ref)) return { schema: {}, seen, notice: "Recursive schema not expanded" };
  let target: unknown = document;
  for (const part of ref.slice(2).split("/"))
  {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    target = object(target) && Object.hasOwn(target, key) ? target[key] : undefined;
  }
  if (Object.keys(value).some(key => !["$ref", "title", "description", "example", "examples"].includes(key)))
    return { schema: {}, seen, notice: "Combined reference constraints not expanded" };
  const result = resolve(target, document, [...seen, ref]);
  return { ...result, schema: { ...result.schema,
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.description === "string" ? { description: value.description } : {}) } };
}

function shape(value: unknown, document: Schema, seen: string[], depth: number): Shape
{
  const result = resolve(value, document, seen);
  const schema = result.schema;
  const types = Array.isArray(schema.type) ? schema.type.filter(type => type !== "null") : [schema.type];
  const type = types.length === 1 && typeof types[0] === "string" ? labels[types[0]]
    : schema.type === undefined && object(schema.properties) ? "Object" : undefined;
  const notice = depth > 12 ? "Deeper schema not expanded" : result.notice ||
    (schema.oneOf || schema.anyOf || schema.allOf ? "Alternative or combined schemas not expanded" : undefined) ||
    (schema.prefixItems || Array.isArray(schema.items) ? "Tuple item schemas not expanded" : undefined) ||
    (!type ? "Type not documented" : undefined);
  return { ...result, type: notice ? "Unknown" : type!, ...(notice ? { notice } : {}) };
}

function project(source: unknown, document: Schema, group: string, label: string, path: string, seen: string[],
  depth: number, budget: { fields: number; panels: number }, direction: WorkflowData["direction"]): Tree
{
  const resolved = shape(source, document, seen, depth);
  const schema = resolved.schema;
  const fields: WorkflowField[] = [];
  const children: Tree["children"] = [];
  let notice = resolved.notice;
  const add = (value: unknown, name: string, fieldPath: string, required: boolean) => {
    if (fields.length >= 200 || budget.fields >= 2000 || fieldPath.length > 500 || identity(group, fieldPath).length > 1500)
    {
      notice = "Additional fields not expanded";
      return;
    }
    const result = shape(value, document, resolved.seen, depth + 1);
    if (direction === "outputs" && result.schema.writeOnly === true || direction === "inputs" && result.schema.readOnly === true) return;
    const field: WorkflowField = {
      id: identity(group, fieldPath), label: string(result.schema.title, name).slice(0, 200), type: result.type, required,
      description: string(result.schema.description).slice(0, 4000), connectable: !result.notice
    };
    fields.push(field);
    budget.fields++;
    if (result.notice) notice ??= result.notice;
    if (field.connectable && (field.type === "Object" || field.type === "Array"))
    {
      if (budget.panels >= 200) { notice = "Additional schema branches not expanded"; return; }
      budget.panels++;
      children.push({ fieldId: field.id, path: fieldPath,
        tree: project(value, document, group, field.label, fieldPath, resolved.seen, depth + 1, budget, direction) });
    }
  };
  if (!notice)
  {
    if (resolved.type === "Object")
    {
      const properties = object(schema.properties) ? schema.properties : {};
      const required = Array.isArray(schema.required) ? schema.required : [];
      for (const [name, value] of Object.entries(properties)) add(value, name, `${path}/${pointer(name)}`, required.includes(name));
      if (!fields.length) notice ??= "No named properties documented";
    }
    else if (resolved.type === "Array") add(schema.items, "Items", `${path}/items`, true);
    else add(schema, direction === "inputs" ? "Request body" : "Response body", path, false);
  }
  const height = 64 + Math.max(fields.length, 1) * 34 + (notice && fields.length ? 40 : 0);
  const span = Math.max(height, children.reduce((sum, child) => sum + child.tree.span, 0) + Math.max(0, children.length - 1) * 32);
  return { label, fields, children, ...(notice ? { notice } : {}), height, span };
}

function inputGroups(operation: Operation, source: Schema | undefined, pathItem: Schema, document: Schema)
{
  const groups = new Map<string, { properties: Schema; required: string[] }>();
  const add = (location: string, name: string, schema: unknown, required: boolean) => {
    const group = groups.get(location) ?? { properties: Object.create(null) as Schema, required: [] };
    group.properties[name] = schema;
    group.required = group.required.filter(value => value !== name);
    if (required) group.required.push(name);
    groups.set(location, group);
  };
  if (source)
  {
    for (const parameters of [pathItem.parameters, source.parameters])
    {
      if (!Array.isArray(parameters)) continue;
      for (const raw of parameters)
      {
        const parameter = resolve(raw, document).schema;
        if (typeof parameter.name !== "string" || !["path", "query", "header", "cookie"].includes(String(parameter.in))) continue;
        add(String(parameter.in), parameter.name, parameter.schema, parameter.required === true);
      }
    }
  }
  else for (const field of operation.fields.filter(field => field.location !== "body"))
    add(field.location, field.name, { ...field.schema, type: field.type, title: field.label, description: field.description }, field.required);
  const titles: Record<string, string> = { path: "Path parameters", query: "Query parameters", header: "Headers", cookie: "Cookies" };
  const result = [...groups].map(([id, group]) => ({ id: `input:${id}`, label: titles[id]!,
    schema: { type: "object", properties: group.properties, required: group.required } as unknown }));
  if (source?.requestBody !== undefined)
  {
    const body = resolve(source.requestBody, document);
    const content = object(body.schema.content) ? body.schema.content : {};
    const media = content[operation.bodyMediaType ?? Object.keys(content)[0]!];
    result.push({ id: "input:body", label: "Request body", schema: object(media) ? media.schema : undefined });
  }
  else if (!source)
  {
    const fields = operation.fields.filter(field => field.location === "body");
    if (fields.length) result.push({ id: "input:body", label: "Request body", schema: operation.bodyValue
      ? { ...fields[0]!.schema, type: fields[0]!.type } : {
      type: "object", properties: Object.fromEntries(fields.map(field => [field.name,
        { ...field.schema, type: field.type, title: field.label, description: field.description }])),
      required: fields.filter(field => field.required).map(field => field.name)
    } });
  }
  return result;
}

export function createOperationGraph(operation: Operation, position: { x: number; y: number }, ownerId: string,
  schemaDocument: Schema = {}): Graph
{
  const paths = object(schemaDocument.paths) ? schemaDocument.paths : {};
  const pathItem = resolve(paths[operation.path], schemaDocument).schema;
  const raw = pathItem[operation.method.toLowerCase()];
  const source = object(raw) ? raw : undefined;
  const nodes: WorkflowDocumentNode[] = [{ id: ownerId, type: "operation", position: { ...position }, data: {
    operationId: operation.id, name: operation.name, description: operation.description, method: operation.method, path: operation.path
  } }];
  const edges: WorkflowDocumentEdge[] = [];
  const budget = { fields: 0, panels: 0 };
  const inputs = inputGroups(operation, source, pathItem, schemaDocument);
  const outputs: { id: string; label: string; schema: unknown }[] = [];
  const responses = object(source?.responses) ? source.responses : {};
  for (const [status, raw] of Object.entries(responses))
  {
    if (!/^(?:[1-5](?:\d\d|XX)|default)$/i.test(status)) continue;
    const response = resolve(raw, schemaDocument);
    const content = object(response.schema.content) ? response.schema.content : {};
    const representations = Object.entries(content);
    if (!representations.length) outputs.push({ id: `output:${status}`, label: `Response · ${status}`, schema: undefined });
    for (const [media, value] of representations) outputs.push({ id: `output:${status}:${media}`,
      label: `Response · ${status}${representations.length > 1 ? ` · ${media}` : ""}`, schema: object(value) ? value.schema : undefined });
  }
  for (const direction of ["inputs", "outputs"] as const)
  {
    const input = direction === "inputs";
    const groups = input ? inputs : outputs;
    const trees = groups.length ? groups.slice(0, 100).map(group => ({ id: group.id,
      tree: project(group.schema, schemaDocument, group.id, group.label, "", [], 0, budget, direction) })) : [{ id: direction,
      tree: { label: input ? "Inputs" : "Outputs", fields: [], children: [], height: 98, span: 98,
        notice: input ? "No input fields documented" : "Response schema not documented" } as Tree }];
    let y = position.y - (trees.reduce((sum, item) => sum + item.tree.span, 0) + (trees.length - 1) * 32) / 2 + 40;
    const place = (tree: Tree, group: string, path: string, x: number, centerY: number, parentId: string, handle?: string) => {
      const id = `${ownerId}:${identity(group, path)}`;
      const edgeId = `schema:${id}`;
      nodes.push({ id, type: "data", position: { x, y: centerY - tree.height / 2 },
        data: { ownerId, direction, label: tree.label, fields: tree.fields, ...(tree.notice ? { notice: tree.notice } : {}) } });
      edges.push({ id: edgeId, kind: "schema", source: input ? id : parentId, target: input ? parentId : id,
        sourceHandle: input ? "value" : handle ?? edgeId, targetHandle: input ? handle ?? edgeId : "value" });
      let childY = centerY - (tree.children.reduce((sum, child) => sum + child.tree.span, 0) + Math.max(0, tree.children.length - 1) * 32) / 2;
      for (const child of tree.children)
      {
        place(child.tree, group, child.path, x + (input ? -1 : 1) * (panelWidth + gap), childY + child.tree.span / 2, id, child.fieldId);
        childY += child.tree.span + 32;
      }
    };
    for (const { id, tree } of trees)
    {
      place(tree, id, "", position.x + (input ? -panelWidth - gap : 160 + gap), y + tree.span / 2, ownerId);
      y += tree.span + 32;
    }
  }
  return { nodes, edges };
}

export function schemaBranches(nodes: WorkflowDocumentNode[], edges: WorkflowDocumentEdge[]): Map<string, Map<string, SchemaBranch>>
{
  const byId = new Map(nodes.map(node => [node.id, node]));
  const branches = new Map<string, Map<string, SchemaBranch>>();
  for (const edge of edges)
  {
    if (edge.kind !== "schema") continue;
    const source = byId.get(edge.source);
    const input = source?.type === "data" && source.data.direction === "inputs";
    const child = byId.get(input ? edge.source : edge.target);
    const parent = byId.get(input ? edge.target : edge.source);
    const id = input ? edge.targetHandle : edge.sourceHandle;
    if (!parent || child?.type !== "data" || !id) continue;
    const ports = branches.get(parent.id) ?? new Map<string, SchemaBranch>();
    ports.set(id, { id, childId: child.id, direction: child.data.direction, label: child.data.label,
      hidden: child.hidden === true || edge.detached === true });
    branches.set(parent.id, ports);
  }
  return branches;
}

export function isWorkflowConnection(connection: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null },
  nodes: WorkflowDocumentNode[], edges: WorkflowDocumentEdge[]): boolean
{
  const source = nodes.find(node => node.id === connection.source);
  const target = nodes.find(node => node.id === connection.target);
  if (!source || !target || source === target || source.hidden || target.hidden || edges.some(edge =>
    edge.source === source.id && edge.target === target.id &&
    (edge.sourceHandle ?? null) === (connection.sourceHandle ?? null) && (edge.targetHandle ?? null) === (connection.targetHandle ?? null))) return false;
  if ((source.type === "operation" || source.type === undefined) && (target.type === "operation" || target.type === undefined))
    return !connection.sourceHandle && !connection.targetHandle &&
    !nodes.some(node => node.type === "data" && [source.id, target.id].includes(node.data.ownerId));
  return isValueConnection(connection, source, target, edges);
}

export function createUtilityNode(type: "switch" | "cast" | "comment", position: { x: number; y: number }, id: string): WorkflowDocumentNode
{
  const common = { id, position: { ...position } };
  if (type === "switch") return { ...common, type, data: { gates: [{ id: "gate-1", operator: "==", value: "" }] } };
  if (type === "cast") return { ...common, type, data: { targetType: "Text" } };
  return { ...common, type, data: { text: "" } };
}

export function addSwitchGate(nodeId: string, gateId: string, nodes: WorkflowDocumentNode[], edges: WorkflowDocumentEdge[]): Graph
{
  const node = nodes.find(node => node.id === nodeId);
  if (node?.type !== "switch" || node.data.gates.length >= switchGateLimit || node.data.gates.some(gate => gate.id === gateId)) return { nodes, edges };
  if (!gateId.trim() || gateId.length > 128 || gateId === "value" || gateId.startsWith("gate-value:")) throw new Error("Invalid switch gate ID.");
  const gate = gateForType({ id: gateId, operator: "==", value: "" }, routingInputTypes(nodes, edges).get(nodeId)!);
  return { nodes: nodes.map(item => item === node ? { ...node, data: { gates: [...node.data.gates, gate] } } : item), edges };
}

export function updateSwitchGate(nodeId: string, gateId: string, patch: Partial<Pick<SwitchGate, "operator" | "value">>,
  nodes: WorkflowDocumentNode[], edges: WorkflowDocumentEdge[]): Graph
{
  const node = nodes.find(node => node.id === nodeId);
  const previous = node?.type === "switch" && node.data.gates.find(gate => gate.id === gateId);
  if (!previous || node?.type !== "switch") return { nodes, edges };
  const gate = { ...previous, ...patch };
  if (!switchOperators.some(operator => operator.value === gate.operator) || typeof gate.value !== "string" || gate.value.length > switchValueLimit)
    throw new Error("Invalid switch gate operator or value.");
  const nextEdges = gate.operator === "is_set" || gate.operator === "is_not_set"
    ? edges.filter(edge => edge.target !== nodeId || edge.targetHandle !== switchGateInput(gateId)) : edges;
  return { nodes: nodes.map(item => item === node ? { ...node, data: { gates: node.data.gates.map(item => item.id === gateId ? gate : item) } } : item), edges: nextEdges };
}

export function removeSwitchGate(nodeId: string, gateId: string, nodes: WorkflowDocumentNode[], edges: WorkflowDocumentEdge[]): Graph
{
  const node = nodes.find(node => node.id === nodeId);
  if (node?.type !== "switch" || node.data.gates.length <= 1 || !node.data.gates.some(gate => gate.id === gateId)) return { nodes, edges };
  return {
    nodes: nodes.map(item => item === node ? { ...node, data: { gates: node.data.gates.filter(gate => gate.id !== gateId) } } : item),
    edges: edges.filter(edge => !(edge.source === nodeId && edge.sourceHandle === gateId || edge.target === nodeId && edge.targetHandle === switchGateInput(gateId)))
  };
}

export function createWorkflowGraph(savedDocument: WorkflowDocument, position: { x: number; y: number }, ownerId: string): Graph
{
  const snapshot = validateWorkflowDocument(savedDocument);
  const nodes: WorkflowDocumentNode[] = [{ id: ownerId, type: "workflow", position: { ...position }, data: {
    workflowId: snapshot.id, name: snapshot.name, description: snapshot.description ?? "", snapshot
  } }];
  const edges: WorkflowDocumentEdge[] = [];
  const groups = workflowInterface(snapshot);
  for (const direction of ["inputs", "outputs"] as const)
  {
    const selected = groups.filter(group => group.node.data.direction === direction);
    const panels = selected.length ? selected.map(({ node, fields }, index) => {
      const owner = snapshot.nodes.find((owner): owner is Extract<WorkflowDocumentNode, { data: { name: string } }> => owner.id === node.data.ownerId)!;
      const name = owner.data.name;
      return { id: `${ownerId}:interface:${direction}:${index}`, data: { ownerId, direction,
        label: `${name} · ${node.data.label}`.slice(0, 200), fields: fields.map((field, index) => ({ ...field,
          id: identity("interface", String(index)), endpoint: { nodeId: node.id, fieldId: field.id } })),
        ...(node.data.notice ? { notice: node.data.notice } : {}) } };
    }) : [{ id: `${ownerId}:interface:${direction}`, data: { ownerId, direction, label: direction === "inputs" ? "Inputs" : "Outputs",
      fields: [], notice: direction === "inputs" ? "No external input fields" : "No documented output fields" } }];
    const heights = panels.map(panel => 64 + Math.max(panel.data.fields.length, 1) * 34 + (panel.data.notice && panel.data.fields.length ? 40 : 0));
    let y = position.y + 44 - (heights.reduce((sum, height) => sum + height, 0) + Math.max(0, panels.length - 1) * 32) / 2;
    for (const [index, panel] of panels.entries())
    {
      const input = direction === "inputs";
      nodes.push({ ...panel, type: "data", position: { x: position.x + (input ? -panelWidth - gap : 160 + gap), y } });
      edges.push({ id: `schema:${panel.id}`, kind: "schema", source: input ? panel.id : ownerId, target: input ? ownerId : panel.id,
        sourceHandle: input ? "value" : `schema:${panel.id}`, targetHandle: input ? `schema:${panel.id}` : "value" });
      y += heights[index]! + 32;
    }
  }
  return { nodes, edges };
}

function descendants(ids: Set<string>, branches: ReturnType<typeof schemaBranches>): Set<string>
{
  const result = new Set(ids);
  for (const id of result) for (const branch of branches.get(id)?.values() ?? []) result.add(branch.childId);
  return result;
}

function visibleEdges(nodes: WorkflowDocumentNode[], edges: WorkflowDocumentEdge[]): WorkflowDocumentEdge[]
{
  const hidden = new Set(nodes.filter(node => node.hidden).map(node => node.id));
  return edges.map(edge => {
    const { hidden: _, ...visible } = edge;
    return hidden.has(edge.source) || hidden.has(edge.target) || edge.detached ? { ...visible, hidden: true } : visible;
  });
}

export function removeGraphSelection(selection: { nodes: { id: string }[]; edges: { id: string }[] },
  nodes: WorkflowDocumentNode[], edges: WorkflowDocumentEdge[]): Graph
{
  const selected = new Set(selection.nodes.map(node => node.id));
  const selectedEdges = new Set(selection.edges.map(edge => edge.id));
  const owners = new Set(nodes.filter(node => node.type !== "data" && selected.has(node.id)).map(node => node.id));
  const removed = new Set(nodes.filter(node => owners.has(node.id) || node.type === "data" && owners.has(node.data.ownerId)).map(node => node.id));
  const branches = schemaBranches(nodes, edges);
  const roots = new Set(nodes.filter(node => node.type === "data" && selected.has(node.id)).map(node => node.id));
  for (const ports of branches.values()) for (const branch of ports.values())
    if (selectedEdges.has(`schema:${branch.childId}`)) roots.add(branch.childId);
  const hidden = descendants(roots, branches);
  for (const node of nodes) if (node.hidden) hidden.add(node.id);
  const nextNodes = nodes.filter(node => !removed.has(node.id)).map(node => hidden.has(node.id) ? { ...node, hidden: true } : node);
  const nextEdges = edges.filter(edge => !removed.has(edge.source) && !removed.has(edge.target) &&
    (edge.kind === "schema" || !selectedEdges.has(edge.id) && !hidden.has(edge.source) && !hidden.has(edge.target)))
    .map(edge => edge.kind === "schema" && roots.has(edge.id.slice("schema:".length)) ? { ...edge, detached: true } : edge);
  return { nodes: nextNodes, edges: visibleEdges(nextNodes, nextEdges) };
}

export function restoreDataBranch(childId: string, nodes: WorkflowDocumentNode[], edges: WorkflowDocumentEdge[]): Graph
{
  const child = nodes.find(node => node.id === childId);
  const branches = schemaBranches(nodes, edges);
  const parentId = [...branches].find(([, ports]) => [...ports.values()].some(branch => branch.childId === childId))?.[0];
  const parent = nodes.find(node => node.id === parentId);
  if (child?.type !== "data" || !parent || parent.hidden) return { nodes, edges };
  const restored = descendants(new Set([childId]), branches);
  const nextNodes = nodes.map(node => {
    if (!restored.has(node.id)) return node;
    const { hidden: _, ...visible } = node;
    return visible;
  });
  const nextEdges = edges.map(edge => {
    if (edge.kind !== "schema" || !restored.has(edge.id.slice("schema:".length))) return edge;
    const { detached: _, ...attached } = edge;
    return attached;
  });
  return { nodes: nextNodes, edges: visibleEdges(nextNodes, nextEdges) };
}
