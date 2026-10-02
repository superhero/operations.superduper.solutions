<script lang="ts">
  import { fly } from "svelte/transition";

  let {
    open,
    onClose
  }: {
    open: boolean;
    onClose: () => void;
  } = $props();
</script>

{#if open}
  <button
    class="backdrop"
    type="button"
    aria-label="Close navigation"
    onclick={onClose}
  ></button>

  <aside
    id="side-navigation"
    class="navigation"
    aria-label="Navigation"
    transition:fly={{ x: -24, duration: 160 }}
  >
    <div class="navigation-header">
      <strong>Navigation</strong>
      <button
        class="close-button"
        type="button"
        aria-label="Close navigation"
        onclick={onClose}
      >
        <span aria-hidden="true">&times;</span>
      </button>
    </div>
  </aside>
{/if}

<style>
  .backdrop {
    position: fixed;
    z-index: 39;
    inset: var(--app-header-height) 0 0;
    border: 0;
    background: color-mix(
      in srgb,
      var(--color-background) 48%,
      transparent
    );
    cursor: default;
  }

  .navigation {
    position: fixed;
    z-index: 40;
    top: var(--app-header-height);
    bottom: 0;
    left: 0;
    width: min(20rem, 86vw);
    border-right: 1px solid color-mix(
      in srgb,
      var(--color-surface) 56%,
      var(--color-background)
    );
    background: color-mix(
      in srgb,
      var(--color-background) 92%,
      var(--color-surface)
    );
    box-shadow: 0.8rem 0 2rem
      color-mix(in srgb, var(--color-background) 55%, transparent);
  }

  .navigation-header {
    display: flex;
    min-height: 3.5rem;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem 0.75rem 0.5rem 1rem;
  }

  strong {
    color: var(--color-foreground);
    font-size: 0.9rem;
  }

  .close-button {
    display: grid;
    width: 2.5rem;
    height: 2.5rem;
    padding: 0;
    border: 0;
    border-radius: 0.55rem;
    background: transparent;
    color: var(--color-foreground);
    cursor: pointer;
    font-size: 1.75rem;
    line-height: 1;
    place-items: center;
  }

  .close-button:hover {
    background: color-mix(
      in srgb,
      var(--color-surface) 30%,
      transparent
    );
  }

  .close-button:focus-visible {
    outline: 3px solid color-mix(
      in srgb,
      var(--color-foreground) 65%,
      transparent
    );
    outline-offset: 2px;
  }
</style>
