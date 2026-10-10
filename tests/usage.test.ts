import { describe, expect, test } from "claude-code/testing";

import { cacheLeft, countdown, limitsOf, rowParts, shouldWarn, ttlMs } from "../hooks/usage.ts";

describe("the band's usage line", () => {
  test("the cache countdown runs from the last reply", () => {
    expect(ttlMs("5m")).toBe(300_000);
    expect(ttlMs("1h")).toBe(3_600_000);
    expect(ttlMs(undefined)).toBe(300_000);
    expect(cacheLeft(1_000, 0, 300_000)).toBe(null);
    expect(cacheLeft(61_000, 1_000, 300_000)).toBe(240_000);
    expect(countdown(240_000)).toBe("4:00");
    expect(countdown(59_001)).toBe("1:00");
    expect(countdown(3_725_000)).toBe("1:02:05");
  });

  test("the limits are read from the engine's windows", () => {
    expect(limitsOf([{ kind: "five_hour", percentUsed: 23.5 }, { kind: "seven_day", percentUsed: 41 }])).toEqual({ fiveHour: 23.5, week: 41 });
    expect(limitsOf([])).toEqual({ fiveHour: null, week: null });
  });

  test("it warns once per reply, in the last minute, while still warm", () => {
    expect(shouldWarn(60_000, 60_000, 0, 5)).toBe(true);
    expect(shouldWarn(60_000, 60_000, 5, 5)).toBe(false);
    expect(shouldWarn(61_000, 60_000, 0, 5)).toBe(false);
    expect(shouldWarn(0, 60_000, 0, 5)).toBe(false);
    expect(shouldWarn(null, 60_000, 0, 0)).toBe(false);
  });

  test("the row reads context, cache, 5-hour and weekly use, with tones", () => {
    const parts = rowParts({ contextPct: 42, working: false, cacheLeftMs: 192_000, leadMs: 60_000, fiveHour: 80, week: 95 });
    expect(parts.map(p => p.text)).toEqual(["ctx 42% ▕███░░░░░▏", "cache 3:12", "5h 80%", "week 95%"]);
    expect(parts.map(p => p.tone)).toEqual(["dim", "dim", "warn", "bad"]);
    expect(rowParts({ contextPct: null, working: false, cacheLeftMs: -5, leadMs: 60_000, fiveHour: null, week: null }).map(p => p.text))
      .toEqual(["ctx —", "cache cold", "5h —", "week —"]);
    expect(rowParts({ contextPct: 10, working: true, cacheLeftMs: null, leadMs: 60_000, fiveHour: null, week: null })[1]).toEqual({ text: "cache warm", tone: "dim" });
    expect(rowParts({ contextPct: 10, working: false, cacheLeftMs: 30_000, leadMs: 60_000, fiveHour: null, week: null })[1].tone).toBe("warn");
  });
});
