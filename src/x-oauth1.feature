# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@x-oauth1
Feature: Private X OAuth 1.0a signing
  Scenario: Published OAuth signatures match deterministic vectors
    Then OAuth1 signing matches the published photo vector and normalized form example

  Scenario: Encoding sorting and body inclusion follow the actual wire representation
    Then OAuth1 signs duplicate query and form values while excluding JSON and multipart bodies

  Scenario: Native X alternatives retain their positions and request limitations
    Then the pinned X recipe enables only reviewed OAuth1 choices without replacing OAuth2

  Scenario: Canonical query and JSON requests are signed privately
    Then X requests dispatch once with private signatures over the final method URL and form body

  Scenario: Saved four-part references reject stale credentials and strip portable bindings
    Then OAuth1 connection references validate all four keys and invalidate on rotation or removal

  Scenario: Invalid authority references and collisions cannot dispatch
    Then OAuth1 rejects changed destinations missing references protocol collisions and stale authority

  Scenario: Signature echoes and failures stay private
    Then OAuth1 raw encoded and derived authorization material is removed from responses and errors

  Scenario: Existing bearer and OAuth2 execution bypass signing
    Then X bearer and OAuth2 alternatives execute at their original indexes without signing

  Scenario: Normal execution creates a fresh nonce and current timestamp
    Then repeated OAuth1 requests use fresh unpredictable nonces without exposing authorization
