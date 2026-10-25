<script lang="ts">
  import type { WorkflowSaveStatus } from "$lib/workspace.d.ts";
  let scrollY = $state(0);
  const scrollProgress = $derived(Math.min(1, Math.max(0, scrollY) / 80));
  const scrollStrength = $derived(1 - (1 - scrollProgress) ** 3);
  import MenuButton from "./MenuButton.svelte";
  import HintButton from "$lib/components/HintButton.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  let { navigationOpen, onMenu, settingsOpen, assistantSelected, onSettings, onAssistant, workflowSaveStatus }: { navigationOpen: boolean; onMenu: () => void; settingsOpen: boolean; assistantSelected: boolean; onSettings: () => void; onAssistant: () => void; workflowSaveStatus?: WorkflowSaveStatus | undefined } = $props();
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
    <div class="pane-buttons" role="group" aria-label="AI assistant and settings">
      <HintButton class="menu-button" label="AI assistant" tooltipSide="left" aria-pressed={settingsOpen && assistantSelected} aria-expanded={settingsOpen && assistantSelected} aria-controls="settings-panel" onclick={onAssistant}>
        <MaterialIcon name="robot" />
      </HintButton>
      <HintButton class="menu-button" label="Settings" tooltipSide="left" aria-pressed={settingsOpen && !assistantSelected} aria-expanded={settingsOpen && !assistantSelected} aria-controls="settings-panel" onclick={onSettings}>
        <MaterialIcon name="tune" />
      </HintButton>
    </div>
  </div>
  {#if workflowSaveStatus}
    <div class="document-meta" role="status" class:unsaved={workflowSaveStatus === "saving" || workflowSaveStatus === "error"} class:fresh={workflowSaveStatus === "unsaved"}>
      <i aria-hidden="true"></i>{saveLabels[workflowSaveStatus]}
    </div>
  {/if}
</header>

<style>
  header { container: header-layout / inline-size; }
  .header-content { gap: 8px; }
  .header-content :global(.menu-button) { flex-shrink: 0; }
  .brand-controls { min-width: 0; }
  .pane-buttons { display: flex; flex-shrink: 0; --hover-scale: 1; }
  .pane-buttons :global(.menu-button) { border-radius: 0; }
  .pane-buttons :global(.menu-button:first-child) { border-radius: 4px 0 0 4px; }
  .pane-buttons :global(.menu-button:last-child) { border-radius: 0 4px 4px 0; border-left: 1px solid var(--color-primary-foreground); }
  .pane-buttons :global(.menu-button:focus-visible) { position: relative; z-index: 1; }
  .brand-copy { min-width: 0; overflow: hidden; }
  .brand { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @container header-layout (max-width: 350px) {
    .brand-controls { gap: 8px; }
    .brand { font-size: 16px; }
  }
  @container header-layout (max-width: 240px) { .brand-copy { display: none; } }

  .document-meta { position: absolute; right: calc(1rem + 5px); bottom: 0; height: var(--header-padding); display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--color-muted-foreground); }
  .document-meta i { width: 6px; height: 6px; transform: translateY(1px); border-radius: 50%; background: var(--color-foreground); }
  .document-meta.unsaved i { background: var(--color-accent); }
  .document-meta.fresh i { background: transparent; }
</style>
