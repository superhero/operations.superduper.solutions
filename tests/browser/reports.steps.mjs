// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { categoryLabel } from '../../src/lib/category-label.ts';
import assert from "node:assert/strict";
import { When, Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import { chooseCatalogOperation, closeCatalog, field, expectFieldValue, openCatalog, workspace, searchOperations, setMode, setEvaluationDetails, selectThemeMode } from "./workspace.fixture.mjs";
import { expectThemeColors } from "./theme-colors.mjs";
import { operations } from "../../src/lib/catalog.ts";
import { catalogForOperation } from "../../src/lib/catalog-registry.ts";

const exampleCatalog = catalogForOperation("demo:createTask");
const liveCatalog = catalogForOperation("httpbin:echoJsonObject");

const evaluationReport = page => page.getByRole("region", { name: "Evaluation report", exact: true });
const operationReport = page => page.getByRole("region", { name: "Operation report", exact: true });
const fact = (region, label) => region.locator("dt").filter({ hasText: new RegExp(`^${label}$`) })
  .locator("xpath=following-sibling::dd[1]");
const metric = (region, label) => region.locator(".report-metric").filter({ hasText: label })
  .locator(".report-metric-value");
const expectReportColor = (element, property, role) => expectThemeColors(element, { [property]: role });

Then("evaluation details stay hidden until enabled and the saved choice survives reload", async function () {
  const page = this.page;
  const toggle = page.getByRole("button", { name: "Review matching details", exact: true });
  const preference = page.getByRole("switch", { name: "Evaluation details", exact: true });
  const symbol = page.locator(".catalog-prompt .prompt-symbol");
  await openCatalog(page);
  await expect(toggle).toHaveCount(0);
  await expect(symbol).toHaveText("search");
  await expect(symbol).toHaveAttribute("aria-hidden", "true");
  await expect(evaluationReport(page)).toBeHidden();
  await expect(page.locator(".catalog-prompt .prompt-actions")).toHaveCount(0);
  await setMode(page, "settings");
  if (await page.locator('summary[aria-label="Developer"]').getAttribute('aria-expanded') !== 'true')
    await page.locator('summary[aria-label="Developer"]').click();
  await expect(preference).toHaveAttribute("aria-checked", "false");

  await setEvaluationDetails(page);
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeDisabled();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(symbol).toHaveCount(1);
  await expect(symbol).toHaveText("manage_search");
  await expect(toggle).toHaveClass(/\bprompt-symbol\b/);
  await expect(page.locator(".catalog-prompt label.prompt-symbol")).toHaveCount(0);
  await expect(page.locator(".catalog-prompt .prompt-actions")).toHaveCount(0);
  await searchOperations(page, "Example array response");
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(evaluationReport(page)).toBeVisible();
  await expect(evaluationReport(page).locator(".evaluation-prompt")).toHaveCount(0);
  await expect(page.locator(".catalog-prompt")).toHaveAttribute("data-evaluated-prompt", "Example array response");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(evaluationReport(page)).toBeHidden();
  await toggle.click();
  await searchOperations(page, "");
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeDisabled();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(evaluationReport(page)).toBeHidden();
  await setEvaluationDetails(page, false);
  await expect(toggle).toHaveCount(0);
  await expect(symbol).toHaveText("search");
  await expect(evaluationReport(page)).toBeHidden();

  await setEvaluationDetails(page);
  await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' });
  await searchOperations(page, "Example array response");
  await expect(toggle).toBeVisible();
  await expect(symbol).toHaveText("manage_search");
  await toggle.click();
  await expect(evaluationReport(page)).toBeVisible();
  await setEvaluationDetails(page, false);
  await expect(toggle).toHaveCount(0);
  await expect(evaluationReport(page)).toBeHidden();
  await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' });
  await searchOperations(page, "Example array response");
  await expect(toggle).toHaveCount(0);
  await expect(symbol).toHaveText("search");
  await expect(evaluationReport(page)).toBeHidden();
  await setMode(page, "settings");
  if (await page.locator('summary[aria-label="Developer"]').getAttribute('aria-expanded') !== 'true')
    await page.locator('summary[aria-label="Developer"]').click();
  await expect(preference).toHaveAttribute("aria-checked", "false");
});

async function expectRejectedSummary(list, proposedCount) {
  const rejectedCount = operations.length - proposedCount;
  const hiddenCount = rejectedCount > proposedCount ? rejectedCount - proposedCount + 1 : 0;
  await expect(list.getByRole("listitem")).toHaveCount(Math.min(proposedCount, rejectedCount));
  await expect(list.locator(".candidate-name")).toHaveCount(rejectedCount - hiddenCount);
  const summary = list.locator(".evaluation-more");
  await expect(summary).toHaveCount(hiddenCount ? 1 : 0);
  if (!hiddenCount) return;
  await expect(summary.locator("strong")).toHaveText(`${hiddenCount} hidden ${hiddenCount === 1 ? "operation" : "operations"}`);
  await expect(summary.getByRole("img")).toHaveAccessibleName(`${hiddenCount} more ${hiddenCount === 1 ? "operation" : "operations"} considered but not shown here`);
  await expect(list.getByRole("listitem").last()).toHaveClass(/\bevaluation-more\b/);
  await expect(summary.locator('.candidate-name, .candidate-score')).toHaveCount(0);
  await expectThemeColors(summary, { color: "--color-report-background" });
  if (rejectedCount > hiddenCount)
    await expectThemeColors(list.locator(".candidate-status").first(), { color: "--color-report-background" });
}

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

Then("the evaluation report reflects {string} with top similarity {string}", async function (prompt, similarity) {
  const report = evaluationReport(this.page);
  await expect(report).toBeVisible();
  await expect(report.locator(".evaluation-prompt")).toHaveCount(0);
  await expect(this.page.locator(".catalog-prompt")).toHaveAttribute("data-evaluated-prompt", prompt);
  await expect(metric(report, "Considered operations")).toHaveText(String(operations.length));
  await expect(metric(report, "Top similarity")).toHaveText(similarity);
  await expect(metric(report, "Evaluation time")).toHaveText(/^<?\d+(?:\.\d+)? (?:ms|s)$/);
  const proposed = report.getByRole("list", { name: "Proposed operations", exact: true });
  const notProposed = report.getByRole("list", { name: "Not proposed operations", exact: true });
  const resultNames = await this.page.getByRole("navigation", { name: "Operation catalog", exact: true })
    .getByRole("button", { name: /^Add to workflow: / })
    .evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label").slice("Add to workflow: ".length)));
  if (!resultNames.length) {
    await expect(proposed).toHaveCount(0);
    await expect(notProposed).toHaveCount(0);
    await expect(report.locator(".evaluation-candidate")).toHaveCount(0);
    await expect(report).toContainText("No operations to propose.");
    return;
  }
  await expect(proposed.getByRole("listitem")).toHaveCount(resultNames.length);
  await expectRejectedSummary(notProposed, resultNames.length);
  const proposedNames = await proposed.locator(".candidate-name").allTextContents();
  assert.deepEqual([...proposedNames].sort(), [...resultNames].sort(), "The report must identify precisely the actionable menu results; the tree retains its catalog ordering.");
  assert.equal(new Set(proposedNames).size, proposedNames.length, "Proposals must not contain duplicates.");
  const rejectedNames = await notProposed.locator(".candidate-name").allTextContents();
  assert.ok(rejectedNames.every(name => !proposedNames.includes(name)), "An operation cannot appear in both columns.");
  for (const list of [proposed, notProposed]) {
    const scores = await list.locator(".candidate-score").evaluateAll(elements => elements.map(element => Number.parseFloat(element.getAttribute("aria-label")?.replace(/^Text similarity /, ""))));
    assert.ok(scores.every(Number.isFinite), "Each candidate must expose its precise similarity in its accessible label.");
    assert.deepEqual(scores, [...scores].sort((left, right) => right - left), "Each column must retain descending similarity order.");
  }
  await expect(proposed.locator(".candidate-score").first()).toHaveText(similarity);
  await expect(proposed.getByRole("img", { name: /^Proposed(?::|$)/ })).toHaveCount(resultNames.length);
  for (const row of await proposed.getByRole("listitem").all()) {
    const score = Number.parseFloat((await row.locator(".candidate-score").getAttribute("aria-label")).replace(/^Text similarity /, ""));
    await expect(row.getByRole("img")).toHaveAccessibleName(score > 50 ? "Proposed: similarity exceeds 50%" : "Proposed: among the top 5 similarities");
  }
  await expect(notProposed.getByRole("img", { name: "Not proposed: outside the top 5 and similarity does not exceed 50%", exact: true })).toHaveCount(rejectedNames.length);
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

Then("evaluation values and statuses show styled hints on hover and keyboard focus", async function () {
  const page = this.page;
  const report = evaluationReport(page);
  const proposed = report.getByRole("list", { name: "Proposed operations", exact: true });
  const notProposed = report.getByRole("list", { name: "Not proposed operations", exact: true });
  const tooltip = page.getByRole("tooltip");
  await expect(report.locator('.report-metric-value[title], .candidate-score[title], .candidate-status[title], .hidden-candidates-hint[title]')).toHaveCount(0);
  await expect(proposed.locator(".candidate-status")).toHaveText(["verified", "check_circle", "check_small", "check_small", "check_small"]);
  await expect(notProposed.locator(".candidate-status")).toHaveText(["close_small", "close_small", "close_small", "close_small"]);
  const top = metric(report, "Top similarity");
  await expect(top).toHaveAttribute("aria-label", "Top similarity 100.00%");
  const hints = [
    [top, "100.00%"],
    [proposed.locator(".candidate-score").nth(1), "69.23%"],
    [notProposed.locator(".candidate-score").first(), "31.25%"],
    [proposed.locator(".candidate-status").first(), "Proposed: similarity exceeds 50%"],
    [proposed.locator(".candidate-status").nth(2), "Proposed: among the top 5 similarities"],
    [notProposed.locator(".candidate-status").first(), "Not proposed: outside the top 5 and similarity does not exceed 50%"],
    [notProposed.locator(".hidden-candidates-hint"), `${operations.length - 5 - 4} more operations considered but not shown here`]
  ];
  for (const [trigger, text] of hints) {
    await expect(trigger).toHaveAttribute("tabindex", "0");
    await trigger.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await trigger.hover();
    await expect(tooltip).toHaveCount(1);
    await expect(tooltip).toHaveClass(/\bapp-tooltip\b/);
    await expect(tooltip).toHaveText(text);
    await page.keyboard.press("Escape");
    await expect(tooltip).toHaveCount(0);
    await page.mouse.move(0, 0);
    await trigger.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(trigger).toBeFocused();
    await expect(tooltip).toHaveCount(1);
    await expect(tooltip).toHaveText(text);
    await page.keyboard.press("Escape");
    await expect(tooltip).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
});

When("I edit the report prompt to {string}", async function (prompt) {
  await searchOperations(this.page, prompt);
  await expect(this.page.getByRole("textbox", { name: "Prompt", exact: true })).toBeFocused();
});

Then("the open report follows the latest prompt automatically", async function () {
  await expect(this.page.getByRole("button", { name: "Review matching details", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(evaluationReport(this.page)).toBeVisible();
  await expect(evaluationReport(this.page).locator(".evaluation-prompt")).toHaveCount(0);
  await expect(this.page.locator(".catalog-prompt")).toHaveAttribute("data-evaluated-prompt",
    await this.page.getByRole("textbox", { name: "Prompt", exact: true }).inputValue());
});





Then("the operation report describes the demo Example POST body source and inputs", async function () {
  const report = operationReport(this.page);
  await expect(report).toBeVisible();
  await expect(metric(report, "Catalog")).toHaveText(exampleCatalog.name);
  await expect(metric(report, "Method")).toHaveText("POST");
  await expect(metric(report, "Path")).toHaveText("/projects/{projectId}/tasks");
  await expect(report.getByRole("region", { name: "Catalog metadata", exact: true })).toHaveCount(0);
  const metadata = report.getByRole("region", { name: "Operation metadata", exact: true });
  await expect(fact(metadata, "File")).toHaveText(/(?:^|\/)demo\.openapi\.json$/);
  await expect(fact(metadata, "Catalog version")).toHaveText("1.0.1");
  await expect(fact(metadata, "OpenAPI version")).toHaveText("3.1.0");
  await expect(fact(metadata, "Server URL")).toHaveText("https://example.com");
  await expect(fact(metadata, "Operation ID")).toHaveText("createTask");
  await expect(fact(metadata, "Catalog identifier")).toHaveText("demo:createTask");
  await expect(fact(metadata, "Name")).toHaveText("Example POST body");
  await expect(fact(metadata, "Description")).toHaveText("Illustrates a required path input and a JSON body with string, enum and optional number fields.");
  await expectInputTables(report, { Path: [["projectId", "Yes"]], Body: [["title", "Yes"], ["priority", "Yes"], ["estimate", "No"]] });
  const path = report.getByRole("table", { name: "Input properties · Path", exact: true });
  await expect(path.locator("tbody tr").getByRole("cell")).toHaveText(["Path value", "string", "Yes", "An arbitrary string used in the example schema."]);
  const body = report.getByRole("table", { name: "Input properties · Body", exact: true });
  const estimate = body.getByRole("row").filter({ has: this.page.getByRole("rowheader", { name: "estimate", exact: true }) });
  await expect(estimate.getByRole("cell").nth(0)).toHaveText("Number value");
  await expect(estimate.getByRole("cell").nth(1)).toHaveText("number");
  const groups = report.getByRole("region", { name: "Operation grouping", exact: true }).getByRole("listitem");
  await expect(groups).toHaveCount(2);
  await expect(fact(groups.nth(0), "Name")).toHaveText(categoryLabel(exampleCatalog.name));
  await expect(fact(groups.nth(1), "Name")).toHaveText("Request Examples");
  await expect(report.locator('summary[aria-label="OpenAPI schema"]')).toHaveAttribute("aria-expanded", "false");
});

Then("changing the reported operation resets its schema view and run inputs", async function () {
  await operationReport(this.page).locator('summary[aria-label="OpenAPI schema"]').click();
  await expect(this.page.getByRole("region", { name: "Operation OpenAPI JSON", exact: true })).toBeVisible();
  await chooseCatalogOperation(this.page, "Example object response");
  await expect(this.page.getByRole("button", { name: "Review operation details", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(operationReport(this.page)).toHaveCount(0);
  await this.page.getByRole("button", { name: "Review operation details", exact: true }).click();
  const report = operationReport(this.page);
  const metadata = report.getByRole("region", { name: "Operation metadata", exact: true });
  await expect(fact(metadata, "Server URL")).toHaveText("https://example.com");
  await expect(fact(metadata, "Operation ID")).toHaveText("getProject");
  await expect(fact(metadata, "Catalog identifier")).toHaveText("demo:getProject");
  await expectInputTables(report, { Path: [["projectId", "Yes"]] });
  await expect(report).not.toContainText("demo:createTask");
  await expect(report.locator('summary[aria-label="OpenAPI schema"]')).toHaveAttribute("aria-expanded", "false");
  await expect(this.page.getByRole("region", { name: "Operation OpenAPI JSON", exact: true })).toHaveCount(0);
  const groups = report.getByRole("region", { name: "Operation grouping", exact: true }).getByRole("listitem");
  await expect(groups).toHaveCount(2);
  await expect(fact(groups.nth(0), "Name")).toHaveText(categoryLabel(exampleCatalog.name));
  await expect(fact(groups.nth(1), "Name")).toHaveText("Response Examples");
  await report.locator('summary[aria-label="OpenAPI schema"]').click();
  const schema = this.page.getByRole("region", { name: "Operation OpenAPI JSON", exact: true });
  await expect(schema).toContainText('"/projects/{projectId}"');
  await expect(schema).not.toContainText('"/projects/{projectId}/tasks"');
  await chooseCatalogOperation(this.page, "Example array response");
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
  await expect(fact(liveMetadata, "Server URL")).toHaveText("https://httpbin.org");
  await expect(fact(liveMetadata, "File")).toHaveText("httpbin.openapi.json");
  await expect(fact(liveMetadata, "Catalog identifier")).toHaveText("httpbin:echoJsonObject");
  await expectInputTables(liveReport, { Body: [
    ["label", "No"], ["count", "No"], ["ratio", "No"], ["enabled", "No"],
    ["priority", "No"], ["profile", "No"], ["tags", "No"], ["note", "No"]
  ] });
  const liveGroups = liveReport.getByRole("region", { name: "Operation grouping", exact: true }).getByRole("listitem");
  await expect(fact(liveGroups.nth(0), "Name")).toHaveText(categoryLabel(liveCatalog.name));
  await expect(fact(liveGroups.nth(1), "Name")).toHaveText("Body Formats");
  await expect(liveReport.locator('summary[aria-label="OpenAPI schema"]')).toHaveAttribute("aria-expanded", "false");
  await chooseCatalogOperation(this.page, "Example POST body");
  await expect(await field(this.page, "Path value")).toHaveValue("");
  await expect(await field(this.page, "Title")).toHaveValue("");
  await expectFieldValue(this.page, "Priority", "");
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

async function expectAllmanBranch(branch, key, opening) {
  await expect(branch.locator(":scope > summary > .json-key")).toHaveCount(0);
  await expect.poll(() => branch.evaluate((element, expected) => {
    const keyLine = element.previousElementSibling;
    const key = keyLine?.querySelector(".json-key");
    const open = element.querySelector(":scope > summary > .json-bracket");
    const close = element.querySelector(":scope > .disclosure-panel > .json-closing > .json-bracket");
    const children = element.querySelector(":scope > .disclosure-panel > .json-children");
    const first = children?.firstElementChild?.querySelector(".json-key, .json-string, .json-bracket");
    if (!key || !open || !close || !first) return false;
    const [keyBox, openBox, closeBox, firstBox] = [key, open, close, first].map(node => node.getBoundingClientRect());
    const lineHeight = Number.parseFloat(getComputedStyle(keyLine).lineHeight);
    const near = (left, right) => Math.abs(left - right) <= 1;
    return keyLine.textContent.trim() === `${JSON.stringify(expected.key)}:` && open.textContent === expected.opening &&
      close.textContent === (expected.opening === "{" ? "}" : "]") && near(keyBox.x, openBox.x) &&
      near(openBox.y - keyBox.y, lineHeight) && near(closeBox.x, openBox.x) &&
      near(firstBox.x - openBox.x, openBox.width * 2);
  }, { key, opening })).toBe(true);
}

Then("both reports fit a {int} pixel viewport in the {string} theme", async function (width, theme) {
  const roles = {
    shell: "--color-report-background", card: "--color-report-card",
    header: "--color-json-header-hover-background", headerText: "--color-json-header-hover-foreground",
    text: "--color-foreground", key: "--color-json-key", string: "--color-json-string", value: "--color-json-value"
  };
  await setEvaluationDetails(this.page);
  await this.page.setViewportSize({ width, height: 844 });
  await selectThemeMode(this.page, theme);
  await openCatalog(this.page);
  await searchOperations(this.page, "Example array response");
  await this.page.getByRole("button", { name: "Review matching details", exact: true }).click();
  await expectReportFits(this.page, evaluationReport(this.page));
  const proposed = evaluationReport(this.page).getByRole("list", { name: "Proposed operations", exact: true });
  const notProposed = evaluationReport(this.page).getByRole("list", { name: "Not proposed operations", exact: true });
  await expect(proposed.getByRole("listitem")).toHaveCount(8);
  await expectRejectedSummary(notProposed, 8);
  await expect(proposed.locator(".candidate-name").nth(0)).toHaveText("Example array response");
  await expect(proposed.locator(".candidate-name").nth(1)).toHaveText("Example object response");
  await expect(notProposed.locator(".candidate-name").nth(0)).toHaveText("Example DELETE request");
  await expect(notProposed.locator(".candidate-name").nth(1)).toHaveText("Example OPTIONS request");
  const left = await proposed.boundingBox();
  const right = await notProposed.boundingBox();
  assert.ok(left && right, "Both comparison lists must be visible.");
  assert.ok(right.y >= left.y + left.height && Math.abs(right.x - left.x) <= 1,
    "Sidebar reports stack failed matches below proposals without changing either list.");
  await expectReportColor(evaluationReport(this.page), "background-color", roles.shell);
  await expectReportColor(evaluationReport(this.page).locator(".report-metric").first(), "background-color", roles.card);
  await chooseCatalogOperation(this.page, "Example POST body");
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
  const schemaActions = ["Wrap lines", "Copy JSON"].map(name => header.getByRole("button", { name, exact: true }));
  const schemaActionColors = () => ({ color: roles.header, backgroundColor: roles.headerText });
  for (const action of schemaActions) {
    await action.hover();
    await expectThemeColors(action, await schemaActionColors(action));
  }
  await this.page.mouse.move(0, 0);
  await header.focus();
  for (const action of schemaActions) {
    await this.page.keyboard.press("Tab");
    await expect(action).toBeFocused();
    assert.ok(await action.evaluate(element => element.matches(":focus-visible")), "Schema actions need visible keyboard focus.");
    await expectThemeColors(action, { ...await schemaActionColors(action), outlineColor: roles.headerText });
  }
  await expect(header).toHaveAttribute("aria-expanded", "true");
  const json = report.getByRole("region", { name: "Operation OpenAPI JSON", exact: true });
  await expectReportColor(json.locator(".json-scroll"), "background-color", roles.card);
  await expectReportColor(json.locator(".json-tree"), "color", roles.text);
  await expectReportColor(json.locator(".json-key").first(), "color", roles.key);
  await expectReportColor(json.locator(".json-string:not(.json-description)").first(), "color", roles.string);
  await expectReportColor(json.locator(".json-description").first(), "color", "--color-json-description");
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
  for (const [path, key, opening] of [
    ['$["components"]["schemas"]["NewTask"]["properties"]["title"]', "title", "{"],
    ['$["components"]["schemas"]["NewTask"]["required"]', "required", "["]
  ]) {
    const branch = json.getByRole("group", { name: `Operation OpenAPI JSON: ${path}`, exact: true });
    await expectAllmanBranch(branch, key, opening);
    const summary = branch.locator(":scope > summary");
    await summary.press("Enter");
    await expect(summary).toHaveAttribute("aria-expanded", "false");
    await expect(branch.locator(":scope > .disclosure-panel > .json-children")).toBeHidden();
    await summary.press("Enter");
    await expect(summary).toHaveAttribute("aria-expanded", "true");
    await expectAllmanBranch(branch, key, opening);
  }
  const type = json.getByRole("group", { name: 'Operation OpenAPI JSON: $["components"]["schemas"]["NewTask"]["properties"]["title"]', exact: true })
    .locator(".json-line").filter({ has: this.page.locator(".json-key", { hasText: /^"type"$/ }) });
  assert.ok(await type.evaluate(line => {
    const key = line.querySelector(".json-key").getBoundingClientRect();
    const string = line.querySelector(".json-string");
    const value = string.getBoundingClientRect();
    const quote = document.createRange();
    quote.setStart(string.firstChild, 0);
    quote.setEnd(string.firstChild, 1);
    return Math.abs(key.y - value.y) <= 1 && Math.abs(value.x - key.right - quote.getBoundingClientRect().width * 2) <= 1;
  }), "Primitive property names and values must remain inline with a colon and space between them.");
  const wrapping = header.getByRole("button", { name: "Wrap lines", exact: true });
  const originallyWrapped = await wrapping.getAttribute("aria-pressed");
  const scroll = json.locator(".json-scroll");
  const originalStyle = await scroll.getAttribute("style");
  const description = json.locator(".json-string").filter({ hasText: "Illustrates a required path input and a JSON body with string, enum and optional number fields." });
  const stringLayout = () => description.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const characters = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (let index = 0; index < node.textContent.length; index++) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const box = range.getBoundingClientRect();
        characters.push({ text: node.textContent[index], x: box.x, y: box.y, right: box.right, width: box.width });
      }
    }
    const lines = [];
    for (const character of characters.slice(1, -1))
      if (character.text.trim() && character.width > 0 && (!lines.length || Math.abs(lines.at(-1).y - character.y) > 1)) lines.push(character);
    return { lines, quoteRight: characters[0].right, keyY: element.closest(".json-line").querySelector(".json-key").getBoundingClientRect().y };
  });
  try {
    await scroll.evaluate(element => { element.style.width = "320px"; element.style.maxWidth = "100%"; });
    if (await wrapping.getAttribute("aria-pressed") !== "true") await wrapping.click();
    await expect.poll(async () => {
      const { lines, quoteRight, keyY } = await stringLayout();
      return lines.length > 1 && Math.abs(lines[0].x - quoteRight) <= 1 && Math.abs(lines[0].y - keyY) <= 1 &&
        lines.every(line => Math.abs(line.x - lines[0].x) <= 1);
    }, { message: "Wrapped string continuations must align after the opening quote while the property prefix stays on the first line." }).toBe(true);
    await wrapping.click();
    await expect(wrapping).toHaveAttribute("aria-pressed", "false");
    await expect.poll(async () => (await stringLayout()).lines.length).toBe(1);
  } finally {
    await scroll.evaluate((element, style) => style === null ? element.removeAttribute("style") : element.setAttribute("style", style), originalStyle);
    if (await wrapping.getAttribute("aria-pressed") !== originallyWrapped) await wrapping.click();
  }
  await expectReportFits(this.page, report);
});
