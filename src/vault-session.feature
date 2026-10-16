# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@vault-session
Feature: Browser vault session lifecycle
  Encrypted storage becomes usable only after authentication.
  Changes require current authentication and never return stored credential values.

  Scenario: Creation requires confirming a saved recovery key
    Then a vault session persists creation only after the exact recovery key is confirmed

  Scenario: Password and recovery unlock independently
    Then vault sessions authenticate password and recovery while failed unlock leaves the session locked

  Scenario: Credential editing and destination grants
    Then vault sessions edit credentials and approve or revoke exact destinations without returning secret values

  Scenario: Private records require a strict schema
    Then vault sessions reject invalid credential input and malformed authenticated plaintext

  Scenario: Credential count stays bounded
    Then a full vault rejects an additional credential before changing durable storage

  Scenario: Restored credentials need destination review
    Then vault restore authenticates both vaults and clears imported grants before committing

  Scenario: Invalid restore preserves durable data
    Then corrupt and unauthenticated vault backups never replace the current encrypted storage

  Scenario: Unlock method replacement is independent
    Then vault sessions confirm recovery changes and independently enroll replace and remove methods

  Scenario: Rotation requires proof for every retained method
    Then vault rotation changes the key epoch while every retained method and complete old backup remain independently usable

  Scenario: Rotated backups restore through every retained method
    Then a rotated vault backup restores into fresh storage with every retained unlock method

  Scenario Outline: Rotation interruption preserves a complete restartable snapshot
    Then rotation interrupted "<phase>" the atomic commit restarts with one complete authenticated snapshot

    Examples:
      | phase  |
      | before |
      | after  |

  Scenario: Durable changes invalidate stale tabs
    Then vault sessions detect both durable revisions and lock epochs before using credentials

  Scenario: Lock cancels in-flight session work
    Then vault sessions discard pending creation authentication and decrypted results when locked

  Scenario: Deadline checks guard asynchronous completion
    Then vault sessions check the active deadline before access and after authentication completes

  Scenario: Credential execution uses the authenticated session
    Then vault session execution injects only an approved credential and returns sanitized results

  Scenario: Current schema policy guards approval and execution
    Then vault sessions reject stale schemas before approval and dispatch and before accepting a response

  Scenario: Replacement exports preserve the exact current vault
    Then replacement exports authenticate locked vaults and guard against intervening changes

  Scenario: Unlock input selects its method automatically
    Then automatic vault unlocking tries matching saved methods and retains long passwords
