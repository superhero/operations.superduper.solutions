import { beforeEach, describe, expect, it, vi } from "vitest";

describe("application bootstrap", () =>
{
  beforeEach(() =>
  {
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
  });

  it("mounts the application", async () =>
  {
    await import("./index.ts");

    expect(document.querySelector("h1")?.textContent)
      .toBe("operations.superduper.solutions");
    expect(document.querySelector("p")?.textContent)
      .toBe("CI/CD smoke test application");
  });

  it("fails when the mount target is missing", async () =>
  {
    document.body.innerHTML = "";

    await expect(import("./index.ts"))
      .rejects
      .toThrow("Missing #app element");
  });
});
