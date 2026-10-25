# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@gitlab-oauth
Feature: Private GitLab public OAuth
  Scenario: PKCE authorization matches the published S256 vector
    Then GitLab public authorization uses independent state and the published S256 challenge without a client secret

  Scenario: Native GitLab authentication alternatives stay intact
    Then the GitLab current user profile uses its native OAuth2 alternative and fixed authority

  Scenario: Sign in saves an encrypted managed connection
    Then GitLab consent returns only a saved reference and ordinary vault reads cannot expose managed tokens

  Scenario: Valid long display labels fit the encrypted record limits
    Then GitLab preserves full connection names and account identities while bounding display labels

  Scenario: Reload and re-unlock keep the managed account
    Then an encrypted GitLab connection survives reload and private resource execution retains its account

  Scenario: Concurrent demands refresh the rotating credentials once
    Then concurrent GitLab use and a stale snapshot share one atomic rotating refresh

  Scenario: Interrupted refresh cannot reuse a one time credential
    Then GitLab stores an encrypted refresh lease before exchange and requires reconnect after interruption

  Scenario: Cancelled denied expired late and foreign callbacks reject
    Then invalid GitLab callbacks and changed schema authority cannot exchange or save credentials

  Scenario: Scope account registration and destination changes reject
    Then GitLab tokens reject changed scopes accounts registration origins and resource destinations

  Scenario: Reconnect replaces only the selected account and invalidates old references
    Then GitLab reconnect preserves the selected account and disconnect removes its managed state

  Scenario: Tokens and renewal failures remain private
    Then GitLab access refresh and derived values are scrubbed and grant failures do not replay resource requests

  Scenario: Callback URLs are cleaned before application startup
    Then the reserved GitLab callback strips code and state and rejects duplicate or invalid responses

  Scenario: Isolated popups keep waiting for an authenticated callback
    Then GitLab ignores foreign callback messages and a severed opener can return through its channel or cancel

  @coverage-gaps
  Scenario: Saved GitLab registrations reject malformed records
    Then GitLab rejects malformed saved state registrations and noncanonical callback authority

  @coverage-gaps
  Scenario: Pending GitLab authorization is bounded and generation aware
    Then GitLab bounds pending consent and cancels authorization when its generation changes

  @coverage-gaps
  Scenario: Provider failures and cancellation withhold exchanged GitLab credentials
    Then GitLab malformed provider replies and cancellation never publish exchanged credentials

  @coverage-gaps
  Scenario: Reconnect preserves current authority and private identity boundaries
    Then GitLab reconnect refuses removed authority duplicate labels and private identity echoes

  @coverage-gaps
  Scenario: Disconnect and malformed saved state remain authoritative during rotation
    Then GitLab disconnect or missing managed state cannot be undone by a rotating grant

  @coverage-gaps
  Scenario: Renewal cache retention does not make stale grants reusable
    Then GitLab bounds renewal cache retention and rejects evicted one use grant snapshots

  @coverage-gaps
  Scenario: Late cancellation cannot commit or replay GitLab consent
    Then GitLab cancellation after exchange or authority reading cannot commit or replay consent
