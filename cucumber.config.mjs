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
