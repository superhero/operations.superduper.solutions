<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { onMount, untrack } from "svelte";
  import FieldSelect from "./FieldSelect.svelte";
  import { createConnectionAuthorization, type ConnectionAuthorizationState } from "../secrets/connection-lifecycle.ts";
  import { httpConnectionReference } from "../secrets/http-connections.ts";
  import { subscribeVaultLock, vaultCall } from "../secrets/client.ts";
  import { VaultError, type ApprovedOperation, type HttpConnection, type VaultStatus, type VaultKey } from "../secrets/types.ts";
  import type { JiraOAuthSite } from "../secrets/jira-config.ts";

  let { descriptor, status, credentials = [], current, disabled = false, portalZIndex = 40, onConnected }: {
    descriptor: ApprovedOperation; status: VaultStatus; credentials?: readonly VaultKey[]; current?: HttpConnection | undefined;
    disabled?: boolean; portalZIndex?: number; onConnected: (connection: HttpConnection) => void | Promise<void>;
  } = $props();
  const id = $props.id();
  let host = $state(""), accessKeyId = $state(""), label = $state("Jira");
  let busy = $state(false), polling = $state(false), finishing = $state(false), taskId = $state("");
  let sites = $state.raw<JiraOAuthSite[]>([]), selectedSite = $state(""), error = $state(""), notice = $state("");
  let authorizationState = $state<ConnectionAuthorizationState>({ kind: "needs-action" });
  let popup: Window | null = null, mounted = false, revision = 0;
  const authorization = createConnectionAuthorization<JiraOAuthSite[]>(next => { authorizationState = next; });
  $effect(() => {
    const selected = current;
    if (selected?.format === "jira-companion" && selected.oauth?.profile === "atlassian-jira-3lo-v1")
      untrack(() => { host = selected.oauth!.profile === "atlassian-jira-3lo-v1" ? selected.oauth!.host : ""; label = selected.label; });
  });
  function cancel(communicate = true) {
    revision++; authorization.cancel(); popup?.close(); popup = null;
    const pending = taskId; taskId = ""; sites = []; selectedSite = ""; busy = false;
    if (communicate && pending && !polling && status.unlocked) void vaultCall("cancelJiraOAuth", [pending]).catch(() => {});
  }
  async function connect() {
    if (busy || polling || !status.unlocked || disabled) return;
    const request = ++revision; error = ""; notice = ""; sites = [];
    popup = window.open("about:blank", "operations-jira-" + crypto.randomUUID(), "popup,width=560,height=740");
    if (!popup) { error = "Allow a sign-in window, then try connecting again."; return; }
    busy = true;
    try {
      const task = await vaultCall("beginJiraOAuth", [{ host: host.trim(), accessKeyId, label: label.trim() }, descriptor,
        current?.format === "jira-companion" ? httpConnectionReference(current) : undefined]);
      if (!mounted || request !== revision) { popup?.close(); void vaultCall("cancelJiraOAuth", [task.id]).catch(() => {}); return; }
      taskId = task.id;
      const target = popup!;
      const result = await authorization.start({ id: task.id, revision: 1, fingerprint: task.fingerprint }, async signal => {
        target.location.href = task.authorizationUrl;
        while (true) {
          if (signal.aborted) throw new VaultError("CANCELLED");
          polling = true;
          let next;
          try { next = await vaultCall("pollJiraOAuth", [task.id]); } finally { polling = false; }
          if (signal.aborted || request !== revision) {
            if (status.unlocked) void vaultCall("cancelJiraOAuth", [task.id]).catch(() => {});
            throw new VaultError("CANCELLED");
          }
          if (next.phase === "choose-site") return next.sites!;
          await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(new VaultError("CANCELLED")); };
            const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 500);
            signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
          });
        }
      }, { enabled: true, expiresAt: task.expiresAt, waitMs: 300000 });
      if (!mounted || request !== revision) return;
      if (result) {
        sites = result;
        const matching = result.filter(site => site.url === descriptor.origin);
        if (!matching.length) throw new VaultError("PERMISSION");
        selectedSite = matching.length === 1 ? matching[0]!.id : "";
      } else {
        taskId = ""; await vaultCall("cancelJiraOAuth", [task.id]).catch(() => {});
        if (authorization.state.kind === "failed") error = "Jira sign-in was not completed. Try connecting again.";
      }
    } catch (cause) {
      if (mounted && request === revision) { error = cause instanceof VaultError ? cause.message : "The Jira companion could not be reached."; cancel(); }
    } finally { popup?.close(); popup = null; if (mounted && request === revision) busy = false; }
  }
  async function finish() {
    if (!taskId || !selectedSite || busy || disabled) return;
    const request = revision; busy = true; finishing = true; error = "";
    try {
      const connection = await vaultCall("completeJiraOAuth", [taskId, selectedSite]);
      if (!mounted || request !== revision) return;
      authorization.reset(); taskId = ""; sites = []; selectedSite = "";
      await onConnected(connection); notice = "Connected: " + connection.account;
    } catch (cause) {
      if (mounted && request === revision) { error = cause instanceof VaultError ? cause.message : "The Jira connection could not be saved."; taskId = ""; sites = []; }
    } finally { if (mounted && request === revision) { busy = false; finishing = false; } }
  }
  onMount(() => {
    mounted = true; const stop = subscribeVaultLock(() => cancel(false));
    return () => { mounted = false; cancel(); stop(); };
  });
</script>

<details class="jira-oauth">
  <summary>{current?.format === "jira-companion" ? "Reconnect Jira account" : "Connect Jira account"}</summary>
  <div class="oauth-form">
    <p>Connect through your Jira companion with read-only profile access. It receives the selected access key and keeps Jira tokens on that host.</p>
    <label for={id + "-host"}>Jira companion URL</label>
    <input id={id + "-host"} bind:value={host} type="url" placeholder="https://jira-companion.example" autocomplete="off" spellcheck="false"
      disabled={disabled || busy || !!taskId || current?.format === "jira-companion"} />
    <FieldSelect id={id + "-key"} label="Jira companion access key" value={accessKeyId} {portalZIndex}
      disabled={disabled || busy || !!taskId} options={credentials.filter(item => item.kind === "secret" && item.id !== current?.credentials.OAuth2).map(item => ({ value: item.id, label: item.label }))}
      onValueChange={value => { accessKeyId = value; }} />
    <label for={id + "-label"}>Jira connection name</label>
    <input id={id + "-label"} bind:value={label} maxlength="100" autocomplete="off" disabled={disabled || busy || !!taskId} />
    {#if !status.unlocked}<p>Unlock the vault before connecting.</p>{/if}
    {#if authorizationState.kind === "waiting"}<p role="status">Waiting for Jira sign-in…</p>
    {:else if authorizationState.kind === "cancelled"}<p role="status">Jira sign-in cancelled.</p>
    {:else if authorizationState.kind === "expired"}<p role="status">Jira sign-in expired. Connect again to continue.</p>{/if}
    {#if sites.length}
      <FieldSelect id={id + "-site"} label="Jira site" value={selectedSite} includePlaceholder={true} {portalZIndex}
        disabled={disabled || busy} options={sites.map(site => ({ value: site.id, label: site.name + " · " + site.url, disabled: site.url !== descriptor.origin }))}
        onValueChange={value => { selectedSite = value; }} />
      <p>The selected site must match this operation's configured Jira endpoint.</p>
      <button type="button" onclick={() => void finish()} disabled={disabled || busy || !selectedSite || authorizationState.kind === "expired"}>Connect selected Jira site</button>
    {/if}
    <div class="actions">
      <button type="button" onclick={() => void connect()} disabled={disabled || busy || polling || !!taskId || !status.unlocked || !host.trim() || !accessKeyId || !label.trim()}>Connect Jira</button>
      {#if busy || taskId}<button type="button" onclick={() => cancel()} disabled={finishing}>Cancel Jira sign-in</button>{/if}
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
