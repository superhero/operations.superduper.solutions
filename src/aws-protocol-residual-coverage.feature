# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: AWS protocol residual boundaries
  Scenario: JSON target helpers retain empty models and typed map replies
    Then isolated JSON target helpers reject unknown contracts and retain empty shape boundaries

  Scenario: Query codecs independently retain wire and response guards
    Then isolated Query codecs reject reserved selectors unsupported scalars and malformed responses
