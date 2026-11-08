# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-thread-shell
Feature: Actual SDK thread shell qualification
  Scenario: Explicit shell approval and actual output without provider inference
    Then the pinned SDK preserves approved unsandboxed shell output exit code and no provider inference
  Scenario: Shell cancellation confirms owned process cleanup
    Then the pinned SDK interrupts a cancelled shell process before releasing its owned runtime
