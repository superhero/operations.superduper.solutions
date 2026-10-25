# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@atproto-oauth
Feature: Private browser AT Protocol OAuth connections
  Scenario: Native identities and legacy bearer alternatives remain intact
    Then Bluesky OAuth keeps every native identity and qualifies only the reviewed preferences read
  Scenario: PAR code exchange and resource proofs use the selected account
    Then Bluesky OAuth verifies PAR PKCE ES256 proofs and separate server nonces
  Scenario: Private session state survives restart and rotates safely
    Then Bluesky OAuth restores encrypted proof keys and commits rotating tokens before returning a result
  Scenario: Consent state denial replay and cancellation fail closed
    Then Bluesky OAuth consumes callbacks once and drops denied cancelled or locked consent
  Scenario: Token type subject and scope mismatches are rejected
    Then Bluesky OAuth rejects bearer tokens unexpected accounts and excessive or missing scopes
  Scenario: Discovery and endpoint changes cannot redirect credentials
    Then Bluesky OAuth rejects moved accounts rogue endpoints and private discovery URLs
  Scenario: Interrupted refresh remains invalid after reload
    Then Bluesky OAuth persists refresh intent before dispatch and never replays an ambiguous refresh
  Scenario: Concurrent refresh attempts cannot reuse a rotating token
    Then Bluesky OAuth detects concurrent stale state before a second refresh dispatch
  Scenario: Reconnection preserves account server and saved reference ownership
    Then Bluesky OAuth reconnects the same account and invalidates the previous reference
  Scenario: Saved references cannot authorize another operation
    Then Bluesky OAuth rejects stale schemas changed operations and manual managed formatting
  Scenario: Provider responses cannot reveal vault tokens or proof keys
    Then Bluesky OAuth redacts token echoes and keeps private material out of summaries and copies
  Scenario: Resource failures keep safe response semantics
    Then Bluesky OAuth handles failed reads and rejects unexpected input or oversized responses
  Scenario: Reserved callback URLs are cleaned before application startup
    Then Bluesky OAuth cleans valid duplicate and malformed callback parameters before imports
  Scenario: Public client metadata matches its deployment and callback
    Then Bluesky OAuth validates same-origin metadata and the virtual loopback development profile
  Scenario: Proof keys and resource audiences cannot be substituted
    Then Bluesky OAuth rejects a substituted proof key and a saved audience mismatch
  Scenario: Saved connection capacity remains bounded during consent
    Then Bluesky OAuth preserves the connection limit before and after interactive consent
