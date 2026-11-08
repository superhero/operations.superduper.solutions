# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: JSON Lines request bodies
  Scenario: JSON Lines preserve exact text framing
    Then both JSON Lines parsers preserve UTF-8 text and LF or CRLF framing

  Scenario: Invalid JSON Lines fail with the offending line
    Then JSON Lines reject malformed records and unsupported body representations with field context

  Scenario: Native Cloudflare usage reports send private JSON Lines
    Then the native usage report preserves its source and sends unquoted JSON Lines privately
