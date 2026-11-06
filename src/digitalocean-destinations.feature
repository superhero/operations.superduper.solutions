# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: DigitalOcean agent and private signed upload destinations
  Scenario: Reviewed destination contracts preserve their native source
    Then DigitalOcean destination adapters retain their pinned declarations and expose configuration requirements

  Scenario: Unreviewed destination and capability declarations remain guarded
    Then DigitalOcean destination corrections reject source drift before any mutation

  Scenario: File intents privately adopt their signed capability and expiry
    Then a DigitalOcean file intent returns a credential reference and public storage origin without its signed URL

  Scenario: Invalid file intents never publish or adopt their credentials
    Then malformed expired and failed DigitalOcean file intents withhold all unadopted response material

  Scenario: Signed uploads retain exact URL bytes body and media type
    Then DigitalOcean signed uploads use their bound storage origin and never forward an account token

  Scenario: Invalid capabilities cannot dispatch an upload
    Then DigitalOcean upload validation rejects unsafe hosts altered signatures expired capabilities and wrong connection origins

  Scenario: Private file intents connect to their corresponding uploads
    Then the privately adopted DigitalOcean file intent can authorize its exact upload and retains the shorter expiry

  Scenario: Agent responses preserve both JSON and streamed JSON modes
    Then DigitalOcean agent requests bind their configured key and origin and support bounded opt-in streaming

  Scenario: Public execution cannot bypass private upload approval
    Then unconfigured or public DigitalOcean uploads cannot bypass their private connection or send an account credential

  Scenario: Finite chat streams require complete choices and their terminal marker
    Then DigitalOcean chat streaming assembles split text tool arguments and usage and rejects truncated or inconsistent frames
