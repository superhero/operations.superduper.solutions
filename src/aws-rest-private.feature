# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Private AWS REST wire execution
  Scenario: Native REST requests use the private signing executor for every reviewed provider
    Then each of the fourteen native AWS REST providers signs its final request bytes independently

  Scenario: Native REST credential producers retain private result adoption
    Then native AWS REST credential producers adopt wire response leaves before exposing results

  Scenario: Optional EFS pagination uses a saved companion connection
    Then the saved EFS companion connection forwards an actual signed GET body without exposing keys

  Scenario: The EFS relay remains restricted to the reviewed request and private state
    Then the EFS relay rejects changed signed requests unsafe responses and stale private guards

  Scenario: EFS relay metadata follows encrypted vault lifecycle and key rotation
    Then EFS relay references survive encrypted reload and invalidate when their pairing key rotates

  Scenario: Reviewed native bindings preserve constraints and provenance
    Then AWS REST binding corrections retain source evidence constraints and strict drift rejection

  Scenario: REST scalar and collection traits retain the documented HTTP wire values
    Then AWS REST timestamps repeated query values and private SSE headers retain their wire representations

  Scenario: Qualified AWS REST descriptions fit workflow metadata limits
    Then the four AWS REST description synopses persist while canonical source documentation remains complete

  Scenario: SDK file envelopes preserve the private binary response boundary
    Then REST file envelopes and event chunks with known secrets are withheld without corrupting clean bytes

  Scenario: Saved EFS relays use the default private fetch transport
    Then the default private fetch forwards only the approved signed EFS relay envelope
