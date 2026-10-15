# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@vault-browser
Feature: Browser vault persistence and controlled credential execution
  Native IndexedDB, Web Locks and Fetch enforce the vault contracts in a browser.
  Test-only fixtures exercise storage failures without adding production hooks.

  @vault-browser-storage
  Scenario: Persisted vault data and exports contain only encrypted private fields
    Given an isolated browser vault with synthetic credentials
    Then its database and backup contain no registered secret or private label

  @vault-browser-storage
  Scenario: Two tabs cannot overwrite the same durable revision
    Given an isolated browser vault with synthetic credentials
    Then two vault writers racing the same revision produce exactly one conflict

  @vault-browser-storage
  Scenario Outline: Browser storage failure preserves the previous snapshot
    Given an isolated browser vault with synthetic credentials
    Then a vault storage "<failure>" failure is safe and leaves ciphertext unchanged

    Examples:
      | failure     |
      | quota       |
      | open        |
      | transaction |
      | locks       |

  @vault-browser-storage
  Scenario: A blocked native open cannot recreate a vault after its deadline
    Given an isolated browser vault with synthetic credentials
    Then a blocked native database open fails within its deadline without recreating deleted storage

  @vault-browser-storage
  Scenario: A suspended tab rejects durable lock changes without a broadcast
    Given an isolated browser vault with synthetic credentials
    Then another tab durably locks the vault and stale execution never reaches the endpoint

  @vault-browser-storage
  Scenario Outline: A fresh browser context restores independently
    Given an isolated browser vault with synthetic credentials
    Then a fresh context restores its encrypted backup using "<method>" with grants inactive

    Examples:
      | method   |
      | password |
      | recovery |

  @vault-browser-network
  Scenario: Approved credentials reach only the selected request and echoes are scrubbed
    Given an isolated browser vault with synthetic credentials
    Then a browser vault request sends its scoped headers without cookies or referrer and scrubs echoes

  @vault-browser-network
  Scenario: Redirects never receive registered credentials at the target
    Given an isolated browser vault targeting the "redirect" endpoint
    Then the browser vault rejects the redirect without contacting its target

  @vault-browser-network
  Scenario: A cross-origin credential request fails before dispatch when CORS denies it
    Given a vault whose approved request needs cross-origin credentials without CORS permission
    Then a CORS refusal stops at preflight and exposes no credential or native failure detail

  @vault-browser-network
  Scenario: Cancellation stops a streamed response without retrying the request
    Given an isolated browser vault targeting the "slow" endpoint
    Then cancelling the streamed vault request closes it without retrying

  @vault-browser-network
  Scenario Outline: Decoded response bounds apply before buffering completes
    Given an isolated browser vault targeting the "<endpoint>" endpoint
    Then the browser vault stops the oversized response with a safe size error

    Examples:
      | endpoint   |
      | chunked    |
      | compressed |

  @vault-browser-ui
  Scenario: Vault creation requires a saved recovery key and locks on reload
    Given I create a vault in the Secrets settings and save a synthetic credential
    Then its registered secret is encrypted and a reload requires unlocking again

  @vault-browser-ui
  Scenario: Worker startup failure has no plaintext fallback and can recover
    Given I create a vault in the Secrets settings and save a synthetic credential
    Then a vault worker constructor failure remains safe and a later unlock recovers

  @vault-browser-ui @chromium-only
  Scenario: Approved operation diagnostics stay scrubbed in native copy and persistent error history
    Given I create a vault in the Secrets settings and save a synthetic credential
    Then an approved operation shows and copies only scrubbed diagnostics and persists no registered canaries

  @vault-browser-ui
  Scenario: Manual locking clears temporary inputs and requires authentication
    Given I create a vault in the Secrets settings and save a synthetic credential
    Then manually locking the vault clears inputs and password unlocking restores the credential list

  @vault-browser-ui
  Scenario Outline: Page lifecycle lock discards active worker access
    Given I create a vault in the Secrets settings and save a synthetic credential
    Then a "<event>" notification terminates the vault worker and returning visible leaves it locked

    Examples:
      | event            |
      | visibilitychange |
      | pagehide         |

  @vault-browser-ui
  Scenario: A delayed event cannot reset the idle deadline
    Given I create a vault in the Secrets settings and save a synthetic credential
    Then optional idle locking expires before a delayed trusted interaction can extend it

  @vault-browser-ui
  Scenario: The encrypted download restores through the application UI
    Given I create a vault in the Secrets settings and save a synthetic credential
    Then a downloaded vault backup restores with recovery in a fresh application context

  @vault-browser-policy
  Scenario Outline: The worker reads authoritative schema policy before using an old grant
    Given a browser vault worker has an approved credential request for a saved schema
    Then a schema "<transition>" makes the old worker request fail before dispatch

    Examples:
      | transition  |
      | replacement |
      | disabled    |
      | deleted     |
      | pending     |
      | removed     |

  @vault-browser-policy
  Scenario: Existing catalogs must be backfilled before worker credential use
    Given a browser vault worker has an approved credential request for a saved schema
    Then a legacy catalog without credential policy fails closed until backfilled

  @vault-browser-policy
  Scenario: Reading missing schema policy creates no database
    Then a schema policy check in a fresh origin fails without creating storage

  @vault-browser-policy
  Scenario: The complete worker HTTP error envelope stays within its diagnostic budget
    Then the production worker bounds the whole HTTP diagnostic before posting it

  @vault-browser-policy
  Scenario: An oversized field diagnostic cannot exceed the worker message budget
    Then the production worker bounds an oversized field diagnostic before posting or dispatching

  @vault-browser-kdf
  Scenario: The pinned Argon2 implementation agrees with reference bytes under a restrictive CSP
    Then the browser KDF worker matches official and independent vectors and reports the selected profile timings

  @vault-browser-virtual-passkey @chromium-only
  Scenario: A native PRF ceremony unlocks the vault with a virtual authenticator
    Given I create a synthetic vault on the localhost relying-party origin
    Then the native PRF virtual authenticator enrolls and unlocks the vault without password input

  @vault-browser-virtual-passkey @chromium-only
  Scenario: A native authenticator without PRF cannot become a vault method
    Given I create a synthetic vault on the localhost relying-party origin
    Then a native virtual authenticator without PRF leaves password and recovery methods usable

  @vault-browser-virtual-passkey @chromium-only
  Scenario Outline: Cancelling a native passkey ceremony clears temporary input elements
    Given I create a synthetic vault on the localhost relying-party origin
    Then a pending native passkey enrollment is cancelled by "<action>" and clears retained input elements

    Examples:
      | action            |
      | manual lock       |
      | settings teardown |
