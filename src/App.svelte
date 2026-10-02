<script lang="ts">
  import {
    Background,
    BackgroundVariant,
    Controls,
    MarkerType,
    SvelteFlow,
    addEdge,
    type Connection,
    type Edge,
    type Node
  } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";

  import FlowNode from "./FlowNode.svelte";
  import Header from "./components/Header.svelte";
  import SideNavigation from "./components/SideNavigation.svelte";

  type FlowNodeType = Node<{ name: string }, "flowNode">;

  const nodeTypes = {
    flowNode: FlowNode
  };

  const defaultEdgeOptions = {
    markerEnd: {
      type: MarkerType.ArrowClosed
    }
  };

  let nextNodeId = 3;
  let navigationOpen = $state(false);

  let nodes = $state.raw<FlowNodeType[]>([
    {
      id: "node-1",
      type: "flowNode",
      position: { x: 80, y: 100 },
      data: { name: "Node 1" }
    },
    {
      id: "node-2",
      type: "flowNode",
      position: { x: 380, y: 220 },
      data: { name: "Node 2" }
    }
  ]);

  let edges = $state.raw<Edge[]>([]);

  function addNode()
  {
    const id = "node-" + nextNodeId;
    const index = nextNodeId - 1;
    const column = index % 4;
    const row = Math.floor(index / 4);

    nodes = [
      ...nodes,
      {
        id,
        type: "flowNode",
        position: {
          x: 80 + column * 260,
          y: 80 + row * 160
        },
        data: {
          name: "Node " + nextNodeId
        }
      }
    ];

    nextNodeId += 1;
  }

  function onconnect(connection: Connection)
  {
    edges = addEdge(connection, edges);
  }

  function toggleNavigation()
  {
    navigationOpen = !navigationOpen;
  }

  function closeNavigation()
  {
    navigationOpen = false;
  }
</script>

<svelte:head>
  <title>operations.superduper.solutions</title>
  <meta
    name="description"
    content="A browser-based workflow diagram editor."
  />
</svelte:head>

<Header {navigationOpen} onMenu={toggleNavigation} />
<SideNavigation open={navigationOpen} onClose={closeNavigation} />

<main class="app">
  <section class="canvas" aria-label="Workflow canvas">
    <button class="add-node-button" onclick={addNode}>Add node</button>

    <SvelteFlow
      bind:nodes
      bind:edges
      {nodeTypes}
      {defaultEdgeOptions}
      {onconnect}
      fitView
      minZoom={0.25}
      maxZoom={2}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={24}
        size={1.2}
      />
      <Controls />
    </SvelteFlow>
  </section>
</main>

<style>
  :global(:root) {
    --color-background: #023047;
    --color-surface: #219ebc;
    --color-foreground: #8ecae6;
    --color-accent: #ffb703;
    --color-emphasis: #fb8500;
    --app-header-height: 3.5rem;
  }

  :global(*) {
    box-sizing: border-box;
  }

  :global(html),
  :global(body),
  :global(#app) {
    width: 100%;
    height: 100%;
    margin: 0;
  }

  :global(body) {
    overflow: hidden;
    background: var(--color-background);
    color: var(--color-foreground);
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
      sans-serif;
  }

  :global(button),
  :global(input) {
    font: inherit;
  }

  .app {
    width: 100%;
    height: 100%;
    padding-top: var(--app-header-height);
    background: var(--color-background);
  }

  .canvas {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
  }

  .add-node-button {
    position: absolute;
    z-index: 10;
    top: 1rem;
    right: 1rem;
    min-height: 2.6rem;
    padding: 0 1rem;
    border: 0;
    border-radius: 0.65rem;
    background: var(--color-accent);
    color: var(--color-background);
    cursor: pointer;
    font-weight: 800;
    white-space: nowrap;
  }

  .add-node-button:hover {
    background: var(--color-emphasis);
  }

  .add-node-button:focus-visible {
    outline: 3px solid color-mix(
      in srgb,
      var(--color-foreground) 65%,
      transparent
    );
    outline-offset: 2px;
  }

  :global(.svelte-flow) {
    --xy-edge-stroke-default: var(--color-accent);
    --xy-edge-stroke-selected-default: var(--color-emphasis);
    --xy-connectionline-stroke-default: var(--color-accent);
    --xy-background-pattern-dots-color-default:
      color-mix(in srgb, var(--color-surface) 68%, var(--color-background));
    --xy-controls-button-background-color-default:
      color-mix(in srgb, var(--color-background) 66%, var(--color-surface));
    --xy-controls-button-background-color-hover-default:
      color-mix(in srgb, var(--color-background) 48%, var(--color-surface));
    --xy-controls-button-color-default: var(--color-foreground);
    --xy-controls-button-color-hover-default: var(--color-accent);
    --xy-controls-button-border-color-default:
      color-mix(in srgb, var(--color-surface) 58%, var(--color-background));
    background: var(--color-background);
  }

  :global(.svelte-flow__edge.selected .svelte-flow__edge-path) {
    stroke: var(--color-emphasis);
  }

  :global(.svelte-flow__connection-path) {
    stroke: var(--color-accent);
  }
</style>
