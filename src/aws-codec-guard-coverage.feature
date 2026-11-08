# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: AWS typed wire codec limits
  Scenario: JSON target codecs preserve typed SDK values and reject malformed model input
    Then isolated AWS JSON models retain exact typed values aliases and bounded protocol envelopes

  Scenario: Query codecs preserve typed form fields and reviewed queue routing
    Then isolated AWS Query models retain scalar collection XML and queue authority boundaries

  Scenario: Prepared AWS requests reject stale JSON revisions and stray path declarations
    Then AWS prepared requests reject stale model revisions and unused path fields before transport
