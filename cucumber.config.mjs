const base = {
  format: [
    "pretty"
  ]
};

export default {
  ...base,
  import: [
    "src/**/*.test.mjs"
  ],
  paths: [
    "src/**/*.feature"
  ]
};

export const source = {
  ...base,
  format: [
    "pretty",
    "json:tmp/test/cucumber-source.json"
  ],
  import: [
    "src/application.test.mjs",
    "src/operations.test.mjs",
    "src/integer-scale.test.mjs",
    "src/metrics-history.test.mjs",
    "src/metrics-series.test.mjs",
    "src/logging.test.mjs",
    "src/operation-report.test.mjs",
    "src/workflow-document.test.mjs",
    "src/workflow-runner.test.mjs",
    "src/workflow-comment.test.mjs",
    "src/workflow-connection-snap.test.mjs",
    "src/workflow-change-message.test.mjs",
    "src/flow-routing-engine.test.mjs",
    "src/flow-routing-adapter.test.mjs",
    "src/flow-routing-path.test.mjs",
    "src/flow-routing-dashes.test.mjs",
    "src/flow-routing-rounding.test.mjs",
    "src/flow-routing-snapping.test.mjs",
    "src/flow-routing-worker-lifecycle.test.mjs",
    "src/flow-routing-handoff.test.mjs",
    "src/lib/flow-routing/coverage-regressions.test.mjs"
  ],
  paths: [
    "src/application.feature",
    "src/operations.feature",
    "src/integer-scale.feature",
    "src/metrics-history.feature",
    "src/metrics-series.feature",
    "src/logging.feature",
    "src/operation-report.feature",
    "src/workflow-document.feature",
    "src/workflow-runner.feature",
    "src/workflow-comment.feature",
    "src/workflow-connection-snap.feature",
    "src/workflow-change-message.feature",
    "src/flow-routing-engine.feature",
    "src/flow-routing-adapter.feature",
    "src/flow-routing-path.feature",
    "src/flow-routing-dashes.feature",
    "src/flow-routing-rounding.feature",
    "src/flow-routing-snapping.feature",
    "src/flow-routing-worker-lifecycle.feature",
    "src/flow-routing-handoff.feature",
    "src/lib/flow-routing/coverage-regressions.feature"
  ]
};

export const acceptance = {
  ...base,
  format: [
    "pretty",
    "json:tmp/test/cucumber-test.json"
  ],
  import: [
    "src/build.test.mjs"
  ],
  paths: [
    "src/build.feature"
  ]
};

export const automation = {
  ...base,
  format: [
    "pretty",
    "json:tmp/test/cucumber-automation.json"
  ],
  import: [
    ".github/tests/*.test.mjs"
  ],
  paths: [
    ".github/tests/*.feature"
  ]
};

export const browser = {
  ...base,
  parallel: 2,
  format: ["pretty", "json:tmp/test/cucumber-browser.json"],
  import: ["tests/browser/support.mjs", "tests/browser/*.steps.mjs"],
  paths: ["tests/browser/*.feature"],
};
