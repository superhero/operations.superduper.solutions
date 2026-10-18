// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
export const toolbarButtonLabels = {
  "browse": "Browse operations",
  "switch": "Switch",
  "cast": "Cast",
  "vault": "Add vault variable",
  "file": "Add file",
  "comment": "Comment",
  "copy": "Copy selection",
  "cut": "Cut selection",
  "paste": "Paste",
  "delete": "Remove selected",
  "dashed": "Dashed connections",
  "curved": "Curved connections",
  "snap": "Snap to grid",
  "zoomIn": "Zoom in",
  "zoomOut": "Zoom out",
  "fit": "Fit View",
  "undo": "Undo",
  "redo": "Redo",
  "history": "Workflow history",
  "new": "New workflow",
  "open": "Open workflow",
  "details": "Workflow details",
  "import": "Import workflow",
  "export": "Export workflow",
  "run": "Run workflow"
} as const;
export type ToolbarButton = keyof typeof toolbarButtonLabels;
export type ToolbarButtons = Record<ToolbarButton, boolean>;
export const toolbarButtonGroups = [
  { label: "Nodes", buttons: ["browse", "switch", "cast", "vault", "file", "comment"] },
  { label: "Clipboard", buttons: ["copy", "cut", "paste", "delete"] },
  { label: "Connections", buttons: ["dashed", "curved", "snap"] },
  { label: "View", buttons: ["zoomIn", "zoomOut", "fit"] },
  { label: "History", buttons: ["undo", "redo", "history"] },
  { label: "Workflows", buttons: ["new", "open", "details", "import", "export"] },
  { label: "Run", buttons: ["run"] }
] as const satisfies readonly { label: string; buttons: readonly ToolbarButton[] }[];
export const toolbarButtonNames = Object.keys(toolbarButtonLabels) as ToolbarButton[];
const initiallyHidden = new Set<ToolbarButton>([
  "zoomIn", "zoomOut", ...toolbarButtonGroups[1].buttons, ...toolbarButtonGroups[2].buttons
]);
export const defaultToolbarButtons = Object.fromEntries(toolbarButtonNames.map(key => [key, !initiallyHidden.has(key)])) as ToolbarButtons;
export function normalizeToolbarButtons(value: unknown): ToolbarButtons {
  const saved = value && typeof value === "object" ? value as Partial<ToolbarButtons> : {};
  return Object.fromEntries(toolbarButtonNames.map(key => [key, typeof saved[key] === "boolean" ? saved[key] : defaultToolbarButtons[key]])) as ToolbarButtons;
}
