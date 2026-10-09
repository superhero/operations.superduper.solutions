<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import HintButton from "$lib/components/HintButton.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import type { WorkspaceMode } from "$lib/workspace.d.ts";

  let { mode, onMode }: { mode: WorkspaceMode; onMode: (mode: WorkspaceMode) => void } = $props();
  const workspaces: { mode: WorkspaceMode; label: string; icon: string }[] = [
    { mode: "operations", label: "Operations", icon: "terminal_2" },
    { mode: "workflow", label: "Workflows", icon: "workflow" },
    { mode: "settings", label: "Settings", icon: "settings" }
  ];
  const selectedIndex = $derived(workspaces.findIndex(workspace => workspace.mode === mode));
</script>

<div class="workspace-selector" role="group" aria-label="Workspace" data-mode={mode}>
  <span class="workspace-thumb" style:transform={`translateX(${selectedIndex * 100}%)`} aria-hidden="true"></span>
  {#each workspaces as workspace (workspace.mode)}
    <HintButton class="workspace-option" type="button" label={workspace.label} aria-label={workspace.label}
      aria-pressed={mode === workspace.mode} onclick={() => onMode(workspace.mode)}>
      <MaterialIcon name={workspace.icon} />
    </HintButton>
  {/each}
</div>

<style>
  .workspace-selector { position: relative; display: flex; flex-shrink: 0; width: calc(3 * var(--navigation-control-size, 44px)); height: var(--navigation-control-size, 44px); border-radius: 4px; background: var(--color-muted); }
  .workspace-thumb { position: absolute; inset: 0 auto auto 0; width: var(--navigation-control-size, 44px); height: var(--navigation-control-size, 44px); border-radius: 4px 0 0 4px; background: var(--color-primary); pointer-events: none; transition: transform 180ms ease-in, background-color 180ms ease-in, border-radius 180ms ease-in; }
  .workspace-selector[data-mode="workflow"] .workspace-thumb { border-radius: 0; }
  .workspace-selector[data-mode="settings"] .workspace-thumb { border-radius: 0 4px 4px 0; }
  .workspace-selector :global(.workspace-option) { position: relative; display: grid; place-items: center; flex: 0 0 var(--navigation-control-size, 44px); width: var(--navigation-control-size, 44px); height: var(--navigation-control-size, 44px); padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--color-chip-foreground); outline: 3px solid transparent; outline-offset: 3px; transform: scale(1); transition: color 180ms ease-in, outline-color 180ms ease-in, transform 180ms ease-in; }
  .workspace-selector :global(.workspace-option[aria-pressed="true"]) { color: var(--color-primary-foreground); }
  .workspace-selector :global(.workspace-option:focus-visible) { z-index: 1; outline-color: var(--color-ring); }
  @media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
    .workspace-selector :global(.workspace-option:not(:disabled):not([inert] *)) { will-change: transform; }
    .workspace-selector :global(.workspace-option:hover:not(:disabled):not([inert] *)) { transform: scale(min(1.10, var(--hover-scale, 1.10))); }
  }
  @media (prefers-reduced-motion: reduce) {
    .workspace-thumb, .workspace-selector :global(.workspace-option) { transition: none; }
  }
</style>
