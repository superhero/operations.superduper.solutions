# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Qualified catalog upload request bodies
  Scenario: Every reviewed upload retains its source contract and can be inserted
    Then all 44 upload body contracts retain their original declarations and have usable canonical models

  Scenario: Changed or unrelated upload declarations remain guarded
    Then upload body corrections reject changed source identities shapes and destinations before mutation

  Scenario: Typed wildcard bodies use their documented wire formats
    Then wildcard JSON text and multipart bodies retain typed values and Atlassian upload headers

  Scenario: Raw uploads preserve their bounded file bytes and content types
    Then reviewed raw uploads preserve exact bytes and reject malformed or unsupported files

  Scenario: Google uploads retain metadata alongside media
    Then all reviewed Google uploads send full JSON metadata before exact media bytes on their native upload paths

  Scenario: Google metadata and media modes retain credential boundaries
    Then authenticated Google uploads retain query values and redact credentials without implicit retries

  Scenario: Invalid upload modes and model drift stop before dispatch
    Then upload preparation rejects changed modes unsafe resource paths and stale body models

  Scenario: Bluesky video uploads use a separate delegated service token
    Then video uploads target the video service with the account DID filename and delegated authorization

  Scenario: Serialized media helpers reject incompatible models and MIME envelopes
    Then media helpers preserve model identity metadata limits and collision-free related envelopes

  Scenario: Media workflow graphs retain resources without invented declarations
    Then media workflow graphs preserve resource fields with or without native request declarations
