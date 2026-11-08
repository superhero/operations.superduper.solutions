# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Qualified Cloudflare logo file uploads
  Scenario: The logo correction preserves its native operation and original declaration
    Then the Cloudflare logo uses its pinned SDK multipart wire contract without changing other source data

  Scenario: Unqualified logo declarations remain guarded
    Then changed logo identities destinations and file declarations are rejected before mutation

  Scenario: Logo file uploads retain exact bounded bytes
    Then logo multipart bodies preserve file bytes names and media while rejecting invalid file envelopes

  Scenario: Private logo dispatch retains its token and query boundaries
    Then an authenticated logo upload sends a file part with unchanged queries and no public token value
