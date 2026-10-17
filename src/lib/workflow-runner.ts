// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import { operations, type InputField, type InputSchema, type JsonValue, type Operation } from "./catalog.ts";
import { additionalBodyField, inputAllowsNull, InputValidationError, validateInputValue, type InputValues } from "./operation-input.ts";
import { validateWorkflowDocument, type WorkflowDocument, type WorkflowDocumentNode, type WorkflowField } from "./workflow-document.ts";
import { castValue, isFileRowConnection, matchingSwitchGates } from "./workflow-utilities.ts";
import { createWorkflowExecution, type WorkflowExecutionResult, type WorkflowResponse, type WorkflowExecutor } from "./workflow-execution.ts";
import { responseHeaderReader } from "./workflow-response.ts";
import { isVaultVariableReference, vaultVariablePlaceholder, type VaultVariableInput } from "./secrets/variables.ts";
import { approvedOperation } from "./secrets/policy.ts";
import { workflowExecutionForOperation } from "./workflow-execution.ts";
import { VaultError, type CredentialBinding } from "./secrets/types.ts";

type Node = WorkflowDocumentNode;
type DataNode = Extract<Node, { type: "data" }>;
type Owner = Exclude<Node, { type: "data" | "switch" | "cast" | "comment" | "vault" | "file" }>;
type OperationNode = Exclude<Owner, { type: "workflow" }>;
type RoutingNode = Extract<Node, { type: "switch" | "cast" }>;
type State = "idle" | "queued" | "running" | "complete" | "skipped";
type Contribution = { state: "pending" | "inactive" | "value"; value?: unknown };
type Frame = {
  document: WorkflowDocument; nodes: Map<string, Node>; owners: Owner[]; values: Map<string, unknown>;
  edges: WorkflowDocument["edges"]; contributions: Map<string, Contribution>; states: Map<string, State>;
  rows?: { index: number; count: number; start?: string; active?: Set<string> };
  queue: string[]; started: boolean; parent: Frame | undefined; call: Owner | undefined;
};
export type WorkflowVisit = {
  kind: "operation"; id: string; nodeId: string; workflowName: string; operation: Operation;
  values: InputValues; mappedFields: string[]; step: number;
  credentialBinding?: CredentialBinding;
  vaultVariables?: VaultVariableInput[];
  bindingPath: string[];
};
export type WorkflowStep = WorkflowVisit | { kind: "choice"; workflowName: string; choices: { id: string; label: string }[] }
  | { kind: "complete"; message: string };
export type WorkflowExecution = WorkflowExecutionResult & { operation: Operation; step: number; workflowName: string };
const port = (node: string, handle: string) => JSON.stringify([node, handle]);
const inactive = Symbol("inactive branch");
const inputTypes: Partial<Record<WorkflowField["type"], InputSchema["type"]>> = {
  Text: "string", Integer: "integer", Number: "number", Boolean: "boolean", Object: "object", Array: "array", Null: "null"
};
const isStaticSource = (frame: Frame, nodeId: string) => {
  const node = frame.nodes.get(nodeId);
  return node?.type === "vault" || node?.type === "file" || node?.type === "data" && frame.nodes.get(node.data.ownerId)?.type === "file";
};
const isOwner = (node: Node): node is Owner => node.type === undefined || node.type === "operation" || node.type === "workflow";
const dataNodes = (frame: Frame, owner: string, direction: "inputs" | "outputs") =>
  frame.document.nodes.filter((node): node is DataNode => node.type === "data" && !node.hidden && node.data.ownerId === owner && node.data.direction === direction);

function decodedIdentity(id: string): [string, string[]] | undefined
{
  try
  {
    const value: unknown = JSON.parse(decodeURIComponent(id));
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "string"
      && (value[1] === "" || value[1].startsWith("/")) && !/~(?:[^01]|$)/.test(value[1]))
      return [value[0], value[1] === "" ? [] : value[1].slice(1).split("/").map(part => part.replace(/~1/g, "/").replace(/~0/g, "~"))];
  }
  catch { /* Use a recoverable error for unsupported imported fields. */ }
}

function identity(field: WorkflowField): [string, string[]]
{
  const value = decodedIdentity(field.id);
  if (value) return value;
  throw new Error(`The saved field “${field.label}” has an unsupported path. Add this operation again before running it.`);
}

const responseStatus = (group: string) => /^(?:response|output):([1-5](?:\d\d|XX)|default)(?::|$)/i.exec(group)?.[1]?.toUpperCase();

function selectedResponseStatus(frame: Frame, owner: string, status: number): string
{
  const declared = new Set<string>();
  // Hidden response branches still determine exact/range/default precedence.
  for (const panel of frame.document.nodes)
  {
    if (panel.type !== "data" || panel.data.ownerId !== owner || panel.data.direction !== "outputs") continue;
    const groups = panel.data.fields.map(field => decodedIdentity(field.id)?.[0]);
    if (panel.id.startsWith(`${owner}:`)) groups.push(decodedIdentity(panel.id.slice(owner.length + 1))?.[0]);
    for (const group of groups) if (group) { const key = responseStatus(group); if (key) declared.add(key); }
  }
  const exact = String(status);
  const range = `${Math.floor(status / 100)}XX`;
  return declared.has(exact) ? exact : declared.has(range) ? range : "DEFAULT";
}

function read(value: unknown, path: string[]): unknown
{
  if (!path.length) return value;
  const [head, ...tail] = path;
  if ((head === "items" || head === "*") && Array.isArray(value)) return value.map(item => read(item, tail));
  return value !== null && typeof value === "object" && Object.hasOwn(value, head!)
    ? read((value as Record<string, unknown>)[head!], tail) : undefined;
}

function readResponse(response: WorkflowResponse, path: string[], headers?: ReturnType<typeof responseHeaderReader>): unknown
{
  if (path[0] === "headers")
  {
    if (headers) return read(headers(path[1]), path.slice(2));
    if (path.length === 1) return response.headers;
    const key = Object.keys(response.headers).find(name => name.toLowerCase() === path[1]!.toLowerCase());
    return key === undefined ? undefined : read(response.headers[key], path.slice(2));
  }
  return read(response, path);
}

function mappedOutput(frame: Frame, nodeId: string, fieldId: string): boolean
{
  if (frame.edges.some(edge => edge.source === nodeId && edge.sourceHandle === fieldId)) return true;
  if (!frame.parent || !frame.call) return false;
  return dataNodes(frame.parent, frame.call.id, "outputs").some(panel => panel.data.fields.some(field =>
    field.endpoint?.nodeId === nodeId && field.endpoint.fieldId === fieldId && mappedOutput(frame.parent!, panel.id, field.id)));
}

function mappedFragment(path: string[], value: unknown, arrays: Set<string>, parent: string[]): unknown
{
  if (!path.length) return value;
  const [head, ...tail] = path;
  if ((head === "items" || head === "*") && arrays.has(JSON.stringify(parent)))
  {
    if (!Array.isArray(value)) throw new Error("A connected array item path needs an array value. Check its connection.");
    return value.map(item => mappedFragment(tail, item, arrays, [...parent, head]));
  }
  return { [head!]: mappedFragment(tail, value, arrays, [...parent, head!]) };
}

function mergeMapped(previous: unknown, next: unknown): unknown
{
  if (previous === undefined) return structuredClone(next);
  if (previous !== null && next !== null && typeof previous === "object" && typeof next === "object"
    && Array.isArray(previous) === Array.isArray(next))
  {
    const merged = structuredClone(previous) as Record<string, unknown>;
    for (const [key, value] of Object.entries(next))
      Object.defineProperty(merged, key, { value: mergeMapped(Object.hasOwn(merged, key) ? merged[key] : undefined, value),
        enumerable: true, writable: true, configurable: true });
    return merged;
  }
  if (JSON.stringify(previous) !== JSON.stringify(next)) throw new Error("Connected fields supply conflicting values to the same structured input.");
  return previous;
}

function createFrame(document: WorkflowDocument, parent?: Frame, call?: Owner, rowIndex = 0): Frame
{
  const nodes = new Map(document.nodes.map(node => [node.id, node]));
  const edges = document.edges.filter(edge => edge.kind !== "schema" && !edge.hidden && !edge.detached
    && !nodes.get(edge.source)?.hidden && !nodes.get(edge.target)?.hidden);
  const hasRows = edges.some(edge => isFileRowConnection(edge, document.nodes, document.edges));
  return { document, nodes, owners: document.nodes.filter(node => !node.hidden && isOwner(node)) as Owner[],
    values: new Map(), edges, contributions: new Map(edges.map(edge => [edge.id, { state: "pending" }])),
    states: new Map(document.nodes.map(node => [node.id, "idle"])), queue: [], started: false, parent, call,
    ...(hasRows ? { rows: { index: rowIndex, count: 1 } } : {}) };
}

const fileProjectionCache = new WeakMap<Node, Map<string, unknown>>();
function fileProjection(owner: Extract<Node, { type: "file" }>, field: WorkflowField): unknown {
  let cache = fileProjectionCache.get(owner);
  if (!cache) { cache = new Map(); fileProjectionCache.set(owner, cache); }
  if (!cache.has(field.id)) cache.set(field.id, read(owner.data.file!.value, identity(field)[1]));
  return cache.get(field.id);
}

/** Only arrays feeding the selected path participate; independent roots stay independent. */
function rowCount(frame: Frame, start: string): { count: number; active: Set<string> } {
  const relevant = new Set([start]);
  for (const id of relevant) for (const edge of frame.edges) {
    const sourceOwner = targetOwner(frame, edge.source);
    if (sourceOwner === id) relevant.add(targetOwner(frame, edge.target));
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of frame.edges) {
      const source = frame.nodes.get(edge.source)!;
      if (relevant.has(targetOwner(frame, edge.target)) && ["switch", "cast"].includes(source.type!) && !relevant.has(source.id)) {
        relevant.add(source.id); changed = true;
      }
    }
  }
  const counts = new Set<number>();
  for (const edge of frame.edges.filter(edge => relevant.has(targetOwner(frame, edge.target)) &&
    isFileRowConnection(edge, frame.document.nodes, frame.document.edges))) {
    const panel = frame.nodes.get(edge.source)! as DataNode;
    const owner = frame.nodes.get(panel.data.ownerId)! as Extract<Node, { type: "file" }>;
    const projected = fileProjection(owner, panel.data.fields.find(field => field.id === edge.sourceHandle)!);
    if (!Array.isArray(projected)) throw new Error("An Item connection requires uploaded array data.");
    counts.add(projected.length);
  }
  if (counts.size > 1) throw new Error("Connected file arrays must have the same number of rows to run together.");
  return { count: [...counts][0] ?? 1, active: relevant };
}

function targetOwner(frame: Frame, target: string): string
{
  const node = frame.nodes.get(target)!;
  return node.type === "data" ? node.data.ownerId : node.id;
}

function incoming(frame: Frame, id: string)
{
  return frame.edges.filter(edge => targetOwner(frame, edge.target) === id);
}

function inputs(frame: Frame, id: string): { ready: boolean; inactive: boolean; inactivePorts: Set<string>; values: Map<string, unknown> }
{
  const grouped = new Map<string, Contribution[]>();
  for (const edge of incoming(frame, id))
  {
    const key = port(edge.target, edge.targetHandle ?? "");
    grouped.set(key, [...(grouped.get(key) ?? []), frame.contributions.get(edge.id)!]);
  }
  const values = new Map<string, unknown>();
  let ready = true;
  let inactive = false;
  const inactivePorts = new Set<string>();
  for (const [key, contributions] of grouped)
  {
    if (contributions.some(item => item.state === "pending")) { ready = false; continue; }
    const supplied = contributions.filter(item => item.state === "value");
    if (!supplied.length) { inactive = true; inactivePorts.add(key); }
    else
    {
      if (supplied.some(item => JSON.stringify(item.value) !== JSON.stringify(supplied[0]!.value)))
        throw new Error("Several connections supply different values to the same input. Keep one source or route them through a Switch.");
      values.set(key, supplied[0]!.value);
    }
  }
  return { ready, inactive, inactivePorts, values };
}

/** A step-driven runner: only submit sends an operation request. */
export function createWorkflowRunner(value: WorkflowDocument, startingNodeId?: string,
  execution: WorkflowExecutor = createWorkflowExecution())
{
  const document = validateWorkflowDocument(value);
  const runId = crypto.randomUUID();
  const stack: Frame[] = [createFrame(document)];
  let current: { frame: Frame; node: Owner; visit: WorkflowVisit } | undefined;
  let choice: { frame: Frame; ids: string[] } | undefined;
  let step = 0;
  let iterationStartStep = 0;
  let stopped = false;
  let terminalError: string | undefined;
  let message = "Workflow complete.";
  let pending: AbortController | undefined;

  function queue(frame: Frame, id: string)
  {
    if (!frame.started && frame.rows) {
      frame.rows.start = id;
      Object.assign(frame.rows, rowCount(frame, id));
      if (!frame.rows.count) return;
    }
    frame.states.set(id, "queued");
    frame.queue.push(id);
  }

  function emit(frame: Frame, nodeId: string, handle: string, value: unknown)
  {
    const key = port(nodeId, handle);
    if (value !== inactive) frame.values.set(key, isStaticSource(frame, nodeId) ? value : structuredClone(value));
    for (const edge of frame.edges.filter(edge => edge.source === nodeId && (edge.sourceHandle ?? "") === handle))
    {
      const ownerId = targetOwner(frame, edge.target);
      if (value !== inactive && frame.states.get(ownerId) === "complete")
        throw new Error("This workflow loops back to a completed operation. Remove the cycle before running it again.");
      let rowValue = value;
      if (frame.rows && (!frame.rows.active || frame.rows.active.has(targetOwner(frame, edge.target))) &&
        isFileRowConnection(edge, frame.document.nodes, frame.document.edges) && value !== inactive) {
        if (!Array.isArray(value)) throw new Error("An Item connection requires uploaded array data.");
        rowValue = frame.rows.index < value.length ? value[frame.rows.index] : inactive;
      }
      frame.contributions.set(edge.id, rowValue === inactive ? { state: "inactive" } : { state: "value", value: structuredClone(rowValue) });
    }
  }

  function outputs(frame: Frame, node: Owner, response?: WorkflowResponse, child?: Frame)
  {
    const selectedStatus = response && selectedResponseStatus(frame, node.id, response.status);
    const headers = response && node.type !== "workflow" ? responseHeaderReader(node.data.operationId, response.status, response.headers) : undefined;
    for (const panel of dataNodes(frame, node.id, "outputs")) for (const field of panel.data.fields)
    {
      let value: unknown = inactive;
      if (child && field.endpoint)
      {
        const key = port(field.endpoint.nodeId, field.endpoint.fieldId);
        if (child.values.has(key)) value = child.values.get(key);
      }
      else if (response && field.connectable)
      {
        const [group, path] = identity(field);
        if (responseStatus(group) === selectedStatus)
          value = group.startsWith("response:") ? readResponse(response, path, mappedOutput(frame, panel.id, field.id) ? headers : undefined)
            : read(response.body, path);
      }
      emit(frame, panel.id, field.id, value);
    }
    emit(frame, node.id, "", response || child ? true : inactive);
  }

  function settle(frame: Frame)
  {
    for (const node of frame.document.nodes) {
      if (node.type === "file" && !node.hidden && frame.states.get(node.id) === "idle") {
        frame.states.set(node.id, "complete");
        if (node.data.file) {
          emit(frame, node.id, "value", node.data.file.value);
          for (const panel of dataNodes(frame, node.id, "outputs")) for (const field of panel.data.fields)
            emit(frame, panel.id, field.id, field.connectable ? fileProjection(node, field) : inactive);
        }
      }
      if (node.type !== "vault" || node.hidden || frame.states.get(node.id) !== "idle") continue;
      if (!node.data.credentialId && frame.edges.some(edge => edge.source === node.id))
        throw new Error("Select a vault entry for each connected vault variable before running the workflow.");
      frame.states.set(node.id, "complete");
      if (node.data.credentialId) emit(frame, node.id, "value", { vaultVariable: node.data.credentialId, referenceToken: runId });
    }
    // Constant sources are available even when the user explicitly starts at an operation.
    for (const edge of frame.edges) {
      const contribution = frame.contributions.get(edge.id)!;
      if (isStaticSource(frame, edge.source) && contribution.state === "value")
        frame.values.set(port(edge.target, edge.targetHandle!), contribution.value);
    }
    // Each pass consumes idle nodes. Nodes never become idle again during a run.
    while (true)
    {
      let changed = false;
      for (const node of frame.document.nodes.filter((node): node is Owner | RoutingNode =>
        isOwner(node) || node.type === "switch" || node.type === "cast"))
      {
        if (node.hidden || frame.states.get(node.id) !== "idle" || !incoming(frame, node.id).length ||
          frame.rows?.active && !frame.rows.active.has(node.id)) continue;
        const input = inputs(frame, node.id);
        if (!input.ready) continue;
        for (const [key, value] of input.values) frame.values.set(key, value);
        if (isOwner(node) && (!frame.started || !incoming(frame, node.id).some(edge => !isStaticSource(frame, edge.source)))) continue;
        changed = true;
        if (isOwner(node))
        {
          if (input.inactive) { frame.states.set(node.id, "skipped"); outputs(frame, node); }
          else queue(frame, node.id);
          continue;
        }
        frame.states.set(node.id, "complete");
        const value = input.values.get(port(node.id, "value"));
        const mainInactive = input.inactivePorts.has(port(node.id, "value"));
        if (node.type === "switch" && !mainInactive && !input.values.has(port(node.id, "value")))
          throw new Error("Switch needs a connected input value.");
        if (node.type === "cast") emit(frame, node.id, "result", input.inactive ? inactive : castValue(value, node.data.targetType));
        else
        {
          const operands = new Map<string, unknown>();
          for (const gate of node.data.gates)
          {
            const key = port(node.id, `gate-value:${gate.id}`);
            if (input.values.has(key) || input.inactivePorts.has(key)) operands.set(gate.id, input.values.get(key));
          }
          const gates = mainInactive ? [] : matchingSwitchGates(value, node.data.gates, undefined, operands);
          for (const gate of node.data.gates) emit(frame, node.id, gate.id, gates.includes(gate.id) ? value : inactive);
        }
      }
      if (!changed) return;
    }
  }

  function visit(frame: Frame, node: OperationNode): WorkflowVisit
  {
    const canonical = operations.find(operation => operation.id === node.data.operationId
      && operation.method === node.data.method && operation.path === node.data.path);
    if (!canonical) throw new Error(`“${node.data.name}” is unavailable in the registered schemas. Add an available operation before running it.`);
    const operation = { ...canonical, fields: [...canonical.fields] };
    const values: InputValues = {};
    const mappedFields: string[] = [];
    const vaultVariables: VaultVariableInput[] = [];
    const mapped = new Map<InputField, unknown>();
    const arrayPaths = new Map<string, Set<string>>();
    for (const panel of dataNodes(frame, node.id, "inputs")) for (const field of panel.data.fields)
    {
      try
      {
        const [group, path] = identity(field);
        if (group === "input:body" && path.length === 1 && field.connectable && inputTypes[field.type]
          && !operation.fields.some(input => input.location === "body" && input.name === path[0]))
        {
          const input = additionalBodyField(operation, path[0]!, inputTypes[field.type]!);
          if (input) operation.fields.push(input);
        }
        if (field.type === "Array")
        {
          const arrays = arrayPaths.get(group) ?? new Set<string>();
          arrays.add(JSON.stringify(path));
          arrayPaths.set(group, arrays);
        }
      }
      catch { /* Unsupported saved paths are diagnosed only when connected. */ }
    }
    if (operation.bodySchema?.type === "array")
    {
      const arrays = arrayPaths.get("input:body") ?? new Set<string>();
      arrays.add("[]");
      arrayPaths.set("input:body", arrays);
    }
    for (const panel of dataNodes(frame, node.id, "inputs")) for (const field of panel.data.fields)
    {
      const key = port(panel.id, field.id);
      if (!frame.values.has(key)) continue;
      const [group, path] = identity(field);
      const input = operation.fields.find(input => group === `input:${input.location}`
        && (operation.bodyValue && input.location === "body" || input.name === path[0]));
      if (!input) throw new Error(`The mapped field “${field.label}” is unsupported by this operation.`);
      const value = frame.values.get(key);
      if (value === undefined) continue;
      const tail = operation.bodyValue && input.location === "body" ? path : path.slice(1);
      mapped.set(input, mergeMapped(mapped.get(input), mappedFragment(tail, value, arrayPaths.get(group) ?? new Set(),
        operation.bodyValue && input.location === "body" ? [] : path.slice(0, 1))));
    }
    for (const [input, raw] of mapped)
    {
      const collect = (value: unknown, path: string[]): unknown => {
        if (isVaultVariableReference(value, runId)) {
          vaultVariables.push({ key: input.key, path, credentialId: value.vaultVariable });
          return vaultVariablePlaceholder;
        }
        if (Array.isArray(value)) return value.map((entry, index) => collect(entry, [...path, String(index)]));
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, collect(entry, [...path, key])]));
        return value;
      };
      const value = collect(raw, []);
      const expected = input.type === "integer" ? "number" : input.type;
      const matches = value === null ? inputAllowsNull(input) : expected === "array" ? Array.isArray(value)
        : typeof value === expected && (expected !== "object" || value !== null && !Array.isArray(value));
      if (!matches || typeof value === "number" && (!Number.isFinite(value) || input.type === "integer" && !Number.isInteger(value)))
        throw new Error(`“${input.label}” needs ${input.type === "integer" ? "an integer" : `a ${input.type}`} value. Check its connection or add a Cast.`);
      if (!vaultVariables.some(variable => variable.key === input.key)) validateInputValue(input, value as JsonValue);
      Object.defineProperty(values, input.key, { value: value === null ? null : typeof value === "object" ? JSON.stringify(value) : String(value),
        enumerable: true, writable: true, configurable: true });
      mappedFields.push(input.key);
    }
    const bindingPath = [node.id];
    for (let ancestor = frame; ancestor.parent && ancestor.call; ancestor = ancestor.parent) bindingPath.unshift(ancestor.call.id);
    return { kind: "operation", id: `${++step}:${node.id}`, nodeId: node.id, workflowName: frame.document.name, bindingPath,
      operation, values, mappedFields, step,
      ...(vaultVariables.length ? { vaultVariables } : {}),
      ...(node.data.credentialBinding ? { credentialBinding: structuredClone(node.data.credentialBinding) } : {}) };
  }

  function choose(id: string)
  {
    if (!choice || !choice.ids.includes(id)) throw new Error("Choose one of the available starting operations.");
    queue(choice.frame, id);
    choice.frame.started = true;
    choice = undefined;
  }

  if (startingNodeId !== undefined)
  {
    const frame = stack[0]!;
    if (!frame.owners.some(node => node.id === startingNodeId)) throw new Error("The selected starting operation is unavailable.");
    if (frame.rows?.count !== 0) queue(frame, startingNodeId);
    frame.started = true;
  }

  function next(): WorkflowStep
  {
    if (terminalError) throw new Error(terminalError);
    if (stopped) return { kind: "complete", message };
    if (current) return current.visit;
    try
    {
      // Validated snapshots have finite depth; frames only advance or finish.
      while (true)
      {
        const frame = stack.at(-1);
        if (!frame) { stopped = true; return { kind: "complete", message }; }
        settle(frame);
        if (!frame.started)
        {
          const roots = frame.owners.filter(node => !incoming(frame, node.id).some(edge => !isStaticSource(frame, edge.source)));
          const candidates = roots.length ? roots : frame.owners;
          if (!candidates.length) throw new Error("This workflow has no operations to run. Add an operation first.");
          if (candidates.length > 1)
          {
            choice = { frame, ids: candidates.map(node => node.id) };
            const counts = new Map<string, number>();
            return { kind: "choice", workflowName: frame.document.name, choices: candidates.map(node => {
              const name = node.data.name;
              const number = (counts.get(name) ?? 0) + 1;
              counts.set(name, number);
              return { id: node.id, label: `${name}${candidates.filter(candidate => candidate.data.name === name).length > 1 ? ` ${number}` : ""}` };
            }) };
          }
          queue(frame, candidates[0]!.id);
          frame.started = true;
        }
        const id = frame.queue.shift();
        if (id)
        {
          const node = frame.nodes.get(id)! as Owner;
          const input = inputs(frame, id);
          for (const [key, value] of input.values) frame.values.set(key, value);
          if (frame.rows && input.ready && input.inactive) {
            frame.states.set(id, "skipped"); outputs(frame, node); continue;
          }
          frame.states.set(id, "running");
          if (node.type === "workflow")
          {
            const child = createFrame(node.data.snapshot, frame, node);
            for (const panel of dataNodes(frame, node.id, "inputs")) for (const field of panel.data.fields)
            {
              const key = port(panel.id, field.id);
              if (field.endpoint && frame.values.has(key))
                child.values.set(port(field.endpoint.nodeId, field.endpoint.fieldId), frame.values.get(key));
            }
            stack.push(child);
            continue;
          }
          if (step - iterationStartStep >= 200) throw new Error("The workflow exceeded 200 operation steps. End this run and simplify the workflow.");
          const result = visit(frame, node);
          current = { frame, node, visit: result };
          return result;
        }
        const waiting = frame.edges.some(edge => !isStaticSource(frame, edge.source) && frame.contributions.get(edge.id)!.state === "value"
          && frame.states.get(targetOwner(frame, edge.target)) === "idle");
        if (waiting) throw new Error("The next operation is waiting for an unresolved branch or a routing cycle. Check its incoming connections.");
        if (frame.rows && frame.rows.index + 1 < frame.rows.count) {
          const next = createFrame(frame.document, frame.parent, frame.call, frame.rows.index + 1);
          queue(next, frame.rows.start!);
          next.started = true;
          iterationStartStep = step;
          stack[stack.length - 1] = next;
          continue;
        }
        stack.pop();
        if (frame.parent && frame.call)
        {
          frame.parent.states.set(frame.call.id, "complete");
          outputs(frame.parent, frame.call, undefined, frame);
        }
      }
    }
    catch (error)
    {
      terminalError = (error as Error).message;
      throw error;
    }
  }

  return {
    next, choose,
    async submit(values: InputValues, binding?: CredentialBinding | null): Promise<WorkflowExecution>
    {
      if (!current || stopped || terminalError) throw new Error("There is no operation ready to run.");
      if (pending) throw new Error("This operation already has a request in progress.");
      for (const key of current.visit.mappedFields)
        if (values[key] !== current.visit.values[key]) throw new InputValidationError(key, "Connected values cannot be changed during a run. Update the workflow connection first.");
      const completed = current;
      const controller = new AbortController();
      pending = controller;
      let result: WorkflowExecutionResult;
      // An explicit UI clear must not fall back to a previously saved credential.
      const selectedBinding = binding === null ? undefined : binding ?? completed.visit.credentialBinding;
      try {
        const variables = completed.visit.vaultVariables;
        const binding = selectedBinding ?? (variables?.length && !completed.visit.operation.security?.length
          ? { alternative: 0, credentials: {}, fingerprint: (await approvedOperation(operations.find(operation => operation.id === completed.visit.operation.id)!, workflowExecutionForOperation(completed.visit.operation).origin)).fingerprint } : undefined);
        result = await execution.execute(completed.visit.operation, values, controller.signal,
          binding ? { binding, runId, nodeId: completed.visit.id, ...(variables ? { variables } : {}) } : undefined);
      }
      finally { pending = undefined; }
      if (stopped || current !== completed) throw new Error("This run has ended.");
      if (controller.signal.aborted) throw new Error("The request was cancelled.");
      current = undefined;
      completed.frame.states.set(completed.node.id, "complete");
      // Output routing happens after a successful response. A routing error
      // must never make the completed operation available for an accidental retry.
      try {
        if (result.response.redacted) throw new VaultError("REDACTED");
        outputs(completed.frame, completed.node, result.response);
      }
      catch (error) { terminalError = (error as Error).message; }
      return { ...result, operation: completed.visit.operation, step: completed.visit.step, workflowName: completed.visit.workflowName };
    },
    cancelPending() { pending?.abort(); },
    end() { stopped = true; pending?.abort(); current = undefined; choice = undefined; terminalError = undefined; stack.length = 0; message = "Run ended."; },
    get done() { return stopped; }
  };
}
