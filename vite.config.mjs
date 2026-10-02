import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  root: "src",
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url))
    }
  },
  plugins: [
    tailwindcss(),
    svelte(),
    viteSingleFile()
  ],
  build: {
    target: "es2024",
    outDir: "../dist",
    emptyOutDir: true
  }
});
