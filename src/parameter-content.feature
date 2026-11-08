# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@parameter-content
Feature: Explicit JSON parameter content
  Scenario: JSON query and path parameters preserve their JSON representation
    Then both importers serialize content parameters as one JSON value

  Scenario: Unsupported parameter content identifies the offending parameter
    Then invalid mixed and unsupported content parameter declarations remain unavailable

  Scenario: Native content parameter operations preserve their provider wire contracts
    Then all five native content parameter cases preserve JSON filters or corrected scalar identifiers

  Scenario: Bitbucket content corrections preserve upstream evidence
    Then Bitbucket content parameter corrections are source pinned and reject drift

  Scenario: Private JSON filter values stay inside the credential executor
    Then private content parameters redact JSON escapes and reject stale serialization
