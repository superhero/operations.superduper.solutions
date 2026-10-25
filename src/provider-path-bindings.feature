# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Qualified provider path bindings
  Scenario: GitLab separates scan and issue identities without replacing neighboring methods
    Then GitLab path corrections retain native IDs source bytes and peer methods

  Scenario: JSM Ops receives explicit cloud inputs with unchanged native identities
    Then the pinned JSM Ops correction declares missing cloud IDs without inventing other parameters

  Scenario Outline: Private <contract> uses the exact qualified route
    Then the corrected "<contract>" operation prepares its exact private URL and authentication
    Examples:
      | contract    |
      | GitLab scan |
      | GitLab epic |
      | JSM list    |
      | JSM create  |

  Scenario: Missing null or unresolved cloud inputs cannot dispatch
    Then JSM cloud bindings reject missing null placeholder and unsafe identities before dispatch

  Scenario: Ambiguous or changed source contracts reject the correction
    Then provider path recipes reject changed identities ambiguous inputs and destination collisions

  Scenario: Unreviewed bindings stay unavailable
    Then unresolved JSM parameters stay guarded while the reviewed server override resolves

  Scenario: Changed approved destinations cannot reuse previous credentials
    Then corrected provider bindings reject stale private destination approval

  Scenario: OAuth cannot reuse the qualified Basic site route
    Then JSM preserves the unqualified OAuth choice with a routing reason and rejects its dispatch
