// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { When, Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import { chooseCatalogOperation, closeCatalog, field, expectFieldValue, openCatalog, workspace } from "./workspace.steps.mjs";
import { expectThemeColors } from "./theme-colors.mjs";
import { operations } from "../../src/lib/catalog.ts";
import { catalogForOperation } from "../../src/lib/catalog-registry.ts";

const mockCatalog = catalogForOperation("demo:createTask");
const liveCatalog = catalogForOperation("httpbin:echoJsonObject");

const evaluationReport = page => page.getByRole("region", { name: "Evaluation report", exact: true });
const operationReport = page => page.getByRole("region", { name: "Operation report", exact: true });
const progress = (page, step) => page.getByRole("navigation", { name: "Progress", exact: true })
  .getByRole("button", { name: new RegExp(`${step}$`) });
const fact = (region, label) => region.locator("dt").filter({ hasText: new RegExp(`^${label}$`) })
  .locator("xpath=following-sibling::dd[1]");
const metric = (region, label) => region.locator(".report-metric").filter({ hasText: label })
  .locator(".report-metric-value");
const expectReportColor = (element, property, role) => expectThemeColors(element, { [property]: role });

async function expectInputTables(report, groups) {
  await expect(report.getByRole("table", { name: /^Input properties · / })).toHaveCount(Object.keys(groups).length);
  for (const [location, fields] of Object.entries(groups)) {
    const table = report.getByRole("table", { name: `Input properties · ${location}`, exact: true });
    await expect(table.getByRole("columnheader")).toHaveText(["Property", "Label", "Type", "Required", "Description"]);
    const rows = table.locator("tbody tr");
    await expect(rows).toHaveCount(fields.length);
    for (const [index, [property, required]] of fields.entries()) {
      await expect(rows.nth(index).getByRole("rowheader")).toHaveText(property);
      await expect(rows.nth(index).getByRole("cell").nth(2)).toHaveText(required);
    }
  }
}

Then("the evaluation report records {string} with top similarity {string}", async function (prompt, similarity) {
  const report = evaluationReport(this.page);
  await expect(report).toBeVisible();
  await expect(report.locator(".evaluation-prompt p")).toHaveText(prompt);
  await expect(metric(report, "Considered operations")).toHaveText(String(operations.length));
  await expect(metric(report, "Top text similarity")).toHaveText(similarity);
  await expect(metric(report, "Matching time")).toHaveText(/^<?\d+(?:\.\d+)? (?:ms|s)$/);
  const proposed = report.getByRole("list", { name: "Proposed operations", exact: true });
  const notProposed = report.getByRole("list", { name: "Not proposed operations", exact: true });
  const resultNames = await workspace(this.page).getByRole("button", { name: /^Go to operation: / })
    .evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label").slice("Go to operation: ".length)));
  if (!resultNames.length) {
    await expect(proposed).toHaveCount(0);
    await expect(notProposed).toHaveCount(0);
    await expect(report.locator(".evaluation-candidate")).toHaveCount(0);
    await expect(report).toContainText("No operations meet the matching threshold.");
    return;
  }
  await expect(proposed.getByRole("listitem")).toHaveCount(resultNames.length);
  await expect(notProposed.getByRole("listitem")).toHaveCount(Math.min(resultNames.length, operations.length - resultNames.length));
  const proposedNames = await proposed.locator(".candidate-name").allTextContents();
  assert.deepEqual(proposedNames, resultNames, "The proposed column must identify precisely the actionable results in rank order.");
  const rejectedNames = await notProposed.locator(".candidate-name").allTextContents();
  assert.ok(rejectedNames.every(name => !proposedNames.includes(name)), "An operation cannot appear in both columns.");
  for (const list of [proposed, notProposed]) {
    const scores = (await list.locator(".candidate-score").allTextContents()).map(value => Number.parseFloat(value));
    assert.deepEqual(scores, [...scores].sort((left, right) => right - left), "Each column must retain descending similarity order.");
  }
  await expect(proposed.locator(".candidate-score").first()).toHaveText(similarity);
  await expect(proposed.getByRole("img", { name: "Proposed", exact: true })).toHaveCount(resultNames.length);
  await expect(notProposed.getByRole("img", { name: /^Not proposed:/ })).toHaveCount(rejectedNames.length);
});

Then("the evaluation columns show {string} opposite {string}", async function (proposed, notProposed) {
  const report = evaluationReport(this.page);
  for (const [label, names] of [["Proposed operations", proposed], ["Not proposed operations", notProposed]]) {
    const expected = names ? names.split(", ") : [];
    const list = report.getByRole("list", { name: label, exact: true });
    await expect(list).toHaveCount(expected.length ? 1 : 0);
    if (expected.length) await expect(list.locator(".candidate-name")).toHaveText(expected);
  }
});

When("I edit the report prompt to {string} without submitting", async function (prompt) {
  this.previousReportText = await evaluationReport(this.page).innerText();
  await progress(this.page, "Prompt").click();
  const example = this.page.locator('.prompt-suggestion-list button:visible').last();
  const exampleText = await example.innerText();
  await example.click();
  await expect(this.page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(exampleText);
  await expect(this.page.getByRole("textbox", { name: "Prompt", exact: true })).toBeFocused();
  await this.page.getByRole("textbox", { name: "Prompt", exact: true }).fill(prompt);
  await progress(this.page, "Evaluation").click();
});

Then("the previous evaluation report remains unchanged", async function () {
  await expect(evaluationReport(this.page)).toHaveText(this.previousReportText, { useInnerText: true });
  await expect(this.page.getByRole("button", { name: "Review matching details", exact: true })).toHaveAttribute("aria-expanded", "true");
});

When("I submit the edited report prompt", async function () {
  await progress(this.page, "Prompt").click();
  await this.page.getByRole("textbox", { name: "Prompt", exact: true }).press("Enter");
});

Then("the new evaluation starts with its report closed", async function () {
  await expect(this.page.getByRole("button", { name: "Review matching details", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(evaluationReport(this.page)).toHaveCount(0);
});

Then("the operation report describes the demo Create task source and inputs", async function () {
  const report = operationReport(this.page);
  await expect(report).toBeVisible();
  await expect(metric(report, "Catalog")).toHaveText(mockCatalog.name);
  await expect(metric(report, "Method")).toHaveText("POST");
  await expect(metric(report, "Path")).toHaveText("/projects/{projectId}/tasks");
  await expect(report.getByRole("region", { name: "Catalog metadata", exact: true })).toHaveCount(0);
  const metadata = report.getByRole("region", { name: "Operation metadata", exact: true });
  await expect(fact(metadata, "File")).toHaveText(/(?:^|\/)demo\.openapi\.json$/);
  await expect(fact(metadata, "Catalog version")).toHaveText("1.0.0");
  await expect(fact(metadata, "OpenAPI version")).toHaveText("3.1.0");
  await expect(fact(metadata, "Operation ID")).toHaveText("createTask");
  await expect(fact(metadata, "Catalog identifier")).toHaveText("demo:createTask");
  await expect(fact(metadata, "Name")).toHaveText("Create task");
  await expect(fact(metadata, "Description")).toHaveText("Add a task to a project with a title, priority and optional estimate.");
  await expectInputTables(report, { Path: [["projectId", "Yes"]], Body: [["title", "Yes"], ["priority", "Yes"], ["estimate", "No"]] });
  const path = report.getByRole("table", { name: "Input properties · Path", exact: true });
  await expect(path.locator("tbody tr").getByRole("cell")).toHaveText(["Project ID", "string", "Yes", "The identifier of the project to work with."]);
  const body = report.getByRole("table", { name: "Input properties · Body", exact: true });
  const estimate = body.getByRole("row").filter({ has: this.page.getByRole("rowheader", { name: "estimate", exact: true }) });
  await expect(estimate.getByRole("cell").nth(0)).toHaveText("Estimated hours");
  await expect(estimate.getByRole("cell").nth(1)).toHaveText("number");
  const groups = report.getByRole("region", { name: "Operation grouping", exact: true }).getByRole("listitem");
  await expect(groups).toHaveCount(2);
  await expect(fact(groups.nth(0), "Name")).toHaveText(mockCatalog.name);
  await expect(fact(groups.nth(1), "Name")).toHaveText("Tasks");
  await expect(report.locator('summary[aria-label="OpenAPI schema"]')).toHaveAttribute("aria-expanded", "false");
});

Then("changing the reported operation resets its schema view without losing the draft", async function () {
  await operationReport(this.page).locator('summary[aria-label="OpenAPI schema"]').click();
  await expect(this.page.getByRole("region", { name: "Operation OpenAPI JSON", exact: true })).toBeVisible();
  await chooseCatalogOperation(this.page, "Get project");
  await expect(this.page.getByRole("button", { name: "Review operation details", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(operationReport(this.page)).toHaveCount(0);
  await this.page.getByRole("button", { name: "Review operation details", exact: true }).click();
  const report = operationReport(this.page);
  const metadata = report.getByRole("region", { name: "Operation metadata", exact: true });
  await expect(fact(metadata, "Operation ID")).toHaveText("getProject");
  await expect(fact(metadata, "Catalog identifier")).toHaveText("demo:getProject");
  await expectInputTables(report, { Path: [["projectId", "Yes"]] });
  await expect(report).not.toContainText("demo:createTask");
  await expect(report.locator('summary[aria-label="OpenAPI schema"]')).toHaveAttribute("aria-expanded", "false");
  await expect(this.page.getByRole("region", { name: "Operation OpenAPI JSON", exact: true })).toHaveCount(0);
  const groups = report.getByRole("region", { name: "Operation grouping", exact: true }).getByRole("listitem");
  await expect(groups).toHaveCount(2);
  await expect(fact(groups.nth(0), "Name")).toHaveText(mockCatalog.name);
  await expect(fact(groups.nth(1), "Name")).toHaveText("Overview");
  await report.locator('summary[aria-label="OpenAPI schema"]').click();
  const schema = this.page.getByRole("region", { name: "Operation OpenAPI JSON", exact: true });
  await expect(schema).toContainText('"/projects/{projectId}"');
  await expect(schema).not.toContainText('"/projects/{projectId}/tasks"');
  await chooseCatalogOperation(this.page, "List projects");
  await this.page.getByRole("button", { name: "Review operation details", exact: true }).click();
  await expectInputTables(operationReport(this.page), { Query: [["name", "No"], ["limit", "No"]] });
  await chooseCatalogOperation(this.page, "HTTPBin JSON object");
  await expect(operationReport(this.page)).toHaveCount(0);
  await this.page.getByRole("button", { name: "Review operation details", exact: true }).click();
  const liveReport = operationReport(this.page);
  await expect(metric(liveReport, "Catalog")).toHaveText(liveCatalog.name);
  await expect(metric(liveReport, "Method")).toHaveText("POST");
  await expect(metric(liveReport, "Path")).toHaveText("/anything/bodies/json-object");
  const liveMetadata = liveReport.getByRole("region", { name: "Operation metadata", exact: true });
  await expect(fact(liveMetadata, "File")).toHaveText("httpbin.openapi.json");
  await expect(fact(liveMetadata, "Catalog identifier")).toHaveText("httpbin:echoJsonObject");
  await expectInputTables(liveReport, { Body: [
    ["label", "No"], ["count", "No"], ["ratio", "No"], ["enabled", "No"],
    ["priority", "No"], ["profile", "No"], ["tags", "No"], ["note", "No"]
  ] });
  const liveGroups = liveReport.getByRole("region", { name: "Operation grouping", exact: true }).getByRole("listitem");
  await expect(fact(liveGroups.nth(0), "Name")).toHaveText(liveCatalog.name);
  await expect(fact(liveGroups.nth(1), "Name")).toHaveText("Body formats");
  await expect(liveReport.locator('summary[aria-label="OpenAPI schema"]')).toHaveAttribute("aria-expanded", "false");
  await chooseCatalogOperation(this.page, "Create task");
  await expect(await field(this.page, "Project ID")).toHaveValue("report-project");
  await expect(await field(this.page, "Title")).toHaveValue("Preserve report draft");
  await expectFieldValue(this.page, "Priority", "normal");
});

async function expectReportFits(page, report) {
  await expect(report).toBeVisible();
  await expect.poll(() => report.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const content = element.querySelectorAll(".report-metric, .evaluation-candidate, .report-facts, .report-table, .report-groups li");
    return bounds.left >= 0 && bounds.right <= innerWidth && element.scrollWidth <= element.clientWidth + 1 &&
      [...content].every(child => {
        const box = child.getBoundingClientRect();
        return box.left >= bounds.left && box.right <= bounds.right;
      }) && document.documentElement.scrollWidth <= innerWidth;
  })).toBe(true);
}

Then("both reports fit a {int} pixel viewport in the {string} theme", async function (width, theme) {
  const roles = {
    shell: "--color-report-background", card: "--color-report-card",
    header: "--color-json-header-hover-background", headerText: "--color-json-header-hover-foreground",
    text: "--color-foreground", key: "--color-json-key", string: "--color-json-string", value: "--color-json-value"
  };
  await this.page.setViewportSize({ width, height: 844 });
  await openCatalog(this.page);
  const toggle = this.page.getByRole("switch", { name: "Dark theme", exact: true });
  if (await toggle.getAttribute("aria-checked") !== String(theme === "dark")) await toggle.click();
  await closeCatalog(this.page);
  await this.page.getByRole("textbox", { name: "Prompt", exact: true }).fill("List projects");
  await this.page.getByRole("textbox", { name: "Prompt", exact: true }).press("Enter");
  await this.page.getByRole("button", { name: "Review matching details", exact: true }).click();
  await expectReportFits(this.page, evaluationReport(this.page));
  const proposed = evaluationReport(this.page).getByRole("list", { name: "Proposed operations", exact: true });
  const notProposed = evaluationReport(this.page).getByRole("list", { name: "Not proposed operations", exact: true });
  await expect(proposed.locator(".candidate-name")).toHaveText(["List projects", "Get project"]);
  await expect(notProposed.locator(".candidate-name")).toHaveText(["Mock query and header inputs", "HTTPBin query and header inputs"]);
  const left = await proposed.boundingBox();
  const right = await notProposed.boundingBox();
  assert.ok(left && right, "Both comparison lists must be visible.");
  if (width === 1280)
    assert.ok(right.x >= left.x + left.width && Math.abs(right.y - left.y) <= 1,
      "Wide reports show proposed operations on the left and failed matches on the right.");
  else
    assert.ok(right.y >= left.y + left.height && Math.abs(right.x - left.x) <= 1,
      "Narrow reports stack failed matches below proposals without changing either list.");
  await expectReportColor(evaluationReport(this.page), "background-color", roles.shell);
  await expectReportColor(evaluationReport(this.page).locator(".report-metric").first(), "background-color", roles.card);
  await chooseCatalogOperation(this.page, "Create task");
  await this.page.getByRole("button", { name: "Review operation details", exact: true }).click();
  const report = operationReport(this.page);
  await expectReportFits(this.page, report);
  const records = report.locator("dl.report-record");
  await expect(records).toHaveCount(3);
  await expect.poll(() => records.evaluateAll(elements => elements.every(record =>
    [...record.querySelectorAll("dt")].every(key => {
      const value = key.nextElementSibling;
      if (value?.tagName !== "DD" || getComputedStyle(key).fontWeight !== "800") return false;
      const left = key.getBoundingClientRect();
      const right = value.getBoundingClientRect();
      return right.left >= left.right && Math.abs(left.top - right.top) <= 1;
    })))).toBe(true);
  await expectInputTables(report, { Path: [["projectId", "Yes"]], Body: [["title", "Yes"], ["priority", "Yes"], ["estimate", "No"]] });
  await expectReportColor(report, "background-color", roles.shell);
  await expectReportColor(report.locator(".report-metric").first(), "background-color", roles.card);
  const header = report.locator('summary[aria-label="OpenAPI schema"]');
  await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await expectReportColor(header, "background-color", roles.header);
  await expectReportColor(header, "color", roles.headerText);
  const schemaActions = ["Copy JSON", "Wrap lines"].map(name => header.getByRole("button", { name, exact: true }));
  for (const action of schemaActions) {
    await action.hover();
    await expectThemeColors(action, { color: roles.header, backgroundColor: roles.headerText });
  }
  await this.page.mouse.move(0, 0);
  await header.focus();
  for (const action of schemaActions) {
    await this.page.keyboard.press("Tab");
    await expect(action).toBeFocused();
    assert.ok(await action.evaluate(element => element.matches(":focus-visible")), "Schema actions need visible keyboard focus.");
    await expectThemeColors(action, { color: roles.header, backgroundColor: roles.headerText, outlineColor: roles.headerText });
  }
  await expect(header).toHaveAttribute("aria-expanded", "true");
  const json = report.getByRole("region", { name: "Operation OpenAPI JSON", exact: true });
  await expectReportColor(json.locator(".json-scroll"), "background-color", roles.card);
  await expectReportColor(json.locator(".json-tree"), "color", roles.text);
  await expectReportColor(json.locator(".json-key").first(), "color", roles.key);
  await expectReportColor(json.locator(".json-string").first(), "color", roles.string);
  for (const path of [
    '$["components"]["schemas"]',
    '$["components"]["schemas"]["NewTask"]',
    '$["components"]["schemas"]["NewTask"]["properties"]',
    '$["components"]["schemas"]["NewTask"]["properties"]["title"]'
  ]) {
    const branch = json.getByRole("group", { name: `Operation OpenAPI JSON: ${path}`, exact: true });
    if (!await branch.evaluate(element => element.open)) await branch.locator(":scope > summary").click();
  }
  await expect(json.locator(".json-number").first()).toBeVisible();
  await expect(json.locator(".json-boolean").first()).toBeVisible();
  await expectReportColor(json.locator(".json-number").first(), "color", roles.value);
  await expectReportColor(json.locator(".json-boolean").first(), "color", roles.value);
  await expectReportFits(this.page, report);
});
