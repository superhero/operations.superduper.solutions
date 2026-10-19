# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Bundled service schema integrity
  Scenario: Every default pack retains its recorded OpenAPI document
    Then all service schema packs match their size hash and operation inventory

  Scenario: Corrupt packs cannot become schema documents
    Then service schema decoding rejects corrupt metadata compressed data and JSON

  Scenario: Native byte decoding and its compatibility path preserve schema integrity
    Then native and compatible schema decoders retain identical data and corruption guards

  Scenario: Swagger conversion retains external recursive definitions
    Then external Swagger references remain valid after bundling and OpenAPI conversion
