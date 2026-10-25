# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
# Explicit opt-in evaluation: requires an isolated pinned native binary on the worker.
@native-runtime-ui @service-defaults @native-test-tls @native-real-runtime
Feature: Qualify the production paired runtime with the pinned Codex binary
  Scenario: A real isolated Codex child initializes through the production worker
    Given I create a vault in the Secrets settings and save a synthetic credential
    Then native runtime settings pair reconnect and disconnect through the production worker

  @native-agent-profile
  Scenario: The real pinned runtime accepts the isolated agent permission profile
    Given I create a vault in the Secrets settings and save a synthetic credential
    Then native runtime settings pair reconnect and disconnect through the production worker
