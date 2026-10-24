# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Reviewable schema corrections and structured upstream merges
  Published changes and local edits retain their meaning when schemas are updated.

  Scenario: Independent upstream edits preserve local schema changes
    Then schema merges preserve unrelated edits deletions and identical changes

  Scenario: Overlapping changes need explicit field decisions
    Then schema merge conflicts distinguish missing null arrays and concurrent object edits

  Scenario: Property names and diff limits remain safe
    Then schema merge paths preserve special keys and bound changed-field reports

  Scenario: Resolved upstream corrections are not applied twice
    Then reviewed schema corrections preserve upstream-fixed data and reject unknown recipes

  Scenario: DigitalOcean permissions remain reviewable across correction and upstream update
    Then DigitalOcean corrections retain permissions provenance and authentication alternatives

  Scenario: DigitalOcean corrections are limited to the reviewed bearer contract
    Then DigitalOcean corrections reject changed provider contracts and metadata collisions

  Scenario: Gemini authentication alternatives preserve reviewable published data
    Then Gemini corrections preserve published SDK metadata AND credentials and anonymous overrides

  Scenario: Event Grid management inherits Azure authentication while public overrides stay public
    Then Event Grid corrections attach existing Azure permissions while preserving public and protected overrides

  Scenario Outline: Event Grid authentication is limited to the reviewed management contract for <kind>
    Then Event Grid correction rejects the unreviewed contract "<kind>"
    Examples:
      | kind                   |
      | wrong provider         |
      | wrong version          |
      | missing paths          |
      | wrong audience         |
      | empty servers          |
      | malformed server       |
      | missing OAuth          |
      | wrong OAuth type       |
      | additional flow        |
      | different flow         |
      | wrong issuer           |
      | missing permissions    |
      | different permission   |
      | blank permission       |
      | public inherited route |
      | operation destination  |
      | path destination       |
      | provenance collision   |
      | permission collision   |

  Scenario Outline: Gemini only exposes applicable reviewed credentials for <kind>
    Then Gemini credential applicability "<kind>" stays explicit without executing custom schemes
    Examples:
      | kind                     |
      | key only                 |
      | bearer only              |
      | headers only             |
      | unrelated custom scheme  |
      | unreviewed SDK extension |

  Scenario Outline: Changed Gemini contracts fail closed for <kind>
    Then Gemini correction rejects the changed contract "<kind>"
    Examples:
      | kind                     |
      | unknown server           |
      | extra server             |
      | missing server           |
      | unsupported version      |
      | missing definition       |
      | different custom scheme  |
      | missing SDK contract     |
      | executable SDK extension |
      | wrong SDK shape          |
      | required credential      |
      | composed credentials     |
      | unknown credential       |
      | malformed API key        |
      | constrained token        |
      | nonempty requirement     |
      | invalid requirement      |
      | scheme collision         |
      | credential collision     |
      | provenance collision     |
      | permission collision     |

  Scenario: Schema field diffs preserve exact lines and distinguish absent sides
    Then schema line diffs preserve additions removals context and JSON pointer values

  Scenario: Large field comparisons bound processing and display honestly
    Then schema line diffs fold context and expose bounded output without inventing source values
