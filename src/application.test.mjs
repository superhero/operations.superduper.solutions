import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { startApplication } from "./bootstrap.ts";

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
