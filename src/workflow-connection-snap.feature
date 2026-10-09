# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@workflow-connection-snap
Feature: Workflow connections snap to valid input fields
  Scenario: Invalid and unavailable ports do not hide the nearest usable input
    Given an output drag over a panel with several input fields
    When the nearby ports include hidden, disabled, structural, and rejected inputs
    Then snapping selects the nearest available valid field with its exact connection and coordinates

  Scenario: Native snaps and inactive origins do not create a second candidate
    Given an output drag over a panel with several input fields
    Then these connection origins do not produce a body snap:
      | state                  |
      | missing source         |
      | missing source handle  |
      | input origin           |
      | ended drag             |
      | native valid snap      |
      | hidden source          |
      | unconnectable source   |
      | nonfinite pointer x    |
      | nonfinite pointer y    |

  Scenario: Only visible measured panels under the pointer can attract a connection
    Given an output drag over a panel with several input fields
    Then these panels do not produce a body snap:
      | state                  |
      | missing panel          |
      | source panel           |
      | hidden panel           |
      | unconnectable panel    |
      | unmeasured width       |
      | unmeasured height      |
      | zero width             |
      | zero height            |
      | nonfinite geometry     |
      | pointer left           |
      | pointer right          |
      | pointer above          |
      | pointer below          |
      | no handle bounds       |
      | no target handles      |

  Scenario: Unavailable handle geometry is skipped before connection validation
    Given an output drag over a panel with several input fields
    Then these ports are skipped while another usable input remains selectable:
      | state                  |
      | wrong direction        |
      | zero width             |
      | zero height            |
      | nonfinite geometry     |

  Scenario: Overlapping panels respect stacking order only after finding valid inputs
    Given an output drag over a panel with several input fields
    Then the highest valid panel wins regardless of iteration order
    And a higher panel without valid fields does not mask a lower panel
    And panels with equal stacking order use their display order
    And an unset stacking order behaves as zero

  Scenario: Unnamed legacy handles and final drag states retain their connection identity
    Given an output drag over a panel with several input fields
    Then unnamed handles resolve to null identifiers
    And a final drag state uses the same target as its preview state
