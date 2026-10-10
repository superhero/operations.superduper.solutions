<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { formatLocalDateTime } from "$lib/datetime.ts";
  import type { WorkflowRevision } from "$lib/workflow-repository.ts";

  let { workflowId, revisions, currentRevision, busy = false, onrestore }: {
    workflowId: string;
    revisions: WorkflowRevision[];
    currentRevision: string | null;
    busy?: boolean;
    onrestore: (oid: string) => void | Promise<void>;
  } = $props();

  let restoring = $state("");
  let restoreError = $state("");
  let disposed = false;
  let treeElement = $state<HTMLDivElement>();
  let rowCenters = $state<Record<string, number>>({});
  let graphHeight = $state(0);
  const graph = $derived.by(() => {
    const lanes = new Map<string, number>();
    const edgeLanes = new Map<string, Map<string, number>>();
    const pending: Array<string | null> = [];
    const known = new Set(revisions.map(revision => revision.oid));
    const main = revisions.find(revision => revision.branches.includes("main"));
    if (main) pending.push(main.oid);
    let laneCount = 1;

    // Each child path keeps its lane until the actual parent is reached, even
    // when several paths share that parent. They meet only at the parent node.
    // The repository supplies topological order; timestamps never reorder it.
    for (const revision of revisions)
    {
      let lane = pending.indexOf(revision.oid);
      if (lane < 0) lane = pending.indexOf(null);
      if (lane < 0) lane = pending.length;
      lanes.set(revision.oid, lane);
      pending.forEach((parent, index) => { if (parent === revision.oid) pending[index] = null; });
      pending[lane] = null;
      const parentLanes = new Map<string, number>();
      revision.parents.forEach((parent, index) => {
        if (!known.has(parent)) return;
        let parentLane = index === 0 && pending[lane] === null ? lane : pending.indexOf(null);
        if (parentLane < 0) parentLane = pending.length;
        pending[parentLane] = parent;
        parentLanes.set(parent, parentLane);
      });
      edgeLanes.set(revision.oid, parentLanes);
      laneCount = Math.max(laneCount, lane + 1, pending.length);
    }
    return { lanes, edgeLanes, width: 24 + (laneCount - 1) * 18 };
  });

  $effect(() => {
    const element = treeElement;
    revisions;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      const next: Record<string, number> = {};
      element.querySelectorAll<HTMLElement>("[data-version-oid]").forEach(row => {
        const oid = row.dataset.versionOid;
        if (oid) next[oid] = row.offsetTop + row.offsetHeight / 2;
      });
      if (Object.keys(next).length !== Object.keys(rowCenters).length ||
        Object.entries(next).some(([oid, center]) => rowCenters[oid] !== center)) rowCenters = next;
      graphHeight = element.querySelector<HTMLOListElement>(".version-list")?.offsetHeight ?? 0;
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    element.querySelectorAll("[data-version-oid]").forEach(row => observer.observe(row));
    schedule();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  });

  function laneColor(lane: number)
  {
    return lane === 0 ? "var(--color-badge-background)" : "var(--color-background)";
  }

  function edgePath(child: string, parent: string)
  {
    const childLane = graph.lanes.get(child);
    const parentLane = graph.lanes.get(parent);
    const edgeLane = graph.edgeLanes.get(child)?.get(parent);
    const y = rowCenters[child];
    const parentY = rowCenters[parent];
    if (childLane === undefined || parentLane === undefined || edgeLane === undefined || y === undefined || parentY === undefined) return "";
    const x = 12 + childLane * 18;
    const trackX = 12 + edgeLane * 18;
    const parentX = 12 + parentLane * 18;
    const bend = Math.min(12, (parentY - y) / 4);
    let path = `M ${x} ${y}`;
    if (x !== trackX)
      path += ` C ${x} ${y + bend}, ${trackX} ${y + bend}, ${trackX} ${y + bend * 2}`;
    if (trackX === parentX) return `${path} V ${parentY}`;
    return `${path} V ${parentY - bend * 2} C ${trackX} ${parentY - bend}, ${parentX} ${parentY - bend}, ${parentX} ${parentY}`;
  }

  $effect(() => {
    workflowId;
    untrack(() => {
      restoreError = "";
    });
  });

  onDestroy(() => { disposed = true; });

  async function restore(oid: string)
  {
    if (oid === currentRevision || !revisions.some(revision => revision.oid === oid) || busy || restoring) return;
    const id = workflowId;
    restoring = oid;
    restoreError = "";
    try { await onrestore(oid); }
    catch (cause)
    {
      if (!disposed && id === workflowId)
        restoreError = cause instanceof Error ? cause.message : "This version could not be restored.";
    }
    finally { if (!disposed) restoring = ""; }
  }
</script>

<section class="workflow-history" aria-label="Workflow version history" aria-busy={busy || restoring !== ""}>
  {#if revisions.length}
    <div class="version-scroll">
      <div class="version-tree" style={`--graph-width: ${graph.width}px`} bind:this={treeElement}>
        <svg class="version-graph" aria-hidden="true" width={graph.width} height={graphHeight}>
          {#each revisions as revision (revision.oid)}
            {#each revision.parents as parent (parent)}
              {#if edgePath(revision.oid, parent)}
                <path data-child={revision.oid} data-parent={parent} d={edgePath(revision.oid, parent)}
                  stroke={laneColor(graph.lanes.get(revision.oid) ?? 0)} />
              {/if}
            {/each}
          {/each}
          {#each revisions as revision (revision.oid)}
            {#if rowCenters[revision.oid] !== undefined}
              <circle data-commit={revision.oid} cx={12 + (graph.lanes.get(revision.oid) ?? 0) * 18}
                cy={rowCenters[revision.oid]} r={revision.oid === currentRevision ? 6 : 4}
                class:current={revision.oid === currentRevision} class:alternative={(graph.lanes.get(revision.oid) ?? 0) > 0}
                stroke={laneColor(graph.lanes.get(revision.oid) ?? 0)} />
            {/if}
          {/each}
        </svg>
        <ol class="version-list" aria-label="Saved workflow versions">
          {#each revisions as revision (revision.oid)}
            <li class:current={revision.oid === currentRevision} data-version-oid={revision.oid}>
              <div class="version-description">
                <strong>{revision.message.replace(/^Restore workflow version [a-f0-9]{7,40}\b/, "Restore workflow version")}</strong>
                <span class="version-meta">
                  <time datetime={new Date(revision.timestamp).toISOString()}>{formatLocalDateTime(revision.timestamp)}</time>
                </span>
                {#if revision.oid === currentRevision}<span class="current-version">Current version</span>{/if}
              </div>
              {#if revision.oid !== currentRevision}
                <button type="button" class="restore-button" aria-label={`Restore version from ${formatLocalDateTime(revision.timestamp)}`}
                  disabled={busy || restoring !== ""} onclick={() => restore(revision.oid)}>
                  {restoring === revision.oid ? "Restoring…" : "Restore version"}
                </button>
              {/if}
            </li>
          {/each}
        </ol>
      </div>
    </div>
  {:else if !busy}
    <p class="hint">No saved versions yet.</p>
  {/if}

  {#if restoreError}<p role="alert">{restoreError}</p>{/if}
</section>

<style>
  .workflow-history { display: grid; gap: 20px; min-width: 0; font-size: 12px; }
  .version-scroll { min-width: 0; }
  .version-tree { position: relative; min-width: calc(var(--graph-width) + 190px); }
  .version-graph { position: absolute; inset: 0 auto auto 0; pointer-events: none; overflow: visible; }
  .version-graph path { fill: none; stroke-width: 2; stroke-linecap: round; }
  .version-graph circle { fill: var(--color-background); stroke-width: 2; transition: fill 180ms ease-in, r 180ms ease-in; }
  .version-graph circle:is(.current, .alternative) { fill: var(--color-surface); }
  .version-graph circle.current { fill: var(--color-primary); }
  .version-list { display: grid; gap: 8px; list-style: none; margin: 0; padding: 0 0 0 calc(var(--graph-width) + 4px); }
  .version-list li { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px; border-left: 2px solid transparent; border-radius: 4px; background: var(--color-report-card); }
  .version-list li.current { border-left-color: var(--color-badge-background); }
  .version-description { display: grid; gap: 6px; min-width: 0; overflow-wrap: anywhere; }
  .version-description strong { white-space: pre-line; }
  .version-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 12px; color: var(--color-muted-foreground); font-size: 11px; }
  .current-version { color: var(--color-badge-background); font-size: 11px; font-weight: 700; }
  button { flex-shrink: 0; min-height: 36px; padding: 8px 12px; border: 0; border-radius: 4px; background: var(--color-secondary); color: var(--color-secondary-foreground); font-size: 12px; font-weight: 700; transition: background-color 180ms ease-in, color 180ms ease-in; }
  button:focus-visible { outline: 2px solid var(--color-foreground); outline-offset: 2px; }
  .restore-button { background: var(--color-primary); color: var(--color-primary-foreground); }
  button:disabled { color: var(--color-muted-foreground); cursor: not-allowed; }
  p { margin: 0; line-height: 1.6; }
  [role="alert"] { padding: 12px; border-radius: 4px; background: var(--color-error-background); color: var(--color-error-foreground); }
  @media (prefers-reduced-motion: reduce) { button, .version-graph circle { transition: none; } }
</style>
