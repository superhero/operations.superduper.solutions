export default {
  format: [
    "progress",
    "json:temp/test/cucumber-test.json"
  ],
  import: [
    "src/**/*.test.mjs"
  ],
  paths: [
    "source/**/*.feature"
  ]
};
