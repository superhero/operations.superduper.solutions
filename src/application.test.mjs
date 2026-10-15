import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { startApplication } from "./bootstrap.ts";
import { loadApplication } from "./index.ts";
import { formatLocalDate, formatLocalDateTime } from "./lib/datetime.ts";

Then("displayed dates respect browser language and local time", function ()
{
  const languages = Object.getOwnPropertyDescriptor(navigator, "languages");
  const timezone = process.env.TZ;
  try
  {
    process.env.TZ = "America/Los_Angeles";
    for (const [locale, timestamp, calendar] of [
      ["sv-SE", "2026-01-01 16:30:00", "2026-01-02"],
      ["en-GB", "01/01/2026, 16:30:00", "02/01/2026"]
    ])
    {
      Object.defineProperty(navigator, "languages", { configurable: true, value: [locale] });
      assert.equal(formatLocalDateTime(Date.parse("2026-01-02T00:30:00Z")), timestamp);
      assert.equal(formatLocalDate("2026-01-02"), calendar);
    }
  }
  finally
  {
    if (languages) Object.defineProperty(navigator, "languages", languages);
    else delete navigator.languages;
    if (timezone === undefined) delete process.env.TZ;
    else process.env.TZ = timezone;
  }
});

const component = {};

let documentRef;
let mountedComponent;
let mountedTarget;
let startupError;

function reset(target)
{
  documentRef = {
    querySelector(selector)
    {
      assert.equal(selector, "#app");
      return target;
    }
  };

  mountedComponent = undefined;
  mountedTarget = undefined;
  startupError = undefined;
}

Given("a document with an application mount target", function ()
{
  reset({});
});

Given("a document without an application mount target", function ()
{
  reset(null);
});

When("the application starts", function ()
{
  try
  {
    startApplication(documentRef, component, mountComponent);
  }
  catch (error)
  {
    startupError = error;
  }
});

function mountComponent(componentToMount, { target })
{
  mountedComponent = componentToMount;
  mountedTarget = target;
}

Then("the application is mounted into the target", function ()
{
  assert.equal(startupError, undefined);
  assert.equal(mountedComponent, component);
  assert.equal(mountedTarget, documentRef.querySelector("#app"));
});

Then("startup fails with {string}", function (message)
{
  assert.equal(startupError?.message, message);
  assert.equal(mountedComponent, undefined);
  assert.equal(mountedTarget, undefined);
});

const reloadGuard = "v1/startup/module-reload";
const moduleFailure = () => new TypeError("Failed to fetch dynamically imported module: /src/application.ts");

class StartupElement extends EventTarget {
  constructor(tagName = "div", id = "") {
    super();
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.style = {};
    this.attributes = new Map();
    this.text = "";
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(""); }
  set innerHTML(_value) { throw new Error("Startup recovery must not interpret error details as HTML"); }
  append(...children) {
    for (const child of children) { child.parent = this; this.children.push(child); }
  }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  hasChildNodes() { return this.children.length > 0 || this.text.length > 0; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAnimations() { return []; }
  querySelector(selector) {
    const matches = element => selector.startsWith("#") ? element.id === selector.slice(1)
      : element.tagName === selector.toUpperCase();
    for (const child of this.children) {
      if (matches(child)) return child;
      const descendant = child.querySelector(selector);
      if (descendant) return descendant;
    }
    return null;
  }
  click() { this.dispatchEvent(new Event("click")); }
}

function startupHost({ mounted = false } = {}) {
  const body = new StartupElement("body");
  const app = new StartupElement("div", "app");
  if (mounted) app.append(new StartupElement("main"));
  const status = new StartupElement("div", "startup-status");
  const stage = new StartupElement("div", "startup-stage");
  stage.textContent = "Loading application";
  status.append(stage);
  body.append(app, status);
  const values = new Map();
  const host = {
    document: {
      body,
      getElementById(id) { return body.querySelector(`#${id}`); },
      querySelector(selector) { return body.querySelector(selector); },
      createElement(tagName) { return new StartupElement(tagName); },
    },
    location: { pathname: "/workflow", search: "?view=canvas", reload() { host.reloads++; } },
    sessionStorage: {
      getItem(key) { return values.get(key) ?? null; },
      setItem(key, value) { values.set(key, String(value)); },
      removeItem(key) { values.delete(key); },
    },
    console: { error(...details) { host.errors.push(details); } },
    reloads: 0,
    errors: [],
  };
  return host;
}

function assertStartupRecovery(host, error) {
  const recovery = host.document.getElementById("startup-recovery");
  assert.ok(recovery, "The loading screen offers recovery instead of remaining stuck");
  assert.equal(host.document.getElementById("startup-stage").textContent, "Loading failed");
  assert.ok(recovery.textContent.includes(error.message));
  const button = recovery.querySelector("button");
  assert.ok(button, "The user can explicitly reload");
  assert.equal(button.textContent, "Reload");
  assert.ok(host.errors.some(details => details.includes(error)), "The original error reaches the console");
  return button;
}

Then("development startup reloads once for module failure {string}", async function (message) {
  const host = startupHost();
  await loadApplication(() => Promise.reject(new TypeError(message)), host, true);
  assert.equal(host.reloads, 1, message);
  assert.equal(host.sessionStorage.getItem(reloadGuard), "/workflow?view=canvas");
});

Then("a repeated startup module failure stops reloading and displays its details safely", async function () {
  const host = startupHost();
  await loadApplication(() => Promise.reject(moduleFailure()), host, true);
  const error = new TypeError('Failed to fetch dynamically imported module: <img src=x onerror="alert(1)">');
  await loadApplication(() => Promise.reject(error), host, true);
  assert.equal(host.reloads, 1);
  assertStartupRecovery(host, error);
  await loadApplication(() => Promise.reject(error), host, true);
  assert.equal(host.reloads, 1);
  assert.equal(host.document.getElementById("startup-status").children.length, 2,
    "Repeated failures replace the recovery message instead of accumulating duplicate buttons");
});

Then("successful startup clears the earlier automatic reload guard", async function () {
  const host = startupHost();
  host.sessionStorage.setItem(reloadGuard, "/workflow?view=canvas");
  let loaded = false;
  await loadApplication(async () => { loaded = true; }, host, true);
  assert.equal(loaded, true);
  assert.equal(host.reloads, 0);
  assert.equal(host.sessionStorage.getItem(reloadGuard), null);
  await loadApplication(() => Promise.reject(moduleFailure()), host, true);
  assert.equal(host.reloads, 1);
});

Then("the startup recovery button clears the guard and reloads the page", async function () {
  const host = startupHost();
  host.sessionStorage.setItem(reloadGuard, "/workflow?view=canvas");
  const error = moduleFailure();
  await loadApplication(() => Promise.reject(error), host, true);
  assert.equal(host.reloads, 0);
  assertStartupRecovery(host, error).click();
  assert.equal(host.reloads, 1);
  assert.equal(host.sessionStorage.getItem(reloadGuard), null);
});

Then("startup remains recoverable when session storage {string} fails", async function (failure) {
  const host = startupHost();
  const denied = () => { throw new DOMException("Session storage is unavailable", "SecurityError"); };
  if (failure === "access") Object.defineProperty(host, "sessionStorage", { get: denied });
  else host.sessionStorage[failure] = denied;
  const error = moduleFailure();
  if (failure === "removeItem") host.sessionStorage.setItem(reloadGuard, "/workflow?view=canvas");
  await loadApplication(() => Promise.reject(error), host, true);
  assert.equal(host.reloads, 0, failure);
  assertStartupRecovery(host, error).click();
  assert.equal(host.reloads, 1, `Manual recovery remains available after ${failure} fails`);
  await loadApplication(async () => {}, host, true);
  assert.equal(host.reloads, 1, "Successful loading also tolerates unavailable session storage");
});

Then("production module failures show recovery without automatically reloading", async function () {
  const host = startupHost();
  const error = moduleFailure();
  await loadApplication(() => Promise.reject(error), host, false);
  assert.equal(host.reloads, 0);
  assertStartupRecovery(host, error);
});

Then("startup {string} with {string} shows recovery without automatically reloading", async function (kind, message) {
  const host = startupHost();
  const error = kind === "TypeError" ? new TypeError(message) : new Error(message);
  await loadApplication(() => { throw error; }, host, true);
  assert.equal(host.reloads, 0);
  assertStartupRecovery(host, error);
});

Then("a module failure after mounting does not automatically reload the page", async function () {
  const host = startupHost({ mounted: true });
  await loadApplication(() => Promise.reject(moduleFailure()), host, true);
  assert.equal(host.reloads, 0);
  assert.equal(host.sessionStorage.getItem(reloadGuard), null);
  assert.ok(host.document.getElementById("app").hasChildNodes());
});
