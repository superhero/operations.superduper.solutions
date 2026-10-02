<script lang="ts">
  import MenuIcon from "@lucide/svelte/icons/menu";
  import { Button } from "$lib/components/ui/button/index.js";

  let {
    open,
    onclick
  }: {
    open: boolean;
    onclick: () => void;
  } = $props();
</script>

<Button
  class="menu-button"
  variant="ghost"
  size="icon"
  aria-label={open ? "Close navigation" : "Open navigation"}
  aria-expanded={open}
  aria-controls="side-navigation"
  {onclick}
>
  <MenuIcon aria-hidden="true" />
</Button>

<style>
  :global(.menu-button) {
    width: 2.5rem;
    height: 2.5rem;
    background: transparent;
    color: var(--color-foreground);
  }

  :global(.menu-button:hover) {
    background: color-mix(
      in srgb,
      var(--color-surface) 30%,
      transparent
    );
    color: var(--color-foreground);
  }
</style>
