# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@jira-confidential
Feature: Optional confidential Jira connection with private host ownership
  Scenario: Native Jira read identity retains its existing authentication alternatives
    Then the pinned Jira current user operation qualifies only its reviewed companion route

  Scenario: Consent discovers a site and keeps provider material on its configured host
    Then Jira consent selects a discovered matching site and executes privately with opaque references

  Scenario: Companion API access needs the allowed origin and independent pairing key
    Then Jira companion origin key configuration and private claim checks prevent unauthorized forwarding

  Scenario: Consent tasks are one time current and cancellable
    Then Jira callback state denial replay expiry cancellation and lock cannot publish stale connections

  Scenario: Encrypted host and vault stores survive ordinary restarts
    Then Jira host tokens and opaque vault capabilities persist encrypted across restart and reload

  Scenario: Concurrent demand renews provider credentials once
    Then Jira requests serialize rotating refresh and retain the selected site account and resource

  Scenario: An interrupted rotation never reuses a refresh credential
    Then Jira unknown refresh outcomes remain blocked after restart without token or resource replay

  Scenario: Invalid provider grants cannot become connected accounts
    Then Jira rejects missing refresh material broader scopes and unrelated discovered resources

  Scenario: Site account host and key changes invalidate current authority
    Then Jira rejects changed accounts sites companion registrations and selected access keys

  Scenario: Disconnect removes opaque connection authority
    Then Jira disconnect revokes the host reference and reports unconfirmed remote cleanup honestly

  Scenario: Reconnect keeps the selected account and invalidates prior capabilities
    Then Jira reconnect replaces only the current grant and rejects an account switch

  Scenario: Runnable companion loads private configuration without serving its secrets
    Then the Jira companion launcher reads private key files and serves its real HTTP boundary

  Scenario: Resource failures and echoes remain safe
    Then Jira JSON status and errors are preserved while host and vault secrets are scrubbed without retries

  Scenario: Workflow routes and inputs remain bounded to the supported consumer
    Then Jira unsupported routes forged metadata oversized responses and cancelled dispatch never broaden the companion
