import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    svelte()
  ],
  resolve: {
    conditions: [
      "browser"
    ]
  },
  test: {
    environment: "jsdom",
    include: [
      "src/**/*.spec.mjs"
    ],
    coverage: {
      provider: "v8",
      include: [
        "src/**/*.{ts,svelte}"
      ],
      exclude: [
        "src/**/*.d.ts"
      ],
      reporter: [
        "text-summary",
        "json"
      ],
      reportsDirectory: "tmp/test/coverage"
    }
  }
});
