# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@release-coverage
Feature: Preserve schema sharing at workflow boundaries
  Scenario Outline: Shared inputs reject conflicts
    Then shared input connections reject <reason>
    Examples:
      | reason                  |
      | unattached source       |
      | unattached destination  |
      | existing shared input   |
      | mapped nested field     |
      | different nested type   |

  Scenario: Nested shared inputs fan out source mappings
    Then shared input expansion reveals destination descendants and copies only active mappings

  Scenario Outline: Partial input trees do not fabricate mappings
    Then input expansion tolerates <tree> source trees without fabricating mappings
    Examples:
      | tree        |
      | unsupported |
      | unmatched   |

  Scenario Outline: Imported shared inputs must be active and compatible
    Then workflow imports reject a <link> shared input link
    Examples:
      | link         |
      | hidden       |
      | detached     |
      | incompatible |

  Scenario: Cyclic and incomplete schema trees terminate safely
    Then cyclic schema descriptions and input ancestry terminate without inventing fields

  Scenario Outline: Response identities are decoded conservatively
    Then response identity <identity> resolves to <group>
    Examples:
      | identity     | group      |
      | generated    | response   |
      | foreign      | absent     |
      | empty        | absent     |
      | malformed    | absent     |
      | nonarray     | absent     |
      | numeric      | absent     |

  Scenario Outline: Shared responses reject missing schema attachments
    Then response links reject <reason>
    Examples:
      | reason                  |
      | unattached source       |
      | unattached destination  |
      | same panel              |
      | invalid source group    |
      | invalid target group    |

  Scenario: Incomplete response sharing does not invent active groups
    Then incomplete response links report no source group

  Scenario Outline: Restore controls account for active shared inputs
    Then a <link> shared input makes its hidden branch <visibility>
    Examples:
      | link           | visibility |
      | active         | occupied   |
      | hidden         | restorable |
      | detached       | restorable |
      | another-owner  | restorable |
      | another-handle | restorable |

  Scenario: Contract updates retain compatible shared links
    Then changing an operation contract retains compatible shared input and response links

  Scenario Outline: Restore controls account for active shared responses
    Then a <link> shared response makes its hidden branch <visibility>
    Examples:
      | link           | visibility |
      | active         | occupied   |
      | hidden         | restorable |
      | detached       | restorable |
      | another-owner  | restorable |
      | another-handle | restorable |

  Scenario: Duplicate catalog locations retain the first category path
    Then catalog paths tolerate empty groups and retain the first duplicate operation location
