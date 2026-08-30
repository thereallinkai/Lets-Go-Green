import { describe, expect, it } from "vitest";

import {
  addLocalDays,
  addLocalMonths,
  daysBetweenLocalDates,
  enumerateLocalDates,
  formatLocalDate,
  isValidIanaTimeZone,
  localDateInTimeZone,
  localMonthBounds,
  remainingDays,
} from "../../src/lib/domain/dates";
import { resolvePlanDay } from "../../src/lib/domain/plan-days";

describe("local dates and time zones", () => {
  it("handles leap days using calendar arithmetic", () => {
    expect(addLocalDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addLocalDays("2028-02-28", 2)).toBe("2028-03-01");
    expect(daysBetweenLocalDates("2028-02-28", "2028-03-01")).toBe(2);
  });

  it("rejects impossible local dates", () => {
    expect(() => addLocalDays("2026-02-29", 1)).toThrow(/Invalid local date/);
  });

  it("formats local dates in UTC without shifting calendar days", () => {
    expect(formatLocalDate("2026-03-01", "weekday-short")).toBe("Sun");
    expect(formatLocalDate("2026-03-01", "month-day")).toBe("Mar 1");
    expect(formatLocalDate("2026-03-01", "month-day-year")).toBe(
      "Mar 1, 2026",
    );
    expect(
      formatLocalDate(
        localDateInTimeZone("2026-03-01T23:30:00-05:00", "UTC"),
        "month-day-year",
      ),
    ).toBe("Mar 2, 2026");
  });

  it("rejects invalid dates before formatting", () => {
    expect(() => formatLocalDate("2026-02-29", "month-day")).toThrow(
      /Invalid local date/,
    );
  });

  it("calculates remaining days in the user's local time zone", () => {
    const now = "2026-01-01T04:30:00.000Z";
    expect(localDateInTimeZone(now, "America/New_York")).toBe("2025-12-31");
    expect(
      remainingDays("2026-01-02", {
        now,
        timeZone: "America/New_York",
      }),
    ).toBe(2);
    expect(remainingDays("2025-01-01", { now, timeZone: "UTC" })).toBe(0);
  });

  it("recognizes IANA zones and rejects invalid zones", () => {
    expect(isValidIanaTimeZone("Pacific/Kiritimati")).toBe(true);
    expect(isValidIanaTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(() => localDateInTimeZone(Date.now(), "Mars/Olympus_Mons")).toThrow(
      /Invalid IANA/,
    );
  });

  it("enumerates an inclusive local-date range", () => {
    expect(enumerateLocalDates("2026-07-30", "2026-08-02")).toEqual([
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
      "2026-08-02",
    ]);
  });

  it("shifts local months and derives inclusive month bounds", () => {
    expect(addLocalMonths("2026-12", 1)).toBe("2027-01");
    expect(addLocalMonths("2026-01", -1)).toBe("2025-12");
    expect(localMonthBounds("2028-02")).toEqual({
      first: "2028-02-01",
      last: "2028-02-29",
    });
    expect(() => localMonthBounds("2026-13")).toThrow(/valid YYYY-MM/);
  });
});

describe("seven-day plan mapping", () => {
  it("maps and wraps day indexes deterministically", () => {
    expect(resolvePlanDay("2026-07-20", "2026-07-20")).toMatchObject({
      dayIndex: 1,
      cycleNumber: 1,
    });
    expect(resolvePlanDay("2026-07-26", "2026-07-20")?.dayIndex).toBe(7);
    expect(resolvePlanDay("2026-07-27", "2026-07-20")).toMatchObject({
      dayIndex: 1,
      cycleNumber: 2,
    });
  });

  it("does not map dates outside the selected plan range", () => {
    expect(resolvePlanDay("2026-07-19", "2026-07-20")).toBeNull();
    expect(
      resolvePlanDay("2026-08-01", "2026-07-20", "2026-07-31"),
    ).toBeNull();
  });
});
