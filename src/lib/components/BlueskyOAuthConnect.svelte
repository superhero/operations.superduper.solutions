<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { createConnectionAuthorization, type ConnectionAuthorizationState } from "../secrets/connection-lifecycle.ts";
  import { atprotoCallbackUri, atprotoClientId } from "../secrets/atproto-config.ts";
  import { waitAtprotoCallback } from "../secrets/oauth-popup.ts";
  import { httpConnectionReference } from "../secrets/http-connections.ts";
  import { subscribeVaultLock, vaultCall } from "../secrets/client.ts";
  import { VaultError, type ApprovedOperation, type HttpConnection, type VaultStatus } from "../secrets/types.ts";

  let { descriptor, status, current, disabled = false, onConnected }: {
    descriptor: ApprovedOperation; status: VaultStatus; current?: HttpConnection | undefined; disabled?: boolean;
    onConnected: (connection: HttpConnection) => void | Promise<void>;
  } = $props();
  const id = $props.id();
  let identifier = $state(""), clientId = $state(""), label = $state("Bluesky"), redirectUri = $state("");
  let busy = $state(false), error = $state(""), notice = $state("");
  let authorizationState = $state<ConnectionAuthorizationState>({ kind: "needs-action" });
  let popup: Window | null = null, taskId = "", exchanging = false, mounted = false, revision = 0;
  const authorization = createConnectionAuthorization<HttpConnection>(next => { authorizationState = next; });
  $effect(() => {
    const selected = current;
    if (selected?.format === "atproto-oauth") untrack(() => { identifier = selected.oauth!.accountId; clientId = selected.oauth!.clientId; label = selected.label; });
  });
  function cancel(communicate = true) {
    revision++; authorization.cancel(); popup?.close(); popup = null;
    if (communicate && taskId && !exchanging && status.unlocked) void vaultCall("cancelAtprotoOAuth", [taskId]).catch(() => {});
    taskId = ""; exchanging = false; busy = false;
  }
  async function connect() {
    if (busy || !status.unlocked || disabled) return;
    const request = ++revision; error = ""; notice = "";
    popup = window.open("about:blank", "operations-bluesky-" + crypto.randomUUID(), "popup,width=560,height=740");
    if (!popup) { error = "Allow a sign-in window, then try connecting again."; return; }
    busy = true;
    try {
      const task = await vaultCall("beginAtprotoOAuth", [{ identifier: identifier.trim(), clientId: clientId.trim(), label: label.trim(), redirectUri }, descriptor,
        current?.format === "atproto-oauth" ? httpConnectionReference(current) : undefined]);
      if (!mounted || request !== revision) { popup?.close(); void vaultCall("cancelAtprotoOAuth", [task.id]).catch(() => {}); return; }
      taskId = task.id;
      const target = popup!;
      const result = await authorization.start({ id: task.id, revision: 1, fingerprint: task.fingerprint }, async signal => {
        const callback = waitAtprotoCallback(target, task, signal);
        target.location.href = task.authorizationUrl;
        const received = await callback;
        exchanging = true;
        return vaultCall("completeAtprotoOAuth", [task.id, received], signal);
      }, { enabled: true, expiresAt: task.expiresAt, waitMs: 300000 });
      if (!mounted || request !== revision) return;
      if (result) { authorization.reset(); await onConnected(result); notice = `Connected: ${result.account}`; }
      else if (authorization.state.kind === "failed") error = "Sign-in was not completed. Try connecting again.";
    } catch (cause) {
      if (mounted && request === revision) error = cause instanceof VaultError ? cause.message : "The Bluesky connection could not be created.";
    } finally {
      if (mounted && request === revision) { popup?.close(); popup = null; taskId = ""; exchanging = false; busy = false; }
    }
  }
  onMount(() => {
    mounted = true;
    try { redirectUri = atprotoCallbackUri(window.location.href); if (!clientId) clientId = atprotoClientId(window.location.href); } catch { error = "Use HTTPS or a local development server to connect Bluesky."; }
    const stop = subscribeVaultLock(() => cancel(false));
    return () => { mounted = false; cancel(); stop(); };
  });
</script>

<details class="atproto-oauth">
  <summary>{current?.format === "atproto-oauth" ? "Reconnect Bluesky account" : "Connect Bluesky account"}</summary>
  <div class="oauth-form">
    <p>Connect your Bluesky handle or DID to read your private preferences. Sign-in grants access only to this read operation.</p>
    <label for={`${id}-identifier`}>Bluesky handle or DID</label>
    <input id={`${id}-identifier`} bind:value={identifier} maxlength="255" autocomplete="off" spellcheck="false" disabled={disabled || busy} />
    <label for={`${id}-client`}>Bluesky client metadata URL</label>
    <input id={`${id}-client`} bind:value={clientId} maxlength="2048" autocomplete="off" spellcheck="false"
      disabled={disabled || busy || current?.format === "atproto-oauth"} />
    <label for={`${id}-redirect`}>Bluesky redirect URL</label>
    <input id={`${id}-redirect`} value={redirectUri} readonly />
    <label for={`${id}-label`}>Bluesky connection name</label>
    <input id={`${id}-label`} bind:value={label} maxlength="100" autocomplete="off" disabled={disabled || busy} />
    {#if !status.unlocked}<p>Unlock the vault before connecting.</p>{/if}
    {#if authorizationState.kind === "waiting"}<p role="status">Waiting for Bluesky sign-in…</p>
    {:else if authorizationState.kind === "cancelled"}<p role="status">Bluesky sign-in cancelled.</p>
    {:else if authorizationState.kind === "expired"}<p role="status">Bluesky sign-in expired. Connect again to continue.</p>{/if}
    <div class="actions">
      <button type="button" onclick={() => void connect()} disabled={disabled || busy || !status.unlocked || !clientId.trim() || !identifier.trim() || !label.trim() || !redirectUri}>Connect Bluesky</button>
      {#if busy}<button type="button" onclick={() => cancel()}>Cancel Bluesky sign-in</button>{/if}
    </div>
    {#if notice}<p role="status">{notice}</p>{/if}
    {#if error}<p role="alert">{error}</p>{/if}
  </div>
</details>

<style>
  .oauth-form { display: grid; gap: 8px; padding-top: 12px; min-width: 0; }
  p { margin: 0; font-size: 12px; overflow-wrap: anywhere; }
  label, summary { font-size: 12px; font-weight: 700; }
  input { min-width: 0; width: 100%; box-sizing: border-box; padding: 8px 12px; border: 0; background: var(--color-background); color: var(--color-foreground); }
  button { justify-self: start; border: 0; border-radius: 4px; padding: 8px 12px; background: var(--color-background); color: var(--color-foreground); font-weight: 700; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  [role="alert"] { color: var(--color-error-foreground); }
</style>
