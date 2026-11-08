# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-mcp-read
Feature: Separately authorized standalone MCP reads
  Configured MCP discovery can start local servers and contact their configured endpoints.
  The read grant does not authorize login, tools, foreign thread state or runtime overrides.

  Scenario: MCP reads preserve inventory schemas and text and binary resources
    Then paired MCP reads preserve complete typed inventories and resource metadata

  Scenario: MCP reads require their own grant and exact method scope
    Then MCP read tickets cannot borrow other native grants or acquire tool or login authority

  Scenario: MCP read inputs preserve paging and hosted account selection
    Then MCP read parameters reject thread state configuration overrides and invalid hosted targets

  Scenario: MCP read results reject malformed JSON and private resource echoes
    Then MCP read results enforce typed fields bounded JSON canonical blobs and private credential scans

  Scenario: MCP read cancellation and authority changes withhold replies
    Then pending MCP reads close on cancellation source changes and stale runtime authority

  Scenario: MCP read workflow models retain portable output ports
    Then MCP read models roundtrip nullable targets and expose concrete native result ports
