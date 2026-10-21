<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { getContext } from "svelte";
  import { Position } from "@xyflow/svelte";
  import WorkflowBranchAction from "./WorkflowBranchAction.svelte";

  let { branch, position, top = "50%", beside = false }: {
    branch: { childId: string; label: string };
    position: Position;
    top?: string;
    beside?: boolean;
  } = $props();
  const restore = getContext<(childId: string) => void>("workflow-restore-branch");
</script>

<WorkflowBranchAction class="workflow-restore-branch" {position} {top} {beside}
  label={`Restore ${branch.label}`} onclick={() => restore(branch.childId)} />
