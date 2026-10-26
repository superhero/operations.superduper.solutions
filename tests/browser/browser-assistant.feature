# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Browser assistant in Settings
  Scenario: The pane switch preserves settings and a live assistant session
    Then the pane switches between settings and assistant without losing its session
  Scenario: Local model controls are lazy and preferences survive a reload
    Then the assistant settings expose accepted local models and remember configuration
  Scenario: Application tools edit the real workspace without executing it
    Then the assistant can inspect add move and connect through the workspace UI boundary
  Scenario: Editing can be disabled and model resources can be stopped
    Then assistant read only mode and unload prevent further workspace edits
  Scenario: The assistant fits a narrow settings pane and reports worker failure
    Then assistant messaging remains usable on a narrow viewport and reports failure
  Scenario: Model loading errors retain their diagnostics in the shared error history
    Then assistant loading failures reach the shared history and copy their native error chain
  Scenario: Compatibility runs in the actual browser worker without model downloads
    Then the assistant checks its real browser worker without downloading model files
    And the same compatibility check succeeds in a development worker
  Scenario: The message input grows with drafts and pane width
    Then assistant drafts expand the message input without internal scrolling
  Scenario: Streamed conversations preserve drafts and the reader's scroll position
    Then assistant streaming keeps drafts focus and readable tool details
  Scenario: Attachments remain visible in chat and obsolete image preparation is discarded
    Then assistant attachments and new conversation respect asynchronous image cleanup
  Scenario: Native language profiles load on selection and preserve engine constraints
    Then Gemma MiniCPM and Ornith load on selection with their supported settings
  Scenario: Decision models are separate explicit native requests
    Then decision controls preserve native results and release their exclusive model session
  Scenario: Optional runtime artifacts load without model weights
    Then native runtime modules and compressed Wasm load in real browser workers
