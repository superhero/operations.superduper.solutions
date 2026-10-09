#!/usr/bin/env node
// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { generate } from "multiple-cucumber-html-reporter";

const [output, ...inputs] = process.argv.slice(2);
const context = `output='${output ?? ""}', inputs=${JSON.stringify(inputs)}`;
let temporary;
let outputOwned = false;

// Preserve the reporter's complete pages and JavaScript in their own document.
function openReport()
{
  const files = JSON.parse(document.getElementById("report-files").textContent);
  const frame = document.getElementById("report");
  const urls = new Map();
  const decode = file => Uint8Array.from(atob(file.data), character => character.charCodeAt(0));
  const text = file => new TextDecoder().decode(decode(file));
  let current = "index.html";

  function localPath(reference, page)
  {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference)) return null;
    return decodeURIComponent(new URL(reference, `https://report.invalid/${page}`).pathname.slice(1));
  }

  function asset(path)
  {
    if (urls.has(path)) return urls.get(path);
    if (!Object.hasOwn(files, path)) throw new Error(`Missing embedded report resource: ${path}`);
    const file = files[path];
    const content = file.type === "text/css" ? text(file).replace(/url\(\s*(['"]?)(.*?)\1\s*\)/g,
      (original, quote, reference) => {
        const target = localPath(reference, path);
        return target ? `url("${asset(target)}")` : original;
      }) : decode(file);
    const url = URL.createObjectURL(new Blob([content], { type: file.type }));
    urls.set(path, url);
    return url;
  }

  function show()
  {
    try
    {
      current = decodeURIComponent(location.hash.slice(1)) || "index.html";
      if (!Object.hasOwn(files, current) || files[current].type !== "text/html")
        throw new Error(`Unknown embedded report page: ${current}`);
      const page = new DOMParser().parseFromString(text(files[current]), "text/html");
      for (const element of page.querySelectorAll("[src], [href], [poster]"))
      {
        for (const attribute of ["src", "href", "poster"])
        {
          if (!element.hasAttribute(attribute) || (element.tagName === "A" && attribute === "href")) continue;
          const target = localPath(element.getAttribute(attribute), current);
          if (target) element.setAttribute(attribute, asset(target));
        }
      }
      frame.srcdoc = `<!doctype html>\n${page.documentElement.outerHTML}`;
    }
    catch (error)
    {
      document.getElementById("report-error").textContent = `Cannot open test report: ${error.message}`;
    }
  }

  frame.addEventListener("load", () => {
    frame.contentDocument.addEventListener("click", event => {
      const link = event.target.closest("a[href]");
      if (!link) return;
      const target = localPath(link.getAttribute("href"), current);
      if (target && Object.hasOwn(files, target) && files[target].type === "text/html")
      {
        event.preventDefault();
        location.hash = encodeURIComponent(target);
      }
    });
  });
  window.addEventListener("hashchange", show);
  show();
}

try
{
  if (!output || inputs.length === 0)
    throw new Error("Usage: generate-test-report.mjs <output-html> <cucumber-json>...");
  if (inputs.some(input => resolve(input) === resolve(output)))
    throw new Error("Output must be different from every input report.");
  outputOwned = true;
  await rm(output, { force: true });
  temporary = await mkdtemp(join(tmpdir(), "operations-test-report-"));
  const jsonDir = join(temporary, "json");
  const reportPath = join(temporary, "html");
  await mkdir(jsonDir);
  let featureCount = 0;
  for (const [index, input] of inputs.entries())
  {
    const features = JSON.parse(await readFile(input, "utf8"));
    if (!Array.isArray(features) || features.length === 0 || features.some(feature =>
      !feature || typeof feature.name !== "string" || !feature.name || !Array.isArray(feature.elements) ||
      feature.elements.length === 0 || feature.elements.some(scenario => !Array.isArray(scenario.steps) ||
        scenario.steps.length === 0 || scenario.steps.some(step =>
          !["passed", "failed", "skipped", "undefined", "pending", "ambiguous"].includes(step.result?.status)))))
      throw new Error(`Invalid Cucumber report '${input}': expected a nonempty feature array with scenarios, steps, and result statuses.`);
    // Transfer runtime metadata from Cucumber hooks before rendering. The
    // metadata attachment is not a test artifact and should not clutter steps.
    for (const feature of features)
    {
      let browser;
      for (const scenario of feature.elements)
        for (const step of [...(scenario.before ?? []), ...scenario.steps, ...(scenario.after ?? [])])
          if (step.embeddings) step.embeddings = step.embeddings.filter(attachment => {
            if (attachment.mime_type !== "application/vnd.operations.browser+json") return true;
            const observed = JSON.parse(Buffer.from(attachment.data, "base64").toString("utf8"));
            if (!observed || !["chromium", "firefox", "webkit"].includes(observed.name) ||
              typeof observed.version !== "string" || !/^\d+(?:\.\d+)*$/.test(observed.version))
              throw new Error(`Invalid browser metadata in '${input}' for '${feature.name}'.`);
            if (browser && (browser.name !== observed.name || browser.version !== observed.version))
              throw new Error(`Conflicting browser metadata in '${input}' for '${feature.name}'.`);
            browser = { name: observed.name, version: observed.version };
            return false;
          });
      if (browser) feature.metadata = { ...feature.metadata, browser };
      else if (/^cucumber-(?:source|test|automation)\.json$/.test(basename(input)) && !feature.metadata?.browser)
        feature.metadata = { ...feature.metadata, browser: { name: "Not applicable", version: "" } };
    }
    featureCount += features.length;
    await writeFile(join(jsonDir, `suite-${index}.json`), JSON.stringify(features));
  }
  const runUrl = process.env.REPORT_RUN_URL ? new URL(process.env.REPORT_RUN_URL) : undefined;
  const runId = runUrl?.pathname.match(/\/actions\/runs\/(\d+)\/?$/)?.[1];
  if (runUrl && (runUrl.protocol !== "https:" || !runId))
    throw new Error("REPORT_RUN_URL must be an HTTPS GitHub Actions run URL.");
  const customData = {
    // False suppresses the template field; null restores the runtime username.
    username: false,
    ...(process.env.REPORT_COMMIT ? { Commit: process.env.REPORT_COMMIT.slice(0, 7) } : {}),
    ...(runUrl ? { ciPipeline:
      `<a href="${runUrl.href.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}" target="_blank" rel="noopener noreferrer">${runId}</a>` } : {})
  };
  await generate({ jsonDir, reportPath, pageTitle: "Test Report", reportName: "Operations tests",
    // Empty strings restore the default footer. Clear its content and wrapper.
    pageFooter: " ", customStyle: "footer { display: none; }",
    hideMetadata: true, displayDuration: true, useCDN: false, externalizeMedia: false, logging: "warn", customData });

  const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png",
    ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon" };
  const files = {};
  for (const path of (await readdir(reportPath, { recursive: true })).sort())
  {
    if (!extname(path)) continue;
    files[path] = { type: types[extname(path)] ?? "application/octet-stream",
      data: (await readFile(join(reportPath, path))).toString("base64") };
  }
  if (!files["index.html"] || Object.keys(files).filter(path => path.startsWith("features/") && path.endsWith(".html")).length !== featureCount)
    throw new Error("Reporter did not generate an overview and a detail page for every input feature.");
  await mkdir(dirname(resolve(output)), { recursive: true });
  const warning = (process.env.REPORT_WARNING ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  await writeFile(output, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Test Report</title><style>html,body{margin:0;height:100%}body{display:flex;flex-direction:column}iframe{display:block;width:100%;flex:1;min-height:0;border:0}#report-warning,#report-error{padding:1rem;margin:0;font-family:system-ui,sans-serif}#report-warning{background:#fff3cd;color:#664d03}#report-warning:empty,#report-error:empty{display:none}</style></head>
<body><p id="report-warning" role="status">${warning}</p><p id="report-error" role="alert"></p><iframe id="report" title="Cucumber test report"></iframe>
<script id="report-files" type="application/json">${JSON.stringify(files).replaceAll("<", "\\u003c")}</script>
<script>(${openReport.toString()})();</script></body></html>\n`);
  console.log(`Generated standalone test report: ${output} (${inputs.length} suites, ${featureCount} features).`);
}
catch (error)
{
  if (outputOwned) await rm(output, { force: true }).catch(() => {});
  let message = `::error::Cannot generate test report (${context}): ${error.message}`;
  for (const name of ["NPM_TOKEN", "NODE_AUTH_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "GH_APP_PRIVATE_KEY",
    "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_PAGES_API_TOKEN", "CLOUDFLARE_R2_API_TOKEN"])
    if (process.env[name]) message = message.replaceAll(process.env[name], "[REDACTED]");
  console.error(message.replace(/[\r\n]+/g, " "));
  process.exitCode = 1;
}
finally
{
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
