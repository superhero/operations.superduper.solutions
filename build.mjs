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

const localInputs = Object.entries(result.metafile.inputs)
  .filter(([path]) => !path.includes("node_modules/"))
  .sort(([a], [b]) => a.localeCompare(b));

const intermediateOutputs = Object.entries(result.metafile.outputs)
  .sort(([a], [b]) => a.localeCompare(b));

const processDiagram = [
  "classDiagram",
  "  direction TB",
  "",
  "  class ValidateTypeScript {",
  "    <<build step>>",
  "    +Input: source TypeScript",
  "    +Action: tsc --noEmit",
  "    +Output: validated TypeScript",
  "  }",
  "",
  "  class CompileSvelte {",
  "    <<build step>>",
  `    +Input: ${svelteInputs.size} Svelte component(s)`,
  "    +Action: compile for browser",
  "    +Output: JavaScript and CSS",
  "  }",
  "",
  "  class BundleApplication {",
  "    <<build step>>",
  "    +Input: application modules",
  "    +Action: resolve and bundle imports",
  "    +Output: browser ESM bundle",
  "  }",
  "",
  "  class OptimizeBundle {",
  "    <<build step>>",
  "    +Input: browser bundle and assets",
  "    +Action: minify and inline assets",
  "    +Output: optimized JavaScript and CSS",
  "  }",
  "",
  "  class AssembleHtml {",
  "    <<build step>>",
  "    +Input: source/index.html and optimized bundle",
  "    +Action: inject JavaScript and CSS",
  "    +Output: self-contained HTML",
  "  }",
  "",
  "  class DistributionFile {",
  "    <<artifact>>",
  "    +Path: dist/index.html",
  `    +Raw size: ${formatBytes(finalBytes)}`,
  `    +Gzip size: ${formatBytes(finalGzipBytes)}`,
  "  }",
  "",
  '  ValidateTypeScript --> CompileSvelte : validated source',
  '  CompileSvelte --> BundleApplication : compiled modules',
  '  BundleApplication --> OptimizeBundle : bundled application',
  '  OptimizeBundle --> AssembleHtml : optimized bundle',
  '  AssembleHtml --> DistributionFile : writes'
].join("\n");

const fileDiagram = [
  "classDiagram",
  "  direction TB"
];

localInputs.forEach(([path, metadata], index) =>
{
  fileDiagram.push(
    "",
    `  class Input${index} {`,
    "    <<input>>",
    `    +Path: ${path}`,
    `    +Size: ${formatBytes(metadata.bytes)}`,
    "  }"
  );
});

fileDiagram.push(
  "",
  "  class HtmlTemplate {",
  "    <<input>>",
  `    +Path: ${templatePath}`,
  `    +Size: ${formatBytes(templateBytes)}`,
  "    +Role: HTML template",
  "  }"
);

intermediateOutputs.forEach(([path, metadata], index) =>
{
  fileDiagram.push(
    "",
    `  class Bundle${index} {`,
    "    <<intermediate>>",
    `    +Path: ${path}`,
    `    +Size: ${formatBytes(metadata.bytes)}`,
    "    +Role: esbuild output",
    "  }"
  );
});

fileDiagram.push(
  "",
  "  class FinalOutput {",
  "    <<output>>",
  `    +Path: ${outputPath}`,
  `    +Raw size: ${formatBytes(finalBytes)}`,
  `    +Gzip size: ${formatBytes(finalGzipBytes)}`,
  "    +Role: deployable file",
  "  }"
);

localInputs.forEach(([,], index) =>
{
  if (intermediateOutputs.length === 0)
  {
    fileDiagram.push(`  Input${index} --> FinalOutput : contributes to`);
  }
  else
  {
    intermediateOutputs.forEach(([,], outputIndex) =>
    {
      fileDiagram.push(`  Input${index} --> Bundle${outputIndex} : bundled into`);
    });
  }
});

fileDiagram.push("  HtmlTemplate --> FinalOutput : template for");

intermediateOutputs.forEach(([,], index) =>
{
  fileDiagram.push(`  Bundle${index} --> FinalOutput : injected into`);
});

const report = [
  "## Build process",
  "",
  "```mermaid",
  processDiagram,
  "```",
  "",
  "## Build files",
  "",
  "```mermaid",
  ...fileDiagram,
  "```",
  ""
].join("\n");

await writeFile("temp/build/build-report.md", report);
await writeFile("temp/build/esbuild-metafile.json", JSON.stringify(result.metafile, null, 2));
