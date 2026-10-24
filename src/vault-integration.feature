# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@vault-integration
Feature: Credential references at workflow execution boundaries
  Each invocation selects an approved local credential without exposing its value.
  Imported workflow references cannot authorize use of local secrets.

  Scenario: References contain only strictly parsed opaque IDs
    Then credential bindings and invocation contexts reject inherited accessor and malformed fields without invoking getters

  Scenario: Credential routing requires an explicit valid selection
    Then shared workflow execution routes supported credentials and rejects missing malformed or stale selections

  Scenario: Saved supported choices preserve their original index after an unavailable choice
    Then a reloaded credential binding executes its original supported alternative and cannot select an unsupported AND choice

  Scenario: The anonymous executor cannot bypass authentication
    Then anonymous execution rejects authenticated alternatives and only permits an explicitly selected anonymous alternative

  Scenario: Existing anonymous operation behavior stays available
    Then public workflow operations use the default anonymous executor without touching the vault

  Scenario: Same-operation nodes have distinct credential selections
    Then two workflow nodes invoking the same operation receive separate credential bindings and invocation identities

  Scenario: Clearing a selection never revives a saved credential
    Then an explicitly cleared workflow credential blocks dispatch while an omitted selection retains the saved default

  Scenario: Nested workflow invocations preserve credential ownership
    Then repeated nested workflow invocations keep separate node paths and credential selections

  Scenario: Imports and exports strip local references recursively
    Then portable workflow documents remove credential references at every nesting level without changing local documents

  Scenario: Redaction does not repeat an already completed request
    Then a redacted authenticated response is preserved while downstream routing and accidental resubmission stop

  Scenario: Vault variable selections remain local even inside nested workflows
    Then vault variable nodes preserve local references and strip portable selections at every nesting level

  Scenario: Vault variable connections enforce text types and single inputs
    Then vault variables connect only to available text inputs and never become utility operands

  Scenario: Vault variable requests resolve in the worker and keep public previews safe
    Then vault variable inputs reach the worker as references without exposing values or allowing public execution

  Scenario: Vault variables preserve explicit starting-operation choices
    Then vault variable dependencies do not execute disconnected operations or duplicate selected starting nodes

  Scenario: Vault variable reference validation does not invoke accessors
    Then vault variable references reject malformed shapes and accessors without reading private values

  Scenario: Vault variable dispatch preserves explicit authentication alternatives
    Then vault variable dispatch honors explicit secured and anonymous alternatives

  Scenario: Vault variables support workflow-added text properties
    Then workflow-added text properties resolve vault references against the canonical schema approval
