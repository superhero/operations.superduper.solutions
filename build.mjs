import { readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const result = await build({
  entryPoints: ["source/index.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  target: "es2024",
  write: false,
  outdir: "dist",
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
let css = "";

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

const template = await readFile("source/index.html", "utf8");

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

await writeFile("dist/index.html", html);
