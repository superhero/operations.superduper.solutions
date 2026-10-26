# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Browser-local assistant boundaries
  Scenario: Model pins and validated configuration remain browser-local
    Then the local assistant preserves accepted profiles and rejects unsupported engine settings
  Scenario: Application reads are bounded and editing is a separate capability
    Then assistant tools page application state and reject unavailable capabilities
  Scenario: Tool arguments and private payloads are constrained
    Then assistant tools validate every argument and omit credential and file payloads
  Scenario: Workspace edits use canonical graph validation
    Then assistant workspace edits add move and connect without running operations
  Scenario: Browser compatibility requires real computation
    Then assistant compatibility probes verify GPU readback and release every device
  Scenario: Pinned runtime loading and generation preserve the native adapter
    Then assistant model loading verifies runtime integrity and forwards pinned native settings
  Scenario: Model loading respects optional GPU computation failures
    Then assistant loading keeps a failed FP16 compute probe disabled in the native runtime
  Scenario: Assistant diagnostics preserve original failures without recording cancellation
    Then assistant failures retain native stacks causes codes and GPU diagnostics across the worker boundary
  Scenario: Pi tools and skills pass real tool results back to the model
    Then the local Pi agent streams answers and uses fresh application tool results
  Scenario: Pi requests remain cancellable and bounded
    Then the local Pi agent reports parser failures cancellation and request limits
  Scenario: Token bursts defer transcript projection without losing image or final state
    Then assistant publication coalesces token bursts and retains image message identity
