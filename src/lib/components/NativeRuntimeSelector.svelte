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
  import { nativeOperationSelection, nativeRuntimeSelection, nativeWorkflowSelection } from "../secrets/native-runtime-client.ts";
  import { nativeAccountReadNeedsChatgpt } from "../native-account-read.ts";
  import { isNativePairedOperation } from "../native-account.ts";
  import { approvedNativeOperation } from "../secrets/native-rpc-policy.ts";
  import { nativeReference, nativeHash, type NativeWorkflowBinding, type NativeRuntimeConnection } from "../secrets/native-runtime-config.ts";
  import { readVaultStatus, subscribeVaultLock, vaultCall, readVaultConnections, currentNativeReference } from "../secrets/client.ts";
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
      const pairing = isNativePairedOperation(operation.rpc?.method) && operation.rpc?.method !== 'account/read' ? await nativeRuntimeSelection() : selection;
      const paired = await approvedNativeOperation(pairing.operation, pairing.document);
      const workflowModels = isNativePairedOperation(operation.rpc?.method) ? undefined : await Promise.all(
        (await nativeWorkflowSelection()).map(selection => approvedNativeOperation(selection.operation, selection.document)));
      const workflowFingerprint = workflowModels ? await nativeHash(workflowModels.map(model => ({ method: model.operation.rpc!.method, fingerprint: model.fingerprint }))) : undefined;
      const latest = await readVaultStatus();
      const available = latest.unlocked ? (await readVaultConnections("nativeConnections")).filter(value => isNativePairedOperation(operation.rpc?.method)
        ? value.modelFingerprint === paired.fingerprint && (!nativeAccountReadNeedsChatgpt(operation.rpc?.method) || value.accountType === "chatgpt") : value.workflowFingerprint === workflowFingerprint && (value.accountType !== "none" || value.requiresOpenaiAuth === false)) : [];
      if (!alive) return; fingerprint = descriptor.fingerprint; status = latest; connections = available;
      const initialRuntime = initial ? currentNativeReference(initial.runtime) : undefined;
      const previous = initial && initialRuntime && initial.fingerprint === fingerprint ? connections.find(value => value.id === initialRuntime.id
        && value.revision === initialRuntime.revision && value.fingerprint === initialRuntime.fingerprint) : undefined;
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
    {#if !connections.length}<p class="hint">{isNativePairedOperation(operation.rpc?.method) ? "Pair a native runtime for this schema in Settings → Secrets → Native runtimes." : "Enable the current workflows in Settings → Secrets → Native runtimes and connect an account if the runtime requires one."}</p>{/if}
  {:else if status?.exists}
    <VaultAuthentication {status} bind:this={authentication} disabled={disabled || busy} portalZIndex={90} />
    <button type="button" disabled={disabled || busy} onclick={unlock}>Unlock native runtimes</button>
  {:else if status}<p class="hint">Create a vault and pair a native runtime in Settings → Secrets.</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
</section>
<style>.native-runtime-selector { display: grid; gap: 12px; min-width: 0; } .hint { color: var(--color-muted-foreground); font-size: 12px; }</style>
