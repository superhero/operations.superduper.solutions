<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import FieldSelect from "$lib/components/FieldSelect.svelte";
  import { vaultCall, readVaultConnections } from "$lib/secrets/client.ts";
  import { dockerHostSelection } from "$lib/secrets/docker-client.ts";
  import { dockerReference, type DockerConnection } from "$lib/secrets/docker-config.ts";
  import { safeVaultError, type VaultKey } from "$lib/secrets/types.ts";
  let { records, busy, run, refresh }: { records: VaultKey[]; busy: boolean;
    run: (message: string, action: () => Promise<void>) => Promise<void>; refresh: () => Promise<void> } = $props();
  const keyId = $props.id();
  let label = $state("Docker"), host = $state(""), pairingKeyId = $state("");
  let connections = $state<(DockerConnection & { connected: boolean })[]>([]), error = $state(""), notice = $state("");
  async function reload() { connections = await readVaultConnections("dockerConnections"); }
  async function action(message: string, call: () => Promise<void>) {
    error = ""; notice = "";
    await run(message, async () => { try { await call(); } finally { await reload(); await refresh(); } });
  }
  onMount(() => {
    let alive = true; void readVaultConnections("dockerConnections").then(value => { if (alive) connections = value; })
      .catch(cause => { if (alive) error = safeVaultError(cause).message; }); return () => { alive = false; };
  });
</script>
<section aria-label="Docker hosts" class="docker-hosts">
  <h4>Docker hosts</h4>
  <p class="help">Pair a separate Docker companion for container listing. Enable the Docker schema first. Use trusted HTTPS and a host reachable from this device.</p>
  {#if records.length}
    <form onsubmit={event => { event.preventDefault(); void action("Pairing Docker host…", async () => {
      await vaultCall("pairDockerHost", [{ label, host, pairingKeyId }, await dockerHostSelection()]); host = ""; pairingKeyId = ""; notice = "Docker host paired.";
    }); }}>
      <label>Name<input aria-label="Docker host name" bind:value={label} maxlength="120" required disabled={busy} /></label>
      <label>Companion URL<input aria-label="Docker companion URL" bind:value={host} type="url" placeholder="https://your-host:8447" required disabled={busy} /></label>
      <label for={keyId}>Pairing key</label>
      <FieldSelect id={keyId} label="Docker pairing key" value={pairingKeyId} options={records.map(record => ({ value: record.id, label: record.label }))}
        required disabled={busy} onValueChange={value => pairingKeyId = value} />
      <button type="submit" disabled={busy || !pairingKeyId || !host || !label.trim()}>Pair Docker host</button>
    </form>
  {:else}<p class="help">Save the Docker companion’s pairing key in the vault first.</p>{/if}
  {#each connections as connection (connection.id)}
    <article aria-label={`Docker host ${connection.label}`}>
      <strong>{connection.label}</strong><span>{connection.connected ? "Connected" : "Disconnected"}</span>
      <p class="identity">{connection.host}<br />Engine {connection.identity.daemonId} · API {connection.identity.apiVersion}</p>
      <div class="actions">
        <button type="button" disabled={busy} onclick={() => void action("Checking Docker host…", async () => {
          await vaultCall("checkDockerHost", [dockerReference(connection), await dockerHostSelection()]); notice = "Docker host checked.";
        })}>{connection.connected ? "Check Docker host" : "Reconnect Docker host"}</button>
        {#if connection.connected}<button type="button" disabled={busy} onclick={() => void action("Disconnecting Docker host…", async () => {
          await vaultCall("disconnectDockerHost", [dockerReference(connection)]); notice = "Docker host disconnected.";
        })}>Disconnect Docker host</button>{/if}
        <button type="button" disabled={busy} onclick={() => void action("Removing Docker pairing…", async () => {
          await vaultCall("disconnectDockerHost", [dockerReference(connection), true]); notice = "Docker pairing removed.";
        })}>Remove Docker pairing</button>
      </div>
    </article>
  {/each}
  {#if notice}<p role="status">{notice}</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
</section>
<style>
  .docker-hosts { display: grid; gap: 12px; padding: 14px; background: var(--color-surface); border-radius: 4px; }
  h4, p { margin: 0; } h4, label, strong { font-size: 12px; } label { font-weight: 700; }
  form, label, article { display: grid; gap: 8px; min-width: 0; }
  input { box-sizing: border-box; min-width: 0; width: 100%; min-height: 40px; padding: 8px 12px; border: 0; border-radius: 4px; background: var(--color-background); color: var(--color-foreground); }
  article { padding: 12px; background: var(--color-background); border-radius: 4px; } .identity { overflow-wrap: anywhere; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; } .help { color: var(--color-muted-foreground); font-size: 12px; }
  button { justify-self: start; width: fit-content; padding: 8px 12px; border: 0; border-radius: 4px; background: var(--color-primary); color: var(--color-primary-foreground); font-size: 12px; font-weight: 700; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: default; }
</style>
