<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { getContext, tick, untrack } from "svelte";
  import { NodeResizeControl, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/svelte";
  import HintButton from "$lib/components/HintButton.svelte";
  import MarkdownEditor from "$lib/components/MarkdownEditor.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import type { CommentData } from "$lib/workflow-document.ts";
  import { commentTextLimit } from "$lib/workflow-utilities.ts";
  import WorkflowCommentPreview from "./WorkflowCommentPreview.svelte";
  import "./workflow-utility-nodes.css";

  let { id, data, selected, width, height }: NodeProps<Node<CommentData, "comment">> = $props();
  const resize = getContext<(id: string, size?: { width: number; height: number }) => void>("workflow-comment-resize");
  const changeText = getContext<(id: string, text: string) => void>("workflow-comment-text");
  const editorActive = getContext<(() => boolean) | undefined>("workflow-editor-active");
  const updateNodeInternals = useUpdateNodeInternals();
  let editing = $state(false);
  let preview: HTMLDivElement | undefined = $state();
  let card: HTMLDivElement | undefined = $state();
  const layout = $derived(JSON.stringify([editing, data.text]));
  $effect(() => { layout; untrack(() => updateNodeInternals(id)); });
  $effect(() => { if (editorActive && !editorActive()) editing = false; });

  async function edit(event?: MouseEvent | KeyboardEvent) {
    if (event?.target instanceof Element && event.target.closest("a")) return;
    editing = true;
    await tick();
  }
  async function finish() {
    editing = false;
    await tick();
    (preview ?? card?.closest<HTMLElement>(".svelte-flow__node"))?.focus({ preventScroll: true });
  }
</script>

<div bind:this={card} class="workflow-utility-node workflow-comment-node" class:selected style:width={`${width ?? 300}px`} style:height={`${height ?? 180}px`}>
  {#if selected && (!editorActive || editorActive())}
    {#each ["top-left", "top", "top-right", "right", "bottom-right", "bottom", "bottom-left", "left"] as const as position}
      <NodeResizeControl {position} minWidth={200} minHeight={140} maxWidth={2000} maxHeight={2000}
        onResizeStart={() => resize(id)} onResizeEnd={(_event, size) => resize(id, { width: size.width, height: size.height })}
        class="comment-resize-handle" aria-label={`Resize comment ${position}`} />
    {/each}
  {/if}
  <div class="utility-title">
    <MaterialIcon name="sticky_note" size={20} /><strong>Comment</strong>
  </div>
  {#if editing || !data.text.trim()}
    <div class="comment-editor nodrag nopan nokey nowheel">
      <MarkdownEditor value={data.text} label="Comment text (Markdown)" maxLength={commentTextLimit} autofocus={editing}
        onchange={text => changeText(id, text)} onfocus={() => editing = true} onblur={() => editing = false} onfinish={() => { void finish(); }} />
    </div>
  {:else}
    <HintButton tooltipSide="left" tooltipAnchorSelector=".svelte-flow__node" label="Click or press Enter to edit" labelAsName={false} aria-label="Edit comment text" tabindex={0}
      onclick={edit} onkeydown={event => {
        if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) {
          event.preventDefault(); event.stopPropagation(); void edit(event);
        }
      }}>
      {#snippet child({ props })}
        {@const { type: _type, disabled: _disabled, ...hintProps } = props}
        <div {...hintProps} bind:this={preview} class="comment-preview nodrag nopan nokey" role="button">
          <WorkflowCommentPreview text={data.text} scope={`${id}-view`} />
        </div>
      {/snippet}
    </HintButton>
  {/if}
</div>

<style>
  .workflow-comment-node { display: flex; flex-direction: column; }
  .comment-editor, .comment-preview { flex: 1; min-height: 0; overflow: auto; }
  :global(.comment-resize-handle.handle) { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--color-surface); background: var(--color-foreground); }
  .comment-editor, .comment-preview { padding: 10px 12px; border-top: 1px solid var(--color-border); }
  .comment-preview { min-height: 60px; cursor: text; }
  @media (prefers-reduced-motion: reduce) { .comment-preview { transition: none; } }
</style>
