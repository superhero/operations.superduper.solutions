<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import FieldSelect from "./FieldSelect.svelte";
  import VaultAuthentication from "./VaultAuthentication.svelte";
  import type { Operation } from "../catalog.ts";
  import { nativeOperationSelection } from "../secrets/native-runtime-client.ts";
  import { approvedNativeOperation } from "../secrets/native-rpc-policy.ts";
  import { nativeReference, type NativeWorkflowBinding, type NativeRuntimeConnection } from "../secrets/native-runtime-config.ts";
  import { readVaultStatus, subscribeVaultLock, vaultCall, readVaultConnections } from "../secrets/client.ts";
  import { safeVaultError, type VaultStatus } from "../secrets/types.ts";
  let { operation, initial, disabled = false, onChange }: { operation: Operation; initial?: NativeWorkflowBinding | undefined; disabled?: boolean;
    onChange: (value: NativeWorkflowBinding | undefined) => void } = $props();
  let status = $state<VaultStatus>(), connections = $state<NativeRuntimeConnection[]>([]);
  let selected = $state(""), fingerprint = "", error = $state(""), busy = $state(false);
  let authentication = $state.raw<VaultAuthentication>(), alive = true;
  const id = $props.id();
  function choose(id: string) {
    selected = id; const connection = connections.find(value => value.id === id);
    onChange(connection && fingerprint ? { runtime: nativeReference(connection), fingerprint } : undefined);
  }
  async function refresh() {
    busy = true; error = "";
    try {
      const selection = await nativeOperationSelection(operation.rpc!.method), descriptor = await approvedNativeOperation(selection.operation, selection.document);
      const latest = await readVaultStatus();
      const available = latest.unlocked ? (await readVaultConnections("nativeConnections")).filter(value => value.workflowFingerprint && value.accountType !== "none") : [];
      if (!alive) return; fingerprint = descriptor.fingerprint; status = latest; connections = available;
      const previous = initial && initial.fingerprint === fingerprint ? connections.find(value => value.id === initial.runtime.id
        && value.revision === initial.runtime.revision && value.fingerprint === initial.runtime.fingerprint) : undefined;
      choose(previous?.id ?? "");
    } catch (cause) { if (alive) { error = safeVaultError(cause).message; choose(""); } }
    finally { if (alive) busy = false; }
  }
  async function unlock() {
    if (!authentication || busy) return; busy = true; error = "";
    try {
      const proof = await authentication.proof();
      try { await vaultCall("unlock", [proof]); } finally { if ("prf" in proof) proof.prf.fill(0); }
      await refresh();
    } catch (cause) { if (alive) error = safeVaultError(cause).message; }
    finally { if (alive) busy = false; }
  }
  onMount(() => {
    void refresh(); const unsubscribe = subscribeVaultLock(() => { connections = []; selected = ""; if (status) status = { ...status, unlocked: false }; onChange(undefined); });
    return () => { alive = false; unsubscribe(); };
  });
</script>
<section aria-label="Native runtime" class="native-runtime-selector">
  {#if status?.unlocked}
    <FieldSelect {id} label="Native runtime" value={selected} required disabled={disabled || busy} portalZIndex={90}
      options={connections.map(value => ({ value: value.id, label: value.label }))} onValueChange={choose} />
    {#if !connections.length}<p class="hint">Connect an account and enable workflows in Settings → Secrets → Native runtimes.</p>{/if}
  {:else if status?.exists}
    <VaultAuthentication {status} bind:this={authentication} disabled={disabled || busy} portalZIndex={90} />
    <button type="button" disabled={disabled || busy} onclick={unlock}>Unlock native runtimes</button>
  {:else if status}<p class="hint">Create a vault and pair a native runtime in Settings → Secrets.</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
</section>
<style>.native-runtime-selector { display: grid; gap: 12px; min-width: 0; } .hint { color: var(--color-muted-foreground); font-size: 12px; }</style>
