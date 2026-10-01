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
  "stateDiagram-v2",
  "  direction LR",
  "  [*] --> TypeScript",
  '  TypeScript: TypeScript validation\\ntsc --noEmit',
  `  Svelte: Svelte compilation\\n${svelteInputs.size} component(s)`,
  "  Bundle: esbuild bundle\\nbrowser ESM",
  "  Minify: Minification",
  "  Inline: Asset inlining",
  "  Assemble: HTML assembly\\ninject JavaScript and CSS",
  "  Output: dist/index.html",
  "  TypeScript --> Svelte",
  "  Svelte --> Bundle",
  "  Bundle --> Minify",
  "  Minify --> Inline",
  "  Inline --> Assemble",
  "  Assemble --> Output",
  "  Output --> [*]"
].join("\n");

const fileDiagram = ["flowchart LR"];

localInputs.forEach(([path, metadata], index) =>
{
  fileDiagram.push(
    `  src${index}["${path}<br/>${formatBytes(metadata.bytes)}"]`
  );
});

fileDiagram.push(
  `  template["${templatePath}<br/>${formatBytes(templateBytes)}"]`
);

intermediateOutputs.forEach(([path, metadata], index) =>
{
  fileDiagram.push(
    `  intermediate${index}["${path}<br/>${formatBytes(metadata.bytes)}"]`
  );
});

fileDiagram.push(
  `  final["${outputPath}<br/>raw ${formatBytes(finalBytes)}<br/>gzip ${formatBytes(finalGzipBytes)}"]`
);

localInputs.forEach(([,], index) =>
{
  if (intermediateOutputs.length === 0)
  {
    fileDiagram.push(`  src${index} --> final`);
  }
  else
  {
    intermediateOutputs.forEach(([,], outputIndex) =>
    {
      fileDiagram.push(`  src${index} --> intermediate${outputIndex}`);
    });
  }
});

fileDiagram.push("  template --> final");

intermediateOutputs.forEach(([,], index) =>
{
  fileDiagram.push(`  intermediate${index} --> final`);
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
