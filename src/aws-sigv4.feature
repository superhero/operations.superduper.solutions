# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@aws-sigv4
Feature: Private AWS Signature Version 4 requests
  @coverage-gaps
  Scenario: Signing bounds all supported byte sources before dispatch
    Then AWS signer bounds every supported byte input and rejects invalid key material before signing
  Scenario: Published Smithy header signatures match final payload bytes
    Then AWS signatures match published empty string binary and temporary credential vectors

  Scenario: Canonical path query and headers match an independent verifier
    Then AWS signing binds encoded paths repeated query keys normalized headers and copied payload bytes

  Scenario: Unsafe signing inputs cannot become requests
    Then AWS rejects public signing overrides multipart bodies invalid clocks and insecure destinations

  Scenario: Native Lambda gets one bounded REST profile and S3 loses static fallback
    Then native AWS schemas retain source identities while only the selected Lambda REST request becomes executable

  Scenario Outline: Private regional execution supports <mode> credentials
    Then a saved AWS connection with "<mode>" credentials signs a current regional Lambda request privately
    Examples:
      | mode      |
      | permanent |
      | temporary |

  Scenario: Encrypted reload preserves all AWS credential references
    Then an encrypted AWS connection survives reload and portable workflows contain no local binding

  Scenario: Static credentials and changed authority cannot dispatch
    Then AWS rejects static Authorization bindings changed regions changed profiles and public protocol fields

  Scenario: Rotation removal expiry and lock invalidate saved AWS authority
    Then stale AWS connection references cannot survive credential rotation removal expiry or lock

  Scenario: Signature echoes and failures remain private
    Then AWS credential session and derived signature echoes are scrubbed without resource retries

  Scenario: A delayed preflight cannot dispatch an old signature
    Then AWS cancellation changed schema and stale signing time prevent dispatch
