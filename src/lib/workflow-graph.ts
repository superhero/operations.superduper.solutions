// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import type { Operation } from "./catalog.ts";
import { fileValueType } from "./workflow-file.ts";
import { defaultProcessingData, type ProcessingKind } from "./workflow-processing.ts";
import { placeUtilityNode } from "./workflow-layout.ts";
import { validateWorkflowDocument, type SwitchGate, type WorkflowData, type WorkflowDocument,
  type WorkflowDocumentEdge, type WorkflowDocumentNode, type WorkflowField } from "./workflow-document.ts";
import { adaptRoutingGates, gateForType, isFileBinaryConnection, isValueConnection, isWorkflowConnectionTypeCompatible, routingInputTypes, switchGateInput, switchGateLimit,
  switchOperators, switchValueLimit, workflowInputConnected, workflowInterface } from "./workflow-utilities.ts";

type Schema = Record<string, unknown>;
type Shape = { schema: Schema; seen: string[]; type: WorkflowField["type"]; notice?: string };
type Tree = { array?: { min: number; max?: number }; label: string; fields: WorkflowField[]; children: { fieldId: string; path: string; tree: Tree }[]; notice?: string; height: number; span: number };
type DataNode = Extract<WorkflowDocumentNode, { type: "data" }>;
type Graph<Node extends WorkflowDocumentNode = WorkflowDocumentNode> = { nodes: Node[]; edges: WorkflowDocumentEdge[] };
type TreeTarget = { nodes: { push(...nodes: DataNode[]): number }; edges: WorkflowDocumentEdge[] };
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

function shape(value: unknown, document: Schema, seen: string[], depth: number, binary = false): Shape
{
  const result = resolve(value, document, seen);
  const schema = result.schema;
  const types = Array.isArray(schema.type) ? schema.type.filter(type => type !== "null") : [schema.type];
  const type = types.length === 1 && typeof types[0] === "string" ? binary && types[0] === "string" && schema.format === "binary" ? "Binary" : labels[types[0]]
    : schema.type === undefined && object(schema.properties) ? "Object" : undefined;
  const notice = depth > 12 ? "Deeper schema not expanded" : result.notice ||
    (schema.oneOf || schema.anyOf || schema.allOf ? "Alternative or combined schemas not expanded" : undefined) ||
    (schema.prefixItems || Array.isArray(schema.items) ? "Tuple item schemas not expanded" : undefined) ||
    (!type ? "Type not documented" : undefined);
  return { ...result, type: notice ? "Unknown" : type!, ...(notice ? { notice } : {}) };
}

function schemaArrayBounds(schema: Schema): { min: number; max?: number } {
  const min = typeof schema.minItems === "number" && Number.isSafeInteger(schema.minItems) && schema.minItems >= 0 ? schema.minItems : 0;
  const max = typeof schema.maxItems === "number" && Number.isSafeInteger(schema.maxItems) && schema.maxItems >= min ? schema.maxItems : undefined;
  return { min, ...(max === undefined ? {} : { max }) };
}

function project(source: unknown, document: Schema, group: string, label: string, path: string, seen: string[],
  depth: number, budget: { fields: number; panels: number }, direction: WorkflowData["direction"], binary = false): Tree
{
  const resolved = shape(source, document, seen, depth, binary);
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
    const result = shape(value, document, resolved.seen, depth + 1, binary);
    if (direction === "outputs" && result.schema.writeOnly === true || direction === "inputs" && result.schema.readOnly === true) return;
    const field: WorkflowField = {
      id: identity(group, fieldPath), label: string(result.schema.title, name).slice(0, 200), type: result.type, required,
      description: string(result.schema.description).slice(0, 4000), connectable: !result.notice,
      ...(result.type === "Array" ? { array: schemaArrayBounds(result.schema) } : {})
    };
    fields.push(field);
    budget.fields++;
    if (result.notice) notice ??= result.notice;
    if (field.connectable && (field.type === "Object" || field.type === "Array"))
    {
      if (budget.panels >= 200) { notice = "Additional schema branches not expanded"; return; }
      budget.panels++;
      children.push({ fieldId: field.id, path: fieldPath,
        tree: project(value, document, group, field.label, fieldPath, resolved.seen, depth + 1, budget, direction, binary) });
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
    else if (resolved.type === "Array") {
      add(schema.items, "Items", `${path}/items`, true);
      if (fields[0]) fields[0].array = schemaArrayBounds(schema);
    }
    else add(schema, "Request body", path, false);
  }
  const height = 64 + Math.max(fields.length, 1) * 34 + (notice && fields.length ? 40 : 0);
  const span = Math.max(height, children.reduce((sum, child) => sum + child.tree.span, 0) + Math.max(0, children.length - 1) * 32);
  return { label, fields, children, ...(resolved.type === "Array" ? { array: schemaArrayBounds(schema) } : {}), ...(notice ? { notice } : {}), height, span };
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
      ? { ...fields[0]!.schema, type: fields[0]!.type, ...(fields[0]!.format ? { format: fields[0]!.format } : {}) } : {
      type: "object", properties: Object.fromEntries(fields.map(field => [field.name,
        { ...field.schema, type: field.type, ...(field.format ? { format: field.format } : {}), title: field.label, description: field.description }])),
      required: fields.filter(field => field.required).map(field => field.name)
    } });
  }
  return result;
}

function responseEnvelope(raw: unknown, media: string | undefined, document: Schema): Schema
{
  const response = resolve(raw, document);
  const content = object(response.schema.content) ? response.schema.content : {};
  const representation = media === undefined ? undefined : content[media];
  const body = media === undefined && !response.notice ? { type: "null" }
    : object(representation) ? representation.schema : undefined;
  const properties: Schema = Object.create(null);
  const required: string[] = [];
  for (const [name, rawHeader] of Object.entries(object(response.schema.headers) ? response.schema.headers : {}))
  {
    const header = resolve(rawHeader, document);
    const headerRepresentations = object(header.schema.content) ? Object.values(header.schema.content) : [];
    const headerContent = headerRepresentations.length === 1 ? headerRepresentations[0] : undefined;
    const schema = header.notice ? undefined : header.schema.schema ?? (object(headerContent) ? headerContent.schema : undefined);
    properties[name] = { ...(object(schema) ? schema : {}), title: name,
      ...(typeof header.schema.description === "string" ? { description: header.schema.description } : {}) };
    if (header.schema.required === true) required.push(name);
  }
  return { type: "object", additionalProperties: false, required: ["status", "statusText", "body", "headers"], properties: {
    status: { type: "integer", title: "Status", description: string(response.schema.description, "HTTP response status code.") },
    statusText: { type: "string", title: "Status message", description: "HTTP response status message; it can be empty." },
    body: { ...(object(body) ? body : {}), title: "Response body" },
    headers: { type: "object", title: "Response headers", properties, required, additionalProperties: { type: "string" } }
  } };
}

function placeTree(graph: TreeTarget, tree: Tree, ownerId: string, direction: WorkflowData["direction"], group: string,
  path: string, x: number, centerY: number, parentId: string, handle?: string): void
{
  const input = direction === "inputs";
  const id = `${ownerId}:${identity(group, path)}`;
  const edgeId = `schema:${id}`;
  graph.nodes.push({ id, type: "data", position: { x, y: centerY - tree.height / 2 },
    data: { ownerId, direction, label: tree.label, fields: tree.fields, ...(tree.array ? { array: tree.array } : {}), ...(tree.notice ? { notice: tree.notice } : {}) } });
  graph.edges.push({ id: edgeId, kind: "schema", source: input ? id : parentId, target: input ? parentId : id,
    sourceHandle: input ? "value" : handle ?? edgeId, targetHandle: input ? handle ?? edgeId : "value" });
  let childY = centerY - (tree.children.reduce((sum, child) => sum + child.tree.span, 0) + Math.max(0, tree.children.length - 1) * 32) / 2;
  for (const child of tree.children)
  {
    placeTree(graph, child.tree, ownerId, direction, group, child.path, x + (input ? -1 : 1) * (panelWidth + gap),
      childY + child.tree.span / 2, id, child.fieldId);
    childY += child.tree.span + 32;
  }
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
    if (!representations.length) outputs.push({ id: `response:${status}`, label: `Response · ${status}`,
      schema: responseEnvelope(raw, undefined, schemaDocument) });
    for (const [media] of representations) outputs.push({ id: `response:${status}:${media}`,
      label: `Response · ${status}${representations.length > 1 ? ` · ${media}` : ""}`, schema: responseEnvelope(raw, media, schemaDocument) });
  }
  for (const direction of ["inputs", "outputs"] as const)
  {
    const input = direction === "inputs";
    const groups = input ? inputs : outputs;
    const trees = groups.length ? groups.slice(0, 100).map(group => ({ id: group.id,
      tree: project(group.schema, schemaDocument, group.id, group.label, "", [], 0, budget, direction,
        input && group.id === "input:body" && (!!operation.binaryMediaTypes || operation.bodyMediaType === "multipart/form-data")) })) : [{ id: direction,
      tree: { label: input ? "Inputs" : "Outputs", fields: [], children: [], height: 98, span: 98,
        notice: input ? "No input fields documented" : "Response schema not documented" } as Tree }];
    let y = position.y - (trees.reduce((sum, item) => sum + item.tree.span, 0) + (trees.length - 1) * 32) / 2 + 40;
    for (const { id, tree } of trees)
    {
      placeTree({ nodes, edges }, tree, ownerId, direction, id, "", position.x + (input ? -panelWidth - gap : 160 + gap),
        y + tree.span / 2, ownerId);
      y += tree.span + 32;
    }
  }
  return { nodes, edges };
}


/** Infer shared structure from uploaded values, without inventing fields for empty or mixed arrays. */
function fileSchema(values: unknown[], depth = 0): Schema {
  if (!values.length || depth > 12) return {};
  const types = new Set(values.map(value => value === null ? "null" : Array.isArray(value) ? "array" : typeof value));
  if (types.size !== 1) return {};
  const type = [...types][0]!;
  if (type === "number") return { type: values.every(value => Number.isInteger(value)) ? "integer" : "number" };
  if (type === "array") return { type, maxItems: (values as unknown[][]).reduce((max, value) => Math.max(max, value.length), 0),
    items: fileSchema((values as unknown[][]).flat(), depth + 1) };
  if (type !== "object") return { type };
  const objects = values as Record<string, unknown>[];
  const keys = [...new Set(objects.flatMap(value => Object.keys(value)))].slice(0, 201);
  return { type, properties: Object.fromEntries(keys.map(key => [key,
    fileSchema(objects.filter(value => Object.hasOwn(value, key)).map(value => value[key]), depth + 1)])),
    required: keys.filter(key => objects.every(value => Object.hasOwn(value, key) && value[key] !== null &&
      (typeof value[key] !== "string" || value[key].trim().length > 0))) };
}

/** Build the same bounded output panels used for operations, rooted at a file node. */
export function createFileDataGraph(node: Extract<WorkflowDocumentNode, { type: "file" }>): Graph {
  const graph: Graph<DataNode> = { nodes: [], edges: [] };
  if (!node.data.file || fileValueType(node.data.file) === "Binary") return graph;
  const tree = project(fileSchema([node.data.file.value]), {}, "file", Array.isArray(node.data.file.value) ? "Array" : "File data", "", [], 0,
    { fields: 0, panels: 0 }, "outputs");
  if (node.data.file.value === null || typeof node.data.file.value !== "object")
    tree.fields[0]!.label = "Value";
  placeTree(graph, tree, node.id, "outputs", "file", "", node.position.x + 360 + gap,
    node.position.y + tree.span / 2, node.id, "value");
  for (const panel of graph.nodes) if (panel.data.label === "Items") panel.data.label = "Item";
  // Projecting a field through array items produces an array, not a single sampled item.
  for (const panel of graph.nodes) for (const field of panel.data.fields)
    if (field.connectable) {
      let value: unknown = node.data.file.value;
      const path: string = JSON.parse(decodeURIComponent(field.id))[1];
      for (const part of path.slice(1).split("/")) {
        if (Array.isArray(value) && part === "items") { field.itemType = field.type; field.type = "Array"; field.array = { min: 0, max: value.length }; break; }
        value = object(value) ? value[part.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined;
      }
    }
  return graph;
}

/** Replace inferred panels while retaining stable identities, positions and compatible mappings. */
export function updateFileDataGraph(nodeId: string, data: Extract<WorkflowDocumentNode, { type: "file" }>["data"],
  nodes: WorkflowDocumentNode[], edges: WorkflowDocumentEdge[]): Graph {
  const owner = nodes.find(node => node.id === nodeId);
  if (owner?.type !== "file") return { nodes, edges };
  const next = { ...owner, data };
  const generated = createFileDataGraph(next);
  const oldPanels = new Map(nodes.filter(node => node.type === "data" && node.data.ownerId === nodeId).map(node => [node.id, node]));
  const result = [...nodes.filter(node => !oldPanels.has(node.id)).map(node => node.id === nodeId ? next : node),
    ...generated.nodes.map(node => {
      const old = oldPanels.get(node.id);
      return old ? { ...node, position: old.position, ...(old.hidden ? { hidden: true } : {}) } : node;
    })];
  const links = [...edges.filter(edge => edge.kind !== "schema" || !oldPanels.has(edge.target)),
    ...generated.edges.map(edge => {
      const old = edges.find(previous => previous.id === edge.id);
      return { ...edge, ...(old?.hidden ? { hidden: true } : {}), ...(old?.detached ? { detached: true } : {}) };
    })];
  const index = new Map(result.map(node => [node.id, node]));
  const attached = links.filter(edge => index.has(edge.source) && index.has(edge.target));
  return { nodes: result, edges: attached.filter(edge => {
    const source = index.get(edge.source)!, target = index.get(edge.target)!;
    return edge.kind !== "mapping" || isValueConnection(edge, source, target, attached.filter(other => other.id !== edge.id)) &&
      isWorkflowConnectionTypeCompatible(edge, result, attached);
  }) };
}

const propertyTypes = Object.values(labels);
const annotations = ["title", "description", "example", "examples", "default", "deprecated", "readOnly", "writeOnly"];
const unconstrained = (schema: Schema) => Object.keys(schema).every(key => annotations.includes(key));
const schemaType = (type: WorkflowField["type"]) => Object.keys(labels).find(key => labels[key] === type)!;

// Unsupported object constraints cannot be treated as permission to add arbitrary names.
function supportedObject(schema: Schema): boolean
{
  if (Object.keys(schema).some(key => ![...annotations, "type", "nullable", "properties", "required",
    "additionalProperties", "minProperties", "maxProperties"].includes(key))) return false;
  if (schema.properties !== undefined && !object(schema.properties)) return false;
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some(name => typeof name !== "string") ||
    new Set(schema.required).size !== schema.required.length)) return false;
  for (const key of ["minProperties", "maxProperties"])
    if (schema[key] !== undefined && (typeof schema[key] !== "number" || !Number.isInteger(schema[key]) || schema[key] < 0)) return false;
  if (typeof schema.minProperties === "number" && typeof schema.maxProperties === "number" && schema.minProperties > schema.maxProperties) return false;
  return schema.additionalProperties === undefined || typeof schema.additionalProperties === "boolean" || object(schema.additionalProperties);
}

function extensible(schema: Schema): boolean
{
  return supportedObject(schema) && schema.additionalProperties !== false;
}

function additionalSchema(schema: Schema): unknown
{
  return schema.additionalProperties === undefined || schema.additionalProperties === true ? {} : schema.additionalProperties;
}

function headerPropertyShape(resolved: Shape, group: string, path: string, document: Schema): Shape
{
  if (!group.startsWith("response:") || !/^\/headers\/[^/]+$/.test(path) || resolved.type !== "Object") return resolved;
  const additional = resolve(additionalSchema(resolved.schema), document, resolved.seen);
  if (additional.notice || !unconstrained(additional.schema)) return resolved;
  // Undeclared simple-header object properties are wire strings; body properties remain freely typed.
  return { ...resolved, schema: { ...resolved.schema, additionalProperties: { ...additional.schema, type: "string" } } };
}

function additionalTypes(source: unknown, document: Schema, seen: string[], depth: number, direction: WorkflowData["direction"]): WorkflowField["type"][]
{
  const resolved = resolve(source, document, seen);
  if (resolved.notice || direction === "inputs" && resolved.schema.readOnly === true || direction === "outputs" && resolved.schema.writeOnly === true) return [];
  if (unconstrained(resolved.schema)) return [...propertyTypes];
  const result = shape(source, document, seen, depth);
  const schema = resolved.schema;
  const additional = schema.additionalProperties;
  if (["oneOf", "anyOf", "allOf", "not", "if", "then", "else", "dependentSchemas", "dependencies", "patternProperties",
    "propertyNames", "unevaluatedProperties", "unevaluatedItems", "contains", "$dynamicRef", "$recursiveRef"].some(key => key in schema)) return [];
  if (additional !== undefined && typeof additional !== "boolean" && !object(additional) ||
      schema.properties !== undefined && !object(schema.properties) ||
      schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some(name => typeof name !== "string")) ||
      schema.items !== undefined && !object(schema.items) ||
      schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length)) return [];
  return result.notice ? [] : [result.type];
}

function objectPanel(nodes: WorkflowDocumentNode[], nodeId: string, document: Schema)
{
  const node = nodes.find(node => node.id === nodeId);
  if (node?.type !== "data" || node.hidden) return;
  const owner = nodes.find(owner => owner.id === node.data.ownerId);
  if (!owner || owner.type !== "operation" && owner.type !== undefined || !node.id.startsWith(`${owner.id}:`)) return;
  let decoded: unknown;
  try { decoded = JSON.parse(decodeURIComponent(node.id.slice(owner.id.length + 1))); } catch { return; }
  if (!Array.isArray(decoded) || decoded.length !== 2 || decoded.some(value => typeof value !== "string")) return;
  const [group, path] = decoded as [string, string];
  if (node.id !== `${owner.id}:${identity(group, path)}` || path && (!path.startsWith("/") || /~(?:[^01]|$)/.test(path))) return;
  const paths = object(document.paths) ? document.paths : {};
  const pathItem = resolve(paths[owner.data.path], document);
  const source = pathItem.schema[owner.data.method.toLowerCase()];
  if (pathItem.notice || !object(source)) return;
  let value: unknown;
  if (node.data.direction === "inputs")
  {
    if (!path && group !== "input:body") return; // Parameter collections are synthetic objects.
    const operation: Operation = { ...owner.data, id: owner.data.operationId, group: "", fields: [], bodyRequired: false };
    value = inputGroups(operation, source, pathItem.schema, document).find(item => item.id === group)?.schema;
  }
  else
  {
    const match = /^(output|response):([1-5](?:\d\d|XX)|default)(?::(.+))?$/i.exec(group);
    if (!match || !object(source.responses)) return;
    if (match[1] === "response") value = responseEnvelope(source.responses[match[2]!], match[3], document);
    else
    {
      const response = resolve(source.responses[match[2]!], document);
      const media = object(response.schema.content) && match[3] ? response.schema.content[match[3]] : undefined;
      if (response.notice || !object(media)) return;
      value = media.schema;
    }
  }
  let resolved = shape(value, document, [], 0);
  let currentPath = "";
  const parts = path ? path.slice(1).split("/") : [];
  if (parts.length >= 12) return;
  for (const [index, part] of parts.entries())
  {
    if (resolved.notice) return;
    const name = part.replace(/~1/g, "/").replace(/~0/g, "~");
    const nextPath = `${currentPath}/${part}`;
    const parent = nodes.find(item => item.id === `${owner.id}:${identity(group, currentPath)}`);
    const field = parent?.type === "data" ? parent.data.fields.find(field => field.id === identity(group, nextPath)) : undefined;
    if (!field?.connectable) return;
    if (resolved.type === "Object")
    {
      if (!supportedObject(resolved.schema)) return;
      const properties = object(resolved.schema.properties) ? resolved.schema.properties : {};
      if (Object.hasOwn(properties, name)) value = properties[name];
      else
      {
        if (!extensible(resolved.schema)) return;
        value = additionalSchema(resolved.schema);
        if (!additionalTypes(value, document, resolved.seen, index + 1, node.data.direction).includes(field.type)) return;
        const additional = resolve(value, document, resolved.seen);
        if (unconstrained(additional.schema)) value = { ...additional.schema, type: schemaType(field.type) };
      }
    }
    else if (resolved.type === "Array" && name === "items")
    {
      if (Object.keys(resolved.schema).some(key => ![...annotations, "type", "nullable", "items", "minItems", "maxItems"].includes(key))) return;
      value = resolved.schema.items;
    }
    else return;
    resolved = headerPropertyShape(shape(value, document, resolved.seen, index + 1), group, nextPath, document);
    if (resolved.type !== field.type) return;
    currentPath = nextPath;
  }
  if (resolved.notice || resolved.type !== "Object" || !extensible(resolved.schema) ||
    node.data.direction === "inputs" && resolved.schema.readOnly === true || node.data.direction === "outputs" && resolved.schema.writeOnly === true) return;
  return { node, group, path, resolved, depth: parts.length };
}

export function getAdditionalPropertyTypes(nodes: WorkflowDocumentNode[], nodeId: string, schemaDocument: Schema = {}): WorkflowField["type"][]
{
  const context = objectPanel(nodes, nodeId, schemaDocument);
  if (!context || context.node.data.fields.length >= 200 ||
    typeof context.resolved.schema.maxProperties === "number" && context.node.data.fields.length >= context.resolved.schema.maxProperties) return [];
  return additionalTypes(additionalSchema(context.resolved.schema), schemaDocument, context.resolved.seen, context.depth + 1, context.node.data.direction);
}

function validatePropertyName(name: string): void
{
  if (typeof name !== "string" || !name.trim() || !name.isWellFormed() || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name))
    throw new Error("Property names must contain 1–200 characters without control characters.");
}

function validatedPropertyGraph(graph: Graph): Graph
{
  // Reuse the document limits, including nested snapshots, before returning an editable graph.
  validateWorkflowDocument({ version: 3, id: "additional-property", name: "Workflow", ...graph,
    viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false });
  return graph;
}

export function addAdditionalProperty(nodes: WorkflowDocumentNode[], edges: WorkflowDocumentEdge[], nodeId: string,
  name: string, type: WorkflowField["type"], schemaDocument: Schema = {}): Graph
{
  validatePropertyName(name);
  const context = objectPanel(nodes, nodeId, schemaDocument);
  if (!context) throw new Error("This object does not allow additional properties, or its schema is unavailable or unsupported.");
  const { node, group, path, resolved, depth } = context;
  const fieldPath = `${path}/${pointer(name)}`;
  const id = identity(group, fieldPath);
  if (object(resolved.schema.properties) && Object.hasOwn(resolved.schema.properties, name) || node.data.fields.some(field => field.id === id))
    throw new Error(`Property “${name}” already exists in this object or is reserved by its schema.`);
  if (!getAdditionalPropertyTypes(nodes, nodeId, schemaDocument).includes(type))
    throw new Error("This property type is not permitted, or the object has reached its property limit.");
  let value = additionalSchema(resolved.schema);
  const additional = resolve(value, schemaDocument, resolved.seen);
  if (unconstrained(additional.schema)) value = { ...additional.schema, type: schemaType(type) };
  const owned = nodes.filter((item): item is Extract<WorkflowDocumentNode, { type: "data" }> => item.type === "data" && item.data.ownerId === node.data.ownerId);
  const budget = { fields: owned.reduce((sum, item) => sum + item.data.fields.length, 0), panels: owned.length };
  const tree = project({ type: "object", properties: { [name]: value }, required: resolved.schema.required }, schemaDocument, group, node.data.label,
    path, resolved.seen, depth, budget, node.data.direction);
  const field = tree.fields[0];
  const truncated = (tree: Tree): boolean => Boolean(tree.notice?.startsWith("Additional ")) || tree.children.some(child => truncated(child.tree));
  if (!field || !field.connectable || truncated(tree)) throw new Error("This property exceeds the workflow schema size or depth limits.");
  const graph: Graph = { nodes: nodes.map(item => item === node ? { ...node,
    data: { ...node.data, fields: [...node.data.fields, field] } } : item), edges: [...edges] };
  for (const child of tree.children)
  {
    const x = node.position.x + (node.data.direction === "inputs" ? -1 : 1) * (panelWidth + gap);
    const neighbors = owned.filter(item => item.position.x === x);
    const y = Math.max(node.position.y, ...neighbors.map(item => item.position.y + 64 + Math.max(item.data.fields.length, 1) * 34 + 72));
    placeTree(graph, child.tree, node.data.ownerId, node.data.direction, group, child.path, x, y + child.tree.span / 2, node.id, child.fieldId);
  }
  return validatedPropertyGraph(graph);
}

function decodedIdentity(id: string): [string, string] | undefined
{
  try
  {
    const value: unknown = JSON.parse(decodeURIComponent(id));
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "string" && identity(value[0], value[1]) === id)
      return value as [string, string];
  }
  catch { /* Imported handles need not follow schema projection's identity convention. */ }
}

export function getEditableAdditionalProperties(nodes: WorkflowDocumentNode[], nodeId: string, schemaDocument: Schema = {}):
  { fieldId: string; name: string; types: WorkflowField["type"][] }[]
{
  const context = objectPanel(nodes, nodeId, schemaDocument);
  if (!context) return [];
  const { node, group, path, resolved, depth } = context;
  const types = additionalTypes(additionalSchema(resolved.schema), schemaDocument, resolved.seen, depth + 1, node.data.direction);
  if (!types.length) return [];
  const properties = object(resolved.schema.properties) ? resolved.schema.properties : {};
  return node.data.fields.flatMap(field => {
    const address = decodedIdentity(field.id);
    if (!address || address[0] !== group || !address[1].startsWith(`${path}/`)) return [];
    const part = address[1].slice(path.length + 1);
    if (part.includes("/") || /~(?:[^01]|$)/.test(part)) return [];
    const name = part.replace(/~1/g, "/").replace(/~0/g, "~");
    return Object.hasOwn(properties, name) ? [] : [{ fieldId: field.id, name, types: [...types] }];
  });
}

function editableProperty(nodes: WorkflowDocumentNode[], nodeId: string, fieldId: string, schemaDocument: Schema)
{
  const context = objectPanel(nodes, nodeId, schemaDocument);
  const property = getEditableAdditionalProperties(nodes, nodeId, schemaDocument).find(property => property.fieldId === fieldId);
  if (!context || !property) throw new Error("Only user-added properties with an available, supported object schema can be edited or removed.");
  return { ...context, property, field: context.node.data.fields.find(field => field.id === fieldId)! };
}

function withoutProperty(nodes: WorkflowDocumentNode[], edges: WorkflowDocumentEdge[], nodeId: string, fieldId: string): Graph
{
  const branches = schemaBranches(nodes, edges);
  const child = branches.get(nodeId)?.get(fieldId)?.childId;
  const removed = descendants(new Set(child ? [child] : []), branches);
  return {
    nodes: nodes.filter(node => !removed.has(node.id)).map(node => {
      if (node.id !== nodeId || node.type !== "data") return node;
      const fields = node.data.fields.filter(field => field.id !== fieldId);
      return { ...node, data: { ...node.data, fields, ...(!fields.length ? { notice: "No named properties documented" } : {}) } };
    }),
    edges: edges.filter(edge => !removed.has(edge.source) && !removed.has(edge.target) &&
      !(edge.source === nodeId && edge.sourceHandle === fieldId || edge.target === nodeId && edge.targetHandle === fieldId))
  };
}

export function removeAdditionalProperty(nodes: WorkflowDocumentNode[], edges: WorkflowDocumentEdge[], nodeId: string,
  fieldId: string, schemaDocument: Schema = {}): Graph
{
  editableProperty(nodes, nodeId, fieldId, schemaDocument);
  const graph = withoutProperty(nodes, edges, nodeId, fieldId);
  return validatedPropertyGraph({ nodes: adaptRoutingGates(graph.nodes, graph.edges), edges: graph.edges });
}

export function updateAdditionalProperty(nodes: WorkflowDocumentNode[], edges: WorkflowDocumentEdge[], nodeId: string,
  fieldId: string, name: string, type: WorkflowField["type"], schemaDocument: Schema = {}): Graph
{
  validatePropertyName(name);
  const { node, group, path, resolved, field, property } = editableProperty(nodes, nodeId, fieldId, schemaDocument);
  const nextPath = `${path}/${pointer(name)}`;
  const nextId = identity(group, nextPath);
  if (object(resolved.schema.properties) && Object.hasOwn(resolved.schema.properties, name) ||
      node.data.fields.some(field => field.id === nextId && field.id !== fieldId))
    throw new Error(`Property “${name}” already exists in this object or is reserved by its schema.`);
  if (!property.types.includes(type)) throw new Error("This property type is not permitted by the object's schema.");
  if (name === property.name && type === field.type) return { nodes, edges };
  const branches = schemaBranches(nodes, edges);
  const childId = branches.get(nodeId)?.get(fieldId)?.childId;
  const branch = descendants(new Set(childId ? [childId] : []), branches);
  if (type !== field.type)
  {
    const removed = withoutProperty(nodes, edges, nodeId, fieldId);
    const graph = addAdditionalProperty(removed.nodes, removed.edges, nodeId, name, type, schemaDocument);
    const index = node.data.fields.indexOf(field);
    graph.nodes = graph.nodes.map(item => {
      if (item.id !== nodeId || item.type !== "data") return item;
      const fields = item.data.fields.filter(field => field.id !== nextId);
      fields.splice(index, 0, item.data.fields.find(field => field.id === nextId)!);
      return { ...item, data: { ...item.data, fields } };
    });
    // Keep the replacement branch where the previous branch was, including a hidden attachment.
    const oldChild = nodes.find(item => item.id === childId);
    const newChild = graph.nodes.find(item => item.id === `${node.data.ownerId}:${nextId}`);
    if (oldChild && newChild)
    {
      const added = new Set(graph.nodes.filter(item => !removed.nodes.some(previous => previous.id === item.id)).map(item => item.id));
      graph.nodes = graph.nodes.map(item => added.has(item.id) ? { ...item,
        position: { x: item.position.x + oldChild.position.x - newChild.position.x, y: item.position.y + oldChild.position.y - newChild.position.y },
        ...(oldChild.hidden ? { hidden: true } : {}) } : item);
      const attachment = edges.find(edge => edge.id === `schema:${childId}`);
      graph.edges = graph.edges.map(edge => edge.kind === "schema" && (added.has(edge.source) || added.has(edge.target)) ? { ...edge,
        ...(oldChild.hidden ? { hidden: true } : {}), ...(edge.id === `schema:${newChild.id}` && attachment?.detached ? { detached: true } : {}) } : edge);
    }
    for (const edge of edges)
    {
      if (edge.kind !== "mapping" || branch.has(edge.source) || branch.has(edge.target) ||
          !(edge.source === nodeId && edge.sourceHandle === fieldId || edge.target === nodeId && edge.targetHandle === fieldId)) continue;
      const updated = { ...edge, ...(edge.source === nodeId ? { sourceHandle: nextId } : {}), ...(edge.target === nodeId ? { targetHandle: nextId } : {}) };
      const source = graph.nodes.find(node => node.id === updated.source)!;
      const target = graph.nodes.find(node => node.id === updated.target)!;
      if (isValueConnection(updated, source, target, graph.edges)) graph.edges.push(updated);
    }
    return validatedPropertyGraph({ nodes: adaptRoutingGates(graph.nodes, graph.edges), edges: graph.edges });
  }
  const previousPath = `${path}/${pointer(property.name)}`;
  const renameIdentity = (id: string): string => {
    const address = decodedIdentity(id);
    if (!address || address[0] !== group || address[1] !== previousPath && !address[1].startsWith(`${previousPath}/`))
      throw new Error("This property's saved branch does not have supported schema identities.");
    const path = `${nextPath}${address[1].slice(previousPath.length)}`;
    if (path.length > 500 || identity(group, path).length > 1500) throw new Error("This property exceeds the workflow schema size or depth limits.");
    return identity(group, path);
  };
  const nodeIds = new Map([...branch].map(id => [id, `${node.data.ownerId}:${renameIdentity(id.slice(node.data.ownerId.length + 1))}`]));
  const fields = new Map<string, Map<string, string>>([[nodeId, new Map([[fieldId, renameIdentity(fieldId)]])]]);
  const additional = resolve(additionalSchema(resolved.schema), schemaDocument, resolved.seen).schema;
  const label = string(additional.title, name).slice(0, 200);
  const nextNodes = nodes.map(item => {
    if (item.type !== "data") return item;
    if (branch.has(item.id)) fields.set(item.id, new Map(item.data.fields.map(field => [field.id, renameIdentity(field.id)])));
    const renamed = fields.get(item.id);
    if (!renamed) return item;
    return { ...item, id: nodeIds.get(item.id) ?? item.id, data: { ...item.data, ...(item.id === childId ? { label } : {}),
      fields: item.data.fields.map(value => ({ ...value, id: renamed.get(value.id) ?? value.id,
        ...(item.id === nodeId && value.id === fieldId ? { label, required: Array.isArray(resolved.schema.required) && resolved.schema.required.includes(name) } : {}) })) } };
  });
  const nextEdges = edges.map(edge => ({ ...edge,
    id: edge.kind === "schema" && nodeIds.has(edge.id.slice("schema:".length)) ? `schema:${nodeIds.get(edge.id.slice("schema:".length))}` : edge.id,
    source: nodeIds.get(edge.source) ?? edge.source, target: nodeIds.get(edge.target) ?? edge.target,
    ...(edge.sourceHandle !== undefined ? { sourceHandle: fields.get(edge.source)?.get(edge.sourceHandle) ?? edge.sourceHandle } : {}),
    ...(edge.targetHandle !== undefined ? { targetHandle: fields.get(edge.target)?.get(edge.targetHandle) ?? edge.targetHandle } : {}) }));
  return validatedPropertyGraph({ nodes: nextNodes, edges: nextEdges });
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
  if (!source || !target || source === target || source.hidden || target.hidden ||
    workflowInputConnected(target.id, connection.targetHandle, edges)) return false;
  if ((source.type === "operation" || source.type === undefined) && (target.type === "operation" || target.type === undefined))
    return !connection.sourceHandle && !connection.targetHandle &&
    !nodes.some(node => node.type === "data" && [source.id, target.id].includes(node.data.ownerId));
  return isValueConnection(connection, source, target, edges) && isWorkflowConnectionTypeCompatible(connection, nodes, edges);
}

export function createUtilityNode(type: "switch" | "cast" | "comment" | "vault" | "file" | "stop" | ProcessingKind, position: { x: number; y: number }, id: string): WorkflowDocumentNode
{
  const common = { id, position: { ...position } };
  if (type === "vault" || type === "file" || type === "stop") return { ...common, type, data: {} };
  if (type === "switch") return { ...common, type, data: { gates: [{ id: "gate-1", operator: "==", value: "" }] } };
  if (type === "cast") return { ...common, type, data: { targetType: "Text" } };
  if (type === "transform" || type === "filter" || type === "assert") return { ...common, type, data: defaultProcessingData(type) };
  return { ...common, type, data: { text: "" } };
}

/** Make the original-file conversion visible and persist it as ordinary editable graph nodes. */
export function insertFileBinaryCast(edge: WorkflowDocumentEdge, nodes: WorkflowDocumentNode[], edges: WorkflowDocumentEdge[], castId: string): Graph | undefined {
  const target = nodes.find(node => node.id === edge.target);
  if (!target || target.type !== "data" && target.type !== "transform" || !isFileBinaryConnection(edge, nodes)) return;
  if (nodes.length >= 500 || edges.length > 998) throw new Error("Adding a binary cast would exceed the workflow node or connection limit.");
  if (nodes.some(node => node.id === castId) || edges.some(existing => existing.id === `${castId}:input` || existing.id === edge.id))
    throw new Error("Binary cast IDs must be unique.");
  const source = nodes.find(node => node.id === edge.source)!;
  const center = { x: (source.position.x + 360 + target.position.x) / 2, y: (source.position.y + target.position.y) / 2 + 40 };
  const cast = placeUtilityNode({ id: castId, type: "cast" as const, position: center, data: { targetType: "Binary" as const } }, nodes,
    { x: center.x - 110, y: center.y - 40, width: 220, height: 80 });
  return { nodes: [...nodes, cast], edges: [...edges,
    { id: `${castId}:input`, kind: "mapping", source: edge.source, sourceHandle: "value", target: castId, targetHandle: "value" },
    { ...edge, source: castId, sourceHandle: "result" }] };
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
        label: `${name} · ${node.data.label}`.slice(0, 200), ...(node.data.array ? { array: node.data.array } : {}), fields: fields.map((field, index) => ({ ...field,
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
