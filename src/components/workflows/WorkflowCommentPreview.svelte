<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { renderMarkdown } from "$lib/markdown.ts";
  let { text, scope, allowImages = true }: { text: string; scope: string; allowImages?: boolean } = $props();
  const html = $derived(renderMarkdown(text, scope, allowImages));
</script>

<div class="comment-markdown">{@html html}</div>

<style>
  .comment-markdown { overflow-wrap: anywhere; font-size: 12px; line-height: 1.65; }
  .comment-markdown :global(:is(p,ul,ol,pre,blockquote)) { margin: 0; }
  .comment-markdown > :global(* + *) { margin-top: 8px; }
  .comment-markdown :global(:is(h1,h2,h3,h4,h5,h6)) { margin-bottom: 0; color: inherit; font-weight: 700; letter-spacing: normal; line-height: 1.4; }
  .comment-markdown :global(h1) { font-size: 19px; }
  .comment-markdown :global(h2) { font-size: 17px; }
  .comment-markdown :global(:is(h3,h4,h5,h6)) { font-size: 14px; }
  .comment-markdown :global(:is(ul,ol)) { padding-left: 20px; }
  .comment-markdown :global(ul) { list-style-type: disc; }
  .comment-markdown :global(ol) { list-style-type: decimal; }
  .comment-markdown :global(blockquote) { padding-left: 10px; border-left: 3px solid var(--color-border); color: var(--color-muted-foreground); }
  .comment-markdown :global(code) { padding: 1px 4px; border-radius: 4px; background: var(--color-background); color: var(--color-foreground); font-family: ui-monospace, monospace; font-size: 11px; }
  .comment-markdown :global(pre) { padding: 8px; border-radius: 4px; background: var(--color-background); white-space: pre-wrap; }
  .comment-markdown :global(pre code) { padding: 0; }
  .comment-markdown :global(a) { color: var(--color-foreground); text-decoration: underline; text-underline-offset: 2px; }
  .comment-markdown :global(hr) { border: 0; border-top: 1px solid var(--color-border); }
  .comment-markdown :global(img) { max-width: 100%; object-fit: contain; }
  .comment-markdown :global(table) { border-collapse: collapse; width: 100%; }
  .comment-markdown :global(:is(th,td)) { padding: 4px 6px; border: 1px solid var(--color-border); text-align: left; }
  .comment-markdown :global(mark) { background: var(--color-emphasis); color: var(--color-background); }
  .comment-markdown :global(.task-list-container) { padding-left: 0; list-style: none; }
  .comment-markdown :global(.task-list-item-checkbox) { margin-right: 6px; accent-color: var(--color-emphasis); }
  .comment-markdown :global(.footnotes) { margin-top: 8px; font-size: 11px; }
</style>
