<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { onMount, untrack } from "svelte";
  import GitlabOAuthConnect from "./GitlabOAuthConnect.svelte";
  import { gitlabOAuthAlternative } from "../secrets/gitlab-config.ts";
  import FieldSelect from "./FieldSelect.svelte";
  import { vaultCall } from "../secrets/client.ts";
  import { validateHttpConnectionReference } from "../secrets/bindings.ts";
  import { httpConnectionMatches, httpConnectionReference, httpTokenFormats } from "../secrets/http-connections.ts";
  import { createConnectionAuthorization, type ConnectionAuthorizationState } from "../secrets/connection-lifecycle.ts";
  import { VaultError, type ApprovedOperation, type CredentialBinding, type HttpConnection,
    type HttpConnectionReference, type HttpTokenFormat, type VaultStatus } from "../secrets/types.ts";

  let { descriptor, status, manual, initial, disabled = false, portalZIndex = 40, onSelect }: {
    descriptor: ApprovedOperation; status: VaultStatus; manual?: CredentialBinding | undefined;
    initial?: HttpConnectionReference | undefined; disabled?: boolean; portalZIndex?: number;
    onSelect: (binding: CredentialBinding | undefined, selected: boolean) => void;
  } = $props();
  const id = $props.id();
  let entries = $state.raw<HttpConnection[]>([]), selectedId = $state("manual");
  let reference = $state.raw<HttpConnectionReference>();
  let label = $state(""), account = $state(""), formatOverride = $state<HttpTokenFormat>();
  let busy = $state(false), error = $state("");
  let authorizationState = $state<ConnectionAuthorizationState>({ kind: "needs-action" });
  let mounted = false, revision = 0, loaded = "";
  const selected = $derived(entries.find(item => item.id === selectedId));
  const formats = $derived(httpTokenFormats(descriptor, selected?.alternative ?? manual?.alternative ?? 0));
  const format = $derived(formatOverride ?? selected?.format ?? formats.at(-1) ?? "schema");
  const options = $derived([{ value: "manual", label: "Choose credentials" }, ...entries.filter(item => httpConnectionMatches(item, descriptor))
    .map(item => ({ value: item.id, label: `${item.label} · ${item.account}` })),
    ...(selectedId !== "manual" && !entries.some(item => item.id === selectedId && httpConnectionMatches(item, descriptor))
      ? [{ value: selectedId, label: "Saved connection unavailable", disabled: true }] : [])]);
  const authorization = createConnectionAuthorization<CredentialBinding>(next => {
    authorizationState = next;
    if (mounted && next.kind !== "ready" && selectedId !== "manual") onSelect(undefined, true);
  });
  async function authorize() {
    const current = selected;
    if (!current || !reference || !status.unlocked) { onSelect(undefined, selectedId !== "manual"); return; }
    const binding = await authorization.start(reference, signal => vaultCall("connectionBinding", [reference!, descriptor], signal),
      { enabled: status.unlocked && httpConnectionMatches(current, descriptor), ...(current.expiresAt === undefined ? {} : { expiresAt: current.expiresAt }) });
    if (mounted && binding && authorization.state.kind === "ready") onSelect(binding, true);
  }
  async function choose(value: string) {
    revision++; selectedId = value; error = ""; authorization.reset();
    const current = entries.find(item => item.id === value);
    reference = current && httpConnectionReference(current);
    label = current?.label ?? ""; account = current?.account ?? ""; formatOverride = undefined;
    if (value === "manual") { onSelect(undefined, false); return; }
    busy = true;
    try { await authorize(); } finally { if (mounted) busy = false; }
  }
  async function refresh() {
    const request = ++revision;
    busy = true; error = "";
    try {
      const values = await vaultCall("connections", []);
      if (!mounted || request !== revision || !status.unlocked) return;
      entries = values.sort((left, right) => left.label.localeCompare(right.label));
      const current = entries.find(item => item.id === selectedId);
      label = current?.label ?? ""; account = current?.account ?? ""; formatOverride = undefined;
      if (selectedId !== "manual") await authorize();
    } catch (cause) { if (mounted && request === revision) error = cause instanceof VaultError ? cause.message : "Connections are unavailable."; }
    finally { if (mounted && request === revision) busy = false; }
  }
  async function save() {
    const current = selected;
    const binding = current ? { alternative: current.alternative, fingerprint: descriptor.fingerprint, credentials: current.credentials } : manual;
    if (!binding) return;
    busy = true; error = "";
    try {
      const connection = await vaultCall("putConnection", [{ label, account, format,
        ...(current && reference ? { reference } : {}), ...(current?.expiresAt === undefined ? {} : { expiresAt: current.expiresAt }) }, descriptor, binding]);
      if (!mounted) return;
      entries = [...entries.filter(item => item.id !== connection.id), connection];
      await choose(connection.id);
    } catch (cause) { if (mounted) error = cause instanceof VaultError ? cause.message : "The connection could not be saved."; }
    finally { if (mounted) busy = false; }
  }
  async function remove() {
    if (!reference) return;
    busy = true; error = "";
    try {
      await vaultCall("removeConnection", [reference]);
      if (!mounted) return;
      entries = entries.filter(item => item.id !== selectedId); await choose("manual");
    } catch (cause) { if (mounted) error = cause instanceof VaultError ? cause.message : "The connection could not be removed."; }
    finally { if (mounted) busy = false; }
  }
  $effect(() => {
    const key = `${status.unlocked}:${status.revision}:${descriptor.fingerprint}`;
    untrack(() => {
      if (!mounted || key === loaded) return;
      loaded = key;
      if (!status.unlocked) { revision++; busy = false; entries = []; authorization.cancel(); }
      else void refresh();
    });
  });
  onMount(() => {
    mounted = true; selectedId = initial?.id ?? "manual";
    reference = initial ? validateHttpConnectionReference(initial) : undefined;
    if (status.unlocked) { loaded = `${status.unlocked}:${status.revision}:${descriptor.fingerprint}`; void refresh(); }
    return () => { mounted = false; revision++; authorization.cancel(); entries = []; };
  });
</script>

<div class="http-connections">
  {#if gitlabOAuthAlternative(descriptor) !== undefined}
    <GitlabOAuthConnect {descriptor} {status} current={selected} disabled={disabled || busy}
      onConnected={async connection => { entries = [...entries.filter(item => item.id !== connection.id), connection]; await choose(connection.id); }} />
  {/if}
  <FieldSelect id={`${id}-connection`} label="Saved HTTP connection" value={selectedId} {options} includePlaceholder={false}
    disabled={disabled || busy || !status.unlocked} {portalZIndex} onValueChange={value => { void choose(value); }} />
  {#if !status.unlocked}<p>Unlock the vault to use saved connections.</p>{/if}
  {#if selectedId !== "manual"}
    {#if selected}<p>{selected.account} · {selected.endpoint}</p>{/if}
    {#if authorizationState.kind === "waiting"}<p role="status">Preparing connection…</p>
    {:else if authorizationState.kind === "expired"}<p role="status">Connection expired. Update its credentials to continue.</p>
    {:else if authorizationState.kind === "failed" || status.unlocked && !selected}<p role="status">Connection changed or is unavailable. Select it again to continue.</p>{/if}
    <button type="button" disabled={disabled || busy || !selected || !status.unlocked} onclick={() => void choose(selectedId)}>Use connection</button>
  {/if}
  {#if status.unlocked && selected?.format === "gitlab-oauth"}
    <p>GitLab OAuth manages this connection's tokens and refresh. Reconnect to renew access.</p>
    <button type="button" disabled={disabled || busy} onclick={() => void remove()}>Remove connection</button>
  {:else if status.unlocked && (manual || selected)}
    <details>
      <summary>{selectedId === "manual" ? "Save as connection" : "Edit connection"}</summary>
      <div class="connection-editor">
        <label for={`${id}-label`}>Connection name</label>
        <input id={`${id}-label`} bind:value={label} maxlength="120" disabled={disabled || busy} autocomplete="off" />
        <label for={`${id}-account`}>Account label</label>
        <input id={`${id}-account`} bind:value={account} maxlength="120" disabled={disabled || busy} autocomplete="off" />
        <p>Use a name for this account. The saved connection uses this operation's configured endpoint.</p>
        {#if formats.length > 1}
          <FieldSelect id={`${id}-format`} label="Token format" value={format} includePlaceholder={false} {portalZIndex}
            disabled={disabled || busy} options={formats.map(value => ({ value, label: value === "schema" ? "Use schema format" : value === "discord-bot" ? "Raw Discord bot token" : "Raw Opsgenie API key" }))}
            onValueChange={value => { formatOverride = value as HttpTokenFormat; }} />
        {/if}
        <div class="actions">
          <button type="button" disabled={disabled || busy || !label.trim() || !account.trim()} onclick={() => void save()}>Save connection</button>
          {#if selected}<button type="button" disabled={disabled || busy} onclick={() => void remove()}>Remove connection</button>{/if}
        </div>
      </div>
    </details>
  {/if}
  {#if error}<p role="alert">{error}</p>{/if}
</div>

<style>
  .http-connections, .connection-editor { display: grid; gap: 8px; min-width: 0; }
  .connection-editor { padding-top: 12px; }
  p { margin: 0; font-size: 12px; overflow-wrap: anywhere; }
  label, summary { font-size: 12px; font-weight: 700; }
  input { min-width: 0; width: 100%; box-sizing: border-box; padding: 8px 12px; border: 0; background: var(--color-background); color: var(--color-foreground); }
  button { justify-self: start; border: 0; border-radius: 4px; padding: 8px 12px; background: var(--color-background); color: var(--color-foreground); font-weight: 700; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  [role="alert"] { color: var(--color-error-foreground); }
</style>
