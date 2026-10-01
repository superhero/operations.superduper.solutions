export default {
  format: [
    "pretty",
    "json:tmp/test/cucumber-test.json"
  ],
  import: [
    "src/**/*.test.mjs"
  ],
  paths: [
    "src/**/*.feature"
  ]
};
