# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: AWS REST selectors preserve operation identity and native wire behavior
  Scenario: All frozen selectors hydrate through canonical and strict parsers
    Then all 190 AWS REST selector operations retain qualified canonical and strict identities

  Scenario: Selector fragments become only their reviewed query and header bindings
    Then AWS REST selectors preserve encoded paths and fixed query values without collisions

  Scenario: S3 Control hosts and Outposts ARNs stay within the approved region
    Then S3 Control selector requests resolve account hosts and validated Outposts resources

  Scenario: Object Lambda routes sign with their own service authority
    Then Object Lambda selectors reject arbitrary hosts and sign the final route and token

  Scenario: XML and raw policy selector payloads retain native bytes
    Then S3 selectors serialize XML structures and raw policy strings correctly

  Scenario: Body checksums cover final wire bytes and reject conflicting values
    Then AWS REST selector checksums match independent digests and reject changed checksums

  Scenario: Metadata maps and private encryption keys keep their native header semantics
    Then S3 selector metadata expands safely and encryption keys remain private with verified digests

  Scenario: Private execution signs selector queries hosts bodies and checksums together
    Then native AWS REST selector execution verifies final signatures and enforces destination boundaries

  Scenario: S3 event streams follow their own payload and completion contracts
    Then S3 selector event streams preserve XML statistics binary records and correct completion boundaries

  Scenario: Long selector descriptions fit workflows without losing canonical documentation
    Then AWS selector display synopses preserve the thirteen complete source descriptions
