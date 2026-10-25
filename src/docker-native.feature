# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@docker-native
Feature: Explicit Docker Unix-socket reads
  Scenario: Unpaired origins and keys cannot reach the daemon
    Then Docker native access rejects unauthorized origins keys and profiles before daemon reads

  Scenario: A paired container listing uses the exact source and daemon binding
    Then Docker native listing preserves HTTP results and only uses the configured socket routes

  Scenario: Changed daemon or scope invalidates native reads
    Then Docker native access rejects changed daemon identity and stale source scope

  Scenario: Incompatible API versions fail before listing
    Then Docker native access rejects older and incompatible daemon API versions

  Scenario: Duplex and non JSON responses remain unavailable
    Then Docker native access refuses upgrades and unsupported payloads without replay

  Scenario: Cancellation stops the owned read and stale source cannot return it
    Then Docker native cancellation and source invalidation stop owned response propagation

  Scenario: Socket selection cannot be supplied by a browser
    Then Docker native access rejects arbitrary commands sockets parameters and aliases

  Scenario: The native model does not fabricate an HTTP origin
    Then Docker native models bind the pinned source while configured HTTP remains supported

  Scenario: Encrypted Docker profiles preserve private authority across reload
    Then Docker private profiles persist encrypted and key edits revoke their selected hosts

  Scenario: Private Docker results and source changes cannot bypass the worker
    Then Docker private execution rejects credential echoes and stale source results

  Scenario: Docker graph execution and ordinary HTTP remain distinct
    Then Docker graph reads use private bindings while configured HTTP uses its own endpoint

  @coverage-gaps
  Scenario: Docker contract and model boundaries reject unsupported native inputs
    Then Docker contracts reject invalid identity scope filters and unsupported model input

  @coverage-gaps
  Scenario: Docker broker parsing cannot publish malformed or private payloads
    Then Docker broker rejects malformed envelopes opaque errors and oversized private responses

  @coverage-gaps
  Scenario: Docker pairing and response metadata bind the exact authority
    Then Docker pairing and response metadata preserve exact daemon and source authority

  @coverage-gaps
  Scenario: Docker pending owners release work on cancellation and expiry
    Then Docker request ownership limits cancellation and expiry release only their owned work

  @coverage-gaps
  Scenario: Private Docker lifecycle rejects stale bindings and removes saved authority
    Then Docker saved authority removal stale bindings and daemon errors preserve private ownership

  @coverage-gaps
  Scenario: Authenticated encrypted Docker records cannot bypass saved authority checks
    Then Docker encrypted records reject malformed collections altered fingerprints and excessive saved authority

  @coverage-gaps
  Scenario: Docker defaults retain clock authority and TLS trust
    Then Docker default transport clock and TLS trust preserve exact read authority

  @coverage-gaps
  Scenario: Docker vault guards and credential removal revoke only selected profiles
    Then Docker vault cancellation redaction and credential removal release the selected profiles

  @coverage-gaps
  Scenario: Cancellation while encrypting a Docker pairing cannot publish its profile
    Then Docker pairing cancelled while encrypting its profile cannot replace encrypted storage
