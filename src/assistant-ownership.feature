# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
Feature: Coordinated local model ownership
  Scenario: Canceled waiting work cannot affect the active turn
    Then local model queues cancel waiters and finish active cleanup in FIFO order
  Scenario: Resident owners yield only after complete turns and tools
    Then local model ownership serializes physical cleanup before the next owner
  Scenario: Failed cleanup cannot permit another allocation
    Then local model leases remain held after unknown cleanup and release after recovery
  Scenario: CPU speech does not release the resident GPU model
    Then explicit CPU work leaves GPU ownership unchanged
  Scenario: A real agent retains its transcript across physical model handoff
    Then the assistant worker owns the complete tool loop and restores text without repeating tools
  Scenario: Speech ownership includes native inference and archived output
    Then the speech worker retains its lease through final transcript storage acknowledgement
  Scenario: Speech preparation can be canceled while another owner waits
    Then canceled microphone preparation releases only its own runtime after cleanup
  Scenario: Normal shutdown acknowledges cleanup and stalled shutdown terminates
    Then local worker shutdown waits for disposal with a bounded fallback
  Scenario: The speech controller acknowledges durable final output before reuse
    Then final speech output waits for storage and a preparation failure can retry cleanly
  Scenario: Cancellation drains a running speech forward without late output
    Then canceled speech inference drains before releasing ownership and emits no late transcript
  Scenario: A late PCM failure cannot dispose a running speech session
    Then late speech packet failures drain before native session disposal
  Scenario: A failed image worker cannot silently resume another model
    Then unconfirmed image worker cleanup leaves text paused until explicit recovery
