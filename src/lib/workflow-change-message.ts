// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import type { SwitchGate, WorkflowDocument, WorkflowDocumentEdge, WorkflowDocumentNode } from "./workflow-document.ts";
import { switchOperators } from "./workflow-utilities.ts";

const excerpt = (value: string, limit = 72): string => {
  const text = value.trim().replace(/\s+/g, " ");
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
};
const quote = (value: string): string => `“${excerpt(value)}”`;
const list = (values: string[]): string => values.slice(0, 3).join(", ") +
  (values.length > 3 ? ` and ${values.length - 3} more` : "");
const type = (node: WorkflowDocumentNode): string => node.type ?? "operation";
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

function labels(document: WorkflowDocument)
{
  const nodes = new Map(document.nodes.map(node => [node.id, node]));
  const parents = new Map<string, string>();
  for (const edge of document.edges)
  {
    if (edge.kind !== "schema") continue;
    const source = nodes.get(edge.source);
    const input = source?.type === "data" && source.data.direction === "inputs";
    parents.set(input ? edge.source : edge.target, input ? edge.target : edge.source);
  }
  const nodeLabel = (node: WorkflowDocumentNode): string => {
    if (node.type === "data")
    {
      const owner = nodes.get(node.data.ownerId);
      const panel = node.data.label.replace(/ parameters$/i, "");
      return `${owner ? nodeLabel(owner) : "Operation"} · ${node.data.direction === "inputs" ? "Input" : "Output"} · ${excerpt(panel)}`;
    }
    const peers = document.nodes.filter(other => {
      if (type(other) !== type(node)) return false;
      if (node.type === undefined || node.type === "operation")
        return (other.type === undefined || other.type === "operation") && other.data.operationId === node.data.operationId;
      if (node.type === "workflow") return other.type === "workflow" && other.data.workflowId === node.data.workflowId;
      return true;
    });
    const ordinal = peers.length > 1 ? ` #${peers.findIndex(other => other.id === node.id) + 1}` : "";
    if (node.type === undefined || node.type === "operation") return `${quote(node.data.name)}${ordinal}`;
    if (node.type === "workflow") return `Workflow ${quote(node.data.name)}${ordinal}`;
    if (node.type === "comment") return `Comment${ordinal}${node.data.text.trim() ? ` ${quote(node.data.text)}` : ""}`;
    return `${node.type === "switch" ? "Switch" : "Cast"}${ordinal}`;
  };
  const endpoint = (id: string, handle?: string): string => {
    const node = nodes.get(id);
    if (!node) return "Node";
    const label = nodeLabel(node);
    if (!handle) return label;
    if (node.type === "data")
    {
      const field = node.data.fields.find(field => field.id === handle);
      return field ? `${label} · ${excerpt(field.label)}` : label;
    }
    if (node.type === "switch")
    {
      const gateId = handle.startsWith("gate-value:") ? handle.slice("gate-value:".length) : handle;
      const index = node.data.gates.findIndex(gate => gate.id === gateId);
      if (index >= 0) return `${label} · Gate ${index + 1}${handle.startsWith("gate-value:") ? " value" : ""}`;
      return `${label} · Input`;
    }
    if (node.type === "cast") return `${label} · ${handle === "result" ? "Result" : "Input"}`;
    return label;
  };
  return { nodes, parents, node: nodeLabel,
    connection: (edge: WorkflowDocumentEdge) => `${endpoint(edge.source, edge.sourceHandle)} to ${endpoint(edge.target, edge.targetHandle)}` };
}

function gateDescription(gate: SwitchGate): string
{
  const operator = switchOperators.find(option => option.value === gate.operator)?.label ?? gate.operator;
  return `${operator}${gate.operator === "is_set" || gate.operator === "is_not_set" ? "" : ` ${quote(gate.value)}`}`;
}

// Snapshot comparisons exclude canvas preferences and viewport, including inside nested workflows.
function content(document: WorkflowDocument): unknown
{
  return { name: document.name, description: document.description ?? "", nodes: document.nodes.map(node => ({
    id: node.id, type: type(node), position: node.position, hidden: !!node.hidden,
    data: node.type === "workflow" ? { ...node.data, snapshot: content(node.data.snapshot) } : node.data
  })), edges: document.edges };
}

/** Describe a saved content change without exposing generated node or handle IDs. */
export function describeWorkflowChange(before: WorkflowDocument | null, after: WorkflowDocument): string
{
  const next = labels(after);
  const previous = labels(before ?? { ...after, nodes: [], edges: [] });
  const actions: string[] = [];
  const groups = new Map<string, string[]>();
  const add = (verb: string, label: string): void => {
    const values = groups.get(verb) ?? [];
    values.push(label);
    groups.set(verb, values);
  };
  if (!before) actions.push(`Create workflow ${quote(after.name)}`);
  else
  {
    if (before.name !== after.name) actions.push(`Rename workflow from ${quote(before.name)} to ${quote(after.name)}`);
    if ((before.description ?? "") !== (after.description ?? "")) actions.push("Update workflow description");
  }
  const added = new Set(after.nodes.filter(node => !previous.nodes.has(node.id)).map(node => node.id));
  const removed = new Set((before?.nodes ?? []).filter(node => !next.nodes.has(node.id)).map(node => node.id));
  for (const node of after.nodes)
    if (added.has(node.id) && !(node.type === "data" && added.has(node.data.ownerId))) add("Add", next.node(node));
  for (const node of before?.nodes ?? [])
    if (removed.has(node.id) && !(node.type === "data" && removed.has(node.data.ownerId))) add("Remove", previous.node(node));

  const hidden = new Set<string>();
  const shown = new Set<string>();
  for (const node of after.nodes)
  {
    const old = previous.nodes.get(node.id);
    if (old && !!node.hidden !== !!old.hidden) (node.hidden ? hidden : shown).add(node.id);
  }
  const hasChangedAncestor = (id: string, changed: Set<string>): boolean => {
    const seen = new Set<string>();
    for (let parent = next.parents.get(id); parent && !seen.has(parent); parent = next.parents.get(parent))
    {
      if (changed.has(parent)) return true;
      seen.add(parent);
    }
    return false;
  };
  for (const node of after.nodes)
  {
    const old = previous.nodes.get(node.id);
    if (!old) continue;
    const label = next.node(node);
    if (hidden.has(node.id) && !hasChangedAncestor(node.id, hidden)) add("Hide", label);
    if (shown.has(node.id) && !hasChangedAncestor(node.id, shown)) add("Show", label);
    const dx = node.position.x - old.position.x;
    const dy = node.position.y - old.position.y;
    if (dx || dy)
    {
      const owner = node.type === "data" ? next.nodes.get(node.data.ownerId) : undefined;
      const oldOwner = owner && previous.nodes.get(owner.id);
      // Moving an operation and its panels together is one understandable action.
      if (!owner || !oldOwner || owner.position.x - oldOwner.position.x !== dx || owner.position.y - oldOwner.position.y !== dy)
        add("Move", label);
    }
    if (type(old) !== type(node)) { add("Replace node with", label); continue; }
    if (node.type === "comment" && old.type === "comment")
    {
      if (node.data.text !== old.data.text)
        add("Edit comment", `${previous.node(old).replace(/^Comment\s*/, "") || "text"} to ${node.data.text.trim() ? quote(node.data.text) : "empty text"}`);
    }
    else if (node.type === "cast" && old.type === "cast")
    {
      if (node.data.targetType !== old.data.targetType)
        add("Change", `${label} type from ${old.data.targetType} to ${node.data.targetType}`);
    }
    else if (node.type === "switch" && old.type === "switch")
    {
      const oldGates = new Map(old.data.gates.map(gate => [gate.id, gate]));
      const newGates = new Set(node.data.gates.map(gate => gate.id));
      for (const [index, gate] of node.data.gates.entries())
      {
        const oldGate = oldGates.get(gate.id);
        const gateLabel = `${label} · Gate ${index + 1}`;
        if (!oldGate) add("Add", `${gateLabel}: ${gateDescription(gate)}`);
        else if (gate.operator !== oldGate.operator || gate.value !== oldGate.value)
          add("Change", `${gateLabel} from ${gateDescription(oldGate)} to ${gateDescription(gate)}`);
      }
      for (const [index, gate] of old.data.gates.entries())
        if (!newGates.has(gate.id)) add("Remove", `${previous.node(old)} · Gate ${index + 1}: ${gateDescription(gate)}`);
      const retained = old.data.gates.filter(gate => newGates.has(gate.id)).map(gate => gate.id);
      if (!same(retained, node.data.gates.filter(gate => oldGates.has(gate.id)).map(gate => gate.id))) add("Reorder gates in", label);
    }
    else if (node.type === "workflow" && old.type === "workflow")
    {
      if (!same({ ...old.data, snapshot: content(old.data.snapshot) }, { ...node.data, snapshot: content(node.data.snapshot) }))
        add("Update nested workflow", label.replace(/^Workflow /, ""));
    }
    else if (node.type === "data" && old.type === "data")
    {
      const oldFields = new Map(old.data.fields.map(field => [field.id, field]));
      const newFields = new Set(node.data.fields.map(field => field.id));
      for (const field of node.data.fields)
      {
        const oldField = oldFields.get(field.id);
        if (!oldField) add("Add field", `${label} · ${excerpt(field.label)}`);
        else if (!same(oldField, field)) add("Update field", `${label} · ${excerpt(field.label)}`);
      }
      for (const field of old.data.fields)
        if (!newFields.has(field.id)) add("Remove field", `${previous.node(old)} · ${excerpt(field.label)}`);
      if (old.data.label !== node.data.label || old.data.direction !== node.data.direction || old.data.ownerId !== node.data.ownerId ||
        old.data.notice !== node.data.notice) add("Update", label);
      const retained = old.data.fields.filter(field => newFields.has(field.id)).map(field => field.id);
      if (!same(retained, node.data.fields.filter(field => oldFields.has(field.id)).map(field => field.id))) add("Reorder fields in", label);
    }
    else if (!same(old.data, node.data)) add("Update operation", label);
  }

  const oldEdges = new Map((before?.edges ?? []).map(edge => [edge.id, edge]));
  const newEdges = new Map(after.edges.map(edge => [edge.id, edge]));
  const endpoints = (edge: WorkflowDocumentEdge) => [edge.source, edge.sourceHandle ?? "", edge.target, edge.targetHandle ?? "", edge.kind ?? ""];
  for (const edge of before?.edges ?? [])
  {
    if (edge.kind === "schema" || removed.has(edge.source) || removed.has(edge.target) || hidden.has(edge.source) || hidden.has(edge.target)) continue;
    const changed = newEdges.get(edge.id);
    if (!changed || !same(endpoints(edge), endpoints(changed))) add("Disconnect", previous.connection(edge));
  }
  for (const edge of after.edges)
  {
    if (edge.kind === "schema") continue;
    const old = oldEdges.get(edge.id);
    if (!old || !same(endpoints(old), endpoints(edge))) add("Connect", next.connection(edge));
  }
  for (const [verb, values] of groups) actions.push(`${verb} ${list(values)}`);
  return actions.length ? actions.join("; ") : "Save workflow";
}
