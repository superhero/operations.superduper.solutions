<script lang="ts">
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
  <span></span>
  <span></span>
  <span></span>
</button>

<style>
  .menu-button {
    display: grid;
    width: 2.5rem;
    height: 2.5rem;
    padding: 0.65rem;
    border: 0;
    border-radius: 0.55rem;
    background: transparent;
    cursor: pointer;
    place-content: center;
    gap: 0.24rem;
  }

  .menu-button:hover {
    background: color-mix(
      in srgb,
      var(--color-surface) 30%,
      transparent
    );
  }

  .menu-button:focus-visible {
    outline: 3px solid color-mix(
      in srgb,
      var(--color-foreground) 65%,
      transparent
    );
    outline-offset: 2px;
  }

  span {
    display: block;
    width: 1.15rem;
    height: 0.12rem;
    border-radius: 999px;
    background: var(--color-foreground);
  }
</style>
