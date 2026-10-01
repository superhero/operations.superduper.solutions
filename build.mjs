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

const buildDiagram = [
  "---",
  "config:",
  "    look: classic",
  "    theme: base",
  "    themeVariables:",
  '        fontFamily: "monospace"',
  '        lineColor: "#D65D0E"',
  "---",
  "",
  "flowchart TB",
  '    subgraph BuildReport["Build"]',
  '        subgraph InputBoundary["Inputs"]'
];

const typeScriptNodeIds = [];
const svelteNodeIds = [];
const otherNodeIds = [];

localInputs.forEach(([path, metadata], index) =>
{
  const id = `Source${index}`;
  const label = `${path}<br>${formatBytes(metadata.bytes)}`;

  buildDiagram.push(`            ${id}["${label}"]:::artifact`);

  if (path.endsWith(".ts"))
  {
    typeScriptNodeIds.push(id);
  }
  else if (path.endsWith(".svelte"))
  {
    svelteNodeIds.push(id);
  }
  else
  {
    otherNodeIds.push(id);
  }
});

buildDiagram.push(
  `            HtmlTemplate["${templatePath}<br>${formatBytes(templateBytes)}"]:::artifact`,
  "        end",
  "",
  '        subgraph BuildBoundary["Build Process"]',
  '            subgraph SourceProcessing["Source Processing"]',
  '                subgraph Validation["Validation"]',
  '                    ValidateTypeScript["Validate TypeScript<br>tsc --project tsconfig.json --noEmit"]:::operationDark',
  "                end",
  "",
  '                subgraph Compilation["Compilation"]',
  '                    CompileSvelte["Compile Svelte<br>Svelte compiler API"]:::operationDark',
  "                end",
  "            end",
  "",
  '            subgraph Transformation["Transformation"]',
  '                subgraph Bundling["Bundling"]',
  '                    BundleApplication["Bundle Application<br>esbuild"]:::operationLight',
  '                    OptimizeBundle["Optimize Bundle<br>minify + asset data URLs"]:::operationLight',
  "                end",
  "",
  '                subgraph Assembly["Assembly"]',
  '                    AssembleHtml["Assemble HTML<br>inject JavaScript + CSS"]:::operationDark',
  "                end",
  "            end",
  "        end",
  "",
  '        subgraph DistributionBoundary["Distribution"]',
  `            FinalOutput["${outputPath}<br>raw ${formatBytes(finalBytes)} · gzip ${formatBytes(finalGzipBytes)}"]:::artifactOutput`,
  "        end",
  "    end",
  ""
);

typeScriptNodeIds.forEach(id =>
{
  buildDiagram.push(`    ${id} --> ValidateTypeScript`);
});

svelteNodeIds.forEach(id =>
{
  buildDiagram.push(`    ${id} --> CompileSvelte`);
});

otherNodeIds.forEach(id =>
{
  buildDiagram.push(`    ${id} --> BundleApplication`);
});

buildDiagram.push(
  "    ValidateTypeScript --> BundleApplication",
  "    CompileSvelte --> BundleApplication",
  "    BundleApplication --> OptimizeBundle",
  "    OptimizeBundle --> AssembleHtml",
  "    HtmlTemplate --> AssembleHtml",
  "    AssembleHtml --> FinalOutput",
  "",
  "    classDef nsDepth_1 fill:#1D2021,stroke:#1D2021,color:#7C6F64,stroke-width:16px",
  "    classDef nsDepth_2 fill:#282828,stroke:#282828,color:#7C6F64,stroke-width:12px",
  "    classDef nsDepth_3 fill:#3C3836,stroke:#3C3836,color:#7C6F64,stroke-width:10px",
  "    classDef nsDepth_4 fill:#504945,stroke:#504945,color:#1D2021,stroke-width:8px",
  "    classDef artifact fill:#665C54,stroke:#665C54,color:#EBDBB2,stroke-width:6px",
  "    classDef operationDark fill:#1D2021,stroke:#282828,color:#EBDBB2,stroke-width:8px",
  "    classDef operationLight fill:#EBDBB2,stroke:#A89984,color:#665C54,stroke-width:8px",
  "    classDef artifactOutput fill:#1D2021,stroke:#D65D0E,color:#EBDBB2,stroke-width:8px",
  "",
  "    class BuildReport nsDepth_1",
  "    class InputBoundary,BuildBoundary,DistributionBoundary nsDepth_2",
  "    class SourceProcessing,Transformation nsDepth_3",
  "    class Validation,Compilation,Bundling,Assembly nsDepth_4"
);

const report = [
  "## Build",
  "",
  "```mermaid",
  ...buildDiagram,
  "```",
  ""
].join("\n");

await writeFile("temp/build/build-report.md", report);
await writeFile("temp/build/esbuild-metafile.json", JSON.stringify(result.metafile, null, 2));
