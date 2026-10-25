# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-runtime-ui @service-defaults
Feature: Pair native runtimes from the private settings worker
  The production vault worker owns the authenticated HTTPS and WSS lifecycle.

  Background:
    Given I create a vault in the Secrets settings and save a synthetic credential

  @native-test-tls
  Scenario: A private native pairing survives reload and explicit reconnect
    Then native runtime settings pair reconnect and disconnect through the production worker

  @native-test-tls
  Scenario: Changed account and schema authority revoke a native pairing
    Then native runtime settings reject changed authority until the pairing is explicitly replaced

  Scenario: Untrusted TLS never receives a private pairing request
    Then native runtime settings reject an untrusted companion certificate

  @native-test-tls
  Scenario: A foreign allowed Origin cannot receive the private pairing key
    Then native runtime settings enforce real companion CORS before sending its pairing key
