# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-mcp-tool
Feature: Explicit MCP calls on owned native threads
  Tools require a separate operator grant and the current reviewed workflow approval.
  They keep the live owned thread and never replay a dispatched effect.

  Scenario: MCP tools retain the owned thread and preserve complete results
    Then paired MCP tool calls preserve arguments metadata application errors and the loaded thread

  Scenario: MCP tools require independent authority and a live owned thread
    Then MCP tools reject missing grants old workflow approvals foreign threads and unloaded threads

  Scenario: MCP tool JSON inputs remain bounded and cannot override runtime configuration
    Then MCP tool parameters preserve JSON values and reject invalid or private inputs before dispatch

  Scenario: MCP tool results enforce typed fields and scan decoded content
    Then MCP tool replies withhold malformed fields encodings and private structured or binary echoes

  Scenario: MCP tool cancellation and interactions cannot acquire more authority
    Then pending MCP tools deny server interactions and close without replay after cancellation or authority changes

  Scenario: MCP tool workflow models preserve portable JSON and mapped native ports
    Then MCP tool models roundtrip JSON inputs and concrete result ports with the reviewed workflow profile
