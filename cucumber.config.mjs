const base = {
  format: [
    "pretty"
  ]
};

export default {
  default: {
    ...base,
    import: [
      "src/**/*.test.mjs"
    ],
    paths: [
      "src/**/*.feature"
    ]
  },
  source: {
    ...base,
    import: [
      "src/application.test.mjs"
    ],
    paths: [
      "src/application.feature"
    ]
  },
  acceptance: {
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
  }
};
