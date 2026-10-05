// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Given, Then, When } from "@cucumber/cucumber";
import "./support.mjs";

Then("the README links every manifest dependency to its existing local version badge", function ()
{
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const dependencies = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).devDependencies;
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const badges = [...readme.matchAll(/<a href="https:\/\/www\.npmjs\.com\/package\/([^"]+)"[^>]*>\s*<img\b[^>]*\bsrc="([^"]+)"[^>]*>\s*<\/a>/g)];
  assert.deepEqual(badges.map((match) => match[1]).sort(), Object.keys(dependencies).sort(),
    "README dependency badges must cover exactly the packages in package.json");
  for (const [, name, source] of badges)
  {
    const slug = name.replace(/^@/, "").replaceAll("/", "--");
    const expected = `.github/badges/version-dependency-${slug}.svg`;
    assert.equal(source, expected, `${name} must display a version badge from this revision`);
    assert.ok(existsSync(join(root, source)), `${source} is missing; run npm run badges:dependencies`);
  }
});

function manifest(world, directory = world.automation.root, version = "1.0.0")
{
  mkdirSync(directory, { recursive: true });
  const state = {
    manifest: join(directory, "package.json"), output: join(directory, "badges"),
    data: { devDependencies: { "@scope/tool": version } }
  };
  save(state);
  return state;
}

function save(state)
{
  writeFileSync(state.manifest, JSON.stringify(state.data));
}

function generate(world, state, check = false, outdated)
{
  return world.automation.execute("generate-dependency-badges.sh",
    [state.manifest, state.output, ...(check ? ["--check"] : outdated ? ["--outdated", outdated] : [])],
    [], { success: null });
}

function generateWithOutdated(world, state, data)
{
  const path = join(world.automation.root, "outdated.json");
  writeFileSync(path, typeof data === "string" ? data : JSON.stringify(data));
  return generate(world, state, false, path);
}

function badge(world, name = "scope--tool")
{
  return readFileSync(join(world.localBadges.output, `version-dependency-${name}.svg`), "utf8");
}

function snapshot(directory)
{
  return Object.fromEntries(readdirSync(directory).sort().map((name) =>
    [name, readFileSync(join(directory, name), "utf8")]));
}

function failure(world, reason)
{
  assert.notEqual(world.result.status, 0);
  for (const text of [reason, world.localBadges.manifest, world.localBadges.output, "npm run badges:dependencies"])
    assert.ok(world.result.stderr.includes(text), world.result.stderr);
  assert.deepEqual(world.automation.calls(), []);
}

Given("branch manifests with different dependency versions", function ()
{
  this.branchBadges = ["main", "develop", "release/0.1.0"].map((branch, index) =>
    manifest(this, join(this.automation.root, branch), `${index + 1}.0.0`));
});

When("local version badges are generated for each branch", function ()
{
  for (const state of this.branchBadges)
  {
    const result = generate(this, state);
    assert.equal(result.status, 0, result.stderr);
  }
});

Then("each branch badge displays its own version without a registry request", function ()
{
  for (const state of this.branchBadges)
  {
    const svg = readFileSync(join(state.output, "version-dependency-scope--tool.svg"), "utf8");
    assert.ok(svg.includes(`<title>@scope/tool: ${state.data.devDependencies["@scope/tool"]}</title>`));
    assert.ok(svg.includes('fill="#007ec6"'));
    assert.ok(svg.includes("SPDX-License-Identifier: AGPL-3.0-only"));
  }
  assert.deepEqual(this.automation.calls(), []);
});

Given("a package manifest without local version badges", function ()
{
  this.localBadges = manifest(this);
});

Given("generated local version badges", function ()
{
  this.localBadges = manifest(this);
  const result = generate(this, this.localBadges);
  assert.equal(result.status, 0, result.stderr);
  this.badgesBefore = snapshot(this.localBadges.output);
});

When("a dependency version changes in the manifest", function ()
{
  this.localBadges.data.devDependencies["@scope/tool"] = "2.0.0";
  save(this.localBadges);
});

When("local version badges are checked", function ()
{
  this.result = generate(this, this.localBadges, true);
});

Then("the check reports a stale badge with regeneration instructions without changing files", function ()
{
  failure(this, "missing or stale");
  assert.deepEqual(snapshot(this.localBadges.output), this.badgesBefore);
});

When("local version badges are regenerated and checked", function ()
{
  const result = generate(this, this.localBadges);
  assert.equal(result.status, 0, result.stderr);
  this.result = generate(this, this.localBadges, true);
});

Then("the local badge check succeeds with the updated version", function ()
{
  assert.equal(this.result.status, 0, this.result.stderr);
  assert.ok(readFileSync(join(this.localBadges.output, "version-dependency-scope--tool.svg"), "utf8")
    .includes("<title>@scope/tool: 2.0.0</title>"));
});

Then("the check reports missing badges with regeneration instructions without creating files", function ()
{
  failure(this, "missing or stale");
  assert.equal(existsSync(this.localBadges.output), false);
});

Given("generated local version badges and an unrelated SVG", function ()
{
  this.localBadges = manifest(this);
  this.localBadges.data.devDependencies.retired = "0.9.0";
  save(this.localBadges);
  const result = generate(this, this.localBadges);
  assert.equal(result.status, 0, result.stderr);
  writeFileSync(join(this.localBadges.output, "diagram.svg"), "unrelated SVG");
  this.badgesBefore = snapshot(this.localBadges.output);
});

When("a dependency is removed from the manifest", function ()
{
  delete this.localBadges.data.devDependencies.retired;
  save(this.localBadges);
});

Then("the check reports the obsolete badge without deleting it", function ()
{
  failure(this, "obsolete");
  assert.deepEqual(snapshot(this.localBadges.output), this.badgesBefore);
});

Then("obsolete dependency badges are removed and the unrelated SVG remains", function ()
{
  assert.equal(this.result.status, 0, this.result.stderr);
  assert.equal(existsSync(join(this.localBadges.output, "version-dependency-retired.svg")), false);
  assert.equal(readFileSync(join(this.localBadges.output, "diagram.svg"), "utf8"), "unrelated SVG");
  assert.equal(existsSync(join(this.localBadges.output, "version-dependency-scope--tool.svg")), true);
});

Given("a dependency version containing XML special characters", function ()
{
  this.localBadges = manifest(this, this.automation.root, '>=1 <2 & "quoted"');
});

When("local version badges are generated", function ()
{
  this.result = generate(this, this.localBadges);
});

Then("the badge contains escaped version text and accessible labels", function ()
{
  assert.equal(this.result.status, 0, this.result.stderr);
  const svg = readFileSync(join(this.localBadges.output, "version-dependency-scope--tool.svg"), "utf8");
  const version = "&gt;=1 &lt;2 &amp; &quot;quoted&quot;";
  assert.ok(svg.includes(`aria-label="@scope/tool: ${version}"`));
  assert.ok(svg.includes(`<title>@scope/tool: ${version}</title>`));
  assert.ok(svg.includes(`>${version}</text>`));
});

Then("local version badge generation rejects these manifest problems without writing files:", function (table)
{
  const invalid = {
    "malformed JSON": "{",
    "non-string version": { "@scope/tool": 42 },
    "filename traversal": { "../../escape": "1.0.0" },
    "package control characters": { "tool\n": "1.0.0" },
    "scoped filename collision": { "@scope/tool": "1.0.0", "scope--tool": "2.0.0" },
    "version control characters": { "@scope/tool": "1.0.0\n2.0.0" }
  };
  for (const { problem } of table.hashes())
  {
    assert.ok(Object.hasOwn(invalid, problem));
    const state = manifest(this);
    const data = invalid[problem];
    writeFileSync(state.manifest, typeof data === "string" ? data : JSON.stringify({ devDependencies: data }));
    const result = generate(this, state);
    assert.notEqual(result.status, 0, problem);
    for (const text of ["Expected one package manifest", state.manifest, state.output])
      assert.ok(result.stderr.includes(text), result.stderr);
    assert.equal(existsSync(state.output), false, problem);
  }
  assert.deepEqual(this.automation.calls(), []);
});

Given("declared dependencies with supplied outdated metadata", function ()
{
  this.localBadges = manifest(this);
  Object.assign(this.localBadges.data.devDependencies, { current: "1.0.0", omitted: "1.0.0" });
  save(this.localBadges);
  this.outdated = {
    "@scope/tool": { wanted: "1.0.0", latest: "2.0.0" },
    current: { current: "0.9.0", wanted: "1.0.0", latest: "1.0.0" },
    unrelated: { current: null, wanted: "1.0.0", latest: "2.0.0" }
  };
});

When("local badges are generated from the supplied outdated metadata", function ()
{
  this.result = generateWithOutdated(this, this.localBadges, this.outdated);
});

Then("only declared dependencies behind latest are orange without a registry request", function ()
{
  assert.equal(this.result.status, 0, this.result.stderr);
  assert.ok(badge(this).includes('fill="#fe7d37"'));
  assert.ok(badge(this).includes("<title>@scope/tool: 1.0.0</title>"));
  for (const name of ["current", "omitted"])
    assert.ok(badge(this, name).includes('fill="#007ec6"'));
  assert.deepEqual(readdirSync(this.localBadges.output).sort(), [
    "version-dependency-current.svg", "version-dependency-omitted.svg", "version-dependency-scope--tool.svg"
  ]);
  assert.deepEqual(this.automation.calls(), []);
});

Given("generated orange local version badges", function ()
{
  this.localBadges = manifest(this);
  const result = generateWithOutdated(this, this.localBadges,
    { "@scope/tool": { current: "1.0.0", wanted: "1.0.0", latest: "2.0.0" } });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(badge(this).includes('fill="#fe7d37"'));
  this.badgesBefore = snapshot(this.localBadges.output);
});

Then("local version badges remain orange and unchanged", function ()
{
  assert.equal(this.result.status, 0, this.result.stderr);
  assert.deepEqual(snapshot(this.localBadges.output), this.badgesBefore);
  assert.deepEqual(this.automation.calls(), []);
});

When("the orange badge content is modified", function ()
{
  writeFileSync(join(this.localBadges.output, "version-dependency-scope--tool.svg"),
    badge(this).replace('fill="#555"', 'fill="#111"'));
  this.badgesBefore = snapshot(this.localBadges.output);
});

When("fresh metadata reports the declared version is current", function ()
{
  this.result = generateWithOutdated(this, this.localBadges, {});
});

Then("the dependency badge is blue", function ()
{
  assert.equal(this.result.status, 0, this.result.stderr);
  assert.ok(badge(this).includes('fill="#007ec6"'));
  assert.ok(!badge(this).includes('fill="#fe7d37"'));
  assert.ok(badge(this).includes(`<title>@scope/tool: ${this.localBadges.data.devDependencies["@scope/tool"]}</title>`));
  assert.deepEqual(this.automation.calls(), []);
});

Then("invalid outdated metadata is rejected without changing badges:", function (table)
{
  const invalid = {
    "malformed JSON": "{",
    "multiple JSON objects": "{} {}",
    "array instead of object": [],
    "missing wanted version": { "@scope/tool": { current: "1.0.0", latest: "2.0.0" } },
    "non-string latest version": { "@scope/tool": { current: "1.0.0", wanted: "1.0.0", latest: 2 } },
    "version control characters": { "@scope/tool": { current: "1.0.0", wanted: "1.0.0", latest: "2.0.0\n" } },
    "npm error response": { error: { code: "E503", summary: "registry unavailable" } }
  };
  for (const { problem } of table.hashes())
  {
    assert.ok(Object.hasOwn(invalid, problem));
    const result = generateWithOutdated(this, this.localBadges, invalid[problem]);
    assert.notEqual(result.status, 0, problem);
    for (const text of ["Expected one npm outdated JSON object", this.localBadges.manifest, this.localBadges.output])
      assert.ok(result.stderr.includes(text), result.stderr);
    assert.deepEqual(snapshot(this.localBadges.output), this.badgesBefore, problem);
  }
  assert.deepEqual(this.automation.calls(), []);
});

Then("badge generation refuses symlink outputs without changing their targets", function ()
{
  const outside = join(this.automation.root, "outside");
  mkdirSync(outside);
  const target = join(outside, "version-dependency-scope--tool.svg");
  writeFileSync(target, "outside sentinel");
  for (const location of ["directory", "ancestor", "badge"])
  {
    const state = manifest(this, join(this.automation.root, location));
    if (location === "badge")
    {
      mkdirSync(state.output);
      symlinkSync(target, join(state.output, "version-dependency-scope--tool.svg"));
    }
    else
    {
      symlinkSync(outside, state.output);
      state.output += location === "ancestor" ? "/nested" : "/";
    }
    for (const check of [false, true])
    {
      const result = generate(this, state, check);
      assert.notEqual(result.status, 0, location);
      assert.ok(result.stderr.includes("symlink"), result.stderr);
      assert.deepEqual(snapshot(outside), { "version-dependency-scope--tool.svg": "outside sentinel" });
    }
  }
  assert.deepEqual(this.automation.calls(), []);
});
