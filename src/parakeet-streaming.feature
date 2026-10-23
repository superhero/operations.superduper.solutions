# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
Feature: Local speech streaming contracts
  Scenario: Large model downloads stream to disk and recover incomplete transfers
    Then large speech weights stream without buffering the full download
  Scenario: Pinned resources reject corruption and recover cached downloads
    Then speech resources enforce immutable pins and release failed downloads
  Scenario: Feature worker failure rejects pending work and releases ports
    Then speech workers reject invalid ranges and close pending feature requests
  Scenario: Bounds and runtime errors cannot resume closed recordings
    Then speech failures remain bounded and cannot resume closed recordings
  Scenario: Speech merging preserves confirmed sentences pauses and genuine repetitions
    Then speech merging preserves confirmed sentences pauses and genuine repetitions
  Scenario: Speech inference coalesces jobs without losing audio or repeating stop
    Then speech inference coalesces jobs without losing audio or repeating Stop
  Scenario: Continuous speech features preserve packet boundaries padding and rpc order
    Then continuous speech features preserve packet boundaries padding and RPC order
  Scenario: Dictation preserves the user draft and locked profiles
    Then speech preferences and confirmed text preserve user control
  Scenario: Local evidence preserves submitted audio and comparison details
    Then speech diagnostics retain exact PCM and explain transcript differences
  Scenario: Real TEN VAD skips silence and resets between recordings
    Then real speech detection skips silence and restarts cleanly
