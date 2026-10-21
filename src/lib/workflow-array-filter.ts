// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { WorkflowDocument, WorkflowDocumentEdge, WorkflowDocumentNode } from "./workflow-document.ts";
import { processingInputTypes } from "./workflow-processing.ts";
import { validateArrayPredicate, type ArrayPredicate } from "./workflow-array-predicate.ts";

export type ArrayFilterPlan = { predicate: ArrayPredicate; nodes: Set<string>; edges: Set<string>; captures: WorkflowDocumentEdge[] };
export const isArrayFilter = (node: WorkflowDocumentNode | undefined): boolean => node?.type === "filter" && node.data.operation === "array_filter";
export const isArrayFilterReturn = (node: WorkflowDocumentNode | undefined, handle: string | null | undefined): boolean => isArrayFilter(node) && (handle === "success" || handle === "failure");

/** Compile a scoped item pipeline. Ordinary graph cycles never become iteration. */
export function arrayFilterPlans(document: WorkflowDocument): Map<string, ArrayFilterPlan> {
  const byId = new Map(document.nodes.map(node => [node.id, node]));
  const edges = document.edges.filter(edge => edge.kind === "mapping" && !edge.hidden && !edge.detached && !byId.get(edge.source)?.hidden && !byId.get(edge.target)?.hidden);
  const plans = new Map<string, ArrayFilterPlan>();
  const owned = new Set<string>();
  for (const root of document.nodes.filter(node => !node.hidden && isArrayFilter(node))) {
    const item = edges.filter(edge => edge.source === root.id && edge.sourceHandle === "item");
    const returns = edges.filter(edge => edge.target === root.id && isArrayFilterReturn(root, edge.targetHandle));
    if (!item.length && !returns.length) continue;
    if (item.length !== 1 || returns.length !== 2 || new Set(returns.map(edge => edge.targetHandle)).size !== 2)
      throw new Error("Connect Filter array Item through Assert, then return both Success and Failure.");
    const nodes = new Set<string>(), internal = new Set<string>(), captures: WorkflowDocumentEdge[] = [];
    const steps: ArrayPredicate["steps"] = [];
    let current = item[0]!;
    let keep: ArrayPredicate["keep"] = "success";
    while (true) {
      if (current.targetHandle !== "value" || current.target === root.id || nodes.has(current.target) || owned.has(current.target) || steps.length >= 32)
        throw new Error("Array assertion paths must be separate, bounded processing paths.");
      const node = byId.get(current.target)!;
      if (node.type !== "cast" && node.type !== "transform" && node.type !== "filter" && node.type !== "assert" || isArrayFilter(node))
        throw new Error("An array item path supports Cast, Transform, Filter and a final Assert.");
      nodes.add(node.id); internal.add(current.id);
      const inputs = edges.filter(edge => edge.target === node.id);
      if (inputs.filter(edge => edge.targetHandle === "value").length !== 1) throw new Error("Each array assertion step needs one item input.");
      const bindings: Record<string, string> = {};
      for (const input of inputs.filter(edge => edge.targetHandle !== "value")) {
        if (node.type === "cast" || !processingInputTypes(node.type, node.data, input.targetHandle))
          throw new Error("Unsupported array assertion operand.");
        const capture = JSON.stringify([node.id, input.targetHandle]);
        if (Object.hasOwn(bindings, input.targetHandle!)) throw new Error("An array assertion operand needs one source.");
        bindings[input.targetHandle!] = capture;
        captures.push({ ...input, target: root.id, targetHandle: capture });
        internal.add(input.id);
      }
      if (node.type === "cast") steps.push({ type: "cast", targetType: node.data.targetType });
      else steps.push({ type: node.type, data: node.data, bindings });
      const outputs = edges.filter(edge => edge.source === node.id);
      if (node.type === "assert") {
        if (outputs.length !== 2 || returns.some(edge => edge.source !== node.id) || new Set(returns.map(edge => edge.sourceHandle)).size !== 2
          || returns.some(edge => edge.sourceHandle !== "success" && edge.sourceHandle !== "failure"))
          throw new Error("Return both outcomes of the same Assert to Filter array without leaving the item path.");
        keep = returns.find(edge => edge.targetHandle === "success")!.sourceHandle as ArrayPredicate["keep"];
        for (const edge of returns) internal.add(edge.id);
        break;
      }
      if (outputs.length !== 1 || outputs[0]!.sourceHandle !== "result") throw new Error("Each array item step must lead to its Assert without branching outside the filter.");
      current = outputs[0]!;
    }
    if (captures.some(edge => nodes.has(edge.source) || edge.source === root.id || isArrayFilter(byId.get(edge.source)) && edge.sourceHandle === "item"))
      throw new Error("Array assertion operands cannot depend on their own item path.");
    for (const node of nodes) owned.add(node);
    plans.set(root.id, { predicate: validateArrayPredicate({ steps, keep }), nodes, edges: internal, captures });
  }
  return plans;
}
