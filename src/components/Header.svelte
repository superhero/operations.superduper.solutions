<script lang="ts">
  import MenuButton from "./MenuButton.svelte";

  let {
    navigationOpen,
    onMenu
  }: {
    navigationOpen: boolean;
    onMenu: () => void;
  } = $props();
</script>

<header class="app-header">
  <MenuButton open={navigationOpen} onclick={onMenu} />
  <strong>operations</strong>
</header>

<style>
  .app-header {
    position: fixed;
    z-index: 30;
    top: 0;
    right: 0;
    left: 0;
    display: flex;
    height: var(--app-header-height);
    align-items: center;
    gap: 0.5rem;
    padding: 0 0.75rem;
    border-bottom: 1px solid color-mix(
      in srgb,
      var(--color-surface) 56%,
      var(--color-background)
    );
    background: color-mix(
      in srgb,
      var(--color-background) 90%,
      var(--color-surface)
    );
  }

  strong {
    color: var(--color-foreground);
    font-size: 1rem;
    font-weight: 800;
    letter-spacing: 0.01em;
  }
</style>
