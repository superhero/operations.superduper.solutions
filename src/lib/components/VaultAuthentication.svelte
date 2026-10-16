<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { onDestroy, onMount, type Snippet } from "svelte";
  import FieldSelect from "./FieldSelect.svelte";
  import { lockVaultLocally, subscribeVaultLock, vaultCeremony } from "../secrets/client.ts";
  import { unlockPasskey } from "../secrets/passkeys.ts";
  import { VaultError, recoveryKeyCharacters, type UnlockProof, type VaultStatus } from "../secrets/types.ts";

  let { status, disabled = false, label = "Authenticate", portalZIndex = 40, action, inputLabel, detectMethod = false }: {
    status: VaultStatus; disabled?: boolean; label?: string; portalZIndex?: number; action?: Snippet | undefined; inputLabel?: string | undefined; detectMethod?: boolean;
  } = $props();
  const id = $props.id();
  let methodId = $state("");
  let secretInput = $state.raw<HTMLInputElement>();
  let pendingPasskey = false;
  const automatic = $derived(detectMethod || label === "Unlock");
  let usePasskey = $state(false);
  let automaticRecovery = $state(false);
  const names = { password: "Password", recovery: "Recovery key", passkey: "Passkey" };
  const options = $derived(status.methods.map((method, index) => ({ value: method.id,
    label: `${names[method.kind]}${status.methods.filter(item => item.kind === method.kind).length > 1 ? ` ${index + 1}` : ""}` })));
  const method = $derived(status.methods.find(item => item.id === methodId));

  export function clear(): void { if (secretInput) secretInput.value = ""; automaticRecovery = false; }

  export async function proof(): Promise<UnlockProof> {
    if (automatic && !usePasskey) {
      const secret = secretInput?.value ?? "";
      clear();
      if (!secret) throw new VaultError("AUTHENTICATION");
      return { methodId: "auto", secret };
    }
    const selected = method;
    if (!selected) throw new VaultError("AUTHENTICATION");
    if (selected.kind === "passkey") {
      clear();
      if (!selected.credentialId || !selected.prfSalt) throw new VaultError("AUTHENTICATION");
      const material = { credentialId: selected.credentialId, prfSalt: selected.prfSalt };
      pendingPasskey = true;
      try { return { methodId: selected.id, prf: await vaultCeremony(signal => unlockPasskey(material, signal)) }; }
      finally { pendingPasskey = false; }
    }
    const secret = secretInput?.value ?? "";
    clear();
    if (!secret) throw new VaultError("AUTHENTICATION");
    return { methodId: selected.id, secret };
  }

  $effect(() => {
    if (!status.methods.some(item => item.id === methodId)) {
      methodId = status.methods.find(item => item.kind === "password")?.id ?? status.methods[0]?.id ?? "";
      clear();
    }
  });
  onMount(() => subscribeVaultLock(clear));
  onDestroy(() => { clear(); if (pendingPasskey) lockVaultLocally(); });
</script>

<div class="vault-authentication">
  {#if automatic}
    {#if !usePasskey}
      <input type="hidden" name="username" autocomplete="username" value="Operations vault" />
      <label for={`${id}-automatic-secret`}>{inputLabel ?? "Password, or recovery key to unlock vault"}</label>
      <div class="unlock-field">
      <input bind:this={secretInput} id={`${id}-automatic-secret`} type="password" name="vault-password"
        aria-label={inputLabel ?? "Unlock password, or recovery key"} autocomplete={automaticRecovery ? "off" : "current-password"}
        data-1p-ignore={automaticRecovery ? true : undefined} data-lpignore={automaticRecovery ? "true" : undefined}
        oninput={event => { automaticRecovery = event.currentTarget.value.length === recoveryKeyCharacters; }}
        data-vault-sensitive spellcheck="false" autocapitalize="off" {disabled} />
      {@render action?.()}
      </div>
      {#each status.methods.filter(item => item.kind === "passkey") as passkey, index}
        <button type="button" {disabled} onclick={() => { clear(); methodId = passkey.id; usePasskey = true; }}>Use passkey{index > 0 ? ` ${index + 1}` : ""}</button>
      {/each}
    {:else}
      <p>Your authenticator will ask you to verify this action.</p>
      {@render action?.()}
      <button type="button" {disabled} onclick={() => { clear(); usePasskey = false; }}>Use password, or recovery key</button>
    {/if}
  {:else}
  {#if options.length > 1}
  <label for={`${id}-method`}>{label} method</label>
  <FieldSelect id={`${id}-method`} label={`${label} method`} value={methodId} {options} includePlaceholder={false} {disabled} {portalZIndex}
    onValueChange={value => { clear(); methodId = value; }} />
  {/if}
  {#if method && method.kind !== "passkey"}
    {#if method.kind === "password"}
      <input type="hidden" name="username" autocomplete="username" value="Operations vault" />
    {/if}
    <label for={`${id}-secret`}>{inputLabel ?? `${label} ${method.kind === "password" ? "password" : "recovery key"}`}</label>
    <div class={action ? "unlock-field" : "authentication-input"}>
    {#key methodId}
    <input bind:this={secretInput} id={`${id}-secret`} type="password" data-vault-sensitive spellcheck="false" autocapitalize="off"
      name={method.kind === "password" ? "vault-password" : "vault-recovery-key"}
      autocomplete={method.kind === "password" ? "current-password" : "off"}
      data-1p-ignore={method.kind === "recovery" ? true : undefined}
      data-lpignore={method.kind === "recovery" ? "true" : undefined} {disabled} />
    {/key}
    {@render action?.()}
    </div>
  {:else if method}
    <p>Your authenticator will ask you to verify this action.</p>
    {@render action?.()}
  {:else}
    <p>No unlock method is available.</p>
  {/if}
  {/if}
</div>

<style>
  .vault-authentication { display: grid; gap: 8px; min-width: 0; --field-background: var(--color-background); --field-foreground: var(--color-foreground); }
  .authentication-input { display: contents; }
  .unlock-field { display: flex; min-width: 0; border-radius: 4px; background: var(--color-background); outline: 3px solid transparent; outline-offset: 3px; transition: outline-color 180ms ease-in; }
  .unlock-field:focus-within, .unlock-field:hover:has(:enabled) { outline-color: var(--color-ring); }
  .unlock-field > input { flex: 1; width: 0; border-radius: 4px 0 0 4px; outline: none; }
  .unlock-field :global(.unlock-vault) { outline: none; }
  label { font-size: 12px; font-weight: 700; }
  input { min-width: 0; width: 100%; min-height: 40px; padding: 8px 12px; border: 0; border-radius: 4px; background: var(--color-background); color: var(--color-foreground); }
  :global(.vault-authentication .field-select-trigger) { border-radius: 4px; font-size: 12px; }
  button { justify-self: start; padding: 8px 12px; border: 0; border-radius: 4px; background: var(--color-background); color: inherit; font: inherit; cursor: pointer; }
  p { margin: 0; font-size: 12px; line-height: 1.5; }
</style>
