<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { onMount, tick } from "svelte";
  import FieldInteger from "$lib/components/FieldInteger.svelte";
  import FieldSelect from "$lib/components/FieldSelect.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import VaultAuthentication from "$lib/components/VaultAuthentication.svelte";
  import { operations } from "$lib/catalog.ts";
  import { workflowExecutionForOperation } from "$lib/workflow-execution.ts";
  import { approvedOperation } from "$lib/secrets/policy.ts";
  import { enrollPasskey } from "$lib/secrets/passkeys.ts";
  import { loadVaultPreferences, lockVault, lockVaultLocally, readVaultStatus, saveVaultPreferences, subscribeVaultLock, vaultCall, vaultCeremony } from "$lib/secrets/client.ts";
  import { defaultVaultPreferences, safeVaultError, VaultError, vaultLimits, type ApprovedOperation, type CredentialSummary,
    type Enrollment, type UnlockProof, type VaultStatus } from "$lib/secrets/types.ts";

  type Authentication = { proof: () => Promise<UnlockProof>; clear: () => void };
  const emptyStatus: VaultStatus = { exists: false, unlocked: false, revision: 0, epoch: 0, methods: [] };
  const methodNames = { password: "Password", recovery: "Recovery key", passkey: "Passkey" };
  const createFormId = $props.id();
  let status = $state<VaultStatus>(emptyStatus);
  let records = $state<CredentialSummary[]>([]);
  let preferences = $state({ ...defaultVaultPreferences });
  let idleMinutes = $state(String(defaultVaultPreferences.idleLockMinutes));
  const maximumIdleMinutes = 7 * 24 * 60;
  let ready = $state(false);
  let busy = $state(false);
  let progress = $state("");
  let error = $state("");
  let notice = $state("");
  let panel: HTMLElement;
  let authentication = $state.raw<Authentication>();
  let restoreAuthentication = $state.raw<Authentication>();
  let recoveryOutput = $state.raw<HTMLTextAreaElement>();
  let recoveryMode = $state<"create" | "replace" | null>(null);
  let credentialId = $state("");
  let credentialLabel = $state("");
  let credentialKind = $state<"bearer" | "apiKey">("bearer");
  let grantCredential = $state("");
  let grantOperation = $state("");
  let grantScheme = $state("");
  let grantDescriptor = $state.raw<ApprovedOperation | null>(null);
  let operationOptions = $state<{ value: string; label: string }[]>([]);
  let passwordReplacement = $state("");
  let recoveryReplacement = $state("");
  let showRotation = $state(false);
  let restoreStatus = $state<VaultStatus | null>(null);
  let restoreFilename = $state("");
  let restoreInput = $state.raw<HTMLInputElement>();
  let restorePayload = "";
  let generation = 0;
  let reviewGeneration = 0;
  let disposed = false;
  const rotationAuthentication: Record<string, Authentication> = {};
  const selectedCredential = $derived(records.find(item => item.id === grantCredential));
  const schemeOptions = $derived([...new Map((grantDescriptor?.operation.security?.flat() ?? [])
    .filter(scheme => scheme.kind === selectedCredential?.kind).map(scheme => [scheme.name,
      { value: scheme.name, label: `${scheme.name} · ${scheme.header}` }])).values()]);
  const selectedScheme = $derived(grantDescriptor?.operation.security?.flat().find(scheme => scheme.name === grantScheme));

  function wipe(proof: UnlockProof): void { if ("prf" in proof) proof.prf.fill(0); else proof.secret = ""; }
  function clearInputs(): void {
    panel?.querySelectorAll<HTMLInputElement>("input[data-vault-sensitive]").forEach(input => { input.value = ""; });
    authentication?.clear(); restoreAuthentication?.clear();
    for (const component of Object.values(rotationAuthentication)) component?.clear();
  }
  function clearRecovery(): void { if (recoveryOutput) recoveryOutput.value = ""; recoveryMode = null; }
  function cancelRecovery(): void { clearInputs(); clearRecovery(); lockVaultLocally(); }
  function clearRestore(): void { restorePayload = ""; restoreStatus = null; restoreFilename = ""; if (restoreInput) restoreInput.value = ""; }
  function take(name: string): string {
    const input = panel.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    const value = input?.value ?? "";
    if (input) input.value = "";
    return value;
  }
  function locked(): void {
    generation++; reviewGeneration++; clearInputs(); clearRecovery(); clearRestore();
    records = []; grantDescriptor = null; status = { ...status, unlocked: false }; showRotation = false; busy = false; progress = "";
  }
  async function refresh(): Promise<void> {
    const current = generation;
    const next = await readVaultStatus();
    const items = next.unlocked ? await vaultCall("list", []) : [];
    if (current !== generation || disposed) return;
    status = next; records = items;
    operationOptions = operations.filter(operation => operation.security?.some(option => option.length))
      .map(operation => ({ value: operation.id, label: `${operation.name} · ${operation.method} ${operation.path}` }));
    if (!items.some(item => item.id === grantCredential)) grantCredential = items[0]?.id ?? "";
  }
  async function run(message: string, action: () => Promise<void>): Promise<void> {
    if (busy) return;
    const current = generation;
    busy = true; progress = message; error = ""; notice = "";
    try { await action(); }
    catch (failure) { if (current === generation && !disposed) error = safeVaultError(failure).message; }
    finally { clearInputs(); if (current === generation && !disposed) { busy = false; progress = ""; } }
  }
  async function manualLock(): Promise<void> {
    try { await lockVault(); }
    catch (failure) { if (!disposed) error = safeVaultError(failure).message; }
  }
  async function fresh<T>(action: (proof: UnlockProof) => Promise<T>): Promise<T> {
    if (!authentication) throw new VaultError("AUTHENTICATION");
    const proof = await authentication.proof();
    try { return await action(proof); } finally { wipe(proof); }
  }
  async function create(): Promise<void> {
    const current = generation;
    let password = take("create-password");
    const matches = password === take("confirm-password");
    if (!matches || password.length < 4) { password = ""; error = "Enter matching passwords with at least 4 characters."; return; }
    let recovery = "";
    try {
      recovery = await vaultCall("prepareCreate", [password]);
      password = "";
      await presentRecovery("create", recovery, current);
    } finally { password = ""; recovery = ""; }
  }
  async function confirmRecovery(): Promise<void> {
    let confirmation = take("confirm-recovery");
    try {
      if (!confirmation || confirmation !== recoveryOutput?.value) { error = "The recovery keys do not match. Enter the saved key to verify it."; return; }
      if (recoveryMode === "create") await vaultCall("confirmCreate", [confirmation]);
      else await fresh(proof => vaultCall("addMethod", [proof, { kind: "recovery", secret: confirmation }, recoveryReplacement || undefined]));
      clearRecovery(); await refresh(); notice = "Recovery key verified and saved. Keep your copy outside this browser.";
    } finally { confirmation = ""; }
  }
  async function saveCredential(): Promise<void> {
    const input = { ...(credentialId ? { id: credentialId } : {}), label: credentialLabel, kind: credentialKind, value: take("credential-value") };
    try { await fresh(proof => vaultCall("put", [proof, input])); }
    finally { input.value = ""; }
    credentialId = ""; credentialLabel = ""; await refresh(); notice = "Credential saved.";
  }
  function editCredential(item: CredentialSummary): void {
    clearInputs(); credentialId = item.id; credentialLabel = item.label; credentialKind = item.kind;
    panel.querySelector<HTMLInputElement>('input[name="credential-value"]')?.focus();
  }
  async function reviewGrant(id: string): Promise<void> {
    grantOperation = id; grantDescriptor = null; grantScheme = "";
    const revision = ++reviewGeneration;
    const operation = operations.find(item => item.id === id);
    if (!operation) return;
    try {
      const descriptor = await approvedOperation(operation, workflowExecutionForOperation(operation).origin);
      if (revision === reviewGeneration && !disposed) {
        grantDescriptor = descriptor;
        grantScheme = descriptor.operation.security?.flat().find(scheme => scheme.kind === selectedCredential?.kind)?.name ?? "";
      }
    } catch (failure) { if (revision === reviewGeneration) error = safeVaultError(failure).message; }
  }
  async function approveGrant(): Promise<void> {
    const operation = operations.find(item => item.id === grantOperation);
    if (!operation || !grantDescriptor || !grantScheme) throw new VaultError("PERMISSION");
    const current = await approvedOperation(operation, workflowExecutionForOperation(operation).origin);
    if (current.fingerprint !== grantDescriptor.fingerprint) throw new VaultError("PERMISSION");
    await fresh(proof => vaultCall("grant", [proof, grantCredential, grantScheme, current]));
    await refresh(); notice = "Destination approved for this credential.";
  }
  async function changePassword(): Promise<void> {
    const material: Enrollment = { kind: "password", secret: take("new-password") };
    try {
      if (material.secret.length < 4 || material.secret !== take("new-password-confirm")) { error = "Enter matching passwords with at least 4 characters."; return; }
      await fresh(proof => vaultCall("addMethod", [proof, material, passwordReplacement || undefined]));
      await refresh(); notice = "Password method saved. Other unlock methods remain available.";
    } finally { material.secret = ""; }
  }
  async function addPasskey(): Promise<void> {
    await fresh(async proof => {
      const material = await vaultCeremony(signal => enrollPasskey(signal));
      try { await vaultCall("addMethod", [proof, material]); } finally { material.prf.fill(0); }
    });
    await refresh(); notice = "Passkey verified and added.";
  }
  async function prepareRecovery(): Promise<void> {
    const current = generation;
    let recovery = await fresh(proof => vaultCall("prepareRecovery", [proof]));
    try { await presentRecovery("replace", recovery, current); }
    finally { recovery = ""; }
  }
  async function presentRecovery(mode: "create" | "replace", value: string, current: number): Promise<void> {
    if (current !== generation || disposed) throw new VaultError("CANCELLED");
    recoveryMode = mode;
    await tick();
    if (current !== generation || disposed) throw new VaultError("CANCELLED");
    if (recoveryOutput) recoveryOutput.value = value;
  }
  async function rotate(): Promise<void> {
    const proofs: UnlockProof[] = [];
    try {
      for (const method of status.methods) {
        const component = rotationAuthentication[method.id];
        if (!component) throw new VaultError("AUTHENTICATION");
        proofs.push(await component.proof());
      }
      await vaultCall("rotate", [proofs]); showRotation = false; await refresh(); notice = "Vault encryption key rotated. Save a new encrypted export.";
    } finally { proofs.forEach(wipe); }
  }
  async function exportVault(): Promise<void> {
    const content = await fresh(proof => vaultCall("backup", [proof]));
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "operations-secrets-vault.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0); notice = "Encrypted export downloaded. Its unlock methods are those saved in that export.";
  }
  async function selectRestore(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0]; input.value = "";
    if (!file) return;
    await run("Reading encrypted export…", async () => {
      const current = generation;
      clearRestore();
      if (file.size > vaultLimits.backupBytes) throw new VaultError("LIMIT");
      const content = await file.text();
      if (current !== generation || disposed) throw new VaultError("CANCELLED");
      let parsed: unknown;
      try { parsed = JSON.parse(content); } catch { throw new VaultError("INVALID"); }
      if (!parsed || typeof parsed !== "object" || !("envelopes" in parsed) || !Array.isArray(parsed.envelopes)
        || !parsed.envelopes.length || parsed.envelopes.length > 16) throw new VaultError("INVALID");
      const ids = new Set<string>();
      const methods: VaultStatus["methods"] = parsed.envelopes.map(value => {
        if (!value || typeof value !== "object" || typeof value.id !== "string" || value.id.length > 128 || ids.has(value.id)
          || !["password", "recovery", "passkey"].includes(value.kind))
          throw new VaultError("INVALID");
        ids.add(value.id);
        return { id: value.id, kind: value.kind,
          ...(typeof value.credentialId === "string" ? { credentialId: value.credentialId } : {}),
          ...(typeof value.prfSalt === "string" ? { prfSalt: value.prfSalt } : {}) };
      });
      restorePayload = content; restoreFilename = file.name;
      restoreStatus = { ...emptyStatus, exists: true, methods };
    });
  }
  async function restore(): Promise<void> {
    if (!restoreAuthentication || !restorePayload) throw new VaultError("INVALID");
    const proof = await restoreAuthentication.proof();
    let currentProof: UnlockProof | undefined;
    try {
      if (status.exists) { if (!authentication) throw new VaultError("AUTHENTICATION"); currentProof = await authentication.proof(); }
      await vaultCall("restore", [restorePayload, proof, currentProof]);
      clearRestore(); await refresh(); notice = "Vault imported. Approve destinations again before using its credentials.";
    } finally { wipe(proof); if (currentProof) wipe(currentProof); }
  }
  async function saveIdle(enabled: boolean, minutes: number): Promise<void> {
    await saveVaultPreferences({ idleLockEnabled: enabled, idleLockMinutes: minutes });
    preferences = { idleLockEnabled: enabled, idleLockMinutes: minutes };
    idleMinutes = String(minutes);
  }

  onMount(() => {
    const unsubscribe = subscribeVaultLock(locked);
    void run("Loading secrets vault…", async () => { preferences = await loadVaultPreferences(); idleMinutes = String(preferences.idleLockMinutes); await refresh(); ready = true; });
    return () => { disposed = true; generation++; unsubscribe(); if (busy || recoveryMode) lockVaultLocally(); clearInputs(); clearRecovery(); clearRestore(); };
  });
</script>

{#snippet vaultImport()}
  <input bind:this={restoreInput} type="file" accept=".json,application/json" aria-label="Encrypted vault export" onchange={event => void selectRestore(event)} hidden />
  {#if restoreStatus}
    <p class="destination">Selected export: {restoreFilename}</p>
    <VaultAuthentication bind:this={restoreAuthentication} status={restoreStatus} disabled={busy} label="Export" />
    {#if status.exists}<p class="help">Also authenticate the current vault using the form above before replacing it.</p>{/if}
    <div class="actions"><button type="button" disabled={busy} onclick={() => run(status.exists ? "Replacing vault…" : "Importing vault…", restore)}>{status.exists ? "Authenticate and replace vault" : "Authenticate and import vault"}</button>
      <button type="button" disabled={busy} onclick={() => { clearInputs(); clearRestore(); }}>Cancel</button></div>
  {/if}
{/snippet}

<section bind:this={panel} class="secrets-settings" aria-label="Secrets vault">
  <div class="toolbar vault-status">
    <p class="help"><strong>{ready ? status.exists ? status.unlocked ? "Vault unlocked" : "Vault locked" : "No vault has been created:" : "Secrets vault"}</strong>{#if ready && !status.exists}{" "}Use a vault to help protect stored data required as input in the workflows.{/if}</p>
    {#if status.unlocked || busy}
      <div class="actions">
        {#if status.unlocked}<button type="button" onclick={() => void manualLock()}>Lock vault</button>
        {:else}<button type="button" onclick={() => void manualLock()}>Cancel action</button>{/if}
      </div>
    {/if}
  </div>
  <div class="vault-info" role="note">
    <p class="help"><strong>Credentials provided are encrypted:</strong> Managed by the browser profile for this site.</p>
  </div>
  <div class="vault-info" role="note">
    <p class="help"><strong>Automatic locking:</strong> Closing or reloading this page locks the vault. Switching tabs or minimizing the browser keeps it unlocked.</p>
  </div>
  <div class="vault-info" role="note">
    <p class="help"><strong>Exports:</strong> Keep an encrypted export and your recovery key in a safe place outside this browser.</p>
  </div>
  <div class="vault-info" role="note">
    <p class="help"><strong>Lost unlock methods can not be recovered:</strong> the vault storage is managed locally in the user’s browser.</p>
  </div>
  <div class="vault-info" role="note">
    <p class="help"><strong>Encrypted exports:</strong> you must retain the unlock method to be able to import a vault.</p>
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if progress || notice}<p class="notice" role="status">{progress || notice}</p>{/if}

  {#if ready && !status.exists && recoveryMode !== "create"}
    <div class="card">
      <form id={createFormId} class="vault-create-form" onsubmit={event => { event.preventDefault(); void run("Preparing vault…", create); }}>
        <label>New vault password<input name="create-password" type="password" minlength="4" required autocomplete="new-password" data-vault-sensitive disabled={busy} /></label>
        <label>Confirm vault password<input name="confirm-password" type="password" minlength="4" required autocomplete="new-password" data-vault-sensitive disabled={busy} /></label>
        <p class="help">You will verify a recovery key before the vault is saved.</p>
      </form>
      <div class="actions creation-actions">
        <button type="button" aria-label="Import vault" disabled={busy} onclick={() => restoreInput?.click()}><MaterialIcon name="upload" size={18} />Import</button>
        <button type="submit" form={createFormId} aria-label="Create vault" disabled={busy}><MaterialIcon name="add" size={18} />Create</button>
      </div>
      {@render vaultImport()}
    </div>
  {/if}

  {#if ready && status.exists}
    <form class="card" onsubmit={event => { event.preventDefault(); if (!status.unlocked) void run("Unlocking vault…", async () => { await fresh(proof => vaultCall("unlock", [proof])); await refresh(); }); }}>
      <h3>{status.unlocked ? "Confirm management actions" : "Unlock the vault"}</h3>
      <VaultAuthentication bind:this={authentication} {status} disabled={busy} label={status.unlocked ? "Confirm action" : "Unlock"} />
      {#if status.unlocked}<p class="help">Enter fresh authentication before each credential, destination, unlock-method or export change below.</p>
      {:else}<button disabled={busy}>Unlock vault</button>{/if}
    </form>
  {/if}

  {#if recoveryMode}
    <form class="card recovery" onsubmit={event => { event.preventDefault(); void run("Verifying recovery key…", confirmRecovery); }}>
      <h3>Save and verify your recovery key</h3>
      <p class="help">This is its only presentation. Save it securely, then enter the saved key below. Anyone with this key and an encrypted export can unlock that export.</p>
      <label>Recovery key<textarea bind:this={recoveryOutput} readonly rows="2" spellcheck="false" aria-label="Generated recovery key"></textarea></label>
      <label>Verify saved recovery key<input name="confirm-recovery" type="password" required autocomplete="off" spellcheck="false" data-vault-sensitive disabled={busy} /></label>
      <div class="actions"><button disabled={busy}>Verify and save recovery key</button><button type="button" disabled={busy} onclick={cancelRecovery}>Cancel and lock</button></div>
    </form>
  {/if}

  {#if ready && status.unlocked}
    <div class="card">
      <h3>Credentials</h3>
      {#if !records.length}<p class="help">No credentials saved.</p>{/if}
      <ul class="records">
        {#each records as item (item.id)}
          <li><div class="record-heading"><div><strong>{item.label}</strong><small>{item.kind === "bearer" ? "Bearer token" : "Header API key"} · {item.grants.length} approved destinations</small></div>
            <div class="actions"><button type="button" disabled={busy} onclick={() => editCredential(item)}>Replace</button>
              <button type="button" disabled={busy} onclick={() => run("Removing credential…", async () => { await fresh(proof => vaultCall("remove", [proof, item.id])); await refresh(); })}>Remove</button></div></div>
            {#each item.grants as grant (grant.id)}
              <div class="grant"><span>{grant.descriptor.operation.method} {grant.descriptor.origin}{grant.descriptor.operation.path}<small>{grant.scheme}</small></span>
                <button type="button" disabled={busy} onclick={() => run("Revoking destination…", async () => { await fresh(proof => vaultCall("revoke", [proof, item.id, grant.id])); await refresh(); })}>Revoke</button></div>
            {/each}
          </li>
        {/each}
      </ul>
      <form class="subform" onsubmit={event => { event.preventDefault(); void run("Saving credential…", saveCredential); }}>
        <h4>{credentialId ? "Replace credential" : "Add credential"}</h4>
        <label>Credential label<input bind:value={credentialLabel} maxlength="120" required disabled={busy} /></label>
        <label for="vault-credential-kind">Credential type</label>
        <FieldSelect id="vault-credential-kind" label="Credential type" value={credentialKind} includePlaceholder={false} disabled={busy}
          options={[{ value: "bearer", label: "Bearer token" }, { value: "apiKey", label: "Header API key" }]}
          onValueChange={value => credentialKind = value as "bearer" | "apiKey"} />
        <label>{credentialId ? "Replacement value" : "Credential value"}<input name="credential-value" type="password" required autocomplete="off" spellcheck="false" data-vault-sensitive disabled={busy} /></label>
        <div class="actions"><button disabled={busy}>Save credential</button><button type="button" disabled={busy} onclick={() => { clearInputs(); credentialId = ""; credentialLabel = ""; }}>Cancel</button></div>
      </form>
    </div>

    {#if records.length}
      <form class="card" onsubmit={event => { event.preventDefault(); void run("Approving destination…", approveGrant); }}>
        <h3>Approve a destination</h3>
        <label for="vault-grant-credential">Credential</label>
        <FieldSelect id="vault-grant-credential" label="Approval credential" value={grantCredential} options={records.map(item => ({ value: item.id, label: item.label }))}
          includePlaceholder={false} disabled={busy} onValueChange={value => { grantCredential = value; grantScheme = ""; void reviewGrant(grantOperation); }} />
        <label for="vault-grant-operation">Operation</label>
        <FieldSelect id="vault-grant-operation" label="Approval operation" value={grantOperation} options={operationOptions} disabled={busy} onValueChange={value => void reviewGrant(value)} />
        {#if grantDescriptor}
          <p class="destination"><strong>{grantDescriptor.operation.method}</strong> {grantDescriptor.origin}{grantDescriptor.operation.path}</p>
          <label for="vault-grant-scheme">Authentication scheme</label>
          <FieldSelect id="vault-grant-scheme" label="Approval authentication scheme" value={grantScheme} options={schemeOptions} disabled={busy} onValueChange={value => grantScheme = value} />
          {#if selectedScheme}<p class="help">This credential may be sent in the {selectedScheme.header} header for this operation. Approval expires when the operation definition or destination changes.</p>{/if}
        {/if}
        <button disabled={busy || !grantDescriptor || !grantScheme}>Approve destination</button>
        <p class="help">Revocation stops future use in this vault. It cannot undo a request already received by an API or invalidate copies held elsewhere.</p>
      </form>
    {/if}

    <div class="card">
      <h3>Unlock methods</h3>
      <ul class="records">{#each status.methods as method, index (method.id)}<li class="record-heading"><span>{methodNames[method.kind]} {index + 1}</span>
        <button type="button" disabled={busy || status.methods.length < 2} onclick={() => run("Removing unlock method…", async () => { await fresh(proof => vaultCall("removeMethod", [proof, method.id])); await refresh(); })}>Remove method</button></li>{/each}</ul>
      <p class="help">Use a different retained method to authenticate removal. Removing a method does not change previously downloaded exports.</p>
      <form class="subform" onsubmit={event => { event.preventDefault(); void run("Saving password method…", changePassword); }}>
        <h4>Password</h4>
        <FieldSelect id="vault-password-replacement" label="Password method to replace" value={passwordReplacement} disabled={busy}
          options={status.methods.filter(method => method.kind === "password").map((method, index) => ({ value: method.id, label: `Replace password ${index + 1}` }))}
          onValueChange={value => passwordReplacement = value} />
        <p class="help">Leave the method unselected to add another password.</p>
        <label>New password<input name="new-password" type="password" minlength="4" required autocomplete="new-password" data-vault-sensitive disabled={busy} /></label>
        <label>Confirm new password<input name="new-password-confirm" type="password" minlength="4" required autocomplete="new-password" data-vault-sensitive disabled={busy} /></label>
        <button disabled={busy}>Save password method</button>
      </form>
      <div class="subform"><h4>Recovery key</h4>
        <FieldSelect id="vault-recovery-replacement" label="Recovery method to replace" value={recoveryReplacement} disabled={busy || recoveryMode !== null}
          options={status.methods.filter(method => method.kind === "recovery").map((method, index) => ({ value: method.id, label: `Replace recovery key ${index + 1}` }))}
          onValueChange={value => recoveryReplacement = value} />
        <p class="help">Leave the method unselected to add a recovery key. The new key must be saved and verified before it replaces a method.</p>
        <button type="button" disabled={busy || recoveryMode !== null} onclick={() => run("Generating recovery key…", prepareRecovery)}>Generate recovery key</button>
      </div>
      <div class="subform"><h4>Passkey</h4><p class="help">Use an authenticator that supports passkey encryption. A failed enrollment leaves your existing methods intact.</p>
        <button type="button" disabled={busy} onclick={() => run("Verifying passkey…", addPasskey)}>Add passkey</button></div>
      <div class="subform"><h4>Rotate vault encryption key</h4><p class="help">Verify every retained unlock method to re-encrypt the current vault. Older exports keep their original keys and methods.</p>
        {#if showRotation}
          {#each status.methods as method, index (method.id)}
            <VaultAuthentication bind:this={rotationAuthentication[method.id]} status={{ ...status, methods: [method] }} disabled={busy} label={`Verify ${methodNames[method.kind].toLowerCase()} ${index + 1}`} />
          {/each}
          <div class="actions"><button type="button" disabled={busy} onclick={() => run("Rotating vault key…", rotate)}>Verify all and rotate key</button>
            <button type="button" disabled={busy} onclick={() => { clearInputs(); showRotation = false; }}>Cancel</button></div>
        {:else}<button type="button" disabled={busy} onclick={() => showRotation = true}>Prepare key rotation</button>{/if}
      </div>
    </div>
  {/if}

  {#if ready && status.exists}
    <div class="card">
      <h3>Encrypted vault exports</h3>
      <p class="help">Importing replaces any existing vault in this browser and removes imported destination approvals. Exports are encrypted; keep their password, recovery key or passkey available.</p>
      <div class="actions">{#if status.unlocked}<button type="button" disabled={busy} onclick={() => run("Preparing encrypted export…", exportVault)}>Export encrypted vault</button>{/if}
        <button type="button" disabled={busy} onclick={() => restoreInput?.click()}>Import vault</button></div>
      {@render vaultImport()}
    </div>
  {/if}
  {#if ready}
    <div class="card">
      <button class="idle-toggle" type="button" role="switch" aria-checked={preferences.idleLockEnabled} disabled={busy}
        onclick={() => void run("Saving lock preference…", () => saveIdle(!preferences.idleLockEnabled, preferences.idleLockMinutes))}>
        <span>Lock after inactivity</span><span class="default-switch" aria-hidden="true"><span></span></span>
      </button>
      <div class="idle-control">
        <FieldInteger id="vault-idle-minutes" label="Minutes of inactivity" value={idleMinutes}
          minimum={1} maximum={maximumIdleMinutes} required disabled={busy || !preferences.idleLockEnabled}
          onValueChange={value => { idleMinutes = value; }}
          onValueCommit={() => {
            const minutes = Number(idleMinutes);
            if (Number.isInteger(minutes) && minutes >= 1 && minutes <= maximumIdleMinutes)
              void run("Saving lock preference…", () => saveIdle(preferences.idleLockEnabled, minutes));
          }} />
        <span aria-hidden="true">min</span>
      </div>
      <p class="help">Idle locking is optional. Closing or reloading this page always locks the vault.</p>
    </div>
  {/if}
</section>

<style>
  .secrets-settings { display: grid; gap: 12px; min-width: 0; padding: 16px; color: var(--color-foreground); --field-background: var(--color-background); --field-foreground: var(--color-foreground); }
  .toolbar, .record-heading, .grant { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .creation-actions { justify-content: flex-end; }
  .creation-actions button { display: inline-flex; align-items: center; gap: 6px; }
  .card, .subform, .vault-create-form { display: grid; gap: 10px; min-width: 0; }
  .card { padding: 14px; border-radius: 4px; background: var(--color-surface); }
  .vault-info { display: grid; gap: 10px; }
  .vault-info, .vault-status { padding: 14px; border-radius: 4px; background: var(--color-emphasis); color: var(--color-background); }
  .subform { padding-top: 12px; border-top: 1px solid var(--color-background); }
  h3, h4, p { margin: 0; }
  h3 { font-size: 14px; } h4, label, strong { font-size: 12px; }
  label { display: grid; gap: 8px; font-weight: 700; }
  input:not([type="checkbox"]), textarea { box-sizing: border-box; min-width: 0; width: 100%; min-height: 40px; padding: 8px 12px; border: 0; border-radius: 4px; background: var(--color-background); color: var(--color-foreground); }
  .idle-control { display: flex; align-items: stretch; min-width: 0; border-radius: 4px; background: var(--color-background); outline: 2px solid transparent; outline-offset: 2px; transition: outline-color 180ms ease-in; }
  .idle-control:focus-within, .idle-control:hover:has(:enabled) { outline-color: var(--color-ring); }
  .idle-control :global(.field-integer) { flex: 1; min-width: 0; padding-right: 4px; }
  .idle-control :global(.field-integer :is(.integer-range, .integer-value):is(:hover, :focus-visible)) { outline: none; }
  .idle-control > span { display: flex; align-items: center; padding: 0 8px; }
  @media (prefers-reduced-motion: no-preference) {
    .idle-control :global(.integer-range) { transition: transform 180ms ease-in; }
    .idle-control :global(.integer-range:hover:enabled) { transform: scale(1.10); }
  }
  textarea { resize: vertical; overflow-wrap: anywhere; font-family: monospace; }
  :global(.secrets-settings .field-select-trigger) { border-radius: 4px; font-size: 12px; }
  button { width: fit-content; padding: 8px 12px; border: 0; border-radius: 4px; background: var(--color-primary); color: var(--color-primary-foreground); font-size: 12px; font-weight: 700; cursor: pointer; }
  button:disabled { opacity: .55; cursor: not-allowed; }
  .help, .notice, .destination, small { font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
  .records { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
  .records li { display: grid; gap: 10px; padding: 10px; border: 1px solid var(--color-background); border-radius: 4px; }
  .records li.record-heading { display: flex; }
  small { display: block; font-weight: 400; }
  .grant > span { min-width: 0; flex: 1; font-size: 12px; overflow-wrap: anywhere; }
  .destination { padding: 10px; border-radius: 4px; background: var(--color-background); }
  .error { padding: 10px 12px; border-radius: 4px; background: var(--color-error-background); color: var(--color-error-foreground); font-size: 12px; overflow-wrap: anywhere; }
  .idle-toggle { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; min-height: 44px; padding: 10px 12px; background: var(--color-background); color: var(--color-catalog-foreground); text-align: left; }
  .default-switch { box-sizing: border-box; flex-shrink: 0; width: 40px; height: 24px; padding: 3px; border-radius: 4px; background: var(--color-muted-foreground); transition: background-color 180ms ease-in, transform 180ms ease-in; }
  .default-switch > span { display: block; width: 18px; height: 18px; border-radius: 2px; background: var(--color-surface); transform: translateX(0); transition: transform 180ms ease-in, background-color 180ms ease-in; }
  .idle-toggle[aria-checked="true"] .default-switch { background: var(--color-catalog-active); }
  .idle-toggle[aria-checked="true"] .default-switch > span { transform: translateX(16px); background: var(--color-catalog-active-foreground); }
  @media (prefers-reduced-motion: no-preference) { .idle-toggle:hover:enabled .default-switch { transform: scale(1.10); } }
  @media (prefers-reduced-motion: reduce) { .default-switch, .default-switch > span { transition: none; } }
</style>
