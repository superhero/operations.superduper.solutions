<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import FieldSelect from "$lib/components/FieldSelect.svelte";
  import { vaultCall } from "$lib/secrets/client.ts";
  import { nativeRuntimeSelection, nativeWorkflowSelection } from "$lib/secrets/native-runtime-client.ts";
  import { nativeReference, type NativeRuntimeConnection } from "$lib/secrets/native-runtime-config.ts";
  import { safeVaultError, type VaultKey } from "$lib/secrets/types.ts";
  import type { NativeAgentProgress, NativeLoginKind } from "$lib/native-agent-contract.ts";
  let { records, busy, run, refresh }: { records: VaultKey[]; busy: boolean;
    run: (message: string, action: () => Promise<void>) => Promise<void>; refresh: () => Promise<void> } = $props();
  const keyId = $props.id();
  let label = $state("Codex"), host = $state(""), pairingKeyId = $state("");
  let connections = $state<(NativeRuntimeConnection & { connected: boolean })[]>([]);
  let error = $state(""), notice = $state("");
  let loginKind = $state<NativeLoginKind>("chatgptDeviceCode"), credentialId = $state("");
  let signingIn = $state(""), loginNotice = $state<Extract<NativeAgentProgress, { kind: "login" }>>();
  let loginController: AbortController | undefined;
  async function reload() { connections = await vaultCall("nativeConnections", []); }
  async function action(message: string, call: () => Promise<void>) {
    error = ""; notice = "";
    await run(message, async () => { try { await call(); } finally { await reload(); await refresh(); } });
  }
  onMount(() => {
    let alive = true;
    void vaultCall("nativeConnections", []).then(value => { if (alive) connections = value; })
      .catch(failure => { if (alive) error = safeVaultError(failure).message; });
    return () => { alive = false; loginController?.abort(); loginNotice = undefined; };
  });
  async function signIn(connection: NativeRuntimeConnection) {
    const controller = new AbortController(); loginController = controller; signingIn = connection.id; loginNotice = undefined;
    try {
      await action("Waiting for Codex sign-in…", async () => {
        const input = loginKind === "apiKey" ? { type: loginKind, credentialId } : { type: loginKind };
        await vaultCall("loginNativeRuntime", [nativeReference(connection), await nativeWorkflowSelection(), input], controller.signal,
          undefined, progress => { if (progress.kind === "login") loginNotice = progress; });
        notice = "Codex account connected. Select this updated runtime for new workflow steps.";
      });
    } finally { signingIn = ""; loginNotice = undefined; if (loginController === controller) loginController = undefined; }
  }
</script>

<section class="native-runtimes" aria-label="Native runtimes">
  <h4>Native runtimes</h4>
  <p class="help">Pair a Codex companion you control. Use trusted HTTPS and, on phones or tablets, a host reachable from that device.</p>
  {#if records.length}
    <form onsubmit={event => { event.preventDefault(); void action("Pairing runtime…", async () => {
      await vaultCall("pairNativeRuntime", [{ label, host, pairingKeyId }, await nativeRuntimeSelection()]);
      host = ""; pairingKeyId = ""; notice = "Runtime paired.";
    }); }}>
      <label>Name<input aria-label="Runtime name" bind:value={label} maxlength="120" required disabled={busy} /></label>
      <label>Companion URL<input aria-label="Companion URL" type="url" placeholder="https://your-host:8446" bind:value={host} required disabled={busy} /></label>
      <label for={keyId}>Pairing key</label>
      <FieldSelect id={keyId} label="Pairing key" value={pairingKeyId} options={records.map(record => ({ value: record.id, label: record.label }))}
        required disabled={busy} onValueChange={value => pairingKeyId = value} />
      <button type="submit" disabled={busy || !pairingKeyId || !host || !label.trim()}>Pair runtime</button>
    </form>
  {:else}<p class="help">Save the companion’s pairing key in the vault first.</p>{/if}
  {#each connections as connection (connection.id)}
    <article aria-label={`Runtime ${connection.label}`}>
      <strong>{connection.label}</strong><span>{connection.connected ? "Connected" : "Disconnected"}</span>
      <p class="host">{connection.host}</p>
      <p class="help">Codex {connection.identity.version} · {connection.accountType === "none" ? "No account connected" : connection.accountType === "chatgpt" ? "ChatGPT account" : "API key account"}</p>
      {#if connection.workflowFingerprint}
        <p class="help">Workflows enabled · Uses the host’s approved workspace. Commands that need approval wait for your decision.</p>
        <form aria-label={`Sign in to ${connection.label}`} onsubmit={event => { event.preventDefault(); void signIn(connection); }}>
          <FieldSelect id={`${keyId}-login-${connection.id}`} label="Codex sign-in method" value={loginKind} disabled={busy}
            options={[{ value: "chatgptDeviceCode", label: "ChatGPT device code" }, { value: "chatgpt", label: "ChatGPT browser sign-in" }, { value: "apiKey", label: "API key from vault" }]}
            onValueChange={value => loginKind = value as NativeLoginKind} />
          {#if loginKind === "apiKey"}
            <FieldSelect id={`${keyId}-api-key-${connection.id}`} label="Codex API key" value={credentialId} disabled={busy} required
              options={records.filter(record => record.id !== connection.pairingKeyId).map(record => ({ value: record.id, label: record.label }))}
              onValueChange={value => credentialId = value} />
          {/if}
          <button type="submit" disabled={busy || loginKind === "apiKey" && !credentialId}>Sign in to Codex</button>
        </form>
        {#if signingIn === connection.id}
          <section aria-label="Codex sign-in" class="sign-in">
            {#if loginNotice?.login === "chatgptDeviceCode"}
              <p>Enter <code>{loginNotice.userCode}</code> at <a href={loginNotice.verificationUrl} target="_blank" rel="noopener noreferrer">Codex device sign-in</a>.</p>
            {:else if loginNotice?.login === "chatgpt"}
              <a href={loginNotice.authUrl} target="_blank" rel="noopener noreferrer">Open Codex sign-in</a>
            {/if}
            <p role="status" class="help">Waiting for Codex to confirm your account…</p>
            <button type="button" onclick={() => loginController?.abort()}>Cancel sign-in</button>
          </section>
        {/if}
      {:else}
        <button type="button" disabled={busy} onclick={() => void action("Enabling native workflows…", async () => {
          await vaultCall("enableNativeWorkflow", [nativeReference(connection), await nativeWorkflowSelection()]);
          notice = "Workflows enabled. The companion must also be configured to allow agent workflows.";
        })}>Enable workflows</button>
      {/if}
      <div class="actions">
        <button type="button" disabled={busy} onclick={() => void action("Checking runtime…", async () => {
          await vaultCall("checkNativeRuntime", [nativeReference(connection), await nativeRuntimeSelection()]); notice = "Runtime checked.";
        })}>{connection.connected ? "Check runtime" : "Reconnect runtime"}</button>
        {#if connection.connected}<button type="button" disabled={busy} onclick={() => void action("Disconnecting runtime…", async () => {
          await vaultCall("disconnectNativeRuntime", [nativeReference(connection)]); notice = "Runtime disconnected. Remote cleanup is best effort; no logout was requested.";
        })}>Disconnect runtime</button>{/if}
        <button type="button" disabled={busy} onclick={() => void action("Removing pairing…", async () => {
          await vaultCall("disconnectNativeRuntime", [nativeReference(connection), true]); notice = "Pairing removed.";
        })}>Remove pairing</button>
      </div>
    </article>
  {/each}
  {#if connections.length}<p class="help">If the host, workspace or account changes, remove the pairing and pair again to trust the new runtime.</p>{/if}
  {#if notice}<p role="status">{notice}</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
</section>

<style>
  .native-runtimes { display: grid; gap: 12px; padding: 14px; background: var(--color-surface); border-radius: 4px; }
  h4, p { margin: 0; }
  form, label, article { display: grid; gap: 8px; min-width: 0; }
  h4, label, strong { font-size: 12px; }
  label { font-weight: 700; }
  input { box-sizing: border-box; min-width: 0; width: 100%; min-height: 40px; padding: 8px 12px; border: 0; border-radius: 4px; background: var(--color-background); color: var(--color-foreground); }
  article { padding: 12px; background: var(--color-background); border-radius: 4px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .host { overflow-wrap: anywhere; }
  .help { color: var(--color-muted-foreground); font-size: 12px; }
  button { justify-self: start; width: fit-content; padding: 8px 12px; border: 0; border-radius: 4px; background: var(--color-primary); color: var(--color-primary-foreground); font-size: 12px; font-weight: 700; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: default; }
</style>
