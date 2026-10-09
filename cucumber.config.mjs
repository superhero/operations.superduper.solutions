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
    "src/operation-report.test.mjs",
    "src/workflow-document.test.mjs",
    "src/workflow-runner.test.mjs",
    "src/workflow-comment.test.mjs",
    "src/workflow-connection-snap.test.mjs"
  ],
  paths: [
    "src/application.feature",
    "src/operations.feature",
    "src/operation-report.feature",
    "src/workflow-document.feature",
    "src/workflow-runner.feature",
    "src/workflow-comment.feature",
    "src/workflow-connection-snap.feature"
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
