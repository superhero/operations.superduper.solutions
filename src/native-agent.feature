# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-agent
Feature: Owned native Codex workflows
  Scenario: Public login waits for completion and account confirmation
    Then native browser and device logins wait while API key login has no login ID

  Scenario: An owned turn waits for explicit approval and terminal output
    Then native thread turns require a one off approval and a matching completed result

  Scenario: Cancellation interrupts only the owned turn
    Then cancelling a native turn interrupts the owned child without logout

  Scenario: Source changes invalidate an outstanding approval and result
    Then stale native source cannot approve or complete a turn

  Scenario: Disconnect never replays a dispatched native turn
    Then a disconnected native turn fails with an unknown outcome and no replay

  Scenario: Failed and interrupted native terminals cannot succeed
    Then failed and interrupted native turns return explicit failures

  Scenario: Internal login and foreign threads are rejected
    Then native workflows reject internal login foreign threads and configuration overrides

  Scenario: Early login completion remains correlated
    Then early native login completion is matched and a foreign completion is rejected

  Scenario: Private native management binds canonical sources account and encrypted profiles
    Then native workflow management keeps credentials private and rejects stale runtime selections

  Scenario: Native graph mappings carry a thread ID into a terminal turn
    Then a native graph runs through parameters and typed terminal result ports without HTTP

  Scenario: Unimplemented interactions stop an owned turn
    Then unsupported native permission requests cannot obtain approval

  Scenario: Cancellation during account confirmation cannot save a new profile
    Then a cancelled native account confirmation does not publish login success

  @coverage-gaps
  Scenario: Native input validation rejects malformed bounds before dispatch
    Then native text inputs and login credentials reject malformed bounds before dispatch

  @coverage-gaps
  Scenario: Hostile approval requests cannot authorize native commands
    Then native workflow events reject foreign malformed and excessive approvals without authorizing commands

  @coverage-gaps
  Scenario: Malformed native terminal authority cannot publish success
    Then native terminal results and account confirmations cannot claim success with malformed authority

  @coverage-gaps
  Scenario: Native login instructions and completion retain their private authority
    Then native login rejects unsafe instructions failed completion and secret echoes

  @coverage-gaps
  Scenario: Early login and unsolicited events retain their active owner
    Then native early login events and authority updates retain exact ownership

  @coverage-gaps
  Scenario: Active native requests recheck lifecycle ownership
    Then native active requests expire cancel and recheck approval ownership after asynchronous guards

  @coverage-gaps
  Scenario: Private native workflows require complete current enabled selections
    Then native private workflow management rejects incomplete selections and stale or unenabled authority

  @coverage-gaps
  Scenario: Concurrent native connects cannot replay against a stale owner
    Then overlapping native connects revoke stale ownership and permit a fresh workflow without replay

  @coverage-gaps
  Scenario: Private native login cannot publish secret progress or a late confirmed profile
    Then native private login redacts progress and cancellation after confirmation cannot update its profile
