# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-mcp-oauth @native-mcp-oauth-sdk
Feature: Pinned SDK OAuth authority qualification
  Only an owned loopback authority is used. Tokens remain in the isolated SDK home.

  Scenario: Pinned MCP OAuth supports auto CIMD and dynamic registration with persistent credentials
    Then the real MCP OAuth SDK completes owned registrations and uses its private stored credentials

  Scenario: Pinned MCP OAuth rejects invalid callbacks and closes cancelled listeners
    Then the real MCP OAuth SDK rejects foreign state and cancellation without storing credentials

  @native-mcp-oauth-thread-sdk
  Scenario: Pinned MCP OAuth retains a loaded thread for authenticated tools
    Then the real MCP OAuth SDK signs in its loaded thread and retains it for tool calls
