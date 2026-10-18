<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { defaultKeybindings, formatShortcut, shortcutActions, shortcutFromEvent, type Keybindings, type SelectionModifier } from "$lib/keybindings.ts";

  let { value, onValueChange, error = "", onRetry }: {
    value: Keybindings; onValueChange: (next: Keybindings) => void; error?: string; onRetry: () => void;
  } = $props();
  let recording = $state<keyof Keybindings | null>(null);
  let notice = $state("");
  const labels = { undo: "Undo", redo: "Redo", selectAll: "Select all", deleteSelection: "Delete selection", newWorkflow: "New workflow", openWorkflow: "Open workflow", runWorkflow: "Run workflow", history: "History", copy: "Copy selection", cut: "Cut selection", paste: "Paste", nodeSelection: "Add node to selection", areaSelection: "Add area to selection" };
  const actions = [...shortcutActions, "nodeSelection", "areaSelection"] as const;
  function capture(event: KeyboardEvent, action: keyof Keybindings) {
    if (recording !== action || event.key === "Tab") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") { recording = null; notice = ""; return; }
    if (action === "nodeSelection" || action === "areaSelection") {
      const modifier: SelectionModifier | null = event.key === "Shift" ? "Shift" : event.key === "Control" || event.key === "Meta" ? "Mod" : event.key === "Alt" ? "Alt" : null;
      if (!modifier) { notice = "Press Shift, Ctrl/Cmd or Alt/Option. Escape cancels."; return; }
      notice = "";
      recording = null;
      onValueChange({ ...value, [action]: modifier });
      return;
    }
    const shortcut = shortcutFromEvent(event);
    if (!shortcut) { notice = "Press Delete, Backspace, or Ctrl/Cmd or Alt with a letter or number. Escape cancels."; return; }
    const conflict = shortcutActions.find(other => other !== action && value[other] === shortcut);
    if (conflict) { notice = `Already assigned to ${labels[conflict]}. Choose another shortcut.`; return; }
    notice = "";
    recording = null;
    onValueChange({ ...value, [action]: shortcut });
  }
</script>

<fieldset aria-label="Keybindings preferences">
  <div class="options">
    {#each actions as action}
      <div class="option">
        <span id={`keybinding-${action}`}>{labels[action]}</span>
        <button type="button" aria-label={`${labels[action]} ${action === "nodeSelection" || action === "areaSelection" ? "modifier" : "shortcut"}`} aria-describedby={`keybinding-${action}`}
          aria-pressed={recording === action} onclick={() => { recording = action; notice = ""; }}
          onkeydown={event => capture(event, action)} onblur={() => { recording = null; notice = ""; }}>
          {recording === action ? "Press keys…" : `${formatShortcut(value[action])}${action === "nodeSelection" ? " + click" : action === "areaSelection" ? " + drag" : ""}`}
        </button>
      </div>
    {/each}
  </div>
  <p class="notice" role="status">{notice}</p>
  {#if error}<div role="alert"><p>{error}</p><button type="button" onclick={onRetry}>Retry saving</button></div>{/if}
  <button type="button" onclick={() => { recording = null; notice = ""; onValueChange({ ...defaultKeybindings }); }}>Reset keybindings</button>
</fieldset>

<style>
  fieldset { min-width: 0; margin: 0; padding: 16px; border: 0; color: var(--color-foreground); }
  p { margin: 0 0 12px; font-size: 12px; }
  .options { display: grid; gap: 6px; margin-bottom: 12px; }
  .option { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; min-width: 0; padding: 2px 2px 2px 10px; border-radius: 4px; background: var(--color-surface); }
  .option > span { font-size: 12px; font-weight: 700; }
  button { min-height: 36px; padding: 8px 12px; border: 0; border-radius: 4px; background: var(--color-background); color: var(--color-foreground); font-size: 12px; font-weight: 700; transition: scale 180ms ease-in-out; }
  .option button { box-sizing: border-box; width: 176px; height: 36px; padding: 6px 8px; white-space: nowrap; }
  button:hover { scale: 1.03; }
  .notice:empty { display: none; }
  @media (prefers-reduced-motion: reduce) { button { transition: none; } }
</style>
