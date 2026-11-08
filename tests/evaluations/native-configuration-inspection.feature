# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-configuration-inspection
Feature: Private SDK configuration inspection for verified writes
  Scenario: Paired write receipts retain separate host grants
    Then the paired host emits verified write receipts without granting agent access
  Scenario: Paired writes retain the loaded thread and SDK child
    Then the paired host retains its loaded thread after verified configuration changes
  Scenario: Paired writes withhold uncertain authority changes
    Then the paired host withholds transitions for revoked cancelled or unrelated changes
  Scenario: SDK layers retain their authority beyond the local file basis
    Then host verification rejects changes to SDK layers beyond its local file hashes
  Scenario: Internal configuration queries retain versions without publishing private settings
    Then private configuration inspection retains actual SDK versions and withholds raw replies
  Scenario: Internal configuration inspection has independent authority and closed failures
    Then private configuration inspection requires its grant and masks SDK errors

  Scenario: Owned SDK writes retain version conflicts and both skill selectors
    Then owned SDK configuration writes preserve versions selectors and private provider settings

  Scenario: Host verification retains exact preference and skill effects
    Then host verification accepts exactly the owned SDK preference and skill edits
  Scenario: Host verification catches unrelated configuration authority changes
    Then host verification rejects unrelated user and workspace changes
  Scenario: Host write preparation keeps grant and file boundaries
    Then host write preparation rejects missing grants and unsafe configuration destinations
