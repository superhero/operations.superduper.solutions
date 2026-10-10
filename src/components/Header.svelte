<script lang="ts">
  let scrollY = $state(0);
  const scrollProgress = $derived(Math.min(1, Math.max(0, scrollY) / 80));
  const scrollStrength = $derived(1 - (1 - scrollProgress) ** 3);
  import MenuButton from "./MenuButton.svelte";
  let { navigationOpen, onMenu }: { navigationOpen: boolean; onMenu: () => void } = $props();
</script>

<svelte:window bind:scrollY />

<header class="site-header" style:--header-scroll-strength={scrollStrength}>
  <div class="header-content">
    <div class="brand-controls">
      <MenuButton open={navigationOpen} onclick={onMenu} />
      <div class="brand-copy">
        <strong class="brand">Operations</strong>
      </div>
    </div>
  </div>
</header>
