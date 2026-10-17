<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { getContext, onMount } from "svelte";
  import { Handle, Position, type Node, type NodeProps } from "@xyflow/svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import VaultVariableAccess from "$lib/components/VaultVariableAccess.svelte";
  import { subscribeVaultLock } from "$lib/secrets/client.ts";
  import type { VaultVariableData } from "$lib/workflow-document.ts";
  import "./workflow-utility-nodes.css";
  let { id, data, selected }: NodeProps<Node<VaultVariableData, "vault">> = $props();
  const select = getContext<(id: string, credentialId: string) => void>("workflow-vault-variable");
  const editorActive = getContext<() => boolean>("workflow-editor-active");
  let open = $state(false);
  let label = $state<{ id: string; name: string }>();
  onMount(() => subscribeVaultLock(() => { label = undefined; }));
  $effect(() => { if (!editorActive()) open = false; });
</script>
<div class="workflow-utility-node workflow-vault-node" class:selected>
  <div class="utility-title"><MaterialIcon name="variable_add" size={20} /><strong>{label?.id === data.credentialId ? label?.name : "Vault variable"}</strong><span class="utility-type">Text</span></div>
  <div class="utility-row nodrag nopan nokey">
    <button type="button" class="utility-value" onclick={() => open = true} disabled={!editorActive()}>
      {data.credentialId ? "Change vault variable" : "Select vault variable"}
    </button>
    <Handle id="value" type="source" position={Position.Right} isConnectableEnd={false} aria-label="Vault variable output (Text)" />
  </div>
</div>
<Modal bind:open title="Select vault variable">
  {#if open}<VaultVariableAccess selected={data.credentialId ?? ""} onselect={(credentialId, name) => { select(id, credentialId); label = { id: credentialId, name }; open = false; }} />{/if}
</Modal>
<style>
  button { text-align: left; cursor: pointer; }
</style>
