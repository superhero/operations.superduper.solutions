<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import { validateWorkflowBinary, workflowBinaryBlob } from "$lib/workflow-binary.ts";
  let { value }: { value: unknown } = $props();
  const file = $derived.by(() => { try { return validateWorkflowBinary(value); } catch { return undefined; } });
  function download() {
    if (!file) return;
    const url = URL.createObjectURL(workflowBinaryBlob(file));
    const link = document.createElement("a");
    link.href = url; link.download = file.name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
</script>

{#if file}
  <div class="binary-response">
    <p><strong>{file.name}</strong> · {file.mediaType} · {file.size.toLocaleString()} bytes</p>
    <button type="button" onclick={download}><MaterialIcon name="download" size={18} /><span>Download file</span></button>
  </div>
{:else}<p>Binary response unavailable.</p>{/if}

<style>
  .binary-response { padding: 12px; background: var(--color-report-card); font-size: 12px; overflow-wrap: anywhere; }
  p { margin: 0 0 12px; }
  button { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--color-surface); border-radius: 4px; padding: 9px 14px;
    background: var(--color-primary); color: var(--color-primary-foreground); font-weight: 700; cursor: pointer; }
</style>
