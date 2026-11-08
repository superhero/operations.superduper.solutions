# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-command-private @native-command-private-sdk
Feature: Pinned SDK private command integration
  The encrypted vault pairs an owned companion and invokes the real pinned SDK.

  Scenario: Private SDK commands deliver terminal bytes and controls under encrypted ownership
    Then encrypted private command approval and binary process controls use the real SDK

  Scenario: Private SDK command cancellation keeps another owned process alive
    Then the real private command broker preserves a sibling while cancelling one process
