<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<style>
  :global(*) { scrollbar-color: var(--color-scrollbar-thumb) transparent; }
  :global(:is(html, .catalog-menu, .catalog-sheet, .modal-content, .json-scroll, .json-report, textarea)) { scrollbar-gutter: stable; }
  :global(.modal-content) { scrollbar-gutter: stable both-edges; }
  :global(::-webkit-scrollbar) { width: 4px; height: 4px; }
  :global(::-webkit-scrollbar), :global(::-webkit-scrollbar-track), :global(::-webkit-scrollbar-track-piece), :global(::-webkit-scrollbar-corner) { background: transparent; box-shadow: none; }
  :global(::-webkit-scrollbar-thumb) { background: var(--color-scrollbar-thumb); border-radius: 4px; }
  @supports selector(::-webkit-scrollbar) {
    :global(*) { scrollbar-width: auto; scrollbar-color: auto; }
  }
</style>
