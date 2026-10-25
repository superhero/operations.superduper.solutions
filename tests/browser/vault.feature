# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@vault-browser
Feature: Browser vault persistence and controlled credential execution
  Native IndexedDB, Web Locks and Fetch enforce the vault contracts in a browser.
  Test-only fixtures exercise storage failures without adding production hooks.

  @chromium-only
  Scenario Outline: Jira companion connections survive reload and refresh at <width>px
    Then Jira companion sign-in at <width> pixels uses native CORS and keeps its provider tokens outside the application
    Examples:
      | width |
      | 390   |
      | 1280  |

  @chromium-only
  Scenario Outline: GitLab public OAuth survives reload at <width>px
    Then GitLab public sign-in at <width> pixels uses a private PKCE exchange and saved resource connection
    Examples:
      | width |
      | 390   |
      | 1280  |

  @chromium-only
  Scenario Outline: Cloudflare private upload works at <width>px
    Then a Cloudflare upload at <width> pixels carries opaque session references through private worker calls
    Examples:
      | width |
      | 390   |
      | 1280  |

  @chromium-only
  Scenario Outline: X OAuth1 connections survive reload at <width>px
    Then an X OAuth1 connection at <width> pixels signs privately after selecting four stored credentials
    Examples:
      | width |
      | 390   |
      | 1280  |

  @chromium-only
  Scenario Outline: Telegram private paths survive reload at <width>px
    Then a Telegram connection at <width> pixels supplies its private token only to the worker request
    Examples:
      | width |
      | 390   |
      | 1280  |

  @chromium-only
  Scenario Outline: Saved HTTP connections survive reload at <width>px
    Then a saved HTTP connection at <width> pixels can be edited re-unlocked and reused without reselecting keys
    Examples:
      | width |
      | 390   |
      | 1280  |

  @vault-browser-network @chromium-only
  Scenario: Production connection profiles keep account and schema authority in the worker
    Then production connection references survive worker replacement and reject account edits and disabled schemas

  @vault-browser-storage
  Scenario: Persisted vault data and exports contain only encrypted private fields
    Given an isolated browser vault with synthetic credentials
    Then its database exposes key names while stored values and exports remain encrypted

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

  @vault-browser-network @chromium-only
  Scenario: Production vault streaming crosses the worker boundary as counts and one scrubbed result
    Then production vault stream progress contains counts only and its terminal result is scrubbed

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
  Scenario: Vault creation, copying and key management preserve encrypted credentials across reload
    Given I exercise vault creation, copying and key management with a synthetic credential
    Then its registered secret is encrypted and a reload requires unlocking again

  @vault-browser-ui
  Scenario: Worker startup failure has no plaintext fallback and can recover
    Given I create a vault in the Secrets settings and save a synthetic credential
    Then a vault worker constructor failure remains safe and a later unlock recovers

  @vault-browser-ui @chromium-only
  Scenario: Approved operation diagnostics stay scrubbed in native copy and persistent error history
    Given I create a vault in the Secrets settings and save a synthetic credential
    Then an approved operation shows and copies only scrubbed diagnostics and persists no registered canaries

  @vault-browser-ui @chromium-only
  Scenario Outline: Basic choices retain two private references on desktop and mobile
    When I use a viewport of <width> by 900 pixels
    Given I create a vault in the Secrets settings and save a synthetic credential
    Then a Basic username and token selection survives reload and only its private request receives the encoded credentials

    Examples:
      | width |
      | 390   |
      | 1280  |

  @vault-browser-ui @chromium-only
  Scenario Outline: Supported authentication choices preserve their original identity on desktop and mobile
    When I use a viewport of <width> by 900 pixels
    Given I create a vault in the Secrets settings and save a synthetic credential
    Then an unsupported first authentication choice stays disabled while a later saved token choice survives reload and executes privately

    Examples:
      | width |
      | 390   |
      | 1280  |

  @vault-browser-ui
  Scenario: Manual locking clears temporary inputs and requires authentication
    Given I create a vault in the Secrets settings and save a synthetic credential
    Then manually locking the vault clears inputs and password unlocking restores the credential list

  @vault-browser-ui @vault-page-lifecycle
  Scenario: Page exit discards active worker access
    Given I create a vault in the Secrets settings and save a synthetic credential
    Then a "pagehide" notification terminates the vault worker and returning visible leaves it locked

  @vault-browser-ui @vault-page-lifecycle
  Scenario: Hidden tabs retain access and complete pending vault operations
    Given I create a vault in the Secrets settings and save a synthetic credential
    Then hiding and restoring the page preserves the vault worker and pending operations

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

  Scenario: Password replacement uses its own expandable authentication pane
    Given I create a vault in the Secrets settings and save a synthetic credential
    Then the password replacement pane validates matching values and preserves recovery access

  @vault-browser-policy
  Scenario: Public vault variable requests upgrade legacy catalog policies before dispatch
    Given a browser vault worker has an approved credential request for a saved schema
    Then a public operation resolves a vault variable only after upgrading its legacy schema policy

  @vault-browser-storage
  Scenario: Legacy vault key indexes populate after one unlock
    Given an isolated browser vault with synthetic credentials
    Then a legacy vault publishes only key names after unlocking without changing its encrypted snapshot

  @vault-browser-policy
  Scenario: Factory schema policy is bound to its packaged digest
    Given a browser vault worker has an approved credential request for a saved schema
    Then factory schema policy accepts only the matching packaged digest

  @vault-browser-ui @chromium-only
  Scenario Outline: Anthropic <kind> credentials and header connections survive reload on desktop and mobile
    When I use a viewport of <width> by 900 pixels
    Given I create a vault in the Secrets settings and save a synthetic credential
    Then the Anthropic "<kind>" selection preserves private headers and saved references across reload

    Examples:
      | width | kind              |
      | 390   | connected API key |
      | 1280  | connected API key |
      | 390   | bearer            |
      | 1280  | bearer            |

  @vault-browser-ui @chromium-only
  Scenario Outline: ElevenLabs private header connections survive reload on desktop and mobile
    When I use a viewport of <width> by 900 pixels
    Given I create a vault in the Secrets settings and save a synthetic credential
    Then the ElevenLabs private key connection survives reload without exposing credentials
    Examples:
      | width |
      | 390   |
      | 1280  |
