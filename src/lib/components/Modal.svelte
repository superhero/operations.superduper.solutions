<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { Dialog, mergeProps } from "bits-ui";
  import type { Snippet } from "svelte";
  import HintButton from "./HintButton.svelte";
  import MaterialIcon from "./MaterialIcon.svelte";
  let { open = $bindable(false), title, description, children, initialFocus, onCloseAutoFocus, onEscapeKeydown }:
    { open: boolean; title: string; description?: string; children: Snippet;
      initialFocus?: () => HTMLElement | null | undefined; onCloseAutoFocus?: (event: Event) => void;
      onEscapeKeydown?: (event: KeyboardEvent) => void } = $props();
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="modal-overlay" />
    <Dialog.Content class="modal-content" onOpenAutoFocus={(event) => {
      const target = initialFocus?.();
      if (target) { event.preventDefault(); target.focus(); }
    }} onCloseAutoFocus={(event) => onCloseAutoFocus?.(event)} onEscapeKeydown={(event) => onEscapeKeydown?.(event)}>
      <header><Dialog.Title class="modal-title">{title}</Dialog.Title>
        <Dialog.Close>
          {#snippet child({ props: closeProps })}
            <HintButton label={`Close ${title}`} aria-label="Close">
              {#snippet child({ props: hintProps })}
                <button {...mergeProps(closeProps, hintProps)} class="modal-close"><MaterialIcon name="close_small" size={28} /></button>
              {/snippet}
            </HintButton>
          {/snippet}
        </Dialog.Close></header>
      {#if description}<Dialog.Description class="hint modal-description">{description}</Dialog.Description>{/if}
      {@render children()}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
