<script lang="ts">
  import type { WorkflowSaveStatus } from "$lib/workspace.d.ts";
  let scrollY = $state(0);
  const scrollProgress = $derived(Math.min(1, Math.max(0, scrollY) / 80));
  const scrollStrength = $derived(1 - (1 - scrollProgress) ** 3);
  import MenuButton from "./MenuButton.svelte";
  import HintButton from "$lib/components/HintButton.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  let { navigationOpen, onMenu, settingsOpen, onSettings, workflowSaveStatus }: { navigationOpen: boolean; onMenu: () => void; settingsOpen: boolean; onSettings: () => void; workflowSaveStatus?: WorkflowSaveStatus | undefined } = $props();
  const saveLabels = { loading: "Loading…", saving: "Saving…", saved: "Saved locally", unsaved: "Not saved", error: "Not saved" };
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
    <HintButton class="menu-button" label="Settings" tooltipSide="bottom" aria-pressed={settingsOpen} onclick={onSettings}>
      <MaterialIcon name="settings" />
    </HintButton>
  </div>
  {#if workflowSaveStatus}
    <div class="document-meta" role="status" class:unsaved={workflowSaveStatus === "saving" || workflowSaveStatus === "error"} class:fresh={workflowSaveStatus === "unsaved"}>
      <i aria-hidden="true"></i>{saveLabels[workflowSaveStatus]}
    </div>
  {/if}
</header>

<style>
  .document-meta { position: absolute; right: calc(1rem + 3px); bottom: 8px; display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--color-muted-foreground); }
  .document-meta i { width: 6px; height: 6px; border-radius: 50%; background: var(--color-foreground); }
  .document-meta.unsaved i { background: var(--color-accent); }
  .document-meta.fresh i { background: transparent; }
</style>
