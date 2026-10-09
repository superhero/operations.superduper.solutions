// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import { operations, type InputField, type JsonValue, type Operation } from "./catalog.ts";
import { InputValidationError, validateInputValue } from "./operation-input.ts";
import { validateWorkflowDocument, type WorkflowDocument, type WorkflowDocumentNode, type WorkflowField } from "./workflow-document.ts";
import { castValue, matchingSwitchGates } from "./workflow-utilities.ts";
import { createWorkflowExecution, type WorkflowExecutionResult, type WorkflowResponse, type WorkflowExecutor } from "./workflow-execution.ts";

type Node = WorkflowDocumentNode;
type DataNode = Extract<Node, { type: "data" }>;
type Owner = Exclude<Node, { type: "data" | "switch" | "cast" | "comment" }>;
type OperationNode = Exclude<Owner, { type: "workflow" }>;
type RoutingNode = Extract<Node, { type: "switch" | "cast" }>;
type State = "idle" | "queued" | "running" | "complete" | "skipped";
type Contribution = { state: "pending" | "inactive" | "value"; value?: unknown };
type Frame = {
  document: WorkflowDocument; nodes: Map<string, Node>; owners: Owner[]; values: Map<string, unknown>;
  edges: WorkflowDocument["edges"]; contributions: Map<string, Contribution>; states: Map<string, State>;
  queue: string[]; started: boolean; parent: Frame | undefined; call: Owner | undefined;
};
export type WorkflowVisit = {
  kind: "operation"; id: string; nodeId: string; workflowName: string; operation: Operation;
  values: Record<string, string>; mappedFields: string[]; step: number;
};
export type WorkflowStep = WorkflowVisit | { kind: "choice"; workflowName: string; choices: { id: string; label: string }[] }
  | { kind: "complete"; message: string };
export type WorkflowExecution = WorkflowExecutionResult & { operation: Operation; step: number; workflowName: string };
const port = (node: string, handle: string) => JSON.stringify([node, handle]);
const inactive = Symbol("inactive branch");
const isOwner = (node: Node): node is Owner => node.type === undefined || node.type === "operation" || node.type === "workflow";
const dataNodes = (frame: Frame, owner: string, direction: "inputs" | "outputs") =>
  frame.document.nodes.filter((node): node is DataNode => node.type === "data" && !node.hidden && node.data.ownerId === owner && node.data.direction === direction);

function identity(field: WorkflowField): [string, string[]]
{
  try
  {
    const value: unknown = JSON.parse(decodeURIComponent(field.id));
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "string"
      && (value[1] === "" || value[1].startsWith("/")) && !/~(?:[^01]|$)/.test(value[1]))
      return [value[0], value[1] === "" ? [] : value[1].slice(1).split("/").map(part => part.replace(/~1/g, "/").replace(/~0/g, "~"))];
  }
  catch { /* Use a recoverable error for unsupported imported fields. */ }
  throw new Error(`The saved field “${field.label}” has an unsupported path. Add this operation again before running it.`);
}

function read(value: unknown, path: string[]): unknown
{
  if (!path.length) return value;
  const [head, ...tail] = path;
  if ((head === "items" || head === "*") && Array.isArray(value)) return value.map(item => read(item, tail));
  return value !== null && typeof value === "object" && Object.hasOwn(value, head!)
    ? read((value as Record<string, unknown>)[head!], tail) : undefined;
}

function mappedFragment(path: string[], value: unknown): unknown
{
  if (!path.length) return value;
  const [head, ...tail] = path;
  if (head === "items" || head === "*")
  {
    if (!Array.isArray(value)) throw new Error("A connected array item path needs an array value. Check its connection.");
    return value.map(item => mappedFragment(tail, item));
  }
  return { [head!]: mappedFragment(tail, value) };
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

function createFrame(document: WorkflowDocument, parent?: Frame, call?: Owner): Frame
{
  const nodes = new Map(document.nodes.map(node => [node.id, node]));
  const edges = document.edges.filter(edge => edge.kind !== "schema" && !edge.hidden && !edge.detached
    && !nodes.get(edge.source)?.hidden && !nodes.get(edge.target)?.hidden);
  return { document, nodes, owners: document.nodes.filter(node => !node.hidden && isOwner(node)) as Owner[],
    values: new Map(), edges, contributions: new Map(edges.map(edge => [edge.id, { state: "pending" }])),
    states: new Map(document.nodes.map(node => [node.id, "idle"])), queue: [], started: false, parent, call };
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
  const stack: Frame[] = [createFrame(document)];
  let current: { frame: Frame; node: Owner; visit: WorkflowVisit } | undefined;
  let choice: { frame: Frame; ids: string[] } | undefined;
  let step = 0;
  let stopped = false;
  let terminalError: string | undefined;
  let message = "Workflow complete.";
  let pending: AbortController | undefined;

  function queue(frame: Frame, id: string)
  {
    frame.states.set(id, "queued");
    frame.queue.push(id);
  }

  function emit(frame: Frame, nodeId: string, handle: string, value: unknown)
  {
    const key = port(nodeId, handle);
    if (value !== inactive) frame.values.set(key, structuredClone(value));
    for (const edge of frame.edges.filter(edge => edge.source === nodeId && (edge.sourceHandle ?? "") === handle))
    {
      const ownerId = targetOwner(frame, edge.target);
      if (value !== inactive && frame.states.get(ownerId) === "complete")
        throw new Error("This workflow loops back to a completed operation. Remove the cycle before running it again.");
      frame.contributions.set(edge.id, value === inactive ? { state: "inactive" } : { state: "value", value: structuredClone(value) });
    }
  }

  function outputs(frame: Frame, node: Owner, response?: WorkflowResponse, child?: Frame)
  {
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
        if (group === `output:${response.status}` || group.startsWith(`output:${response.status}:`)
          || /^output:2XX(?::|$)/i.test(group) && response.status >= 200 && response.status < 300)
          value = read(response.body, path);
      }
      emit(frame, panel.id, field.id, value);
    }
    emit(frame, node.id, "", response || child ? true : inactive);
  }

  function settle(frame: Frame)
  {
    // Each pass consumes idle nodes. Nodes never become idle again during a run.
    while (true)
    {
      let changed = false;
      for (const node of frame.document.nodes.filter((node): node is Owner | RoutingNode =>
        isOwner(node) || node.type === "switch" || node.type === "cast"))
      {
        if (node.hidden || frame.states.get(node.id) !== "idle" || !incoming(frame, node.id).length) continue;
        const input = inputs(frame, node.id);
        if (!input.ready) continue;
        for (const [key, value] of input.values) frame.values.set(key, value);
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
    const operation = operations.find(operation => operation.id === node.data.operationId
      && operation.method === node.data.method && operation.path === node.data.path);
    if (!operation) throw new Error(`“${node.data.name}” is unavailable in the bundled test catalog. Add an available operation before running it.`);
    const values: Record<string, string> = {};
    const mappedFields: string[] = [];
    const mapped = new Map<InputField, unknown>();
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
      mapped.set(input, mergeMapped(mapped.get(input), mappedFragment(tail, value)));
    }
    for (const [input, value] of mapped)
    {
      const expected = input.type === "integer" ? "number" : input.type;
      const matches = expected === "null" ? value === null : expected === "array" ? Array.isArray(value)
        : typeof value === expected && (expected !== "object" || value !== null && !Array.isArray(value));
      if (!matches || typeof value === "number" && (!Number.isFinite(value) || input.type === "integer" && !Number.isInteger(value)))
        throw new Error(`“${input.label}” needs ${input.type === "integer" ? "an integer" : `a ${input.type}`} value. Check its connection or add a Cast.`);
      validateInputValue(input, value as JsonValue);
      Object.defineProperty(values, input.key, { value: typeof value === "object" ? JSON.stringify(value) : String(value),
        enumerable: true, writable: true, configurable: true });
      mappedFields.push(input.key);
    }
    return { kind: "operation", id: `${++step}:${node.id}`, nodeId: node.id, workflowName: frame.document.name,
      operation, values, mappedFields, step };
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
    queue(frame, startingNodeId);
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
          const roots = frame.owners.filter(node => !incoming(frame, node.id).length);
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
          if (step >= 200) throw new Error("The workflow exceeded 200 operation steps. End this run and simplify the workflow.");
          const result = visit(frame, node);
          current = { frame, node, visit: result };
          return result;
        }
        const waiting = frame.edges.some(edge => frame.contributions.get(edge.id)!.state === "value"
          && frame.states.get(targetOwner(frame, edge.target)) === "idle");
        if (waiting) throw new Error("The next operation is waiting for an unresolved branch or a routing cycle. Check its incoming connections.");
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
    async submit(values: Record<string, string>): Promise<WorkflowExecution>
    {
      if (!current || stopped || terminalError) throw new Error("There is no operation ready to run.");
      if (pending) throw new Error("This operation already has a request in progress.");
      for (const key of current.visit.mappedFields)
        if (values[key] !== current.visit.values[key]) throw new InputValidationError(key, "Connected values cannot be changed during a run. Update the workflow connection first.");
      const completed = current;
      pending = new AbortController();
      let result: WorkflowExecutionResult;
      try { result = await execution.execute(completed.visit.operation, values, pending.signal); }
      finally { pending = undefined; }
      if (stopped || current !== completed) throw new Error("This run has ended.");
      current = undefined;
      completed.frame.states.set(completed.node.id, "complete");
      // Output routing happens after a successful response. A routing error
      // must never make the completed operation available for an accidental retry.
      try { outputs(completed.frame, completed.node, result.response); }
      catch (error) { terminalError = (error as Error).message; }
      return { ...result, operation: completed.visit.operation, step: completed.visit.step, workflowName: completed.visit.workflowName };
    },
    end() { stopped = true; pending?.abort(); current = undefined; choice = undefined; terminalError = undefined; stack.length = 0; message = "Run ended."; },
    get done() { return stopped; }
  };
}
