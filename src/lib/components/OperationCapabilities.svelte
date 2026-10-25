<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import type { Operation } from "../catalog.ts";
  import { capabilityAreaLabels, readOperationCapabilities, type CapabilityRequirement } from "../operation-capabilities.ts";
  let { operation, requirementsOnly = false, selection }: { operation: Operation; requirementsOnly?: boolean;
    selection?: { credentials: boolean; native: boolean; docker: boolean } } = $props();
  const capabilities = $derived(readOperationCapabilities(operation));
  function state(requirement: CapabilityRequirement): string {
    if (requirement.code === "native-terminal") return "During execution";
    if (!selection) return "Required";
    const selected = requirement.code === "credentials" ? selection.credentials
      : requirement.code === "docker-destination" ? selection.docker
      : requirement.code.startsWith("native-") ? selection.native : false;
    return selected ? "Selected" : "Required";
  }
</script>
{#if capabilities}
  <section class="operation-capabilities" aria-label={requirementsOnly ? "Execution requirements" : "Operation capabilities"}>
    {#if !requirementsOnly && capabilities.issues.length}
      <h4>Limitations</h4>
      <ul>{#each capabilities.issues as issue}<li><strong>{capabilityAreaLabels[issue.area]}</strong>: {issue.message}</li>{/each}</ul>
    {/if}
    {#if !requirementsOnly && capabilities.alternatives?.length}
      <h4>Authentication alternatives</h4>
      <ol>{#each capabilities.alternatives as alternative (alternative.id)}
        <li data-auth-alternative={alternative.id}><strong>{alternative.names.join(" + ") || "Without credentials"}</strong> · {alternative.supported ? "Supported" : "Unavailable"}
          {#if alternative.reasons?.length}<ul>{#each alternative.reasons as reason}<li>{reason}</li>{/each}</ul>{/if}
        </li>
      {/each}</ol>
    {/if}
    {#if capabilities.requirements?.length}
      <h4>Before running</h4>
      <ul>{#each capabilities.requirements as requirement (requirement.code)}
        <li data-requirement={requirement.code}><strong>{state(requirement)}</strong>: {requirement.message}</li>
      {/each}</ul>
    {/if}
  </section>
{/if}
<style>
  .operation-capabilities { min-width: 0; font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
  h4 { margin: 12px 0 6px; font-size: inherit; }
  ul, ol { margin: 0; padding-left: 20px; }
  li + li { margin-top: 6px; }
</style>
