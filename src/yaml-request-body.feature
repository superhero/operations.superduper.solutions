# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Structured YAML request bodies
  Scenario: YAML media preserve typed data with flow syntax
    Then both YAML body parsers preserve logical values through an independent YAML decoder

  Scenario: Unsupported YAML representations stay guarded
    Then YAML bodies retain schema validation and reject binary or unknown media encodings

  Scenario: Native DigitalOcean policy validation sends a private YAML request
    Then the native YAML policy operation preserves its source and sends the exact typed manifest privately
