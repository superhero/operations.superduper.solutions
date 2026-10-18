// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
export const shortcutActions = ["undo", "redo", "selectAll", "deleteSelection", "newWorkflow", "openWorkflow", "runWorkflow", "history", "copy", "cut", "paste"] as const;
export type ShortcutAction = typeof shortcutActions[number];
export type SelectionModifier = "Shift" | "Mod" | "Alt";
export type Keybindings = Record<ShortcutAction, string> & { nodeSelection: SelectionModifier; areaSelection: SelectionModifier };
export const defaultKeybindings: Readonly<Keybindings> = {
  undo: "Mod+z", redo: "Mod+y", selectAll: "Mod+a", deleteSelection: "Delete", newWorkflow: "Mod+n", openWorkflow: "Mod+o", runWorkflow: "Mod+r", history: "Mod+h", copy: "Mod+c", cut: "Mod+x", paste: "Mod+v", nodeSelection: "Shift", areaSelection: "Shift"
};
type Modifiers = { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean };

/** Mod is portable: either Control or Command, without requiring both. */
export function shortcutFromEvent(event: Modifiers & { key: string; isComposing?: boolean; getModifierState?: (key: string) => boolean }): string | null {
  if (event.isComposing || event.getModifierState?.("AltGraph") || event.ctrlKey && event.metaKey) return null;
  if (["Delete", "Backspace"].includes(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) return "Delete";
  const key = event.key.toLowerCase();
  if (!/^[a-z0-9]$/.test(key) || !(event.ctrlKey || event.metaKey || event.altKey)) return null;
  return [event.ctrlKey || event.metaKey ? "Mod" : "", event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : "", key].filter(Boolean).join("+");
}
function validShortcut(value: unknown): value is string {
  return value === "Delete" || typeof value === "string" && /^(?:Mod\+(?:Alt\+)?|Alt\+)(?:Shift\+)?[a-z0-9]$/.test(value);
}
export function normalizeKeybindings(value: unknown): Keybindings {
  const saved = value && typeof value === "object" ? value as Partial<Keybindings> : {};
  const result = { ...defaultKeybindings };
  for (const action of shortcutActions) if (validShortcut(saved[action])) result[action] = saved[action];
  // Never leave two actions assigned to the same shortcut, including partial saved data.
  if (new Set(shortcutActions.map(action => result[action])).size !== shortcutActions.length)
    for (const action of shortcutActions) result[action] = defaultKeybindings[action];
  for (const action of ["nodeSelection", "areaSelection"] as const)
    if (["Shift", "Mod", "Alt"].includes(saved[action] ?? "")) result[action] = saved[action]!;
  return result;
}
export function shortcutAction(event: Parameters<typeof shortcutFromEvent>[0], bindings: Keybindings): ShortcutAction | null {
  const shortcut = shortcutFromEvent(event);
  const action = shortcutActions.find(action => bindings[action] === shortcut);
  if (action) return action;
  // Preserve the familiar alternative while the default Redo binding is selected.
  return bindings.redo === defaultKeybindings.redo && shortcut === "Mod+Shift+z" ? "redo" : null;
}
export function modifierKeys(modifier: SelectionModifier): string[] {
  return modifier === "Mod" ? ["Control", "Meta"] : [modifier];
}
export function modifierPressed(event: Modifiers, modifier: SelectionModifier): boolean {
  return modifier === "Mod" ? event.ctrlKey || event.metaKey : modifier === "Alt" ? event.altKey : event.shiftKey;
}
export function formatShortcut(shortcut: string): string {
  if (shortcut === "Delete") return "Delete / Backspace";
  return shortcut.split("+").map(key => key === "Mod" ? "Ctrl/Cmd" : key.toUpperCase().length === 1 ? key.toUpperCase() : key).join(" + ");
}
