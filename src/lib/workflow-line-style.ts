// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

export const workflowLineStyles = ["orthogonal", "filleted", "bezier", "clutter", "flowing"] as const;
export type WorkflowLineStyle = typeof workflowLineStyles[number];
export const workflowLineStyleLabels: Record<WorkflowLineStyle, string> = {
  orthogonal: "Orthogonal", filleted: "Filleted", bezier: "Bézier", clutter: "Clutter", flowing: "Flowing",
};

export function isWorkflowLineStyle(value: unknown): value is WorkflowLineStyle {
  return value === "orthogonal" || value === "filleted" || value === "bezier" || value === "clutter" || value === "flowing";
}

/** Documents without a named style retain their existing appearance. */
export function workflowLineStyle(value: { lineStyle?: unknown; curved: boolean }): WorkflowLineStyle {
  return isWorkflowLineStyle(value.lineStyle) ? value.lineStyle : value.curved ? "filleted" : "orthogonal";
}
