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
  "requirementDiagram",
  "  direction LR",
  "",
  "  element source {",
  '    type: "TypeScript and Svelte source"',
  "  }",
  "",
  "  requirement validate {",
  '    id: "1"',
  '    text: "TypeScript validation"',
  "    risk: Low",
  "    verifymethod: Analysis",
  "  }",
  "",
  "  requirement compile {",
  '    id: "2"',
  '    text: "Svelte compilation"',
  "    risk: Low",
  "    verifymethod: Analysis",
  "  }",
  "",
  "  requirement bundle {",
  '    id: "3"',
  '    text: "esbuild bundling"',
  "    risk: Low",
  "    verifymethod: Analysis",
  "  }",
  "",
  "  requirement minify {",
  '    id: "4"',
  '    text: "Minification and asset inlining"',
  "    risk: Low",
  "    verifymethod: Analysis",
  "  }",
  "",
  "  requirement assemble {",
  '    id: "5"',
  '    text: "HTML assembly"',
  "    risk: Low",
  "    verifymethod: Analysis",
  "  }",
  "",
  "  element output {",
  '    type: "dist/index.html"',
  "  }",
  "",
  "  source - satisfies -> validate",
  "  validate - derives -> compile",
  "  compile - derives -> bundle",
  "  bundle - derives -> minify",
  "  minify - derives -> assemble",
  "  output - satisfies -> assemble"
].join("\n");

const fileDiagram = [
  "requirementDiagram",
  "  direction LR"
];

localInputs.forEach(([path, metadata], index) =>
{
  fileDiagram.push(
    "",
    `  element src${index} {`,
    `    type: "${path} (${formatBytes(metadata.bytes)})"`,
    "  }"
  );
});

fileDiagram.push(
  "",
  "  element template {",
  `    type: "${templatePath} (${formatBytes(templateBytes)})"`,
  "  }"
);

intermediateOutputs.forEach(([path, metadata], index) =>
{
  fileDiagram.push(
    "",
    `  requirement intermediate${index} {`,
    `    id: "bundle-${index + 1}"`,
    `    text: "${path} (${formatBytes(metadata.bytes)})"`,
    "    risk: Low",
    "    verifymethod: Analysis",
    "  }"
  );
});

fileDiagram.push(
  "",
  "  element final {",
  `    type: "${outputPath} (raw ${formatBytes(finalBytes)}, gzip ${formatBytes(finalGzipBytes)})"`,
  "  }"
);

localInputs.forEach(([,], index) =>
{
  if (intermediateOutputs.length === 0)
  {
    fileDiagram.push(`  src${index} - satisfies -> final`);
  }
  else
  {
    intermediateOutputs.forEach(([,], outputIndex) =>
    {
      fileDiagram.push(`  src${index} - satisfies -> intermediate${outputIndex}`);
    });
  }
});

fileDiagram.push("  template - satisfies -> final");

intermediateOutputs.forEach(([,], index) =>
{
  fileDiagram.push(`  final - satisfies -> intermediate${index}`);
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
