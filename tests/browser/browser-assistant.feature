# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Browser assistant in Settings
  Scenario: Local model controls are lazy and preferences survive a reload
    Then the assistant settings expose only three Bonsai models and remember configuration
  Scenario: Application tools edit the real workspace without executing it
    Then the assistant can inspect add move and connect through the workspace UI boundary
  Scenario: Editing can be disabled and model resources can be stopped
    Then assistant read only mode and unload prevent further workspace edits
  Scenario: The assistant fits a narrow settings pane and reports worker failure
    Then assistant messaging remains usable on a narrow viewport and reports failure
  Scenario: Compatibility runs in the actual browser worker without model downloads
    Then the assistant checks its real browser worker without downloading model files
  Scenario: Streamed conversations preserve drafts and the reader's scroll position
    Then assistant streaming keeps drafts focus and readable tool details
  Scenario: Attachments remain visible in chat and obsolete image preparation is discarded
    Then assistant attachments and new conversation respect asynchronous image cleanup
