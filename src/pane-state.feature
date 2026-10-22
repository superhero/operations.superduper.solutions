# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@pane-state @release-coverage
Feature: Safely resume pane state from browser storage
  Scenario Outline: Unusable snapshots leave normal defaults
    Then the pane snapshot falls back for <snapshot>
    Examples:
      | snapshot             |
      | missing              |
      | malformed            |
      | oversized            |
      | null                 |
      | array                |
      | unsupported version  |
      | missing navigation   |
      | missing settings     |

  Scenario: Complete pane state survives storage
    Then pane storage retains visibility navigation settings and reading positions

  Scenario Outline: Invalid nested snapshots recover independently
    Then pane state recovers nested <snapshot> values
    Examples:
      | snapshot |
      | missing  |
      | null     |
      | array    |
      | scalar   |

  Scenario: Snapshot bounds preserve useful content
    Then pane snapshots limit oversized fields and reject invalid expansion entries

  Scenario Outline: Invalid reading positions return to the start
    Then pane reading positions reject <position>
    Examples:
      | position |
      | negative |
      | infinite |
      | text     |

  Scenario: Writes coalesce and page hide preserves the latest state
    Then pane snapshots coalesce writes and flush synchronously without duplicate writes

  Scenario: Restricted storage leaves panes usable
    Then pane state tolerates blocked reads and writes and can recover

  Scenario: Default navigation state is independent
    Then separate default navigation states do not share mutable contents
