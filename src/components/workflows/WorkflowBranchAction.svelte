<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { Position } from "@xyflow/svelte";
  import HintButton from "$lib/components/HintButton.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";

  let { label, position, top = "50%", disabled = false, class: className = "", onclick }: {
    label: string;
    position: Position;
    top?: string;
    beside?: boolean;
    disabled?: boolean;
    class?: string;
    onclick: () => void;
  } = $props();

  function blockPointer(event: MouseEvent | TouchEvent) { event.stopPropagation(); }
</script>

<HintButton tooltipSide={position} type="button"
  class={`workflow-branch-action ${className} nodrag nopan nokey`} data-side={position}
  style={`top: ${top}`} {label} {disabled}
  onmousedown={blockPointer} ontouchstart={blockPointer} ondblclick={blockPointer}
  onclick={event => { event.stopPropagation(); onclick(); }}>
  <MaterialIcon name="add_location" size={18} />
</HintButton>

<style>
  :global(button.workflow-branch-action) { position: absolute; z-index: 2; display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--color-primary); --branch-action-shadow-color: var(--color-badge-background); text-shadow: -1px 0 0 var(--branch-action-shadow-color), 1px 0 0 var(--branch-action-shadow-color), 0 -1px 0 var(--branch-action-shadow-color), 0 1px 0 var(--branch-action-shadow-color); transform: translate(-50%, -50%); transition: color 180ms ease-in, text-shadow 180ms ease-in, outline-color 180ms ease-in; }
  :global(.workflow-branch-action[data-side="left"]) { left: -28px; }
  :global(.workflow-branch-action[data-side="right"]) { right: -28px; transform: translate(50%, -50%); }
  :global(.workflow-branch-action[data-side="top"]), :global(.workflow-branch-action[data-side="bottom"]) { left: 50%; }
  :global(.workflow-branch-action:disabled) { background: transparent; }
  :global(.workflow-branch-action .material-symbols-rounded) { font-variation-settings: "FILL" 1; scale: 1; transition: scale 180ms ease-in; }
  :global(.workflow-branch-action[data-side="left"] .material-symbols-rounded) { transform: rotate(-90deg); }
  :global(.workflow-branch-action[data-side="right"] .material-symbols-rounded) { transform: rotate(90deg); }
  :global(.workflow-branch-action[data-side="bottom"] .material-symbols-rounded) { transform: rotate(180deg); }
  @media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
    :global(.workflow-branch-action:hover:not(:disabled) .material-symbols-rounded) { scale: min(1.16, var(--hover-scale, 1.16)); }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(button.workflow-branch-action), :global(.workflow-branch-action .material-symbols-rounded) { transition: none; }
  }
</style>
