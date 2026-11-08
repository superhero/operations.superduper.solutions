# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-filesystem-write
Feature: Explicit native workspace mutations
  Filesystem mutations require independent authority and preserve pinned effects without automatic replay.

  Scenario: Filesystem mutations cannot borrow read metadata app or agent permissions
    Then native filesystem write authority stays separate from every other grant

  Scenario: Native mutation workflows preserve bytes flags leaf links and empty acknowledgements
    Then native filesystem mutations preserve their exact parameters results and portable models

  Scenario: Native mutations exclude private roots escaped links special files and unbounded trees
    Then filesystem mutations validate every source destination and recursive tree before dispatch

  Scenario: Base64 write inputs and mutation acknowledgements cannot expose known credentials
    Then native mutation inputs and acknowledgements reject private bytes and unknown fields

  Scenario: Cancelled changed and failed filesystem mutations never replay their applied effects
    Then native filesystem mutations discard late acknowledgements without replay or rollback claims
