# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: AWS relay and response boundary guards
  Scenario: EFS relay references and input retain exact trust boundaries
    Then EFS relay references reject malformed keys identities methods and GET bodies

  Scenario: EFS relay responses retain bounded exact envelopes
    Then EFS relay responses reject changed transport metadata and malformed result envelopes

  Scenario: EFS relay cancellation remains authoritative during bounded reads
    Then EFS relay cancellation preserves cancellation errors when stream cleanup rejects

  Scenario: AWS response readers retain model approval and body cancellation
    Then AWS response readers reject stale JSON models and tolerate rejected HEAD body cancellation
