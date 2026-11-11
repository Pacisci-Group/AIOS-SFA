import {
  fromExclusiveEnd,
  leaveEventConflicts,
  mergeHolidays,
  toExclusiveEnd,
  yearlyOccurrences,
  type HolidayRow,
} from "./hr-calendar";

describe("HR calendar (PAC-169)", () => {
  describe("exclusive end", () => {
    it("round-trips an inclusive last day through FullCalendar’s exclusive end", () => {
      expect(toExclusiveEnd("2026-12-18")).toBe("2026-12-19");
      expect(fromExclusiveEnd("2026-12-19")).toBe("2026-12-18");
      for (const day of [
        "2026-01-31",
        "2026-12-31",
        "2028-02-28",
        "2028-02-29",
      ]) {
        expect(fromExclusiveEnd(toExclusiveEnd(day))).toBe(day);
      }
    });

    it("crosses a month and a year", () => {
      expect(toExclusiveEnd("2026-12-31")).toBe("2027-01-01");
      expect(fromExclusiveEnd("2027-01-01")).toBe("2026-12-31");
    });

    it("reads the day out of a date-time string", () => {
      expect(fromExclusiveEnd("2026-12-19T00:00:00Z")).toBe("2026-12-18");
    });
  });

  describe("yearlyOccurrences", () => {
    it("finds the day inside a month", () => {
      expect(
        yearlyOccurrences("2019-11-20", "2026-11-01", "2026-11-30"),
      ).toEqual([{ date: "2026-11-20", years: 7 }]);
    });

    it("is empty when the month and day fall outside the range", () => {
      expect(
        yearlyOccurrences("2019-10-31", "2026-11-01", "2026-11-30"),
      ).toEqual([]);
    });

    it("finds both sides of a year boundary", () => {
      expect(
        yearlyOccurrences("2020-01-02", "2026-12-28", "2027-02-07"),
      ).toEqual([{ date: "2027-01-02", years: 7 }]);
      expect(
        yearlyOccurrences("2020-12-30", "2026-12-28", "2027-02-07"),
      ).toEqual([{ date: "2026-12-30", years: 6 }]);
    });

    it("returns one per year over a range spanning two", () => {
      expect(
        yearlyOccurrences("2020-06-15", "2026-01-01", "2027-12-31"),
      ).toEqual([
        { date: "2026-06-15", years: 6 },
        { date: "2027-06-15", years: 7 },
      ]);
    });

    it("observes 29 February on the 28th in a year without one", () => {
      expect(
        yearlyOccurrences("2020-02-29", "2027-02-01", "2027-03-01"),
      ).toEqual([{ date: "2027-02-28", years: 7 }]);
      expect(
        yearlyOccurrences("2020-02-29", "2028-02-01", "2028-03-01"),
      ).toEqual([{ date: "2028-02-29", years: 8 }]);
    });

    it("includes the year of the date itself as zero and nothing before it", () => {
      expect(
        yearlyOccurrences("2026-11-20", "2025-01-01", "2026-12-31"),
      ).toEqual([{ date: "2026-11-20", years: 0 }]);
    });
  });

  describe("mergeHolidays", () => {
    const row = (over: Partial<HolidayRow> = {}): HolidayRow => ({
      date: "2026-11-26",
      name: "Thanksgiving",
      observedFor: null,
      policy: { id: "paid", name: "Paid holidays" },
      mine: false,
      ...over,
    });

    it("is one entry for two policies closing the same day, naming both", () => {
      const merged = mergeHolidays([
        row(),
        row({ policy: { id: "part", name: "Part-time holidays" }, mine: true }),
      ]);
      expect(merged).toHaveLength(1);
      expect(merged[0]).toMatchObject({
        kind: "holiday",
        firstDay: "2026-11-26",
        lastDay: "2026-11-26",
        name: "Thanksgiving",
        mine: true,
        policies: [
          { id: "paid", name: "Paid holidays" },
          { id: "part", name: "Part-time holidays" },
        ],
      });
    });

    it("keeps two names on one date apart", () => {
      const merged = mergeHolidays([
        row({ date: "2026-12-24", name: "Christmas Eve" }),
        row({ date: "2026-12-24", name: "Office closed" }),
      ]);
      expect(merged.map((entry) => entry.name)).toEqual([
        "Christmas Eve",
        "Office closed",
      ]);
    });

    it("merges consecutive days of one name into a span", () => {
      const merged = mergeHolidays(
        ["2026-12-28", "2026-12-29", "2026-12-30", "2027-01-04"].map((date) =>
          row({ date, name: "Winter closure" }),
        ),
      );
      expect(merged.map((entry) => [entry.firstDay, entry.lastDay])).toEqual([
        ["2026-12-28", "2026-12-30"],
        ["2027-01-04", "2027-01-04"],
      ]);
    });

    it("never folds an observed day into a span", () => {
      const merged = mergeHolidays([
        row({
          date: "2026-07-03",
          name: "Independence Day",
          observedFor: "2026-07-04",
        }),
        row({ date: "2026-07-04", name: "Independence Day" }),
      ]);
      expect(merged).toHaveLength(2);
      expect(merged[0].observedFor).toBe("2026-07-04");
      expect(merged[1].observedFor).toBeNull();
    });

    it("sorts by first day, then name, with unique ids", () => {
      const merged = mergeHolidays([
        row({ date: "2026-12-25", name: "Christmas Day" }),
        row({ date: "2026-11-27", name: "Day after Thanksgiving" }),
        row({ date: "2026-11-26", name: "Thanksgiving" }),
      ]);
      expect(merged.map((entry) => entry.firstDay)).toEqual([
        "2026-11-26",
        "2026-11-27",
        "2026-12-25",
      ]);
      expect(new Set(merged.map((entry) => entry.id)).size).toBe(3);
    });
  });

  describe("leaveEventConflicts", () => {
    // Thu, Fri, Sat, Sun, Mon — the weekend at zero hours.
    const days = [
      { date: "2026-12-17", hours: 8 },
      { date: "2026-12-18", hours: 8 },
      { date: "2026-12-19", hours: 0 },
      { date: "2026-12-20", hours: 0 },
      { date: "2026-12-21", hours: 4 },
    ];
    const event = (
      id: string,
      effect: "none" | "blackout" | "day_off",
      firstDay: string,
      lastDay: string,
    ) => ({ id, name: id, effect, firstDay, lastDay });

    it("names the charged days a blackout covers", () => {
      expect(
        leaveEventConflicts(days, [
          event("audit", "blackout", "2026-12-18", "2026-12-21"),
        ]),
      ).toEqual([
        {
          eventId: "audit",
          name: "audit",
          effect: "blackout",
          dates: ["2026-12-18", "2026-12-21"],
        },
      ]);
    });

    it("flags a day off declared over a day that still carries hours", () => {
      expect(
        leaveEventConflicts(days, [
          event("closure", "day_off", "2026-12-17", "2026-12-17"),
        ]),
      ).toEqual([
        {
          eventId: "closure",
          name: "closure",
          effect: "day_off",
          dates: ["2026-12-17"],
        },
      ]);
    });

    it("is no conflict when only zero-hour days are covered", () => {
      expect(
        leaveEventConflicts(days, [
          event("meetup", "blackout", "2026-12-19", "2026-12-20"),
        ]),
      ).toEqual([]);
    });

    it("ignores an event with no effect and one outside the range", () => {
      expect(
        leaveEventConflicts(days, [
          event("party", "none", "2026-12-18", "2026-12-18"),
          event("later", "blackout", "2026-12-22", "2026-12-23"),
        ]),
      ).toEqual([]);
    });

    it("sorts by the first conflicting day", () => {
      const conflicts = leaveEventConflicts(days, [
        event("second", "blackout", "2026-12-21", "2026-12-21"),
        event("first", "day_off", "2026-12-17", "2026-12-17"),
      ]);
      expect(conflicts.map((conflict) => conflict.eventId)).toEqual([
        "first",
        "second",
      ]);
    });
  });
});
