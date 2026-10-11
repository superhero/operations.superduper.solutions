import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import errorOverlay from "@visulima/vite-overlay";
import { devToolbar } from "@visulima/dev-toolbar/vite";
import { pail } from "@visulima/pail";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless"
};

const overlay = errorOverlay({
  framework: "svelte",
  // Pail sends errors explicitly. Never intercept Vite's transport errors.
  forwardedConsoleMethods: ["warn"],
  showBalloonButton: false,
  overlay: {
    customCSS: readFileSync(new URL("./src/dev/error-overlay.css", import.meta.url), "utf8")
  }
});
const injectOverlay = overlay.transformIndexHtml;
overlay.transformIndexHtml = async function (...args) {
  const result = await injectOverlay.apply(this, args);
  const runtime = result.tags?.find(tag => tag.tag === "script" && tag.attrs?.type === "module"
    && typeof tag.children === "string" && tag.children.includes("async function sendError("));
  if (!runtime) throw new Error("Visulima runtime injection changed; review the browser error normalization hook.");
  // Module dependencies run before its body registers the error listeners.
  runtime.children = `import "/dev/error-chain.ts";\n${runtime.children}`;
  return result;
};
const configureOverlay = overlay.configureServer;
overlay.configureServer = function (server) {
  const on = server.ws.on;
  server.ws.on = function (event, listener) {
    if (event !== "visulima:vite-overlay:error") return on.call(this, event, listener);
    return on.call(this, event, (data, client) => {
      if (data && !data.cause && !data.stack && !(data.file && data.line > 0)) {
        // Visulima prepends the full message to its stack parser. With no trace,
        // multiline diagnostic prose can become a fictitious source location.
        // There is no source to resolve: deliver the same overlay shape directly.
        pail.error(`[client] ${data.name}: ${data.message}`);
        client.send({ type: "error", err: { errorType: "client", rootPath: server.config.root,
          errors: [{ name: data.name, message: data.message, stack: "", originalStack: "",
            originalFilePath: data.file || "", originalFileLine: 0, originalFileColumn: 0,
            originalSnippet: "", compiledFilePath: "", compiledLine: 0, compiledColumn: 0,
            compiledSnippet: "", fixPrompt: "" }] } });
        return;
      }
      return listener(data, client);
    });
  };
  try { return configureOverlay.call(this, server); }
  finally { server.ws.on = on; }
};

export default defineConfig({
  root: "src",
  // Visulima handles runtime errors; Vite's own forwarding can report failed
  // transmissions back through console.error and create a transport loop.
  server: { forwardConsole: false, headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url))
    }
  },
  plugins: [
    tailwindcss(),
    svelte(),
    {
      name: "operations-error-source-lookup",
      apply: "serve",
      configureServer(server) {
        const getModuleByUrl = server.moduleGraph.getModuleByUrl;
        server.moduleGraph.getModuleByUrl = function (url, ...args) {
          // Visulima derives an empty candidate from inline-page paths like '/'.
          // It means no source module, not a second error from Vite's resolver.
          return url === "" ? Promise.resolve(undefined) : getModuleByUrl.call(this, url, ...args);
        };
      },
    },
    overlay,
    devToolbar({
      placement: "bottom-center",
      apps: { performance: true, timeline: true, settings: false },
      injectSource: { enabled: false }
    }),
    viteSingleFile()
  ],
  build: {
    target: "es2024",
    outDir: "../dist",
    emptyOutDir: true
  }
});
