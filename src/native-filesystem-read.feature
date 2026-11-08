# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-filesystem-read
Feature: Bounded native workspace reads
  Native filesystem APIs have independent host permissions and preserve complete bounded results.

  Scenario: Filesystem reads require their own host authority and cannot grant writes
    Then filesystem read permissions stay separate from metadata apps agent and write methods

  Scenario: Native paths reject credential homes escapes hard links special files and byte excess
    Then native reads resolve workspace paths and enforce complete file and directory bounds

  Scenario: Base64 native file contents cannot bypass credential guards
    Then native file bytes remain exact and known credential echoes are withheld after decoding

  Scenario: Search and directory results cannot introduce foreign paths
    Then native result review withholds escaped search matches and malformed directory entries

  Scenario: Cancelled and revoked native reads discard their pending data
    Then native filesystem cancellation source drift and identity changes close owned reads
