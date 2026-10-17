<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import HintButton from "./HintButton.svelte";
  import MaterialIcon from "./MaterialIcon.svelte";
  import FieldSelect from "./FieldSelect.svelte";
  import VaultAuthentication from "./VaultAuthentication.svelte";
  import { readVaultStatus, subscribeVaultLock, vaultCall } from "../secrets/client.ts";
  import type { CredentialSummary, VaultStatus } from "../secrets/types.ts";
  let { selected = "", onselect, disabled = false }: { selected?: string; onselect?: (id: string, label: string) => void; disabled?: boolean } = $props();
  let status = $state<VaultStatus>();
  let entries = $state<CredentialSummary[]>([]);
  let authentication = $state.raw<VaultAuthentication>();
  let busy = $state(false);
  let error = $state("");
  let alive = false;
  let generation = 0;
  const id = $props.id();
  async function refresh() {
    const request = ++generation;
    busy = true; error = "";
    try {
      const latest = await readVaultStatus();
      const list = latest.unlocked && onselect ? await vaultCall("list", []) : [];
      if (alive && request === generation) { status = latest; entries = list; }
    } catch (cause) { if (alive && request === generation) error = cause instanceof Error ? cause.message : "The vault is unavailable."; }
    finally { if (alive && request === generation) busy = false; }
  }
  async function unlock(event: SubmitEvent) {
    event.preventDefault();
    if (!authentication || busy) return;
    const request = generation;
    busy = true; error = "";
    try {
      const proof = await authentication.proof();
      try { if (alive && request === generation) await vaultCall("unlock", [proof]); }
      finally { if ("prf" in proof) proof.prf.fill(0); }
      if (alive && request === generation) await refresh();
    } catch (cause) { if (alive && request === generation) error = cause instanceof Error ? cause.message : "The vault could not be unlocked."; }
    finally { if (alive && request === generation) busy = false; }
  }
  onMount(() => {
    alive = true; void refresh();
    const stop = subscribeVaultLock(() => { generation++; busy = false; entries = []; if (status) status = { ...status, unlocked: false }; authentication?.clear(); });
    return () => { alive = false; generation++; stop(); authentication?.clear(); };
  });
</script>
<div class="vault-variable-access">
  {#if status?.exists}
    {#if !status.unlocked}
      <form onsubmit={unlock}>
        <VaultAuthentication bind:this={authentication} {status} disabled={disabled || busy} label="Unlock" portalZIndex={90}>
          {#snippet action()}<HintButton class="unlock-vault" type="submit" label="Unlock" aria-label="Unlock" disabled={disabled || busy}>
            <MaterialIcon name="passkey" size={24} />
          </HintButton>{/snippet}
        </VaultAuthentication>
      </form>
    {:else if onselect}
      {#if entries.length}
        <FieldSelect id={id} label="Vault variable" value={selected} options={entries.map(entry => ({ value: entry.id, label: entry.label }))}
          disabled={disabled || busy} portalZIndex={90} onValueChange={value => { const entry = entries.find(item => item.id === value); if (entry) onselect?.(entry.id, entry.label); }} />
      {:else}<p>No values saved. Add a key and value in Settings → Secrets.</p>{/if}
    {/if}
  {:else if status}<p>Create a vault in Settings → Secrets to select a variable.</p>{/if}
  {#if error}<p role="alert">{error}</p><button type="button" onclick={refresh} disabled={disabled || busy}>Retry</button>{/if}
</div>
<style>
  .vault-variable-access { min-width: 0; }
  form { display: grid; gap: 12px; }
  p { margin: 0; font-size: 12px; }
  button { justify-self: end; border: 0; border-radius: 4px; padding: 8px 12px; background: var(--color-background); color: var(--color-foreground); font-weight: 700; transition: transform 180ms ease-in-out; }
  button:hover:not(:disabled) { transform: scale(1.05); }
  :global(.vault-variable-access .unlock-vault) { display: grid; place-items: center; flex: 0 0 44px; padding: 8px; border: 0; border-radius: 0 4px 4px 0; background: var(--color-background); color: var(--color-foreground); }
  :global(.vault-variable-access .unlock-vault:hover:enabled), :global(.vault-variable-access .unlock-vault:focus-visible) { background: var(--color-foreground); color: var(--color-background); }
  :global(.vault-variable-access .unlock-vault .material-symbols-rounded) { transition: transform 180ms ease-in-out; }
  :global(.vault-variable-access .unlock-vault:hover:enabled .material-symbols-rounded) { transform: scale(1.2); }
  [role="alert"] { color: var(--color-error-foreground); }
  @media (prefers-reduced-motion: reduce) { button, :global(.vault-variable-access .unlock-vault .material-symbols-rounded) { transition: none; } }
</style>
