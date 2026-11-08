# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-filesystem-watch-host
Feature: Owned native watch channel foundation
  The channel retains watch IDs, registration and unwatch barriers while workflow integration remains guarded.

  Scenario: Watch acknowledgements release only owned early events and unwatch ends delivery
    Then native watch channels preserve acknowledgement order and reject notifications after unwatch

  Scenario: Native watch roots and changed paths cannot escape the authorized workspace
    Then native watch paths reject private roots escaped aliases and recursive notifications

  Scenario: Native watch IDs frames and queued events stay bounded and connection owned
    Then native watch channels reject duplicate IDs malformed frames and notification overflow

  Scenario: Changed watch roots and closed preparation cannot regain watch authority
    Then native watch root replacement and closure discard pending registration and events
