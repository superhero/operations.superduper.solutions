import { dirname } from "node:path";
import { gzipSync } from "node:zlib";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { compile } from "svelte/compiler";

const formatBytes = bytes =>
{
  if (bytes < 1024)
  {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024)
  {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
};

await rm("dist", { recursive: true, force: true });
await rm("temp/build", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await mkdir("temp/build", { recursive: true });

const svelteCss = [];
const svelteInputs = new Set();

const sveltePlugin = {
  name: "svelte",
  setup(buildContext)
  {
    buildContext.onLoad({ filter: /\.svelte$/ }, async ({ path }) =>
    {
      svelteInputs.add(path);

      const source = await readFile(path, "utf8");
      const compiled = compile(source, {
        filename: path,
        generate: "client",
        dev: false
      });

      if (compiled.css?.code)
      {
        svelteCss.push(compiled.css.code);
      }

      return {
        contents: compiled.js.code,
        loader: "js",
        resolveDir: dirname(path)
      };
    });
  }
};

const result = await build({
  entryPoints: ["source/index.ts"],
  bundle: true,
  minify: true,
  metafile: true,
  format: "esm",
  platform: "browser",
  target: "es2024",
  write: false,
  outdir: "dist",
  plugins: [sveltePlugin],
  loader: {
    ".svg": "dataurl",
    ".png": "dataurl",
    ".jpg": "dataurl",
    ".jpeg": "dataurl",
    ".gif": "dataurl",
    ".webp": "dataurl",
    ".woff": "dataurl",
    ".woff2": "dataurl"
  }
});

let javascript = "";
let css = svelteCss.join("");

for (const output of result.outputFiles)
{
  if (output.path.endsWith(".js"))
  {
    javascript += output.text;
  }
  else if (output.path.endsWith(".css"))
  {
    css += output.text;
  }
}

const templatePath = "source/index.html";
const template = await readFile(templatePath, "utf8");

const inlineJavascript = javascript.replaceAll("</script", "<\\/script");
const inlineCss = css.replaceAll("</style", "<\\/style");

let html = template.replace(
  '<script type="module" src="./index.js"></script>',
  `<script type="module">${inlineJavascript}</script>`
);

if (inlineCss)
{
  html = html.replace("</head>", `<style>${inlineCss}</style>\n</head>`);
}

const outputPath = "dist/index.html";
await writeFile(outputPath, html);

const finalBytes = Buffer.byteLength(html);
const finalGzipBytes = gzipSync(html).byteLength;
const templateBytes = Buffer.byteLength(template);

const inputRows = Object.entries(result.metafile.inputs)
  .filter(([path]) => !path.includes("node_modules/"))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, metadata]) =>
  {
    const kind = svelteInputs.has(path) ? "🧩" : "📄";
    return `| ${kind} \`${path}\` | ${formatBytes(metadata.bytes)} |`;
  });

inputRows.unshift(`| 🧱 \`${templatePath}\` | ${formatBytes(templateBytes)} |`);

const intermediateRows = Object.entries(result.metafile.outputs)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, metadata]) =>
    `| ⚙️ \`${path}\` | ${formatBytes(metadata.bytes)} |`);

const stageRows = [
  "| 1 | ✅ TypeScript validation | `tsc --noEmit` validates the TypeScript source before bundling. |",
  `| 2 | 🧩 Svelte compilation | Compiles ${svelteInputs.size} Svelte component(s) to browser JavaScript and collects generated CSS. |`,
  "| 3 | 📦 Bundle | esbuild follows imports from `source/index.ts` and combines reachable modules into a browser ESM bundle. |",
  "| 4 | ✂️ Minify | esbuild minifies the generated JavaScript bundle. |",
  "| 5 | 🖼️ Inline assets | SVG, PNG, JPG, JPEG, GIF, WebP, WOFF and WOFF2 assets are embedded as data URLs when imported. |",
  "| 6 | 🧬 Assemble HTML | Bundled JavaScript and generated CSS are injected into `source/index.html`. |",
  "| 7 | 🎯 Final output | Writes one self-contained deployable file: `dist/index.html`. |"
];

const report = [
  "# Build Report",
  "",
  "## Transformation",
  "",
  "| Stage | Operation | What happened |",
  "| ---: | --- | --- |",
  ...stageRows,
  "",
  "## Inputs",
  "",
  "| Source | Size |",
  "| --- | ---: |",
  ...inputRows,
  "",
  "## esbuild intermediate output",
  "",
  "| Bundle output | Size |",
  "| --- | ---: |",
  ...intermediateRows,
  "",
  "## Final output",
  "",
  "| Distribution file | Raw | Gzip |",
  "| --- | ---: | ---: |",
  `| 📦 \`${outputPath}\` | ${formatBytes(finalBytes)} | ${formatBytes(finalGzipBytes)} |`,
  ""
].join("\n");

await writeFile("temp/build/build-report.md", report);
await writeFile("temp/build/esbuild-metafile.json", JSON.stringify(result.metafile, null, 2));
