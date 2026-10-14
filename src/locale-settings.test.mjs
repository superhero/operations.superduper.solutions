// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Then } from "@cucumber/cucumber";
import { defaultLocaleSettings, formatCalendarDate, formatDateTime, getTimeZoneOptions, normalizeLocaleSettings }
  from "./lib/locale-settings.ts";
import { applyLocaleSettings, getLocaleSettings } from "./lib/datetime-state.ts";
import { formatLocalDate, formatLocalDateTime } from "./lib/datetime.ts";

const settings = patch => ({ ...defaultLocaleSettings, ...patch });
const at = (value, patch, locale = "en-US") => formatDateTime(Date.parse(value), settings(patch), locale);

Then("public date helpers load in Node and use the current normalized preferences", () => {
  try
  {
    const selected = settings({ dateFormat: "ymd", timeFormat: "24h", timeZone: "America/New_York" });
    applyLocaleSettings(selected);
    assert.deepEqual(getLocaleSettings(), selected);
    assert.equal(formatLocalDateTime(Date.parse("2026-07-05T17:06:07Z")), "2026-07-05, 13:06:07");
    assert.equal(formatLocalDate("2026-07-05"), "2026-07-05");
    applyLocaleSettings({ ...selected, dateFormat: "dmy" });
    assert.equal(formatLocalDate("2026-07-05"), "05/07/2026");
    applyLocaleSettings(null);
    assert.deepEqual(getLocaleSettings(), defaultLocaleSettings);
  }
  finally { applyLocaleSettings(defaultLocaleSettings); }
});

Then("normalization restores defaults for invalid fields and keeps supported preferences", () => {
  for (const value of [undefined, null, true, 42, "long", [], {}])
    assert.deepEqual(normalizeLocaleSettings(value), defaultLocaleSettings);
  assert.deepEqual(normalizeLocaleSettings({ dateFormat: "invalid", timeFormat: "13h", timeZone: "Mars/Olympus" }), defaultLocaleSettings);
  for (const dateFormat of ["system", "dmy", "mdy", "ymd", "long"])
    for (const timeFormat of ["system", "12h", "24h"])
      assert.deepEqual(normalizeLocaleSettings({ dateFormat, timeFormat, timeZone: "America/New_York" }),
        { dateFormat, timeFormat, timeZone: "America/New_York" });
  assert.equal(normalizeLocaleSettings({ timeZone: "UTC" }).timeZone, "UTC");
  assert.equal(normalizeLocaleSettings({ timeZone: "" }).timeZone, "system");
  assert.equal(normalizeLocaleSettings({ timeZone: 2 }).timeZone, "system");
});

Then("system formatting preserves the browser's default date, clock, and zone", () => {
  const date = new Date("2026-01-02T00:04:05Z");
  for (const locale of ["en-US", "en-GB", "de-DE", "ar-EG"])
    assert.equal(formatDateTime(date.getTime(), defaultLocaleSettings, locale), date.toLocaleString(locale));
});

Then("fixed date patterns preserve their order, padding, and Gregorian year across locales", () => {
  for (const [dateFormat, expected] of [["dmy", "02/01/2026"], ["mdy", "01/02/2026"], ["ymd", "2026-01-02"]])
  {
    for (const locale of ["en-US", "en-GB", "th-TH", "ar-EG"])
      assert.equal(formatCalendarDate("2026-01-02", settings({ dateFormat }), locale), expected);
    assert.ok(at("2026-01-02T00:04:05Z", { dateFormat, timeZone: "UTC" }).startsWith(`${expected}, `));
  }
  assert.equal(formatCalendarDate("0099-01-02", settings({ dateFormat: "ymd" }), "en-US"), "0099-01-02");
});

Then("instant dates roll forward and backward with their selected timezone", () => {
  const instant = "2026-01-02T00:04:05Z";
  assert.equal(at(instant, { dateFormat: "ymd", timeFormat: "24h", timeZone: "UTC" }), "2026-01-02, 00:04:05");
  assert.equal(at(instant, { dateFormat: "ymd", timeFormat: "24h", timeZone: "America/Los_Angeles" }), "2026-01-01, 16:04:05");
  assert.equal(at("2026-01-02T20:04:05Z", { dateFormat: "ymd", timeFormat: "24h", timeZone: "Asia/Tokyo" }), "2026-01-03, 05:04:05");
});

Then("clock choices retain seconds and render midnight and noon correctly", () => {
  for (const locale of ["en-US", "en-GB"])
  {
    assert.equal(at("2026-01-02T00:00:00Z", { dateFormat: "ymd", timeFormat: "24h", timeZone: "UTC" }, locale), "2026-01-02, 00:00:00");
    assert.match(at("2026-01-02T00:04:05Z", { dateFormat: "ymd", timeFormat: "12h", timeZone: "UTC" }, locale), /^2026-01-02, 12:04:05\s[ap]m$/i);
    assert.match(at("2026-01-02T12:04:05Z", { dateFormat: "ymd", timeFormat: "12h", timeZone: "UTC" }, locale), /^2026-01-02, 12:04:05\spm$/i);
  }
});

Then("named zones apply daylight-saving transitions to historical instants", () => {
  const patch = { dateFormat: "ymd", timeFormat: "24h", timeZone: "America/New_York" };
  assert.equal(at("2026-03-08T06:59:59Z", patch), "2026-03-08, 01:59:59");
  assert.equal(at("2026-03-08T07:00:00Z", patch), "2026-03-08, 03:00:00");
  assert.equal(at("2026-11-01T05:59:59Z", patch), "2026-11-01, 01:59:59");
  assert.equal(at("2026-11-01T06:00:00Z", patch), "2026-11-01, 01:00:00");
});

Then("calendar dates stay on their own day across zones, skipped days, and leap days", () => {
  for (const timeZone of ["system", "UTC", "America/Los_Angeles", "Pacific/Kiritimati", "Pacific/Apia"])
    for (const date of ["2024-02-29", "2026-01-01", "2011-12-30"])
      assert.equal(formatCalendarDate(date, settings({ dateFormat: "ymd", timeZone }), "en-US"), date);
  assert.equal(formatCalendarDate("2026-01-02", settings({ dateFormat: "long", timeZone: "Pacific/Kiritimati" }), "en-US"), "January 2, 2026");
  assert.equal(formatCalendarDate("2026-01-02", settings({ dateFormat: "long" }), "en-GB"), "2 January 2026");
  assert.equal(formatCalendarDate("2026-01-02", defaultLocaleSettings, "en-US"), "1/2/2026");
});

Then("malformed timestamps and calendar dates display a graceful placeholder", () => {
  for (const timestamp of [NaN, Infinity, -Infinity, 9e20])
    assert.equal(formatDateTime(timestamp), "Unavailable");
  for (const date of ["", "not-a-date", "2026-2-01", "2026-02-30", "2025-02-29", "2026-13-01", "2026-01-00", "2026-01-02T00:00:00Z"])
    assert.equal(formatCalendarDate(date), "Unavailable");
});

Then("timezone options include UTC, the system zone, and supported named zones", () => {
  const zones = getTimeZoneOptions();
  assert.ok(zones.includes("UTC"));
  assert.ok(zones.includes(new Intl.DateTimeFormat().resolvedOptions().timeZone));
  assert.ok(zones.includes("America/New_York"));
  assert.equal(zones.length, new Set(zones).size);
  const supportedValuesOf = Intl.supportedValuesOf;
  try
  {
    Intl.supportedValuesOf = undefined;
    assert.ok(getTimeZoneOptions().includes("UTC"));
  }
  finally { Intl.supportedValuesOf = supportedValuesOf; }
});
