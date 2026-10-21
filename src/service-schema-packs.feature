# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Bundled service schema integrity
  Scenario: DigitalOcean bearer permissions no longer block private credential dispatch
    Then DigitalOcean published permissions become canonical metadata and dispatch private unchanged bearer tokens

  Scenario: Google OAuth grant aliases retain scopes provenance and other required credentials
    Then Google grant normalization preserves scope alternatives without weakening unrelated authentication

  Scenario: Google Cloud published sources remain separate from executable corrected schemas
    Then Google Cloud corrections preserve published packs and enable both private bearer alternatives

  Scenario: Corrected schemas must match their reviewed size and digest
    Then corrected schema packs reject stale revision metadata while retaining the published source

  Scenario: Every default pack retains its recorded schema document
    Then all service schema packs match their size hash and operation inventory

  Scenario: Codex retains its native integration protocol without inventing HTTP routes
    Then the pinned Codex schema preserves requests responses and events with execution unavailable

  Scenario: Malformed Codex protocol bundles cannot enter the catalog
    Then Codex inspection rejects incomplete protocols duplicate methods and forged HTTP routes

  Scenario: Corrupt packs cannot become schema documents
    Then service schema decoding rejects corrupt metadata compressed data and JSON

  Scenario: Native byte decoding and its compatibility path preserve schema integrity
    Then native and compatible schema decoders retain identical data and corruption guards

  Scenario: Swagger conversion retains external recursive definitions
    Then external Swagger references remain valid after bundling and OpenAPI conversion

  Scenario: Documentation exports preserve the embedded contract without executing page scripts
    Then embedded ReDoc exports preserve OpenAPI data and reject missing malformed or incomplete contracts

  Scenario: Colliding upstream operation identifiers and path aliases remain independently addressable
    Then method and path identities preserve aliased operations and recursive models without changing existing contracts
