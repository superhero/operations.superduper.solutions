# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Qualified Mistral fragment variants
  Scenario: Mistral variant corrections preserve native provenance
    Then seven Mistral variants retain their identities shared schemas and reversible source operations

  Scenario: Mistral variant drift is rejected atomically
    Then changed Mistral source contracts reject before any variant is adapted

  Scenario: Mistral variants are available in both importers
    Then all seven Mistral native variants retain distinct identities and qualified request models

  Scenario: Mistral native requests preserve their wire variants
    Then seven Mistral operations execute their native private JSON multipart and connector requests

  Scenario: Mistral streaming retains every native event until completion
    Then Mistral streams preserve UTF8 event envelopes and cancel their producer at the terminal event

  Scenario: Mistral failures cannot return partial stream results
    Then invalid incomplete oversized and cancelled Mistral streams fail within their resource budget

  Scenario: Mistral variant authority cannot be reused after a contract change
    Then stream false forged Mistral selectors and changed approvals cannot dispatch

  Scenario: Mistral saved connections preserve private credentials
    Then a saved Mistral connection preserves its variant and scrubs credential echoes from events

  Scenario: Mistral streams require named selectors and native reference declarations
    Then Mistral stream selectors require their named Boolean field and pinned schema references
