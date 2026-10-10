<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { getContext } from "svelte";
  import { Position } from "@xyflow/svelte";
  import HintButton from "$lib/components/HintButton.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";

  let { branch, position, top = "50%", beside = false }: {
    branch: { childId: string; label: string };
    position: Position;
    top?: string;
    beside?: boolean;
  } = $props();
  const restore = getContext<(childId: string) => void>("workflow-restore-branch");

  function blockPointer(event: MouseEvent | TouchEvent) { event.stopPropagation(); }
  function restoreBranch(event: MouseEvent) {
    event.stopPropagation();
    restore(branch.childId);
  }
</script>

<HintButton type="button" class="workflow-restore-branch nodrag nopan nokey" data-side={position}
  data-beside={beside} style={`top: ${top}`} label={`Restore ${branch.label}`} title={`Restore ${branch.label}`}
  onmousedown={blockPointer} ontouchstart={blockPointer} ondblclick={blockPointer} onclick={restoreBranch}>
  <MaterialIcon name={beside ? "add_location" : "add_box"} size={18} />
</HintButton>

<style>
  :global(.workflow-restore-branch) { position: absolute; z-index: 2; display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-background); color: var(--color-foreground); transform: translate(-50%, -50%); transition: background-color 180ms ease-in, color 180ms ease-in, outline-color 180ms ease-in; }
  :global(.workflow-restore-branch[data-side="left"]) { left: 0; }
  :global(.workflow-restore-branch[data-side="right"]) { right: 0; transform: translate(50%, -50%); }
  :global(.workflow-restore-branch[data-side="top"]), :global(.workflow-restore-branch[data-side="bottom"]) { left: 50%; }
  :global(.workflow-restore-branch[data-side="right"][data-beside="true"]) { right: -28px; }
  :global(.workflow-restore-branch:hover) { background: var(--color-secondary-hover); color: var(--color-secondary-hover-foreground); }
  :global(.workflow-restore-branch .material-symbols-rounded) { font-variation-settings: "FILL" 1; }
  @media (prefers-reduced-motion: reduce) { :global(.workflow-restore-branch) { transition: none; } }
</style>
