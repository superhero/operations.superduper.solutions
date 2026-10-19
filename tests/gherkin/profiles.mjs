// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
const source = {
  import: [
    "src/operation-security.test.mjs",
    "src/vault-crypto.test.mjs",
    "src/vault-session.test.mjs",
    "src/vault-execution.test.mjs",
    "src/vault-lifecycle.test.mjs",
    "src/vault-passkeys.test.mjs",
    "src/vault-integration.test.mjs",
    "src/application.test.mjs",
    "src/operations.test.mjs",
    "src/operation-matching.test.mjs",
    "src/integer-scale.test.mjs",
    "src/metrics-history.test.mjs",
    "src/metrics-series.test.mjs",
    "src/logging.test.mjs",
    "src/error-diagnostics.test.mjs",
    "src/error-capture.test.mjs",
    "src/operation-report.test.mjs",
    "src/workflow-document.test.mjs",
    "src/workflow-input-occupancy.test.mjs",
    "src/workflow-connection-types.test.mjs",
    "src/workflow-runner.test.mjs",
    "src/workflow-comment.test.mjs",
    "src/workflow-file.test.mjs",
    "src/workflow-connection-snap.test.mjs",
    "src/workflow-focus-order.test.mjs",
    "src/workflow-change-message.test.mjs",
    "src/flow-routing-engine.test.mjs",
    "src/flow-routing-adapter.test.mjs",
    "src/flow-routing-path.test.mjs",
    "src/flow-routing-dashes.test.mjs",
    "src/flow-routing-rounding.test.mjs",
    "src/flow-routing-snapping.test.mjs",
    "src/flow-routing-worker-lifecycle.test.mjs",
    "src/flow-routing-handoff.test.mjs",
    "src/flow-routing-manual.test.mjs",
    "src/lib/flow-routing/coverage-regressions.test.mjs",
    "src/locale-settings.test.mjs",
    "src/keybindings.test.mjs",
    "src/toolbar-settings.test.mjs",
    "src/workflow-clipboard.test.mjs",
    "src/metrics-cache.test.mjs",
    "src/processing-metrics.test.mjs",
    "src/resource-core.test.mjs",
    "src/schema-documents.test.mjs",
    "src/service-schema-packs.test.mjs",
    "src/service-catalog.test.mjs",
    "src/schema-runtime.test.mjs",
    "src/worker-rpc.test.mjs",
    "src/workflow-curve.test.mjs",
    "src/workflow-graph-coverage.test.mjs",
    "src/workflow-graph-guards.test.mjs",
    "src/workflow-layout.test.mjs",
    "src/workflow-response.test.mjs",
    "src/workflow-defensive.test.mjs"
  ],
  paths: [
    "src/operation-security.feature",
    "src/vault-crypto.feature",
    "src/vault-session.feature",
    "src/vault-execution.feature",
    "src/vault-lifecycle.feature",
    "src/vault-passkeys.feature",
    "src/vault-integration.feature",
    "src/application.feature",
    "src/operations.feature",
    "src/operation-matching.feature",
    "src/integer-scale.feature",
    "src/metrics-history.feature",
    "src/metrics-series.feature",
    "src/logging.feature",
    "src/error-diagnostics.feature",
    "src/error-capture.feature",
    "src/operation-report.feature",
    "src/workflow-document.feature",
    "src/workflow-input-occupancy.feature",
    "src/workflow-connection-types.feature",
    "src/workflow-runner.feature",
    "src/workflow-comment.feature",
    "src/workflow-file.feature",
    "src/workflow-connection-snap.feature",
    "src/workflow-focus-order.feature",
    "src/workflow-change-message.feature",
    "src/flow-routing-engine.feature",
    "src/flow-routing-adapter.feature",
    "src/flow-routing-path.feature",
    "src/flow-routing-dashes.feature",
    "src/flow-routing-rounding.feature",
    "src/flow-routing-snapping.feature",
    "src/flow-routing-worker-lifecycle.feature",
    "src/flow-routing-handoff.feature",
    "src/flow-routing-manual.feature",
    "src/lib/flow-routing/coverage-regressions.feature",
    "src/locale-settings.feature",
    "src/keybindings.feature",
    "src/toolbar-settings.feature",
    "src/workflow-clipboard.feature",
    "src/metrics-cache.feature",
    "src/processing-metrics.feature",
    "src/resource-core.feature",
    "src/schema-documents.feature",
    "src/service-schema-packs.feature",
    "src/service-catalog.feature",
    "src/schema-runtime.feature",
    "src/worker-rpc.feature",
    "src/workflow-curve.feature",
    "src/workflow-graph-coverage.feature",
    "src/workflow-graph-guards.feature",
    "src/workflow-layout.feature",
    "src/workflow-response.feature",
    "src/workflow-defensive.feature"
  ]
};

const acceptance = {
  import: [
    "src/build.test.mjs",
    "src/favicons.test.mjs"
  ],
  paths: [
    "src/build.feature",
    "src/favicons.feature"
  ]
};

const automation = {
  import: [
    ".github/tests/*.test.mjs"
  ],
  paths: [
    ".github/tests/*.feature"
  ]
};


const browser = {
  import: ['tests/browser/support.mjs', 'tests/browser/*.steps.mjs'],
  paths: ['tests/browser/*.feature'],
};
const components = {
  import: ['tests/components/*.steps.mjs'],
  paths: ['tests/components/*.feature'],
};
const runner = {
  import: ['tests/gherkin/runner-regressions/steps.mjs'],
  paths: ['tests/gherkin/runner-regressions/contracts.feature'],
};
export { source, acceptance, automation, browser, components, runner };
export const profiles = { source, acceptance, automation, browser, components, runner };
