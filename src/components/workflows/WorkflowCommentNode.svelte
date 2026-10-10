<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { getContext, tick, untrack } from "svelte";
  import { useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/svelte";
  import HintButton from "$lib/components/HintButton.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import type { CommentData } from "$lib/workflow-document.ts";
  import { commentTextLimit } from "$lib/workflow-utilities.ts";
  import WorkflowCommentPreview from "./WorkflowCommentPreview.svelte";
  import "./workflow-utility-nodes.css";

  let { id, data, selected }: NodeProps<Node<CommentData, "comment">> = $props();
  const changeText = getContext<(id: string, text: string) => void>("workflow-comment-text");
  const editorActive = getContext<(() => boolean) | undefined>("workflow-editor-active");
  const updateNodeInternals = useUpdateNodeInternals();
  let editing = $state(false);
  let input: HTMLTextAreaElement | undefined = $state();
  let preview: HTMLDivElement | undefined = $state();
  let card: HTMLDivElement | undefined = $state();
  const layout = $derived(JSON.stringify([editing, data.text]));
  $effect(() => { layout; untrack(() => updateNodeInternals(id)); });
  $effect(() => { if (editorActive && !editorActive()) editing = false; });

  async function edit(event?: MouseEvent | KeyboardEvent) {
    if (event?.target instanceof Element && event.target.closest("a")) return;
    editing = true;
    await tick();
    input?.focus({ preventScroll: true });
  }
  async function finish() {
    input?.blur();
    editing = false;
    await tick();
    (preview ?? card?.closest<HTMLElement>(".svelte-flow__node"))?.focus({ preventScroll: true });
  }
  function keydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (!event.isComposing && (event.key === "Escape" || event.key === "Enter" && (event.ctrlKey || event.metaKey))) {
      event.preventDefault();
      void finish();
    }
  }
</script>

<div bind:this={card} class="workflow-utility-node workflow-comment-node" class:selected>
  <div class="utility-title">
    <MaterialIcon name="sticky_note" size={20} /><strong>Comment</strong>
    <HintButton type="button" class="utility-action nodrag nopan nokey" label={editing ? "Finish editing comment" : "Edit comment"}
      onpointerdown={event => { if (editing) event.preventDefault(); }}
      onclick={() => editing ? finish() : edit()}><MaterialIcon name={editing ? "check" : "edit"} size={18} /></HintButton>
  </div>
  {#if editing || !data.text.trim()}
    <div class="comment-editor nodrag nopan nokey nowheel">
      <textarea bind:this={input} aria-label="Comment text (Markdown)" placeholder="Write a comment…" maxlength={commentTextLimit}
        value={data.text} onfocus={() => editing = true} onblur={() => editing = false} onkeydown={keydown}
        oninput={event => changeText(id, event.currentTarget.value)}></textarea>
      <span class="comment-hint">Markdown · Ctrl/⌘ + Enter to finish</span>
    </div>
  {:else}
    <div bind:this={preview} class="comment-preview nodrag nopan nokey" role="button" tabindex="0" aria-label="Edit comment text"
      title="Click or press Enter to edit" onclick={edit} onkeydown={event => {
        if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) {
          event.preventDefault(); event.stopPropagation(); void edit(event);
        }
      }}>
      <WorkflowCommentPreview text={data.text} />
    </div>
  {/if}
</div>

<style>
  .workflow-comment-node { width: 300px; }
  .comment-editor, .comment-preview { padding: 10px 12px; border-top: 1px solid var(--color-border); }
  .comment-preview { min-height: 60px; cursor: text; }
  textarea { display: block; width: 100%; min-height: 112px; max-height: 420px; padding: 8px; border: 0; border-radius: 4px; resize: vertical; background: var(--color-background); color: var(--color-foreground); font: 12px/1.6 ui-monospace, monospace; }
  .comment-hint { display: block; margin-top: 7px; color: var(--color-muted-foreground); font-size: 10px; }
  @media (prefers-reduced-motion: reduce) { textarea, .comment-preview { transition: none; } }
</style>
