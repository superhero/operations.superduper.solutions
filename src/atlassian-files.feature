# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Reviewed Atlassian multipart file declarations
  Scenario: FilePart corrections retain their complete source provenance
    Then the eight Atlassian file corrections preserve shared Java schemas identities security and upstream requests

  Scenario: FilePart source drift cannot become an upload contract
    Then Atlassian file corrections reject changed declarations atomically

  Scenario: Native Atlassian uploads send actual file parts
    Then all eight native Atlassian file operations send named bytes XSRF headers and private credentials

  Scenario: Java object fields and invalid file values cannot dispatch
    Then Atlassian file uploads reject missing malformed oversized and obsolete Java field inputs before dispatch
