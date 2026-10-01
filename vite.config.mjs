import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  root: "src",
  plugins: [
    svelte(),
    viteSingleFile()
  ],
  build: {
    target: "es2024",
    outDir: "../dist",
    emptyOutDir: true
  }
});
