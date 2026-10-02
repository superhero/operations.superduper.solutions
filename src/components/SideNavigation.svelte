<script lang="ts">
  import * as Sheet from "$lib/components/ui/sheet/index.js";

  let {
    open = $bindable(false)
  }: {
    open: boolean;
  } = $props();
</script>

<Sheet.Root bind:open>
  <Sheet.Content
    id="side-navigation"
    class="navigation"
    side="left"
    aria-label="Navigation"
  >
    <Sheet.Header class="navigation-header">
      <Sheet.Title class="navigation-title">Navigation</Sheet.Title>
    </Sheet.Header>
  </Sheet.Content>
</Sheet.Root>

<style>
  :global([data-slot="sheet-overlay"]) {
    top: var(--app-header-height);
    background: color-mix(
      in srgb,
      var(--color-background) 48%,
      transparent
    );
  }

  :global(.navigation) {
    top: var(--app-header-height) !important;
    bottom: 0 !important;
    width: min(20rem, 86vw) !important;
    height: auto !important;
    max-width: none !important;
    gap: 0 !important;
    border-color: color-mix(
      in srgb,
      var(--color-surface) 56%,
      var(--color-background)
    ) !important;
    background: color-mix(
      in srgb,
      var(--color-background) 92%,
      var(--color-surface)
    ) !important;
    color: var(--color-foreground);
    box-shadow: 0.8rem 0 2rem
      color-mix(in srgb, var(--color-background) 55%, transparent) !important;
  }

  :global(.navigation-header) {
    min-height: 3.5rem;
    padding: 0.5rem 0.75rem 0.5rem 1rem;
  }

  :global(.navigation-title) {
    color: var(--color-foreground);
    font-size: 0.9rem;
  }

  :global(.navigation > button) {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 0.55rem;
    color: var(--color-foreground);
    opacity: 1;
  }

  :global(.navigation > button:hover) {
    background: color-mix(
      in srgb,
      var(--color-surface) 30%,
      transparent
    );
  }
</style>
