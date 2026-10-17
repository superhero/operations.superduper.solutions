<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { onMount, tick } from "svelte";
  import { slide } from "svelte/transition";
  import { cubicInOut } from "svelte/easing";
  import HintButton from "$lib/components/HintButton.svelte";
  import FieldInteger from "$lib/components/FieldInteger.svelte";
  import FieldSelect from "$lib/components/FieldSelect.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import VaultAuthentication from "$lib/components/VaultAuthentication.svelte";
  import { enrollPasskey } from "$lib/secrets/passkeys.ts";
  import { loadVaultPreferences, lockVault, lockVaultLocally, readVaultKeys, readVaultStatus, saveVaultPreferences, subscribeVaultLock, vaultCall, vaultCeremony } from "$lib/secrets/client.ts";
  import { defaultVaultPreferences, safeVaultError, VaultError, vaultLimits, type VaultKey,
    type Enrollment, type UnlockProof, type VaultStatus } from "$lib/secrets/types.ts";

  type Authentication = { proof: () => Promise<UnlockProof>; clear: () => void };
  const emptyStatus: VaultStatus = { exists: false, unlocked: false, revision: 0, epoch: 0, methods: [] };
  const methodNames = { password: "Password", recovery: "Recovery key", passkey: "Passkey" };
  const createFormId = $props.id();
  let status = $state<VaultStatus>(emptyStatus);
  let records = $state<VaultKey[]>([]);
  let preferences = $state({ ...defaultVaultPreferences });
  let idleMinutes = $state(String(defaultVaultPreferences.idleLockMinutes));
  const maximumIdleMinutes = 7 * 24 * 60;
  let ready = $state(false);
  let busy = $state(false);
  let idleSaving = $state(false);
  let progress = $state("");
  let error = $state("");
  let notice = $state("");
  let panel: HTMLElement;
  let authentication = $state.raw<Authentication>();
  let replacementAuthentication = $state.raw<Authentication>();
  let restoreAuthentication = $state.raw<Authentication>();
  let passkeyAuthentication = $state.raw<Authentication>();
  let passwordAuthentication = $state.raw<Authentication>();
  let showPassword = $state(false);
  let passwordError = $state("");
  let showPasskey = $state(false);
  let passkeyError = $state("");
  let recoveryOutput = $state.raw<HTMLPreElement>();
  let recoveryMode = $state<"create" | "rotate" | null>(null);
  let credentialId = $state("");
  let credentialLabel = $state("");
  let passwordReplacement = $state("");
  let showRotation = $state(false);
  let restoreStatus = $state<VaultStatus | null>(null);
  let restoreFilename = $state("");
  let restoreInput = $state.raw<HTMLInputElement>();
  let restorePayload = "";
  let generation = 0;
  let disposed = false;
  const rotationAuthentication: Record<string, Authentication> = {};
  function wipe(proof: UnlockProof): void { if ("prf" in proof) proof.prf.fill(0); else proof.secret = ""; }
  function clearInputs(): void {
    panel?.querySelectorAll<HTMLInputElement>("input[data-vault-sensitive]").forEach(input => { input.value = ""; });
    authentication?.clear(); replacementAuthentication?.clear(); restoreAuthentication?.clear(); passkeyAuthentication?.clear(); passwordAuthentication?.clear();
    for (const component of Object.values(rotationAuthentication)) component?.clear();
  }
  function clearRecovery(): void { if (recoveryOutput) recoveryOutput.textContent = ""; recoveryMode = null; }
  function clearRestore(): void { restorePayload = ""; restoreStatus = null; restoreFilename = ""; if (restoreInput) restoreInput.value = ""; }
  function take(name: string): string {
    const input = panel.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    const value = input?.value ?? "";
    if (input) input.value = "";
    return value;
  }
  function locked(): void {
    generation++; clearInputs(); clearRecovery(); clearRestore();
    status = { ...status, unlocked: false }; showRotation = false; showPassword = false; passwordError = ""; showPasskey = false; passkeyError = ""; busy = false; progress = "";
    const current = generation;
    if (!disposed) void readVaultKeys().then(index => {
      if (!disposed && current === generation) records = index.entries.toSorted((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }) || a.label.localeCompare(b.label));
    }).catch(() => { /* The next explicit action reports storage failures. */ });
  }
  async function refresh(): Promise<void> {
    const current = generation;
    const next = await readVaultStatus();
    const items = (await readVaultKeys()).entries;
    if (current !== generation || disposed) return;
    status = next; records = items.toSorted((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }) || a.label.localeCompare(b.label));

  }
  async function run(message: string, action: () => Promise<void>): Promise<void> {
    if (busy) return;
    const current = generation;
    busy = true; progress = message; error = ""; if (message) notice = "";
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
    if (!matches || password.length < 3) { password = ""; error = "Enter matching passwords with at least 3 characters."; return; }
    let recovery = "";
    try {
      recovery = await vaultCall("prepareCreate", [password]);
      password = "";
      await presentRecovery("create", recovery, current);
    } finally { password = ""; recovery = ""; }
  }
  async function copyRecovery(): Promise<void> {
    const current = generation;
    try {
      if (recoveryOutput?.textContent) await navigator.clipboard.writeText(recoveryOutput.textContent);
    } catch (failure) {
      if (current === generation && !disposed) error = "Could not copy the recovery key. Select and copy it manually.";
    }
  }
  function downloadRecoveryKey(value: string): void {
    const url = URL.createObjectURL(new Blob([value + "\n"], { type: "text/plain" }));
    const link = document.createElement("a"); link.href = url; link.download = "operations-vault-recovery-key.txt"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  async function confirmRecovery(): Promise<void> {
    let confirmation = recoveryOutput?.textContent ?? "";
    try {
      if (!confirmation) throw new VaultError("INVALID");
      if (recoveryMode === "create") await vaultCall("confirmCreate", [confirmation]);
      downloadRecoveryKey(confirmation);
      clearRecovery(); await refresh(); notice = "Recovery key saved. Keep the downloaded key in a safe place.";
    } finally { confirmation = ""; }
  }
  async function saveCredential(): Promise<void> {
    const input = { ...(credentialId ? { id: credentialId } : {}), label: credentialLabel, kind: credentialId ? records.find(item => item.id === credentialId)!.kind : "secret" as const, value: take("credential-value") };
    try { await vaultCall("put", [null, input]); }
    finally { input.value = ""; }
    credentialId = ""; credentialLabel = ""; await refresh();
  }
  async function copyCredential(id: string): Promise<void> {
    let value = await vaultCall("copyCredential", [id]);
    try { await navigator.clipboard.writeText(value); }
    finally { value = ""; }
  }
  async function changePassword(): Promise<void> {
    const current = generation;
    passwordError = "";
    const material: Enrollment = { kind: "password", secret: take("new-password") };
    let proof: UnlockProof | undefined;
    try {
      if (material.secret.length < 3 || material.secret !== take("new-password-confirm")) { passwordError = "Enter matching passwords with at least 3 characters."; return; }
      if (!passwordAuthentication) throw new VaultError("AUTHENTICATION");
      proof = await passwordAuthentication.proof();
      await vaultCall("addMethod", [proof, material, passwordReplacement || undefined]);
      await refresh();
      if (current !== generation || disposed) return;
      showPassword = false; notice = passwordReplacement ? "Password replaced." : "Password added.";
    } catch (failure) {
      if (current === generation && !disposed) passwordError = safeVaultError(failure).message;
    } finally { material.secret = ""; if (proof) wipe(proof); }
  }
  async function addPasskey(): Promise<void> {
    const current = generation;
    passkeyError = "";
    let enrolling = false;
    let proof: UnlockProof | undefined;
    try {
      if (!passkeyAuthentication) throw new VaultError("AUTHENTICATION");
      proof = await passkeyAuthentication.proof();
      enrolling = true;
      const material = await vaultCeremony(signal => enrollPasskey(signal));
      enrolling = false;
      try { await vaultCall("addMethod", [proof, material]); } finally { material.prf.fill(0); }
      await refresh();
      if (current !== generation || disposed) return;
      showPasskey = false; notice = "Passkey verified and added.";
    } catch (failure) {
      if (current === generation && !disposed) {
        const safe = safeVaultError(failure);
        passkeyError = enrolling && safe.code === "UNAVAILABLE"
          ? "Passkey encryption (WebAuthn PRF) is unavailable in this browser or passkey provider. Your existing vault is unchanged."
          : safe.message;
      }
    } finally { if (proof) wipe(proof); }
  }
  async function presentRecovery(mode: "create" | "rotate", value: string, current: number): Promise<void> {
    if (current !== generation || disposed) throw new VaultError("CANCELLED");
    recoveryMode = mode;
    await tick();
    if (current !== generation || disposed) throw new VaultError("CANCELLED");
    if (recoveryOutput) recoveryOutput.textContent = value;
  }
  async function rotate(): Promise<void> {
    const current = generation;
    const proofs: UnlockProof[] = [];
    try {
      for (const method of status.methods.filter(method => method.kind !== "recovery")) {
        const component = rotationAuthentication[method.id];
        if (!component) throw new VaultError("AUTHENTICATION");
        proofs.push(await component.proof());
      }
      let result = await vaultCall("rotate", [proofs]);
      showRotation = false;
      try {
        downloadRecoveryKey(result.recovery);
        await refresh(); await presentRecovery("rotate", result.recovery, current);
      }
      finally { result.recovery = ""; }
      notice = "Vault encryption key rotated. Your new recovery key was downloaded. Save a new encrypted export.";
    } finally { proofs.forEach(wipe); }
  }
  function downloadVault(content: string, filename = "operations-secrets-vault.json"): void {
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  async function exportVault(): Promise<void> {
    const content = await vaultCall("backup", []);
    downloadVault(content);
    notice = "Encrypted export downloaded. Its unlock methods are those saved in that export.";
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
      if (status.exists) { if (!replacementAuthentication) throw new VaultError("AUTHENTICATION"); currentProof = await replacementAuthentication.proof(); }
      let previousExport: string | undefined;
      if (currentProof) {
        previousExport = await vaultCall("backup", [currentProof, true]);
        if (JSON.parse(previousExport).records.length > 0)
          downloadVault(previousExport, "operations-secrets-vault-before-replacement.json");
      }
      await vaultCall("restore", [restorePayload, proof, currentProof, previousExport]);
      clearRestore(); await refresh(); notice = "Vault imported.";
    } finally { wipe(proof); if (currentProof) wipe(currentProof); }
  }
  async function saveIdle(enabled: boolean, minutes: number): Promise<void> {
    if (idleSaving || busy) return;
    const current = generation;
    idleSaving = true;
    try {
      await saveVaultPreferences({ idleLockEnabled: enabled, idleLockMinutes: minutes });
      if (current !== generation || disposed) return;
      preferences = { idleLockEnabled: enabled, idleLockMinutes: minutes };
      idleMinutes = String(minutes);
    } catch (failure) {
      if (current === generation && !disposed) error = safeVaultError(failure).message;
    } finally { idleSaving = false; }
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
    {#if status.exists}<VaultAuthentication bind:this={replacementAuthentication} {status} disabled={busy} label="Current vault" detectMethod inputLabel="Password, or recovery key for the current vault" />{/if}
    <div class="actions"><button type="button" disabled={busy} onclick={() => run(status.exists ? "Replacing vault…" : "Importing vault…", restore)}>{status.exists ? "Authenticate and replace vault" : "Authenticate and import vault"}</button>
      <button type="button" disabled={busy} onclick={() => { clearInputs(); clearRestore(); }}>Cancel</button></div>
  {/if}
{/snippet}

<section bind:this={panel} class="secrets-settings" aria-label="Secrets vault">
  {#if !status.exists}
  <div class="toolbar vault-status">
    <div class="vault-status-message">
      <MaterialIcon name="brightness_alert" size={18} />
      <p class="help"><strong>{ready ? "No vault has been created:" : "Secrets vault"}</strong>{#if ready && !status.exists}{" "}Use a vault to help protect stored data required as input in the workflows.{/if}</p>
    </div>
    {#if busy}
      <div class="actions">
        <button type="button" onclick={() => void manualLock()}>Cancel action</button>
      </div>
    {/if}
  </div>
  {/if}
  <div class="vault-info" role="note">
    <MaterialIcon name="brightness_alert" size={18} />
    <p class="help"><strong>Vault storage is encrypted:</strong> Data in the vault is stored locally in this browser profile for this site, encrypted.</p>
  </div>
  <div class="vault-info" role="note">
    <MaterialIcon name="brightness_alert" size={18} />
    <p class="help"><strong>Automatic locking:</strong> Closing or reloading this page locks the vault.</p>
  </div>
  <div class="vault-info" role="note">
    <MaterialIcon name="brightness_alert" size={18} />
    <p class="help"><strong>Encrypted exports:</strong> Exported vault files remain encrypted. Importing one requires its password, recovery key or passkey.</p>
  </div>
  <div class="vault-info" role="note">
    <MaterialIcon name="brightness_alert" size={18} />
    <p class="help"><strong>Lost unlock methods can not be recovered:</strong> the vault storage is managed locally in the user’s browser.</p>
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if progress || notice}<p class="notice" role="status">{progress || notice}</p>{/if}

  {#if ready && !status.exists && recoveryMode !== "create"}
    <div class="card">
      <form id={createFormId} class="vault-create-form" onsubmit={event => { event.preventDefault(); void run("Preparing vault…", create); }}>
        <input type="hidden" name="username" autocomplete="username" value="Operations vault" />
        <label>New vault password<input name="create-password" type="password" minlength="3" required autocomplete="new-password" data-vault-sensitive disabled={busy} /></label>
        <label>Confirm vault password<input name="confirm-password" type="password" minlength="3" required autocomplete="new-password" data-vault-sensitive disabled={busy} /></label>
      </form>
      <div class="actions creation-actions">
        <button type="button" aria-label="Import vault" disabled={busy} onclick={() => restoreInput?.click()}><MaterialIcon name="upload" size={18} />Import</button>
        <button type="submit" form={createFormId} aria-label="Create vault" disabled={busy}><MaterialIcon name="add" size={18} />Create</button>
      </div>
      {@render vaultImport()}
    </div>
  {/if}

  {#if ready && status.exists && !status.unlocked}
    <form class="card" onsubmit={event => { event.preventDefault(); if (!status.unlocked) void run("", async () => { await fresh(proof => vaultCall("unlock", [proof])); await refresh(); }); }}>
      <VaultAuthentication bind:this={authentication} {status} disabled={busy} label="Unlock">
        {#snippet action()}{#if !status.unlocked}<button class="unlock-vault" type="submit" aria-label="Unlock vault" disabled={busy}><MaterialIcon name="password" size={20} /></button>{/if}{/snippet}
      </VaultAuthentication>
    </form>
  {/if}

  {#if recoveryMode}
    <div class="card recovery" data-1p-ignore data-lpignore="true">
      <span class="recovery-label">Recovery key</span>
      <div class="recovery-key">
        <pre bind:this={recoveryOutput} aria-label="Generated recovery key"></pre>
        <HintButton label="Copy" aria-label="Copy recovery key" disabled={busy} onclick={() => void copyRecovery()}>
          {#snippet child({ props })}<button {...props} class="recovery-copy" type="button"><MaterialIcon name="content_copy" size={18} /></button>{/snippet}
        </HintButton>
      </div>
      <p class="help">This is its only presentation. Save it securely. Anyone with this key and an encrypted export can unlock that export.</p>
      <div class="actions recovery-actions"><button type="button" disabled={busy} onclick={() => void run("Saving recovery key…", confirmRecovery)}><MaterialIcon name="download" size={18} />Save recovery key</button></div>
    </div>
  {/if}

  {#if ready && status.unlocked}
    <div class="card">
      <form class="subform" onsubmit={event => { event.preventDefault(); void run("Saving credential…", saveCredential); }}>
        {#if credentialId}<h4>Replace credential</h4>{/if}
        <div class="credential-fields">
          <input aria-label="Credential label" placeholder="Key" bind:value={credentialLabel} maxlength="120" required disabled={busy} />
          <input aria-label={credentialId ? "Replacement value" : "Credential value"} placeholder="Value" name="credential-value" type="password" required autocomplete="off" spellcheck="false" data-vault-sensitive disabled={busy} />
          <button class="credential-save" type="submit" aria-label="Save credential" disabled={busy}><MaterialIcon name="save" size={20} /><span>Save</span></button>
        </div>
        {#if credentialId}<div class="actions"><button type="button" disabled={busy} onclick={() => { clearInputs(); credentialId = ""; credentialLabel = ""; }}>Cancel</button></div>{/if}
      </form>
    </div>
  {/if}
    {#if ready && records.length}
    <div class="card">
      <ul class="records">
        {#each records as item (item.id)}
          <li><div class="record-heading"><div><strong>{item.label}</strong></div>
            <div class="actions"><button type="button" disabled={busy || !status.unlocked} onclick={() => run("", () => copyCredential(item.id))}><MaterialIcon name="content_copy" size={18} />Copy</button>
              <button type="button" disabled={busy || !status.unlocked} onclick={() => run("Removing credential…", async () => { await vaultCall("remove", [null, item.id]); await refresh(); })}><MaterialIcon name="delete" size={18} />Remove</button></div></div>

          </li>
        {/each}
      </ul>
    </div>
    {/if}
  {#if ready && status.unlocked}
    <div class="card">
      <div class="idle-settings">
      <button class="idle-toggle" type="button" role="switch" aria-checked={preferences.idleLockEnabled} disabled={busy || idleSaving}
        onclick={() => void saveIdle(!preferences.idleLockEnabled, preferences.idleLockMinutes)}>
        <span>Lock after inactivity</span><span class="default-switch" aria-hidden="true"><span></span></span>
      </button>
      <div class="idle-control" class:disabled={busy || idleSaving || !preferences.idleLockEnabled}>
        <FieldInteger id="vault-idle-minutes" label="Minutes of inactivity" value={idleMinutes}
          minimum={1} maximum={maximumIdleMinutes} required disabled={busy || idleSaving || !preferences.idleLockEnabled}
          onValueChange={value => { idleMinutes = value; }}
          onValueCommit={() => {
            const minutes = Number(idleMinutes);
            if (Number.isInteger(minutes) && minutes >= 1 && minutes <= maximumIdleMinutes)
              void saveIdle(preferences.idleLockEnabled, minutes);
          }} />
        <span aria-hidden="true">min</span>
      </div>
      </div>
    </div>
  {/if}
  {#if ready && status.unlocked}
    <div class="card rotation-card">
      <div class="vault-password-row">
        <button type="button" disabled={busy} aria-expanded={showPassword} aria-controls={`${createFormId}-password`}
          onclick={() => { clearInputs(); passwordError = ""; if (!showPassword) passwordReplacement = status.methods.find(method => method.kind === "password")?.id ?? ""; showPassword = !showPassword; }}><MaterialIcon name={showPassword ? "backspace" : "password"} size={18} />{showPassword ? "Cancel" : status.methods.some(method => method.kind === "password") ? "Replace password" : "Add password"}</button>
        <p class="help">Change the vault password. Your stored data and recovery key remain unchanged.</p>
      </div>
      {#if showPassword}
        <form id={`${createFormId}-password`} class="rotation-body" inert={!showPassword}
          onsubmit={event => { event.preventDefault(); void run("", changePassword); }}
          transition:slide={{ duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 240, easing: cubicInOut }}>
          {#if status.methods.filter(method => method.kind === "password").length > 1}
            <FieldSelect id="vault-password-replacement" label="Password to replace" value={passwordReplacement} disabled={busy} includePlaceholder={false}
              options={status.methods.filter(method => method.kind === "password").map((method, index) => ({ value: method.id, label: `Password ${index + 1}` }))}
              onValueChange={value => { passwordAuthentication?.clear(); passwordReplacement = value; }} />
          {/if}
          <label>New password<input name="new-password" type="password" minlength="3" required autocomplete="new-password" data-vault-sensitive disabled={busy} /></label>
          <label for={`${createFormId}-new-password-confirm`}>Confirm new password</label>
          <input id={`${createFormId}-new-password-confirm`} name="new-password-confirm" type="password" minlength="3" required autocomplete="new-password" data-vault-sensitive disabled={busy} />
          <div class="password-verification-divider" role="separator"></div>
          <VaultAuthentication bind:this={passwordAuthentication}
            {status} detectMethod disabled={busy} label="Authorize password change" inputLabel="Password, or recovery key">
            {#snippet action()}
              <HintButton label="Verify and replace password" disabled={busy}>
                {#snippet child({ props })}<button {...props} class="unlock-vault" type="submit"><MaterialIcon name="password" size={20} /></button>{/snippet}
              </HintButton>
            {/snippet}
          </VaultAuthentication>
          {#if passwordError}<p class="error" role="alert"
            transition:slide={{ duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 240, easing: cubicInOut }}>{passwordError}</p>{/if}
        </form>
      {/if}
    </div>
    <div class="card rotation-card">
      <div class="vault-passkey-row">
        <button type="button" disabled={busy} aria-expanded={showPasskey} aria-controls={`${createFormId}-passkey`}
          onclick={() => { passkeyAuthentication?.clear(); passkeyError = ""; showPasskey = !showPasskey; }}><MaterialIcon name={showPasskey ? "backspace" : "passkey"} size={18} />{showPasskey ? "Cancel" : "Add passkey"}</button>
        <p class="help">Add a passkey to unlock this vault. Your provider must support passkey encryption.</p>
      </div>
      {#if showPasskey}
        {#snippet passkeyAction()}
          <HintButton label="Verify and add passkey" disabled={busy}>
            {#snippet child({ props })}<button {...props} class="unlock-vault" type="submit"><MaterialIcon name="password" size={20} /></button>{/snippet}
          </HintButton>
        {/snippet}
        <form id={`${createFormId}-passkey`} class="rotation-body" inert={!showPasskey}
          onsubmit={event => { event.preventDefault(); void run("", addPasskey); }}
          transition:slide={{ duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 240, easing: cubicInOut }}>
          <VaultAuthentication bind:this={passkeyAuthentication}
            status={{ ...status, methods: status.methods.some(method => method.kind === "password") ? status.methods.filter(method => method.kind === "password") : status.methods }}
            disabled={busy} label="Authorize passkey" inputLabel={status.methods.some(method => method.kind === "password") ? "Password" : undefined} action={passkeyAction} />
          {#if passkeyError}<p class="error" role="alert"
            transition:slide={{ duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 240, easing: cubicInOut }}>{passkeyError}</p>{/if}
        </form>
      {/if}
    </div>
    <div class="card rotation-card">
      <div class="vault-rotate-row">
        <button type="button" disabled={busy || !status.methods.some(method => method.kind !== "recovery")} aria-expanded={showRotation} aria-controls={`${createFormId}-rotation`} onclick={() => { if (showRotation) clearInputs(); showRotation = !showRotation; }}><MaterialIcon name={showRotation ? "backspace" : "lock_reset"} size={18} />{showRotation ? "Cancel" : "Rotate key"}</button>
        <p class="help">{status.methods.some(method => method.kind !== "recovery") ? "Rotate the vault’s encryption key and generate a new recovery key. Your password remains unchanged." : "Add a password or passkey before rotating keys."}</p>
      </div>
        {#if showRotation}
          {#snippet rotationAction()}
            <HintButton label="Verify and rotate recovery key" aria-label="Rotate key" disabled={busy} onclick={() => run("Rotating vault key…", rotate)}>
              {#snippet child({ props })}<button {...props} class="unlock-vault" type="button"><MaterialIcon name="password" size={20} /></button>{/snippet}
            </HintButton>
          {/snippet}
          <div id={`${createFormId}-rotation`} class="rotation-body" inert={!showRotation}
            transition:slide={{ duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 240, easing: cubicInOut }}>
          {#each status.methods.filter(method => method.kind !== "recovery") as method, index (method.id)}
            <VaultAuthentication bind:this={rotationAuthentication[method.id]} status={{ ...status, methods: [method] }} disabled={busy} label={`Verify ${methodNames[method.kind].toLowerCase()} ${index + 1}`}
              action={index === status.methods.filter(item => item.kind !== "recovery").length - 1 ? rotationAction : undefined}
              inputLabel={method.kind === "password" ? `Password${status.methods.filter(item => item.kind === "password").length > 1 ? ` ${status.methods.filter(item => item.kind === "password").findIndex(item => item.id === method.id) + 1}` : ""}` : undefined} />
          {/each}
          </div>
        {/if}
    </div>
  {/if}

  {#if ready && status.exists}
    <div class="card">
      <div class="vault-export-row">
        <button type="button" disabled={busy} onclick={() => run("", exportVault)}><MaterialIcon name="download" size={18} />Export vault</button>
        <p class="help">Exported vault data remains encrypted at rest and during transfer.</p>
      </div>
    </div>
  {/if}
  {#if ready && status.exists}
    <div class="card">
      <div class="vault-replace-row">
        <button type="button" disabled={busy} onclick={() => restoreInput?.click()}><MaterialIcon name="sync" size={18} />Replace vault</button>
        <p class="help">Importing replaces any existing vault in this browser. Exports are encrypted; keep their password, recovery key or passkey available.</p>
      </div>
      {@render vaultImport()}
    </div>
  {/if}

</section>

<style>
  .secrets-settings { display: grid; gap: 12px; min-width: 0; padding: 16px; color: var(--color-foreground); --field-background: var(--color-background); --field-foreground: var(--color-foreground); }
  .toolbar, .record-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .actions > button { display: inline-flex; align-items: center; gap: 6px; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .recovery-label { font-size: 12px; font-weight: 700; }
  .recovery-key { position: relative; min-width: 0; border-radius: 4px; background: var(--color-background); }
  .recovery-key pre { margin: 0; padding: 8px 40px 8px 8px; white-space: pre-wrap; overflow-wrap: anywhere; font-family: monospace; font-size: 12px; }
  .recovery-copy { position: absolute; top: 4px; right: 4px; display: grid; place-items: center; width: 32px; height: 32px; padding: 0; background: transparent; color: inherit; }
  .vault-replace-row, .vault-export-row, .vault-rotate-row, .vault-passkey-row, .vault-password-row { display: flex; align-items: center; gap: 12px; }
  .vault-replace-row > button, .vault-export-row > button, .vault-rotate-row > button, .vault-passkey-row > button, .vault-password-row > button { display: inline-flex; align-items: center; justify-content: flex-start; text-align: left; gap: 6px; flex: 0 0 160px; width: 160px; white-space: nowrap; }
  .vault-replace-row > p, .vault-export-row > p, .vault-rotate-row > p, .vault-passkey-row > p, .vault-password-row > p { min-width: 0; }
  .creation-actions, .recovery-actions { justify-content: flex-end; }
  .unlock-vault { display: grid; place-items: center; justify-self: end; flex-shrink: 0; align-self: stretch; min-width: 40px; border-radius: 0 4px 4px 0; }
  .unlock-vault:hover:enabled, .unlock-vault:focus { color: var(--color-background); }
  .creation-actions button, .recovery-actions button { display: inline-flex; align-items: center; gap: 6px; }
  .card, .subform, .vault-create-form { display: grid; gap: 10px; min-width: 0; }
  .rotation-card { gap: 0; }
  .password-verification-divider { height: 1px; margin: 6px 0; background: repeating-linear-gradient(to right, var(--color-background) 0 8px, transparent 8px 14px); }
  .rotation-body { display: grid; gap: 10px; margin-top: 16px; padding-top: 12px; background: repeating-linear-gradient(to right, var(--color-background) 0 8px, transparent 8px 14px) top / 100% 1px no-repeat; }
  .card { padding: 14px; border-radius: 4px; background: var(--color-surface); }
  .vault-info, .vault-status-message { display: flex; align-items: flex-start; gap: 10px; }
  .vault-status-message { flex: 1; min-width: 0; }
  :is(.vault-info, .vault-status-message) :global(.material-symbols-rounded) { flex-shrink: 0; margin-top: 1px; font-weight: 400; font-variation-settings: "FILL" 0, "wght" 400, "GRAD" 0, "opsz" 20; }
  .vault-info, .vault-status { padding: 14px; border-radius: 4px; background: var(--color-emphasis); color: var(--color-background); }
  .credential-fields { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 7fr) auto; align-items: end; gap: 12px; }
  .credential-save { display: flex; align-items: center; justify-content: center; gap: 6px; height: 40px; }
  @media (max-width: 640px) { .credential-fields { grid-template-columns: minmax(0, 1fr); } .credential-save { width: 100%; } }

  h4, p { margin: 0; }
  h4, label, strong { font-size: 12px; }
  label { display: grid; gap: 8px; font-weight: 700; }
  input:not([type="checkbox"]) { box-sizing: border-box; min-width: 0; width: 100%; min-height: 40px; padding: 8px 12px; border: 0; border-radius: 4px; background: var(--color-background); color: var(--color-foreground); }
  .idle-settings { display: flex; align-items: center; gap: 10px; border-radius: 4px; background: var(--color-background); }
  .idle-settings > .idle-toggle { flex: 0 0 auto; width: auto; background: transparent; }
  .idle-control { display: flex; flex: 1; align-items: stretch; min-width: 0; border-radius: 4px; background: transparent; outline: 2px solid transparent; outline-offset: 2px; transition: outline-color 180ms ease-in; }
  .idle-control:focus-within, .idle-control:hover:has(:enabled) { outline-color: var(--color-ring); }
  .idle-control :global(.field-integer) { flex: 1; min-width: 0; padding-right: 4px; }
  .idle-control :global(.field-integer :is(.integer-range, .integer-value)) { outline: none; }
  .idle-control > span { display: flex; align-items: center; padding: 0 8px; }
  .idle-control.disabled > span { color: var(--color-muted-foreground); }
  :global(.secrets-settings .field-select-trigger) { border-radius: 4px; font-size: 12px; }
  button { width: fit-content; padding: 8px 12px; border: 0; border-radius: 4px; background: var(--color-primary); color: var(--color-primary-foreground); font-size: 12px; font-weight: 700; cursor: pointer; }
  button:disabled { opacity: .55; cursor: not-allowed; }
  .help, .notice, .destination { font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
  .records { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
  .records li { display: grid; gap: 10px; padding: 2px 2px 2px 10px; border: 0; border-radius: 4px; background: var(--color-badge-background); color: var(--color-badge-foreground); }
  .records .actions { gap: 1px; flex-wrap: nowrap; }
  .records .actions > button:first-child { border-top-right-radius: 0; border-bottom-right-radius: 0; }
  .records .actions > button:last-child { border-top-left-radius: 0; border-bottom-left-radius: 0; }
  .destination { padding: 10px; border-radius: 4px; background: var(--color-background); }
  .error { padding: 10px 12px; border-radius: 4px; background: var(--color-error-background); color: var(--color-error-foreground); font-size: 12px; overflow-wrap: anywhere; }
  .idle-toggle { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; min-height: 44px; padding: 10px 12px; background: var(--color-background); color: var(--color-catalog-foreground); text-align: left; }
  .default-switch { box-sizing: border-box; flex-shrink: 0; width: 40px; height: 24px; padding: 3px; border-radius: 4px; background: var(--color-muted-foreground); transition: background-color 180ms ease-in, transform 180ms ease-in; }
  .default-switch > span { display: block; width: 18px; height: 18px; border-radius: 2px; background: var(--color-surface); transform: translateX(0); transition: transform 180ms ease-in, background-color 180ms ease-in; }
  .idle-toggle[aria-checked="true"] .default-switch { background: var(--color-catalog-active); }
  .idle-toggle[aria-checked="true"] .default-switch > span { transform: translateX(16px); background: var(--color-catalog-active-foreground); }
  @media (prefers-reduced-motion: no-preference) {
    .unlock-vault :global(.material-symbols-rounded) { transition: transform 180ms ease-in; }
    .unlock-vault:hover:enabled :global(.material-symbols-rounded), .unlock-vault:focus :global(.material-symbols-rounded) { transform: scale(1.2); }
    .idle-toggle:hover:enabled .default-switch { transform: scale(1.10); }
    .records .actions > button { transition: transform 180ms ease-in-out; }
    .records .actions > button:hover:enabled { transform: scale(1.05); }
    .credential-save { transition: transform 180ms ease-in-out; }
    .credential-save:hover:enabled { transform: scale(1.05); }
    .recovery-copy:hover:enabled { transform: scale(1.10); }
    :is(.creation-actions, .recovery-actions, .vault-replace-row, .vault-export-row, .vault-rotate-row, .vault-passkey-row, .vault-password-row) button:hover:enabled { transform: scale(1.05); }
  }
  @media (prefers-reduced-motion: reduce) { .default-switch, .default-switch > span { transition: none; } }
</style>
