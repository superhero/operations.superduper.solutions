export default {
  format: [
    "pretty",
    "json:temp/test/cucumber-test.json"
  ],
  import: [
    "source/**/*.test.mjs"
  ],
  paths: [
    "source/**/*.feature"
  ]
};
