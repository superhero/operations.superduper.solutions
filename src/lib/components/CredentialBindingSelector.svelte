<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import FieldSelect from "./FieldSelect.svelte";
  import VaultAuthentication from "./VaultAuthentication.svelte";
  import HttpConnectionSelector from "./HttpConnectionSelector.svelte";
  import type { Operation } from "../catalog.ts";
  import { supportedSecurityAlternative } from "../operation-security.ts";
  import { workflowExecutionForOperation } from "../workflow-execution.ts";
  import { approvedOperation } from "../secrets/policy.ts";
  import { credentialSelectionForVariables, isBasicCredentialReference, validateCredentialBinding } from "../secrets/bindings.ts";
  import type { VaultVariableInput } from "../secrets/variables.ts";
  import { lockVaultLocally, readVaultKeys, readVaultStatus, subscribeVaultLock, vaultCall } from "../secrets/client.ts";
  import { VaultError, type ApprovedOperation, type CredentialBinding, type CredentialReference, type VaultKey, type VaultStatus } from "../secrets/types.ts";

  let { operation, initial, variables = [], disabled = false, portalZIndex = 40, onChange }: { operation: Operation; initial?: CredentialBinding | undefined; variables?: VaultVariableInput[] | undefined;
    disabled?: boolean; portalZIndex?: number; onChange: (binding: CredentialBinding | undefined) => void } = $props();
  let status = $state<VaultStatus>({ exists: false, unlocked: false, revision: 0, epoch: 0, methods: [] });
  let credentials = $state<VaultKey[]>([]);
  let descriptor = $state.raw<ApprovedOperation>();
  let alternative = $state("");
  let choices = $state<Record<string, CredentialReference>>({});
  let manualBinding = $state.raw<CredentialBinding>();
  let connectionBinding = $state.raw<CredentialBinding>();
  let connectionSelected = $state(false);
  let error = $state("");
  let busy = $state(false);
  let authentication = $state.raw<VaultAuthentication>();
  let mounted = false;
  const fieldId = $props.id();
  let revision = 0;
  const options = $derived(operation.security?.map((option, index) => ({ value: String(index),
    label: option.length ? option.map(item => item.name).join(" + ") : "Without credentials", disabled: !supportedSecurityAlternative(option) })) ?? []);
  const selected = $derived.by(() => {
    const option = alternative === "" ? undefined : operation.security?.[Number(alternative)];
    return supportedSecurityAlternative(option) ? option : undefined;
  });
  const unavailable = $derived([...new Set(operation.security?.flatMap(option => option.flatMap(scheme => scheme.kind === "unsupported" ? [scheme.reason] : [])) ?? [])]);
  function permitted(item: VaultKey, scheme: string): boolean {
    const kind = selected?.find(item => item.name === scheme)?.kind;
    return kind === "basic" || item.kind === "secret" || item.kind === kind
      || selected?.some(candidate => candidate.name === scheme
        && credentialSelectionForVariables([[candidate]], variables)?.credentials[scheme] === item.id) === true;
  }
  function choice(name: string, part?: "username" | "password"): string {
    const reference = choices[name];
    return part ? reference && typeof reference === "object" ? reference[part] : "" : typeof reference === "string" ? reference : "";
  }
  function basicChoice(name: string, part: "username" | "password", id: string) {
    const previous = choices[name];
    choices = { ...choices, [name]: { ...(previous && typeof previous === "object" ? previous : { username: "", password: "" }), [part]: id } };
    changed();
  }
  function changed() {
    error = "";
    const selection = selected;
    if (!descriptor || !selection || selection.length && !status.unlocked) { manualBinding = undefined; publish(); return; }
    const entries = selection.map(scheme => [scheme.name, choices[scheme.name] ?? ""] as const);
    if (entries.some(([name, reference]) => {
      const scheme = selection.find(scheme => scheme.name === name)!;
      if (scheme.kind === "basic") return !isBasicCredentialReference(reference)
        || [reference.username, reference.password].some(id => !credentials.some(item => item.id === id && permitted(item, name)));
      return typeof reference !== "string" || !credentials.some(item => item.id === reference && permitted(item, name));
    })) { manualBinding = undefined; publish(); return; }
    manualBinding = validateCredentialBinding({ alternative: Number(alternative), credentials: Object.fromEntries(entries), fingerprint: descriptor.fingerprint });
    publish();
  }
  function publish() { onChange(connectionSelected ? connectionBinding : manualBinding); }
  async function refresh() {
    const request = ++revision;
    busy = true; error = "";
    try {
      const next = await approvedOperation(operation, workflowExecutionForOperation(operation).origin);
      const latest = await readVaultStatus();
      const list = (await readVaultKeys()).entries;
      if (!mounted || request !== revision) return;
      const first = !descriptor;
      descriptor = next; status = latest; credentials = list;
      if (first && initial?.fingerprint === next.fingerprint) {
        alternative = String(initial.alternative); choices = { ...initial.credentials };
      } else if (first && !initial) {
        const connected = credentialSelectionForVariables(operation.security, variables);
        if (connected) { alternative = String(connected.alternative); choices = connected.credentials; }
      }
      changed();
    } catch (cause) { if (mounted && request === revision) error = cause instanceof VaultError ? cause.message : "Credential choices are unavailable."; }
    finally { if (mounted && request === revision) busy = false; }
  }
  async function unlock() {
    if (!authentication) return;
    const request = revision;
    busy = true; error = "";
    try {
      const proof = await authentication.proof();
      try {
        if (!mounted || request !== revision) throw new VaultError("CANCELLED");
        await vaultCall("unlock", [proof]);
      }
      finally { if ("prf" in proof) proof.prf.fill(0); }
      if (mounted && request === revision) await refresh();
    } catch (cause) { if (mounted && request === revision) error = cause instanceof VaultError ? cause.message : "The vault could not be unlocked."; }
    finally { if (mounted && request === revision) busy = false; }
  }
  onMount(() => {
    mounted = true; void refresh();
    const stop = subscribeVaultLock(() => {
      revision++; busy = false; status = { ...status, unlocked: false };
      authentication?.clear(); manualBinding = undefined; connectionBinding = undefined; onChange(undefined);
      const request = revision;
      void readVaultKeys().then(index => { if (mounted && request === revision) credentials = index.entries; }).catch(() => {});
    });
    return () => {
      mounted = false; revision++; authentication?.clear(); stop();
      if (busy) lockVaultLocally();
    };
  });
</script>

<fieldset class="credential-selection" disabled={disabled || busy}>
  <legend>Credentials</legend>
  {#if descriptor}
    <HttpConnectionSelector {descriptor} {status} manual={manualBinding}
      initial={initial?.fingerprint === descriptor.fingerprint ? initial.connection : undefined} disabled={disabled || busy} {portalZIndex}
      onSelect={(binding, selected) => { connectionSelected = selected; connectionBinding = binding;
        if (binding) alternative = String(binding.alternative);
        else if (!selected) { alternative = manualBinding ? String(manualBinding.alternative) : ""; choices = { ...manualBinding?.credentials }; }
        publish(); }} />
  {/if}
  {#if operation.oauthScopes}<p class="hint">Use an existing OAuth access token. The API checks its scopes and validity.</p>{/if}
  {#if !connectionSelected}
  <FieldSelect id={`${fieldId}-alternative`} label="Authentication alternative" value={alternative} options={options}
    disabled={disabled || busy} {portalZIndex}
    onValueChange={value => { alternative = value; choices = {}; changed(); }} />
  {/if}
  {#each unavailable as reason}<p class="hint">{reason}</p>{/each}
  {#if selected?.length}
    {#if descriptor}<p class="destination"><strong>{operation.method}</strong> {descriptor.origin}{operation.path}</p>{/if}
    {#if !status.exists}<p>Create a vault and add credentials in Settings → Secrets.</p>
    {:else}
        {#if !connectionSelected}{#each selected as scheme, index (scheme.name)}
          <div class="credential-choice">
            {#if scheme.kind === "basic"}
              <p class="credential-name">{scheme.name} · {scheme.header}</p>
              <p class="hint">Choose stored username and password or API token values. Usernames cannot contain a colon.</p>
              <label for={`${fieldId}-credential-${index}-username`}>Username</label>
              <FieldSelect id={`${fieldId}-credential-${index}-username`} label={`Username for ${scheme.name}`} value={choice(scheme.name, "username")}
                disabled={disabled || busy} {portalZIndex} options={credentials.map(item => ({ value: item.id, label: item.label }))}
                onValueChange={value => basicChoice(scheme.name, "username", value)} />
              <label for={`${fieldId}-credential-${index}-password`}>Password or API token</label>
              <FieldSelect id={`${fieldId}-credential-${index}-password`} label={`Password or token for ${scheme.name}`} value={choice(scheme.name, "password")}
                disabled={disabled || busy} {portalZIndex} options={credentials.map(item => ({ value: item.id, label: item.label }))}
                onValueChange={value => basicChoice(scheme.name, "password", value)} />
            {:else}
            <label for={`${fieldId}-credential-${index}-value`}>{scheme.name} · {scheme.header ?? scheme.query}</label>
            <FieldSelect id={`${fieldId}-credential-${index}-value`} label={`Credential for ${scheme.name}`} value={choice(scheme.name)}
              disabled={disabled || busy} {portalZIndex}
              options={credentials.filter(item => permitted(item, scheme.name)).map(item => ({ value: item.id, label: item.label }))}
              onValueChange={value => { choices = { ...choices, [scheme.name]: value }; changed(); }} />
            {/if}
          </div>
        {/each}{/if}
      {#if !status.unlocked}<VaultAuthentication bind:this={authentication} {status} disabled={disabled || busy} {portalZIndex}
        label="Unlock the vault" />{/if}
      {#if !status.unlocked}<button type="button" onclick={unlock}>Unlock</button>{/if}
    {/if}
  {/if}
  <button type="button" onclick={refresh}>Refresh credentials</button>
  {#if error}<p role="alert">{error}</p>{/if}
</fieldset>

<style>
  .credential-selection { display: grid; gap: 12px; min-width: 0; margin: 12px 0; padding: 14px; border: 0; border-radius: 4px; background: var(--color-surface); --field-background: var(--color-background); --field-foreground: var(--color-foreground); }
  .credential-selection :global(.field-select-value.placeholder) { color: var(--color-muted-foreground); }
  legend { font-weight: 700; padding: 0; }
  p { margin: 0; font-size: 12px; overflow-wrap: anywhere; }
  .credential-choice { display: grid; gap: 8px; }
  label, .credential-name { font-size: 12px; font-weight: 700; }
  button { justify-self: start; border: 0; border-radius: 4px; padding: 8px 12px; background: var(--color-background); color: var(--color-foreground); font-weight: 700; }
  [role="alert"] { color: var(--color-error-foreground); }
</style>
