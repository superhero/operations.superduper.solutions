<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import { EditorState } from "@codemirror/state";
  import { EditorView, keymap, placeholder } from "@codemirror/view";
  import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
  import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
  import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
  import { tags } from "@lezer/highlight";

  let { value, label, maxLength, autofocus = false, onchange, onfocus, onblur, onfinish }: {
    value: string; label: string; maxLength: number; autofocus?: boolean;
    onchange: (value: string) => void; onfocus: () => void; onblur: () => void; onfinish: () => void;
  } = $props();
  let host: HTMLDivElement;
  let editor: EditorView | undefined;

  onMount(() => {
    editor = new EditorView({ parent: host, state: EditorState.create({ doc: value, extensions: [
      markdown({ base: markdownLanguage }), history(), EditorView.lineWrapping,
      placeholder("Write a comment…"),
      EditorView.contentAttributes.of({ "aria-label": label, "aria-multiline": "true", spellcheck: "true" }),
      EditorState.transactionFilter.of(transaction => transaction.newDoc.length > maxLength ? [] : transaction),
      keymap.of([
        { key: "Escape", run: view => { view.contentDOM.blur(); onfinish(); return true; } },
        { key: "Mod-Enter", run: view => { view.contentDOM.blur(); onfinish(); return true; } },
        ...defaultKeymap, ...historyKeymap,
      ]),
      EditorView.domEventHandlers({ focus: () => { onfocus(); }, blur: () => { onblur(); } }),
      EditorView.updateListener.of(update => { if (update.docChanged) onchange(update.state.doc.toString()); }),
      syntaxHighlighting(HighlightStyle.define([
        { tag: tags.heading, fontWeight: "700" },
        { tag: tags.strong, fontWeight: "700" },
        { tag: tags.emphasis, fontStyle: "italic" },
        { tag: tags.strikethrough, textDecoration: "line-through" },
        { tag: tags.monospace, fontFamily: "ui-monospace, monospace", backgroundColor: "var(--color-background)", borderRadius: "3px" },
        { tag: [tags.link, tags.url], textDecoration: "underline" },
        { tag: tags.processingInstruction, color: "var(--color-muted-foreground)" },
      ])),
      EditorView.theme({
        "&": { height: "100%", color: "var(--color-foreground)", backgroundColor: "transparent", fontSize: "12px" },
        "&.cm-focused": { outline: "none" },
        ".cm-scroller": { overflow: "auto", fontFamily: "inherit", lineHeight: "1.65" },
        ".cm-content": { padding: "4px 0", minHeight: "100%", caretColor: "var(--color-foreground)" },
        ".cm-line": { padding: "0" },
        ".cm-placeholder": { color: "var(--color-muted-foreground)", fontStyle: "italic" },
        ".cm-cursor": { borderLeftColor: "var(--color-foreground)" },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--color-secondary-hover)" },
      }),
    ] }) });
    if (autofocus) editor.focus();
    return () => { editor?.destroy(); editor = undefined; };
  });
  $effect(() => {
    if (editor && editor.state.doc.toString() !== value) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  });
</script>

<div bind:this={host} class="markdown-editor"></div>

<style>
  .markdown-editor { height: 100%; min-height: 0; }
</style>
