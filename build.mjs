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
  '    subgraph Inputs["_Inputs_"]'
];

const sourceNodeIds = [];
const svelteNodeIds = [];
const otherNodeIds = [];

localInputs.forEach(([path, metadata], index) =>
{
  const id = `Source${index}`;
  const label = `${path}<br>${formatBytes(metadata.bytes)}`;

  buildDiagram.push(`        ${id}["${label}"]:::artifact`);

  if (path.endsWith(".ts"))
  {
    sourceNodeIds.push(id);
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
  `        HtmlTemplate["${templatePath}<br>${formatBytes(templateBytes)}"]:::artifact`,
  "    end",
  "",
  '    subgraph Build["_Build_"]',
  '        ValidateTypeScript["**Validate TypeScript**<br>tsc --project tsconfig.json --noEmit"]:::operation',
  '        CompileSvelte["**Compile Svelte**<br>Svelte compiler API"]:::operation',
  '        BundleApplication["**Bundle Application**<br>esbuild"]:::operation',
  '        OptimizeBundle["**Optimize Bundle**<br>minify + asset data URLs"]:::operation',
  '        AssembleHtml["**Assemble HTML**<br>inject JavaScript + CSS"]:::operation',
  "    end",
  "",
  '    subgraph Output["_Output_"]',
  `        FinalOutput["**${outputPath}**<br>raw ${formatBytes(finalBytes)} · gzip ${formatBytes(finalGzipBytes)}"]:::output`,
  "    end",
  ""
);

sourceNodeIds.forEach(id =>
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
  "    classDef group fill:#282828,stroke:#282828,color:#7C6F64,stroke-width:8px",
  "    classDef artifact fill:#504945,stroke:#504945,color:#EBDBB2,stroke-width:4px",
  "    classDef operation fill:#3C3836,stroke:#665C54,color:#EBDBB2,stroke-width:4px",
  "    classDef output fill:#1D2021,stroke:#D65D0E,color:#EBDBB2,stroke-width:4px",
  "",
  "    class Inputs,Build,Output group"
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
