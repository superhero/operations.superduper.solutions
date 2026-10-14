# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Processing measurements
  Long-task counters isolate collection intervals and recover from unsupported or failed observers.

  Scenario: Processing measurements drain and reset bounded counters, preserve late tasks, and stop cleanly
    Then processing measurements drain and reset bounded counters, preserve late tasks, and stop cleanly
