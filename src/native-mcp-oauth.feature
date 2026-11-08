# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-mcp-oauth
Feature: Owned MCP OAuth completion
  A separate host grant permits sign-in. Authorization URLs are transient instructions,
  and workflows wait for the matching completion without receiving credentials.

  Scenario: MCP login waits for completion and supports early completion
    Then standalone MCP sign-in keeps its owned child until the matching login completes

  Scenario: MCP login uses independent grants and current owned threads
    Then MCP sign-in cannot borrow other grants scopes approvals or foreign thread ownership

  Scenario: MCP login validates names scopes strategies and timeout inputs
    Then MCP sign-in preserves supported options and rejects callback credential and malformed overrides

  Scenario: MCP login correlates strict acknowledgements and completion IDs
    Then MCP sign-in withholds foreign duplicate malformed and failed completion messages

  Scenario: MCP sign-in links cannot expose credentials or unsafe destinations
    Then MCP sign-in links and results reject unsafe URLs and known credential echoes

  Scenario: MCP login cancellation revokes pending work without replay
    Then MCP sign-in cancellation source changes and deadlines close the owned attempt without replay

  Scenario: MCP login models expose terminal status and preserve the wire acknowledgement
    Then MCP sign-in models roundtrip their options and expose typed terminal fields with the original response
