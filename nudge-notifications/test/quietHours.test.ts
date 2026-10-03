import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isQuiet, nextAllowedTime } from "../src/quietHours.ts";

const utc = (iso: string) => new Date(`${iso}Z`);

describe("quiet hours", () => {
  it("handles windows that wrap past midnight", () => {
    const quiet = { startHour: 22, endHour: 7 };
    assert.equal(isQuiet(utc("2026-10-05T23:00"), quiet), true);
    assert.equal(isQuiet(utc("2026-10-05T03:00"), quiet), true);
    assert.equal(isQuiet(utc("2026-10-05T07:00"), quiet), false);
    assert.equal(isQuiet(utc("2026-10-05T12:00"), quiet), false);
  });

  it("handles same-day windows", () => {
    const quiet = { startHour: 12, endHour: 14 };
    assert.equal(isQuiet(utc("2026-10-05T13:30"), quiet), true);
    assert.equal(isQuiet(utc("2026-10-05T14:00"), quiet), false);
  });

  it("moves a quiet time to the end of the window", () => {
    const quiet = { startHour: 22, endHour: 7 };
    assert.deepEqual(nextAllowedTime(utc("2026-10-05T23:15"), quiet), utc("2026-10-06T07:00"));
    assert.deepEqual(nextAllowedTime(utc("2026-10-06T02:00"), quiet), utc("2026-10-06T07:00"));
    assert.deepEqual(nextAllowedTime(utc("2026-10-06T09:00"), quiet), utc("2026-10-06T09:00"));
    assert.deepEqual(nextAllowedTime(utc("2026-10-06T09:00"), undefined), utc("2026-10-06T09:00"));
  });
});
