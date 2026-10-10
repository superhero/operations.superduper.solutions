import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { startApplication } from "./bootstrap.ts";
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
