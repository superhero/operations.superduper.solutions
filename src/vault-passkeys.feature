# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@vault-passkeys
Feature: Passkey PRF protocol bridge
  A passkey is usable for this vault only when its actual PRF output is available.
  Protocol mocks do not establish browser, authenticator, or provider support.

  Scenario: Creation supplies the actual PRF
    Then passkey enrollment requires user verification and returns only bounded PRF material and metadata

  Scenario: Creation enables PRF but needs authentication to evaluate it
    Then passkey enrollment evaluates the same credential and salt when creation returns no PRF result

  Scenario: Ordinary passkey success is insufficient
    Then missing or malformed passkey PRF output never completes vault enrollment

  Scenario: Unlock is bound to saved credential metadata
    Then passkey unlock validates metadata and rejects substituted credentials or invalid PRF results

  Scenario: Cancellation prevents stale material from escaping
    Then aborted passkey ceremonies reject before dispatch and after delayed browser completion

  Scenario: Native failure details are private
    Then passkey provider failures and unavailable environments produce only safe vault errors

  Scenario: Each ceremony receives a fresh challenge
    Then repeated passkey unlocks use fresh challenges while preserving credential identity and PRF salt
