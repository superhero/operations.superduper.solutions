<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { Handle } from "@xyflow/svelte";
  import { mergeProps } from "bits-ui";
  import type { ComponentProps } from "svelte";
  import HintButton from "$lib/components/HintButton.svelte";

  let props: ComponentProps<typeof Handle> = $props();
</script>

<HintButton tooltipSide="left" tooltipAnchorSelector=".svelte-flow__node"
  label={props["aria-label"] ?? `${props.type} connection`} labelAsName={false} tabindex={-1}>
  {#snippet child({ props: tooltipProps })}
    <!-- Keep the graph handle ID and its built-in click-to-connect handler. -->
    {@const { id: _id, type: _type, disabled: _disabled, tabindex: _tabindex, onclick: _onclick, ...hintProps } = tooltipProps}
    <Handle {...props} {...mergeProps(hintProps, { ...props })} />
  {/snippet}
</HintButton>
