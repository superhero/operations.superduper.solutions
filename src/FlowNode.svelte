<script lang="ts">
  import {
    Handle,
    Position,
    useSvelteFlow,
    type Node,
    type NodeProps
  } from "@xyflow/svelte";

  type FlowNode = Node<{ name: string }, "flowNode">;

  let { id, data, selected }: NodeProps<FlowNode> = $props();

  const { updateNodeData } = useSvelteFlow();
</script>

<div class:selected class="node">
  <Handle type="target" position={Position.Left} />

  <label>
    <span>Name</span>
    <input
      class="nodrag nokey"
      value={data.name}
      aria-label="Node name"
      oninput={(event) =>
        updateNodeData(id, { name: event.currentTarget.value })}
    />
  </label>

  <Handle type="source" position={Position.Right} />
</div>

<style>
  .node {
    min-width: 12rem;
    padding: 0.85rem;
    border: 1px solid color-mix(
      in srgb,
      var(--color-surface) 62%,
      var(--color-foreground)
    );
    border-radius: 0.8rem;
    background: color-mix(
      in srgb,
      var(--color-background) 68%,
      var(--color-surface)
    );
    box-shadow: 0 0.35rem 1rem
      color-mix(in srgb, var(--color-background) 70%, transparent);
  }

  .node.selected {
    border-color: var(--color-accent);
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--color-accent) 34%, transparent),
      0 0.35rem 1rem color-mix(in srgb, var(--color-background) 70%, transparent);
  }

  label {
    display: grid;
    gap: 0.35rem;
  }

  span {
    color: color-mix(
      in srgb,
      var(--color-foreground) 72%,
      var(--color-surface)
    );
    font-size: 0.68rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  input {
    width: 100%;
    border: 0;
    border-bottom: 1px solid color-mix(
      in srgb,
      var(--color-foreground) 38%,
      var(--color-surface)
    );
    background: transparent;
    color: var(--color-foreground);
    font: inherit;
    font-size: 0.95rem;
    font-weight: 700;
    outline: none;
  }

  input:focus {
    border-color: var(--color-accent);
  }

  .node :global(.svelte-flow__handle) {
    width: 0.8rem;
    height: 0.8rem;
    border: 2px solid var(--color-background);
    background: var(--color-accent);
  }

  .node :global(.svelte-flow__handle.connectingto),
  .node :global(.svelte-flow__handle.connectingfrom) {
    background: var(--color-emphasis);
  }
</style>
