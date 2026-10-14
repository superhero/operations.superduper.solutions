<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { tick } from "svelte";
  import { Popover } from "bits-ui";
  import MaterialIcon from "./MaterialIcon.svelte";

  type Option = { value: string; label: string; path: string[] };
  type Node = { key: string; id: string; caption: string; parent?: string; option?: Option; children: Node[] };
  let { id, label, value, options, disabled = false, onValueChange }:
    { id: string; label: string; value: string; options: Option[]; disabled?: boolean; onValueChange: (value: string) => void } = $props();
  let open = $state(false);
  let focused = $state("");
  let trigger = $state<HTMLButtonElement | null>(null);
  let restoreFocus = true;
  const tree = $derived.by(() => {
    const roots: Node[] = [], nodes = new Map<string, Node>();
    for (const option of new Map(options.map(option => [option.value, option])).values()) {
      const path = option.path.length ? option.path : [option.label];
      let siblings = roots, parent: string | undefined;
      for (let depth = 0; depth < path.length; depth++) {
        const leaf = depth === path.length - 1;
        const key = leaf ? `leaf:${option.value}` : `group:${JSON.stringify(path.slice(0, depth + 1))}`;
        let node = nodes.get(key);
        if (!node) {
          node = { key, id: `${id}-node-${nodes.size}`, caption: path[depth]!, children: [],
            ...(parent ? { parent } : {}), ...(leaf ? { option } : {}) };
          nodes.set(key, node);
          siblings.push(node);
        }
        siblings = node.children;
        parent = key;
      }
    }
    return { roots, nodes };
  });
  const visible = $derived.by(() => {
    const rows: Node[] = [];
    function visit(nodes: Node[]) {
      for (const node of nodes) {
        rows.push(node);
        visit(node.children);
      }
    }
    visit(tree.roots);
    return rows;
  });

  function prepareOpen(next: boolean) {
    if (!next) return;
    restoreFocus = true;
    const selected = tree.nodes.get(`leaf:${value}`);
    focused = selected?.key ?? tree.roots[0]?.key ?? "";
  }

  async function focusNode(key: string) {
    focused = key;
    await tick();
    if (!open) return;
    const node = tree.nodes.get(key);
    const element = node && document.getElementById(node.id);
    element?.focus({ preventScroll: true });
    element?.firstElementChild?.scrollIntoView({ block: "nearest" });
  }

  function activate(node: Node) {
    if (node.option) {
      restoreFocus = true;
      onValueChange(node.option.value);
      open = false;
    }
  }

  function navigate(event: KeyboardEvent, node: Node) {
    const index = visible.findIndex(row => row.key === node.key);
    let next: Node | undefined;
    switch (event.key) {
      case "ArrowDown": next = visible[Math.min(visible.length - 1, index + 1)]; break;
      case "ArrowUp": next = visible[Math.max(0, index - 1)]; break;
      case "Home": next = visible[0]; break;
      case "End": next = visible.at(-1); break;
      case "ArrowRight":
        next = node.children[0];
        break;
      case "ArrowLeft":
        if (node.parent) next = tree.nodes.get(node.parent);
        break;
      case "Enter": case " ": activate(node); break;
      case "Tab":
        // Let the browser continue from the trigger's place in the page's tab order.
        event.stopPropagation();
        restoreFocus = false;
        open = false;
        trigger?.focus();
        return;
      default: return;
    }
    event.stopPropagation();
    event.preventDefault();
    if (next) void focusNode(next.key);
  }

  $effect(() => { if (disabled) open = false; });
</script>

{#snippet branches(nodes: Node[], level = 1)}
  {#each nodes as node, index (node.key)}
    <div id={node.id} class="field-tree-select-node" role="treeitem" aria-label={node.caption}
      aria-level={level} aria-posinset={index + 1} aria-setsize={nodes.length}
      aria-expanded={node.option ? undefined : true}
      aria-selected={node.option ? node.option.value === value : undefined} tabindex={focused === node.key ? 0 : -1}
      onfocus={event => { if (event.target === event.currentTarget) focused = node.key; }}
      onclick={event => { event.stopPropagation(); activate(node); }} onkeydown={event => navigate(event, node)}>
      <div class="field-tree-select-row" class:selectable={Boolean(node.option)}>
        <span class="field-tree-select-caption">{node.caption}</span>
        <span class="field-tree-select-check" aria-hidden="true">
          {#if node.option?.value === value}<MaterialIcon name="check" size={18} />{/if}
        </span>
      </div>
      {#if node.children.length}
        <div role="group" class="field-tree-select-children">{@render branches(node.children, level + 1)}</div>
      {/if}
    </div>
  {/each}
{/snippet}

<Popover.Root bind:open onOpenChange={prepareOpen}>
  <Popover.Trigger bind:ref={trigger} {id} {disabled}>
    {#snippet child({ props })}
      <button {...props} type="button" class="field-tree-select-trigger" aria-haspopup="tree" aria-label={label}
        onkeydown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) { prepareOpen(true); open = true; }
            else void focusNode(focused);
          } else if (typeof props.onkeydown === "function") props.onkeydown(event);
        }}>
        <span class="field-tree-select-value">{options.find(option => option.value === value)?.label ?? (value || "Select…")}</span>
        <MaterialIcon name="expand_more" size={20} />
      </button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content class="field-tree-select-content" side="bottom" sideOffset={4} align="start"
      collisionPadding={12} trapFocus={false} preventScroll={false}
      onOpenAutoFocus={event => { event.preventDefault(); void focusNode(focused); }}
      onCloseAutoFocus={event => { event.preventDefault(); if (restoreFocus) trigger?.focus(); }}
      onInteractOutside={() => { restoreFocus = false; }}
      onEscapeKeydown={() => { restoreFocus = true; }}>
      <div role="tree" aria-label={label} inert={!open}>{@render branches(tree.roots)}</div>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

<style>
  .field-tree-select-trigger { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; width: 100%; min-height: 34px; padding: 6px 10px; border: 0; border-radius: 4px; background: var(--field-background, var(--color-foreground)); color: var(--field-foreground, var(--color-background)); text-align: left; }
  .field-tree-select-trigger:disabled { cursor: var(--cursor-not-allowed, not-allowed); opacity: 1; }
  .field-tree-select-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
  .field-tree-select-trigger :global(.material-symbols-rounded) { flex-shrink: 0; }
  :global(.field-tree-select-content) { --tree-slide-y: -8px; z-index: 40; box-sizing: border-box; min-width: 0; width: var(--bits-popover-anchor-width); max-width: min(var(--bits-popover-anchor-width), calc(100vw - 24px)); max-height: min(320px, var(--bits-popover-content-available-height)); padding: 4px; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; border: 0; border-radius: 4px; background: var(--color-foreground); color: var(--color-background); box-shadow: none; }
  :global(.field-tree-select-content[data-side="top"]) { --tree-slide-y: 8px; }
  :global(.field-tree-select-content[data-state="open"]) { animation: tree-slide-in 200ms ease-in both; }
  :global(.field-tree-select-content[data-state="closed"]) { animation: tree-slide-out 200ms ease-in both; pointer-events: none; }
  .field-tree-select-node { min-width: 0; position: relative; outline: none; }
  .field-tree-select-row { position: relative; z-index: 1; display: flex; align-items: center; gap: 6px; min-height: 36px; padding: 8px; border-radius: 3px; cursor: var(--cursor-default, default); transition: background-color 180ms ease-in, color 180ms ease-in; }
  .field-tree-select-row.selectable { cursor: var(--cursor-pointer, pointer); }
  .field-tree-select-row.selectable:hover, .field-tree-select-node:focus > .field-tree-select-row { background: var(--color-primary); color: var(--color-primary-foreground); }
  .field-tree-select-caption { flex: 1; min-width: 0; overflow-wrap: anywhere; font-weight: 700; }
  .field-tree-select-row:not(.selectable) > .field-tree-select-caption { color: var(--color-badge-background); font-weight: 400; }
  .field-tree-select-check { display: grid; place-items: center; flex: 0 0 18px; width: 18px; height: 18px; }
  .field-tree-select-children { margin-left: 8px; }
  .field-tree-select-children > .field-tree-select-node { display: grid; grid-template-columns: 12px minmax(0, 1fr); }
  .field-tree-select-children > .field-tree-select-node > .field-tree-select-row { grid-column: 2; grid-row: 1; }
  .field-tree-select-children > .field-tree-select-node > .field-tree-select-children { grid-column: 2; grid-row: 2; }
  .field-tree-select-children > .field-tree-select-node::before, .field-tree-select-children > .field-tree-select-node::after { content: ""; grid-column: 1; background: var(--color-badge-background); pointer-events: none; }
  .field-tree-select-children > .field-tree-select-node::before { grid-row: 1 / span 2; width: 1px; }
  .field-tree-select-children > .field-tree-select-node:last-child::before { grid-row: 1; align-self: start; height: 50%; }
  .field-tree-select-children > .field-tree-select-node::after { grid-row: 1; align-self: center; height: 1px; }
  @keyframes tree-slide-in { from { opacity: 0; translate: 0 var(--tree-slide-y); } to { opacity: 1; translate: 0 0; } }
  @keyframes tree-slide-out { from { opacity: 1; translate: 0 0; } to { opacity: 0; translate: 0 var(--tree-slide-y); } }
  @media (prefers-reduced-motion: reduce) {
    :global(.field-tree-select-content), .field-tree-select-row { animation: none; transition: none; }
  }
</style>
