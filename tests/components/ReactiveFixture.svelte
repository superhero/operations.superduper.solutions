<!-- Copyright (C) 2026 Erik Landvall; SPDX-License-Identifier: AGPL-3.0-only -->
<script>
  import { onMount } from 'svelte';
  import { slide } from 'svelte/transition';
  import { lifecycle } from './lifecycle.mjs';

  let { prefix = 'Hello', multiplier = 2, waitForResult = () => Promise.resolve(), onResult = () => {} } = $props();
  let count = $state(0);
  let name = $state('');
  let enabled = $state(false);
  let loading = $state(false);
  let message = $state('idle');
  let multiplied = $derived(count * multiplier);
  let choice = $state('first');
  let detailsOpen = $state(false);
  let detailsPhase = $state('closed');
  let activeAction;

  $effect(() => {
    const previousTitle = document.title;
    document.title = `${prefix} · ${choice}`;
    return () => { document.title = previousTitle; };
  });

  onMount(() => {
    lifecycle.mounts += 1;
    const listener = () => { lifecycle.events += 1; };
    window.addEventListener('component-integration-event', listener);
    return () => {
      activeAction?.abort();
      lifecycle.destroys += 1;
      window.removeEventListener('component-integration-event', listener);
    };
  });

  async function load() {
    activeAction?.abort();
    const controller = new AbortController();
    activeAction = controller;
    loading = true;
    message = 'pending';
    try {
      await waitForResult(controller.signal);
      if (controller.signal.aborted || activeAction !== controller) return;
      message = `ready: ${name}`;
      loading = false;
      onResult(message);
    } finally {
      if (activeAction === controller) activeAction = undefined;
    }
  }
</script>

<section aria-label="Svelte component-integration fixture" data-component-integration-fixture>
  <h1>{prefix}</h1>
  <button onclick={() => count += 1}>Increment</button>
  <p data-testid="count">count: {count}</p>
  <p data-testid="derived">multiplied: {multiplied}</p>
  <label>Name <input aria-label="Name" bind:value={name} /></label>
  <p data-testid="name">name: {name}</p>
  <label>Enabled <input type="checkbox" aria-label="Enabled" bind:checked={enabled} /></label>
  <p data-testid="enabled">enabled: {enabled}</p>
  <fieldset>
    <legend>Choice</legend>
    <label>First <input type="radio" aria-label="First" value="first" bind:group={choice} /></label>
    <label>Second <input type="radio" aria-label="Second" value="second" bind:group={choice} /></label>
  </fieldset>
  <p data-testid="choice">choice: {choice}</p>
  <button onclick={() => detailsOpen = !detailsOpen} aria-expanded={detailsOpen}>Toggle details</button>
  {#if detailsOpen}
    <div data-testid="transition-panel" transition:slide={{ duration: 2000 }}
      onintrostart={() => detailsPhase = 'opening'} onintroend={() => detailsPhase = 'open'}
      onoutrostart={() => detailsPhase = 'closing'} onoutroend={() => detailsPhase = 'closed'}>
      <p>Details remain readable while their disclosure opens and closes.</p>
    </div>
  {/if}
  <p data-testid="transition-status">{detailsPhase}</p>
  <button onclick={load} disabled={loading}>Load</button>
  <p role="status">{message}</p>
</section>
