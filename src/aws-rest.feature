# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Reviewed AWS REST wire contracts
  Scenario: Native AWS REST profiles load with frozen identities through both parsers
    Then all 658 native AWS REST operations have qualified canonical and strict models

  Scenario: Every reviewed AWS REST identity has a pinned signing authority
    Then the reviewed AWS REST contracts retain pinned sources and reject other authorities

  Scenario: REST JSON uses SDK wire aliases and timestamp representations
    Then AWS REST JSON serialization preserves logical names and exact wire aliases

  Scenario: REST XML preserves payload envelopes lists attributes and header members
    Then AWS REST XML responses decode reviewed SDK shapes without unsafe XML features

  Scenario: Raw AWS payloads preserve bytes content types and response metadata
    Then AWS REST payloads remain bounded binary files through both wire directions

  Scenario: Lambda event streams require valid CRC framing and a terminal event
    Then AWS REST binary event streams reject truncation corruption and missing completion

  Scenario: Malformed AWS data cannot be signed or exposed as a valid protocol result
    Then AWS REST wire codecs reject unknown inputs wrong media and invalid model descriptors

  Scenario: Native XML request operations retain their qualified models
    Then all 56 AWS XML request operations have qualified canonical and strict models

  Scenario: Structured XML request bodies retain provider namespaces and signatures
    Then CloudFront Route53 S3 and S3 Control XML bodies preserve their exact wire envelopes

  Scenario: Outposts bucket creation signs only its documented service authority
    Then S3 Control bucket creation requires its Outpost ID and rejects account or endpoint substitution

  Scenario: XML workflow descriptions fit saved metadata limits
    Then the three XML workflow synopses preserve their complete canonical documentation

  Scenario: AWS XML shape decoding rejects corrupt structures and namespace ambiguity
    Then AWS XML values preserve typed collections and reject corrupt shapes or namespace aliases

  Scenario: AWS REST codec boundaries reject malformed prepared requests and response envelopes
    Then AWS REST codec boundaries retain exact payloads and reject malformed headers queries and replies

  Scenario: AWS event frames preserve typed headers and enforce payload boundaries
    Then AWS event streams reject malformed typed headers and preserve Lambda and S3 payloads
