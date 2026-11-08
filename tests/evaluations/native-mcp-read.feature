# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-mcp-read @native-mcp-sdk
Feature: Pinned SDK standalone MCP read qualification
  This optional evaluation uses only an owned stdio server and isolated anonymous home.

  Scenario: Pinned MCP SDK discovers and reads an owned configured stdio server
    Then the real paired MCP runtime discovers its owned server and preserves resource encodings
