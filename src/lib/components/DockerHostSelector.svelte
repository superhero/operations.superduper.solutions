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
  import { workflowExecutionForOperation } from "../workflow-execution.ts";
  import { dockerHostSelection } from "../secrets/docker-client.ts";
  import { approvedDockerOperation } from "../secrets/docker-policy.ts";
  import { dockerReference, type DockerConnection, type DockerBinding } from "../secrets/docker-config.ts";
  import { readVaultStatus, subscribeVaultLock, vaultCall, readVaultConnections } from "../secrets/client.ts";
  import { safeVaultError, type VaultStatus } from "../secrets/types.ts";
  let { operation, initial, disabled = false, onChange }: { operation: Operation; initial?: DockerBinding | undefined; disabled?: boolean;
    onChange: (value: DockerBinding | undefined, ready: boolean) => void } = $props();
  const id = $props.id();
  let status = $state<VaultStatus>(), connections = $state<DockerConnection[]>([]), selected = $state("");
  let fingerprint = "", http = $state(""), error = $state(""), busy = $state(false), alive = true;
  let authentication = $state.raw<VaultAuthentication>();
  const options = $derived([...(http ? [{ value: "http", label: "Configured HTTP server" }] : []), ...connections.map(value => ({ value: value.id, label: value.label }))]);
  function choose(id: string) {
    selected = id; const connection = connections.find(value => value.id === id);
    onChange(connection ? { host: dockerReference(connection), fingerprint } : undefined, !!connection || id === "http" && !!http);
  }
  async function refresh() {
    busy = true; error = "";
    try {
      const selection = await dockerHostSelection(), descriptor = await approvedDockerOperation(selection.operation, selection.document);
      const latest = await readVaultStatus(), available = latest.unlocked ? await readVaultConnections("dockerConnections") : [];
      if (!alive) return;
      fingerprint = descriptor.fingerprint; status = latest; connections = available.filter(value => value.modelFingerprint === fingerprint);
      try { http = workflowExecutionForOperation(operation).origin; } catch { http = ""; }
      const prior = initial && initial.fingerprint === fingerprint ? connections.find(value => value.id === initial.host.id
        && value.revision === initial.host.revision && value.fingerprint === initial.host.fingerprint) : undefined;
      // A stale saved native destination requires an explicit new choice.
      choose(prior?.id ?? (initial ? "" : http ? "http" : ""));
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
    void refresh(); const unsubscribe = subscribeVaultLock(() => {
      connections = []; if (status) status = { ...status, unlocked: false }; if (selected !== "http") choose("");
    }); return () => { alive = false; unsubscribe(); };
  });
</script>
<section aria-label="Docker destination" class="docker-selector">
  {#if options.length}<FieldSelect {id} label="Docker destination" value={selected} {options} required disabled={disabled || busy} portalZIndex={90} onValueChange={choose} />{/if}
  {#if selected === "http"}<p class="hint">HTTP server: {http}</p>
  {:else if connections.find(value => value.id === selected)}
    {@const connection = connections.find(value => value.id === selected)!}
    <p class="hint">{connection.host} · Engine {connection.identity.daemonId} · API {connection.identity.apiVersion}</p>
  {/if}
  {#if status?.exists && !status.unlocked}
    <VaultAuthentication {status} bind:this={authentication} disabled={disabled || busy} portalZIndex={90} />
    <button type="button" disabled={disabled || busy} onclick={unlock}>Unlock Docker hosts</button>
  {:else if status && !connections.length}<p class="hint">Pair a Docker host for this schema in Settings → Secrets → Docker hosts, or configure its HTTP server.</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
</section>
<style>.docker-selector { display: grid; gap: 12px; min-width: 0; } .hint { color: var(--color-muted-foreground); font-size: 12px; overflow-wrap: anywhere; }</style>
