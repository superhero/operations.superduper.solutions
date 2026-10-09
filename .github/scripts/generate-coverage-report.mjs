#!/usr/bin/env node
// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";

// Keep each Istanbul page in its own document so scripts, filters and line IDs
// operate on that page, not on a mixture of every page in the report.
function openCoverageReport()
{
  const files = JSON.parse(document.getElementById("coverage-files").textContent);
  let frame = document.getElementById("coverage");
  const error = document.getElementById("coverage-error");
  const urls = new Map();
  const bytes = file => Uint8Array.from(atob(file.data), character => character.charCodeAt(0));
  const text = file => new TextDecoder().decode(bytes(file));
  let current;
  let loadedDocument;
  let anchor = "";

  function target(reference, page)
  {
    const base = `https://coverage.invalid/${page.split("/").map(encodeURIComponent).join("/")}`;
    const url = new URL(reference, base);
    if (url.origin !== "https://coverage.invalid") return null;
    return { page: decodeURIComponent(url.pathname.slice(1)), anchor: decodeURIComponent(url.hash.slice(1)) };
  }

  function stylesheet(content, path)
  {
    return content.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/g, (original, quote, reference) => {
      const local = target(reference, path);
      return local ? `url("${asset(local.page)}${local.anchor ? `#${encodeURIComponent(local.anchor)}` : ""}")` : original;
    });
  }

  function asset(path)
  {
    if (urls.has(path)) return urls.get(path);
    if (!Object.hasOwn(files, path)) throw new Error(`Missing embedded coverage resource: ${path}`);
    const file = files[path];
    const content = file.type === "text/css" ? stylesheet(text(file), path) : null;
    // Data URLs are self-contained even when the outer report uses file://.
    const url = content === null ? `data:${file.type};base64,${file.data}` :
      `data:text/css;charset=utf-8,${encodeURIComponent(content)}`;
    urls.set(path, url);
    return url;
  }

  function scrollToAnchor()
  {
    const doc = frame.contentDocument;
    if (!doc || doc !== loadedDocument) return;
    if (anchor) (doc.getElementById(anchor) ?? doc.getElementsByName(anchor)[0])?.scrollIntoView();
    else frame.contentWindow.scrollTo(0, 0);
  }

  function show()
  {
    try
    {
      const route = new URLSearchParams(location.hash.slice(1));
      const pagePath = route.get("file") || "index.html";
      anchor = route.get("line") || "";
      if (!Object.hasOwn(files, pagePath) || files[pagePath].type !== "text/html")
        throw new Error(`Unknown embedded coverage page: ${pagePath}`);
      error.textContent = "";
      if (pagePath === current)
      {
        scrollToAnchor();
        return;
      }
      const page = new DOMParser().parseFromString(text(files[pagePath]), "text/html");
      for (const element of page.querySelectorAll("[src], [href], [poster]"))
      {
        for (const attribute of ["src", "href", "poster"])
        {
          if (!element.hasAttribute(attribute) || (element.tagName === "A" && attribute === "href")) continue;
          const local = target(element.getAttribute(attribute), pagePath);
          if (local) element.setAttribute(attribute, asset(local.page) + (local.anchor ? `#${encodeURIComponent(local.anchor)}` : ""));
        }
      }
      for (const style of page.querySelectorAll("style"))
        style.textContent = stylesheet(style.textContent, pagePath);
      for (const element of page.querySelectorAll("[style]"))
        element.setAttribute("style", stylesheet(element.getAttribute("style"), pagePath));
      page.documentElement.dataset.coveragePage = pagePath;
      current = pagePath;
      loadedDocument = null;
      // A fresh frame has no prior document to traverse when the user goes
      // Back or Forward. Only the outer file/line route owns history entries.
      const next = frame.cloneNode(false);
      next.addEventListener("load", pageLoaded);
      next.srcdoc = `<!doctype html>\n${page.documentElement.outerHTML}`;
      const previous = frame;
      frame = next;
      previous.replaceWith(next);
    }
    catch (failure)
    {
      error.textContent = `Cannot open coverage report: ${failure.message}`;
    }
  }

  function navigate(destination)
  {
    const route = new URLSearchParams({ file: destination.page });
    if (destination.anchor) route.set("line", destination.anchor);
    if (location.hash.slice(1) === route.toString()) scrollToAnchor();
    else location.hash = route.toString();
  }

  function pageLoaded(event)
  {
    if (event.target !== frame) return;
    const doc = frame.contentDocument;
    // Ignore the initial blank document and superseded page loads.
    if (!doc || doc.URL !== "about:srcdoc" || doc.documentElement.dataset.coveragePage !== current) return;
    if (doc === loadedDocument) return;
    loadedDocument = doc;
    doc.addEventListener("click", event => {
      const link = event.target.closest("a[href]");
      if (!link) return;
      const destination = target(link.getAttribute("href"), current);
      if (!destination) return;
      event.preventDefault();
      navigate(destination);
    });
    scrollToAnchor();
  }
  window.addEventListener("hashchange", show);
  show();
}

const [output, input, ...extra] = process.argv.slice(2);
let outputOwned = false;
try
{
  if (!output || !input || extra.length)
    throw new Error("Usage: generate-coverage-report.mjs <output-html> <coverage-directory>");
  const outputRelative = relative(resolve(input), resolve(output));
  if (!outputRelative || (!outputRelative.startsWith(`..${sep}`) && outputRelative !== ".."))
    throw new Error("Output must be outside the input coverage directory.");
  outputOwned = true;
  await rm(output, { force: true });
  const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png",
    ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf" };
  const files = Object.create(null);
  async function collect(directory, prefix = "")
  {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name)))
    {
      const path = join(directory, entry.name);
      const key = `${prefix}${entry.name}`;
      if (entry.isDirectory() && entry.name !== "v8") await collect(path, `${key}/`);
      else if (entry.isFile() && Object.hasOwn(types, extname(entry.name)))
        files[key] = { type: types[extname(entry.name)], data: (await readFile(path)).toString("base64") };
    }
  }
  await collect(input);
  if (!Object.hasOwn(files, "index.html")) throw new Error(`Missing coverage overview: ${join(input, "index.html")}`);
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Test Coverage Report</title><style>html,body{margin:0;height:100%}body{display:flex;flex-direction:column}iframe{display:block;width:100%;flex:1;min-height:0;border:0}#coverage-error{padding:1rem;margin:0;font-family:system-ui,sans-serif}#coverage-error:empty{display:none}</style></head>
<body><p id="coverage-error" role="alert"></p><iframe id="coverage" title="Code coverage report"></iframe>
<script id="coverage-files" type="application/json">${JSON.stringify(files).replaceAll("<", "\\u003c")}</script>
<script>(${openCoverageReport.toString()})();</script></body></html>\n`);
  console.log(`Generated standalone coverage report: ${output} (${Object.keys(files).filter(path => path.endsWith(".html")).length} pages).`);
}
catch (error)
{
  if (outputOwned) await rm(output, { force: true }).catch(() => {});
  let message = `::error::Cannot generate coverage report (input='${input ?? ""}', output='${output ?? ""}'): ${error.message}`;
  for (const name of ["NPM_TOKEN", "NODE_AUTH_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "GH_APP_PRIVATE_KEY",
    "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_PAGES_API_TOKEN", "CLOUDFLARE_R2_API_TOKEN"])
    if (process.env[name]) message = message.replaceAll(process.env[name], "[REDACTED]");
  console.error(message.replace(/[\r\n]+/g, " "));
  process.exitCode = 1;
}
