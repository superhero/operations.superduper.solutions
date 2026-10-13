// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import { Given, When, Then } from "@cucumber/cucumber";

/**
 * Register one first-class scenario, with a private preparation and verification
 * closure. Each case has its own three step definitions and source-report entry;
 * verification helpers can keep the successive assertions of a regression case
 * together without invoking another test runner or concealing other scenarios.
 */
export function routingScenario(given, when, then, prepare) {
  Given(given, function () {
    this.prepareRoutingScenario = prepare;
  });
  When(when, function () {
    this.verifyRoutingScenario = this.prepareRoutingScenario();
  });
  Then(then, function () {
    this.verifyRoutingScenario();
  });
}
