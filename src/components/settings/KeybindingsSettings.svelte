<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import FieldSelect from "$lib/components/FieldSelect.svelte";
  import { defaultKeybindings, formatShortcut, shortcutActions, shortcutFromEvent, type Keybindings, type ShortcutAction, type SelectionModifier } from "$lib/keybindings.ts";

  let { value, onValueChange, error = "", onRetry }: {
    value: Keybindings; onValueChange: (next: Keybindings) => void; error?: string; onRetry: () => void;
  } = $props();
  let recording = $state<ShortcutAction | null>(null);
  let notice = $state("");
  const labels = { undo: "Undo", redo: "Redo", selectAll: "Select all" };
  const modifiers = [{ value: "Shift", label: "Shift" }, { value: "Mod", label: "Ctrl/Cmd" }, { value: "Alt", label: "Alt/Option" }];
  function capture(event: KeyboardEvent, action: ShortcutAction) {
    if (recording !== action || event.key === "Tab") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") { recording = null; notice = ""; return; }
    const shortcut = shortcutFromEvent(event);
    if (!shortcut) { notice = "Use Ctrl/Cmd or Alt with a letter or number. Escape cancels."; return; }
    const conflict = shortcutActions.find(other => other !== action && value[other] === shortcut);
    if (conflict) { notice = `Already assigned to ${labels[conflict]}. Choose another shortcut.`; return; }
    notice = "";
    recording = null;
    onValueChange({ ...value, [action]: shortcut });
  }
</script>

<fieldset aria-label="Keybindings preferences">
  <p>Choose a shortcut, then press its replacement. Ctrl/Cmd works with either Control or Command. Text fields keep their editing shortcuts.</p>
  <div class="options">
    {#each shortcutActions as action}
      <div class="option">
        <span id={`keybinding-${action}`}>{labels[action]}</span>
        <button type="button" aria-label={`${labels[action]} shortcut`} aria-describedby={`keybinding-${action}`}
          aria-pressed={recording === action} onclick={() => { recording = action; notice = ""; }}
          onkeydown={event => capture(event, action)} onblur={() => { recording = null; notice = ""; }}>
          {recording === action ? "Press shortcut…" : formatShortcut(value[action])}
        </button>
      </div>
    {/each}
    <div class="option">
      <label for="keybinding-node">Add node to selection</label>
      <FieldSelect id="keybinding-node" label="Add node to selection modifier" value={value.nodeSelection} options={modifiers} includePlaceholder={false}
        onValueChange={modifier => onValueChange({ ...value, nodeSelection: modifier as SelectionModifier })}/>
      <small>Hold while clicking a node. Click again to remove it.{value.nodeSelection === "Shift" ? " Ctrl/Cmd-click also adds to selection." : ""}</small>
    </div>
    <div class="option">
      <label for="keybinding-area">Add area to selection</label>
      <FieldSelect id="keybinding-area" label="Add area to selection modifier" value={value.areaSelection} options={modifiers} includePlaceholder={false}
        onValueChange={modifier => onValueChange({ ...value, areaSelection: modifier as SelectionModifier })}/>
      <small>Hold while dragging over empty canvas to add covered nodes.</small>
    </div>
  </div>
  {#if value.redo === defaultKeybindings.redo}<p>Ctrl/Cmd + Shift + Z also redoes, unless assigned to another action.</p>{/if}
  <p class="notice" role="status">{notice}</p>
  {#if error}<div role="alert"><p>{error}</p><button type="button" onclick={onRetry}>Retry saving</button></div>{/if}
  <button type="button" onclick={() => { recording = null; notice = ""; onValueChange({ ...defaultKeybindings }); }}>Reset keybindings</button>
</fieldset>

<style>
  fieldset { min-width: 0; margin: 0; padding: 16px; border: 0; container-type: inline-size; color: var(--color-foreground); }
  p { margin: 0 0 12px; font-size: 12px; }
  .options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-bottom: 12px; }
  .option { display: grid; align-content: start; gap: 8px; min-width: 0; padding: 10px; border-radius: 4px; background: var(--color-surface); --field-background: var(--color-background); --field-foreground: var(--color-foreground); }
  .option > span, label { font-size: 12px; font-weight: 700; }
  small { font-size: 11px; }
  button { min-height: 36px; padding: 8px 12px; border: 0; border-radius: 4px; background: var(--color-background); color: var(--color-foreground); font-size: 12px; font-weight: 700; transition: scale 180ms ease-in-out; }
  button:hover { scale: 1.03; }
  :global(.field-select-trigger) { border-radius: 4px; font-size: 12px; }
  .notice:empty { display: none; }
  @container (max-width: 430px) { .options { grid-template-columns: 1fr; } }
  @media (prefers-reduced-motion: reduce) { button { transition: none; } }
</style>
