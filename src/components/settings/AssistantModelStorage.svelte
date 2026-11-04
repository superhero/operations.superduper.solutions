<!-- Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS. -->
<script lang="ts">
  import {onDestroy} from 'svelte';
  import HintButton from '$lib/components/HintButton.svelte';
  import MaterialIcon from '$lib/components/MaterialIcon.svelte';
  import {artifactsFor, profileById} from '$lib/assistant/model-storage/catalog.ts';
  let {visible = false}: {visible?: boolean} = $props();
  let models = $state<string[]>([]), error = $state(''), removing = $state('');
  let initialized = false, alive = true, unsubscribe: (() => void) | undefined;
  let storage: typeof import('$lib/assistant/model-storage/storage.ts');
  const lifetime = new AbortController();
  const label = (id: string) => id === 'image:compatible' ? 'LFM2.5-VL · FP32/Q4' : id === 'image:fp16' ? 'LFM2.5-VL · FP16/Q4' : profileById(id).label ?? id;
  const bytes = (id: string) => artifactsFor(profileById(id)).reduce((total, file) => total + file.bytes, 0);
  async function refresh() { const current = await storage.installedModels(); if (alive) models = current; }
  $effect(() => {
    if (!visible || initialized) return;
    initialized = true;
    void import('$lib/assistant/model-storage/storage.ts').then(async loadedStorage => {
      if (!alive) return;
      storage = loadedStorage;
      unsubscribe = loadedStorage.subscribeModels(() => { void refresh().catch(problem => { if (alive) error = String(problem.message ?? problem); }); });
      await refresh();
    }).catch(problem => { if (alive) error = String(problem.message ?? problem); });
  });
  async function remove(id: string) {
    if (removing) return;
    removing = id; error = '';
    try { await storage.removeModel(id, lifetime.signal); await refresh(); }
    catch (problem) { if (alive) error = problem instanceof Error ? problem.message : String(problem); }
    finally { if (alive) removing = ''; }
  }
  onDestroy(() => { alive = false; lifetime.abort(); unsubscribe?.(); });
</script>

<details class="model-storage">
  <summary>Model storage<MaterialIcon name="chevron_forward" size={16}/></summary>
  <p>Selecting a language model saves and verifies its files before loading. Image files are saved on first inspection. Files stay in this browser until removed or cleared by the browser.</p>
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  {#if models.length}
    <ul aria-label="Verified model files">
      {#each models as id (id)}
        <li><div><strong>{label(id)}</strong><span>{(bytes(id) / 1e9).toFixed(2)} GB · Saved and verified</span></div>
          <HintButton type="button" class="remove-model" label={`Remove ${label(id)}`} disabled={!!removing} onclick={() => void remove(id)}><MaterialIcon name="delete" size={16}/>{removing === id ? 'Removing…' : 'Remove'}</HintButton>
        </li>
      {/each}
    </ul>
  {:else}<p>No model files have been verified and saved yet.</p>{/if}
</details>

<style>
  .model-storage { padding: 12px; border-radius: 4px; background: var(--color-surface); min-width: 0; }
  summary { display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-weight: 700; }
  p { margin: 10px 0 0; }
  ul { display: grid; gap: 8px; list-style: none; padding: 0; margin: 12px 0 0; }
  li { display: flex; align-items: center; justify-content: space-between; gap: 8px; background: var(--color-background); padding: 8px; border-radius: 4px; }
  li > div { min-width: 0; display: grid; gap: 4px; overflow-wrap: anywhere; }
  li span { font-size: 11px; }
  :global(.remove-model) { display: inline-flex; align-items: center; gap: 4px; border: 0; border-radius: 4px; padding: 6px 8px; background: var(--color-primary); color: var(--color-primary-foreground); cursor: pointer; }
  .error { color: var(--color-destructive); }
</style>
