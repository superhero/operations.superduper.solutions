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
