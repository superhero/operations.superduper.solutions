# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-mcp-tool @native-mcp-tool-sdk
Feature: Pinned SDK owned thread tool qualification
  An isolated runtime uses an owned stdio MCP and a local provider stub with no inference.

  Scenario: Pinned MCP SDK calls a configured tool twice on the same owned thread
    Then the real paired MCP tool runtime preserves its loaded thread and authoritative metadata
