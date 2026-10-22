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

<HintButton tooltipSide="left" tooltipAnchorSelector=".svelte-flow__node" type="button"
  class={`workflow-branch-action ${className} nodrag nopan nokey`} data-side={position}
  style={`top: ${top}`} {label} {disabled}
  onmousedown={blockPointer} ontouchstart={blockPointer} ondblclick={blockPointer}
  onclick={event => { event.stopPropagation(); onclick(); }}>
  <MaterialIcon name="add_location" size={18} />
</HintButton>

<style>
  :global(.workflow-branch-action) { position: absolute; z-index: 2; display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-background); color: var(--color-foreground); transform: translate(-50%, -50%); transition: background-color 180ms ease-in, color 180ms ease-in, outline-color 180ms ease-in; }
  :global(.workflow-branch-action[data-side="left"]) { left: -28px; }
  :global(.workflow-branch-action[data-side="right"]) { right: -28px; transform: translate(50%, -50%); }
  :global(.workflow-branch-action[data-side="top"]), :global(.workflow-branch-action[data-side="bottom"]) { left: 50%; }
  :global(.workflow-branch-action:hover:not(:disabled)) { background: var(--color-secondary-hover); color: var(--color-secondary-hover-foreground); }
  :global(.workflow-branch-action .material-symbols-rounded) { font-variation-settings: "FILL" 1; }
  @media (prefers-reduced-motion: reduce) { :global(.workflow-branch-action) { transition: none; } }
</style>
