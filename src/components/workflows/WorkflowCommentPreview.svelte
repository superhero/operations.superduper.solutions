<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { commentBlocks, type CommentInline } from "./workflow-comment-markdown.ts";
  let { text }: { text: string } = $props();
  const blocks = $derived(commentBlocks(text));
</script>

{#snippet content(parts: CommentInline[])}
  {#each parts as part}
    {#if part.type === "text"}{part.text}
    {:else if part.type === "code"}<code>{part.text}</code>
    {:else if part.type === "link"}<a href={part.href} target="_blank" rel="noopener noreferrer" class="nodrag nopan nokey">{@render content(part.children)}</a>
    {:else}<svelte:element this={part.type}>{@render content(part.children)}</svelte:element>{/if}
  {/each}
{/snippet}

<div class="comment-markdown">
  {#each blocks as block}
    {#if block.type === "paragraph"}<p>{@render content(block.children)}</p>
    {:else if block.type === "heading"}<svelte:element this={`h${block.level}`}>{@render content(block.children)}</svelte:element>
    {:else if block.type === "quote"}<blockquote>{@render content(block.children)}</blockquote>
    {:else if block.type === "code"}<pre><code>{block.text}</code></pre>
    {:else if block.type === "rule"}<hr />
    {:else if block.type === "list"}<svelte:element this={block.ordered ? "ol" : "ul"}>{#each block.items as parts}<li>{@render content(parts)}</li>{/each}</svelte:element>{/if}
  {/each}
</div>

<style>
  .comment-markdown { overflow-wrap: anywhere; font-size: 12px; line-height: 1.65; }
  .comment-markdown > :global(* + *) { margin-top: 8px; }
  p, blockquote { white-space: pre-wrap; }
  .comment-markdown :global(:is(h1,h2,h3,h4,h5,h6)) { margin-bottom: 0; color: inherit; font-weight: 700; letter-spacing: normal; line-height: 1.4; }
  .comment-markdown :global(h1) { font-size: 19px; }
  .comment-markdown :global(h2) { font-size: 17px; }
  .comment-markdown :global(:is(h3,h4,h5,h6)) { font-size: 14px; }
  .comment-markdown :global(:is(ul,ol)) { padding-left: 20px; }
  .comment-markdown :global(ul) { list-style-type: disc; }
  .comment-markdown :global(ol) { list-style-type: decimal; }
  blockquote { padding-left: 10px; border-left: 3px solid var(--color-border); color: var(--color-muted-foreground); }
  code { padding: 1px 4px; border-radius: 4px; background: var(--color-background); color: var(--color-foreground); font-family: ui-monospace, monospace; font-size: 11px; }
  pre { padding: 8px; border-radius: 4px; background: var(--color-background); white-space: pre-wrap; }
  pre code { padding: 0; }
  a { color: var(--color-foreground); text-decoration: underline; text-underline-offset: 2px; }
  hr { border: 0; border-top: 1px solid var(--color-border); }
</style>
