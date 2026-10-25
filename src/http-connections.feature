# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@http-connections
Feature: Reusable private HTTP connections
  Scenario Outline: Saved <kind> references survive encrypted reload
    Then a saved "<kind>" connection survives reload and re-unlock without plaintext metadata or values
    Examples:
      | kind   |
      | bearer |
      | apiKey |
      | basic  |

  Scenario: Account endpoint alternative and value changes invalidate old references
    Then edited HTTP connections reject stale references while other accounts remain isolated

  Scenario: Native Discord and Opsgenie connections format raw tokens privately
    Then native Bot and GenieKey formats are restricted to reviewed endpoints and are scrubbed before returning

  Scenario: Profile and binding tampering cannot authorize an HTTP request
    Then connection metadata and opaque bindings reject tampering and portable workflows strip local references

  Scenario: Removed and expired connections cannot run or return a late response
    Then removed credentials and expired HTTP connections fail without exposing a result

  Scenario: Interactive waiting is separate from HTTP execution deadlines
    Then a synthetic connection can wait authorize cancel expire and reject late account completions

  Scenario: Disabled schemas initialize no authorization provider
    Then a disabled connection initializes no SDK probe or native process

  @coverage-gaps
  Scenario: Stored HTTP profiles enforce metadata security and owner boundaries
    Then stored HTTP profiles reject malformed metadata ownership and security before selection

  @coverage-gaps
  Scenario: HTTP profile edits preserve capacity and credential authority
    Then HTTP profile edits reject stale capacity duplicate labels and incompatible credential parts

  @coverage-gaps
  Scenario: Authorization deadlines cannot revive expired or abandoned work
    Then connection authorization rejects invalid deadlines and suppresses expired or abandoned completion

  @coverage-gaps
  Scenario: Readiness observers may cancel without stale expiry or failure callbacks
    Then authorization observers may cancel readiness without reviving expiry or failure state

  @coverage-gaps
  Scenario: Invalid stored connection payloads cannot change the vault
    Then malformed stored connection lists and OAuth payloads fail before vault state changes
