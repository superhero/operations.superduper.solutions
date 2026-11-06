# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Reviewed AWS REST wire contracts
  Scenario: Native AWS REST profiles load with frozen identities through both parsers
    Then all 658 native AWS REST operations have qualified canonical and strict models

  Scenario: Every reviewed AWS REST identity has a pinned signing authority
    Then the 658 AWS REST contracts retain pinned sources and reject other authorities

  Scenario: REST JSON uses SDK wire aliases and timestamp representations
    Then AWS REST JSON serialization preserves logical names and exact wire aliases

  Scenario: REST XML preserves payload envelopes lists attributes and header members
    Then AWS REST XML responses decode reviewed SDK shapes without unsafe XML features

  Scenario: Raw AWS payloads preserve bytes content types and response metadata
    Then AWS REST payloads remain bounded binary files through both wire directions

  Scenario: Lambda event streams require valid CRC framing and a terminal event
    Then AWS REST binary event streams reject truncation corruption and missing completion

  Scenario: Malformed AWS data cannot be signed or exposed as a valid protocol result
    Then AWS REST wire codecs reject unknown inputs wrong media and invalid model descriptors

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
