<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { getContext, onMount } from "svelte";
  import { Handle, Position, type Node, type NodeProps } from "@xyflow/svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import WorkflowNodeSelect from "./WorkflowNodeSelect.svelte";
  import { readVaultKeys, subscribeVaultLock } from "$lib/secrets/client.ts";
  import type { VaultKey } from "$lib/secrets/types.ts";
  import type { VaultVariableData } from "$lib/workflow-document.ts";
  import "./workflow-utility-nodes.css";
  let { id, data, selected }: NodeProps<Node<VaultVariableData, "vault">> = $props();
  const select = getContext<(id: string, credentialId: string) => void>("workflow-vault-variable");
  const editorActive = getContext<() => boolean>("workflow-editor-active");
  let entries = $state<VaultKey[]>([]);
  let needsUnlock = $state(false);
  let error = $state("");
  let alive = false;
  let generation = 0;
  async function refresh() {
    const request = ++generation;
    try {
      const index = await readVaultKeys();
      if (alive && request === generation) {
        entries = index.entries; needsUnlock = index.needsUnlock; error = "";
      }
    } catch (cause) {
      if (alive && request === generation) error = cause instanceof Error ? cause.message : "Vault keys are unavailable.";
    }
  }
  onMount(() => {
    alive = true; void refresh();
    const stop = subscribeVaultLock(() => { void refresh(); });
    return () => { alive = false; generation++; stop(); };
  });

</script>
<div class="workflow-utility-node workflow-vault-node" class:selected>
  <div class="utility-title"><MaterialIcon name="variable_add" size={20} /><strong>Vault variable</strong></div>
  <div class="utility-row nodrag nopan nokey">
    <div class="vault-selection" onpointerenter={() => { void refresh(); }} onfocusin={() => { void refresh(); }}>
      <WorkflowNodeSelect label="Vault variable" value={data.credentialId ?? ""}
        choices={[{ value: "", label: "Select vault variable", placeholder: true }, ...entries.map(entry => ({ value: entry.id, label: entry.label, bold: true }))]}
        active={editorActive()} disabled={!entries.length}
        onchange={credentialId => select(id, credentialId)} />
    </div>
    <span class="utility-type">String</span>
    <Handle id="value" type="source" position={Position.Right} isConnectableEnd={false} aria-label="Vault variable output (Text)" />
  </div>
</div>
{#if needsUnlock}
  <p class="vault-key-notice">Unlock this older vault once in Settings → Secrets to publish its key names. Values remain encrypted.</p>
{:else if error}
  <p class="vault-key-notice" role="alert">{error}</p>
{/if}
<style>
  .vault-selection { flex: 1; min-width: 0; }
  .vault-key-notice { max-width: 260px; margin: 4px 0 0; font-size: 11px; color: var(--color-foreground); }
</style>
