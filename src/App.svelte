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

  import { Button } from "$lib/components/ui/button/index.js";
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
</script>

<svelte:head>
  <title>operations.superduper.solutions</title>
  <meta
    name="description"
    content="A browser-based workflow diagram editor."
  />
</svelte:head>

<Header {navigationOpen} onMenu={toggleNavigation} />
<SideNavigation bind:open={navigationOpen} />

<main class="app">
  <section class="canvas" aria-label="Workflow canvas">
    <Button
      class="add-node-button"
      size="lg"
      onclick={addNode}
    >
      Add node
    </Button>

    <SvelteFlow
      bind:nodes
      bind:edges
      {nodeTypes}
      {defaultEdgeOptions}
      {onconnect}
      proOptions={{ hideAttribution: true }}
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

  :global(.add-node-button) {
    position: absolute;
    z-index: 10;
    top: 1rem;
    right: 1rem;
    background: var(--color-accent);
    color: var(--color-background);
    font-weight: 800;
  }

  :global(.add-node-button:hover) {
    background: var(--color-emphasis);
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
