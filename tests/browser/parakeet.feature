# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
Feature: Browser-local speech beside Bonsai
  Scenario: Dictated messages reach Bonsai only after Send
    Then Parakeet and Bonsai share the draft without sending during capture
  Scenario: Repeated dictation preserves drafts and never sends automatically
    Then Parakeet dictation appends confirmed text and saves local audio across recordings
  Scenario: Silence and closing Assistant release the microphone
    Then Parakeet silence leaves the draft unchanged and pane closure stops capture
  Scenario: Permission denial and late permission grants are recoverable
    Then Parakeet microphone failures allow retry without leaking late streams
  Scenario: Cached restoration preserves the selected profile without opening the microphone
    Then Parakeet restores loaded speech after reload and unload clears restoration
  Scenario: Stalled startup offers a clean manual Retry
    Then Parakeet initialization deadline terminates the old worker before Retry
  Scenario: Audio files and diagnostics remain local on narrow screens
    Then Parakeet transcribes files and exports evidence without overflowing Settings
