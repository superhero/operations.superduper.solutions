# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@aws-wire
Feature: Reviewed AWS target JSON and Action Version wire protocols

  Scenario: Pinned AWS corrections retain native identities and independent residual limits
    Then AWS wire corrections preserve native sources and expose only the reviewed four methods

  Scenario: DynamoDB BatchGetItem signs actual target JSON and preserves typed keys
    Then DynamoDB batch reads send exact target JSON and return unprocessed keys without replay

  Scenario: DynamoDB pagination remains explicit and uses signed JSON bodies
    Then DynamoDB table listing signs empty and paginated JSON using one saved connection

  Scenario: STS GET and POST use the real Action Version protocol
    Then STS identity requests sign query or form bytes and decode the matching XML envelope

  Scenario: AWS wire profiles prevent arbitrary fragment and protocol injection
    Then forged AWS wire models and public protocol fields cannot reach a signer or fetch

  Scenario: AWS wire endpoints and saved references retain current authority
    Then AWS wire connections survive encrypted reload and reject changed regions services and credentials

  Scenario: Explicit AWS codecs reject malformed and mismatched responses
    Then AWS wire decoders reject mismatched media invalid JSON and unsafe or ambiguous XML

  Scenario: AWS wire responses remain bounded and cancellable
    Then AWS wire response limits and cancellation stop decoding without request replay

  Scenario: Native AWS protocol errors retain their status and scrub credentials
    Then AWS JSON and XML failures are scrubbed and never retried automatically

  Scenario: DynamoDB inputs respect the reviewed batch and attribute contract
    Then invalid DynamoDB batch sizes keys and unknown inputs fail before dispatch
