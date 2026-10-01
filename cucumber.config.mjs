export default {
  format: [
    "progress",
    "json:temp/test/cucumber-test.json"
  ],
  import: [
    "source/**/*.test.mjs"
  ],
  paths: [
    "source/**/*.feature"
  ]
};
