# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Bounded native Twilio flat forms
  Scenario Outline: Native <kind> retains all explicit primitive identities
    Then the native "<kind>" model retains all 203 form fields and source constraints
    Examples:
      | kind         |
      | CreateSiprec |
      | CreateStream |

  Scenario Outline: Private <kind> sends exact dotted form keys and escaped values
    Then the native "<kind>" sends selected flat form fields through canonical private preparation
    Examples:
      | kind         |
      | CreateSiprec |
      | CreateStream |

  Scenario: All 99 explicit parameter pairs can be sent without array conversion
    Then the bounded Twilio forms retain all 99 pairs in their actual form encoding

  Scenario: Unknown or oversized form shapes retain the existing limits
    Then the Twilio root exception rejects other identities shapes and oversized nested inputs

  Scenario: Required values and enums still validate before dispatch
    Then bounded Twilio form fields keep requiredness enums and omission semantics

  Scenario: Private bindings retain the complete qualified form contract
    Then changing a bounded Twilio field invalidates its previous private approval
