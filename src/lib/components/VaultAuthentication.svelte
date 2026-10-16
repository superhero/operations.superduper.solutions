<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import FieldSelect from "./FieldSelect.svelte";
  import { lockVaultLocally, subscribeVaultLock, vaultCeremony } from "../secrets/client.ts";
  import { unlockPasskey } from "../secrets/passkeys.ts";
  import { VaultError, type UnlockProof, type VaultStatus } from "../secrets/types.ts";

  let { status, disabled = false, label = "Authenticate", portalZIndex = 40 }: {
    status: VaultStatus; disabled?: boolean; label?: string; portalZIndex?: number;
  } = $props();
  const id = $props.id();
  let methodId = $state("");
  let secretInput = $state.raw<HTMLInputElement>();
  let pendingPasskey = false;
  const names = { password: "Password", recovery: "Recovery key", passkey: "Passkey" };
  const options = $derived(status.methods.map((method, index) => ({ value: method.id,
    label: `${names[method.kind]}${status.methods.filter(item => item.kind === method.kind).length > 1 ? ` ${index + 1}` : ""}` })));
  const method = $derived(status.methods.find(item => item.id === methodId));

  export function clear(): void { if (secretInput) secretInput.value = ""; }

  export async function proof(): Promise<UnlockProof> {
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
  <label for={`${id}-method`}>{label} method</label>
  <FieldSelect id={`${id}-method`} label={`${label} method`} value={methodId} {options} includePlaceholder={false} {disabled} {portalZIndex}
    onValueChange={value => { clear(); methodId = value; }} />
  {#if method && method.kind !== "passkey"}
    {#if method.kind === "password"}
      <input type="hidden" name="username" autocomplete="username" value="Operations vault" />
    {/if}
    <label for={`${id}-secret`}>{label} {method.kind === "password" ? "password" : "recovery key"}</label>
    {#key methodId}
    <input bind:this={secretInput} id={`${id}-secret`} type="password" data-vault-sensitive spellcheck="false" autocapitalize="off"
      name={method.kind === "password" ? "vault-password" : "vault-recovery-key"}
      autocomplete={method.kind === "password" ? "current-password" : "off"}
      data-1p-ignore={method.kind === "recovery" ? true : undefined}
      data-lpignore={method.kind === "recovery" ? "true" : undefined} {disabled} />
    {/key}
  {:else if method}
    <p>Your authenticator will ask you to verify this action.</p>
  {:else}
    <p>No unlock method is available.</p>
  {/if}
</div>

<style>
  .vault-authentication { display: grid; gap: 8px; min-width: 0; --field-background: var(--color-background); --field-foreground: var(--color-foreground); }
  label { font-size: 12px; font-weight: 700; }
  input { min-width: 0; width: 100%; min-height: 40px; padding: 8px 12px; border: 0; border-radius: 4px; background: var(--color-background); color: var(--color-foreground); }
  :global(.vault-authentication .field-select-trigger) { border-radius: 4px; font-size: 12px; }
  p { margin: 0; font-size: 12px; line-height: 1.5; }
</style>
