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
    "src/application.test.mjs"
  ],
  paths: [
    "src/application.feature"
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
