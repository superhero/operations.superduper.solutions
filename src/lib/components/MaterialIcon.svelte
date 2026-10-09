<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  let { name, size, class: className }: { name: string; size?: number; class?: string } = $props();
  // Match product terminology to the icon font's fixed glyph name.
  const symbol = $derived(name === "workflow" ? "flowchart" : name);
</script>

<span class={["material-symbols-rounded", className]} style:font-size={size === undefined ? undefined : `${size}px`} aria-hidden="true">{symbol}</span>
