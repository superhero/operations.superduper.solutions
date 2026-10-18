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
export const toolbarButtonNames = Object.keys(toolbarButtonLabels) as ToolbarButton[];
export const defaultToolbarButtons = Object.fromEntries(toolbarButtonNames.map(key => [key, true])) as ToolbarButtons;
export function normalizeToolbarButtons(value: unknown): ToolbarButtons {
  const saved = value && typeof value === "object" ? value as Partial<ToolbarButtons> : {};
  return Object.fromEntries(toolbarButtonNames.map(key => [key, typeof saved[key] === "boolean" ? saved[key] : true])) as ToolbarButtons;
}
