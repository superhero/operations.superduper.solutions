# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: AWS REST helper metadata boundaries
  Scenario: REST helpers retain missing optional metadata boundaries
    Then isolated REST helpers reject unreviewed models and retain SDK member name fallbacks
