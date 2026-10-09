<script lang="ts">
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";

  let {
    open,
    onclick
  }: {
    open: boolean;
    onclick: () => void;
  } = $props();
</script>

<button
  class="menu-button"
  type="button"
  aria-label={open ? "Close navigation" : "Open navigation"}
  aria-expanded={open}
  aria-controls="side-navigation"
  {onclick}
>
  <MaterialIcon name={open ? "menu_open" : "menu"} />
</button>

<style>
  :global(.menu-button) {
    display: inline-grid;
    place-items: center;
    padding: 0;
    width: var(--navigation-control-size);
    height: var(--navigation-control-size);
    border-radius: 4px;
    background: var(--color-primary);
    color: var(--color-primary-foreground);
  }

  :global(.menu-button:hover) {
    background: var(--color-primary);
    color: var(--color-primary-foreground);
  }
</style>
