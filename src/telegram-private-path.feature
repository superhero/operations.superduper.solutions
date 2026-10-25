# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@telegram-private-path
Feature: Private Telegram bot token paths
  Scenario: Native Telegram source stays pinned while private paths become available
    Then the reviewed Telegram correction retains native bytes and qualifies only its fixed private template

  Scenario: One connection supports getMe JSON and multipart requests
    Then one saved connection supplies getMe JSON and multipart private Telegram URLs without publishing the token

  Scenario: Native getMe JSON messages and sticker files use the private transport
    Then native Telegram getMe JSON messages and sticker files dispatch through saved private token references

  Scenario: URL echoes are scrubbed from success and HTTP errors
    Then raw encoded and double encoded Telegram URL echoes never escape private results or errors

  Scenario: Invalid tokens references destinations and paths cannot dispatch
    Then malformed missing cross origin stale and traversal Telegram bindings fail before any request

  Scenario: Generic unresolved placeholders remain unavailable
    Then unreviewed Telegram and unrelated server placeholders cannot enter public execution

  Scenario: Workflows retain references while portable documents remove them
    Then Telegram connection previews schemas history and portable documents contain no token values

  @coverage-gaps
  Scenario: Private path approval rejects security and method drift
    Then Telegram private path approval rejects method annotation and security drift
