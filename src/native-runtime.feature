# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-runtime
Feature: Explicit private native runtime pairing
  An authenticated browser connection owns only its pinned runtime and read-only pairing scope.

  Scenario: Initialization workflows return a fresh owned handshake rather than cached pairing metadata
    Then native initialization workflows use new owned children and preserve the public handshake result

  Scenario: Initialization workflows reject client and capability overrides before dispatch
    Then native initialization workflows reject unowned clients experimental capabilities and changed selections

  Scenario: Initialization results withhold credential echoes and unclassified fields
    Then native initialization workflow results reject malformed paths unknown fields and credential echoes

  Scenario: Initialization workflow cancellation and authority changes discard pending handshakes
    Then native initialization cancellation and source changes close only their owned child

  Scenario: Paired account workflows read anonymous and public metadata without enabling agent execution
    Then paired native account workflows preserve public results and encrypted authority across reload

  Scenario: Account workflow parameters cannot request credential changes
    Then native account workflow inputs reject refresh and overrides before any native dispatch

  Scenario: Native account workflow results withhold secrets and unknown fields
    Then native account workflows reject internal malformed and credential bearing results

  Scenario: Account workflow cancellation and source changes withhold pending replies
    Then native account workflow cancellation stale references and changed sources retain ownership

  Scenario: Pairing requires HTTPS an exact allowed Origin and the private key
    Then native pairing rejects unsafe hosts origins and missing authorization before a child starts

  Scenario: Tickets are short lived single use and bounded
    Then native pairing consumes tickets once and rejects expiry replay and queue exhaustion

  Scenario: The paired channel rejects arbitrary methods and initialization overrides
    Then native pairing enforces its reviewed method parameters and native initialization order

  Scenario: Concurrent responses retain their owned request identities
    Then native pairing correlates concurrent requests and rejects foreign responses

  Scenario: Private initialization reads the account without publishing native frames
    Then the native worker broker pairs initializes and returns only safe connection metadata

  Scenario: Encrypted pairings survive unlock but reconnect pins remain authoritative
    Then native saved pairings persist encrypted and reconnect to the same runtime only

  Scenario: Runtime workspace account and source changes revoke pairing authority
    Then native pairings reject changed runtime account workspace source and pairing keys

  Scenario: Cancelled and timed out requests stop owned work without replay
    Then native pairing cancellation and expiry close owned requests without retry or logout

  Scenario: Vault lock and disconnect release only the owned native child
    Then native pairing lock disconnect and key removal close transports and preserve host ownership

  Scenario: A late pairing response cannot survive vault invalidation
    Then native pairing cannot save after cancellation lock or stale schema approval

  Scenario: Native values and malformed records cannot cross the private boundary
    Then native pairings reject credential echoes malformed profiles and untrusted TLS

  Scenario: The native process uses only a pinned executable and private filesystem authority
    Then the native runtime isolates its home environment configuration and owned child lifecycle

  @coverage-gaps
  Scenario: Untrusted ticket responses cannot create native sockets
    Then native ticket parsing rejects malformed opaque and oversized responses before opening sockets

  @coverage-gaps
  Scenario: Forged pairing frames revoke the private transport
    Then native pairing rejects forged scope expiry and malformed socket messages and closes the peer

  @coverage-gaps
  Scenario: Native concurrency and expiry remain bounded by each owner
    Then native broker limits concurrent owners and requests and revokes expired or disconnected work

  @coverage-gaps
  Scenario: Malformed account results and transport errors cannot publish success
    Then native broker rejects malformed account results and converts socket failures without leaking details

  @coverage-gaps
  Scenario: Stalled pairing and hostile live frames cannot retain owned work
    Then native stalled pairing retries only tickets while malformed live frames revoke owned work

  @coverage-gaps
  Scenario: Removed and malformed native profiles cannot retain authority
    Then native saved authority rejects malformed bindings duplicate owners and removed profiles

  @coverage-gaps
  Scenario: Authenticated encrypted native records cannot bypass saved authority checks
    Then native encrypted records reject malformed collections altered fingerprints and excessive saved authority

  @coverage-gaps
  Scenario: Default trust and changed native peer authority remain pinned
    Then native runtime defaults retain TLS trust and changed peer authority forces a fresh check

  @coverage-gaps
  Scenario: Guard delays cannot publish cancelled or disconnected native peers
    Then native cancellation and disconnect during asynchronous guards cannot publish a paired peer

  @coverage-gaps
  Scenario: A missing native pairing acknowledgement expires before request dispatch
    Then native handshake expiry closes an unacknowledged socket before the overall request deadline
