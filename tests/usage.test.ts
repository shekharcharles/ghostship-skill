import { describe, expect, test } from "claude-code/testing";

import { addStep, cacheLeft, cacheShort, coldWriteUsd, countdown, endAgent, fmtK, hitRate, keepWarmDue, limitsOf, modelLabel, projectTotal, refreshVerdict, rowParts, shouldWarn, ttlMs, untilReset } from "../hooks/usage.ts";

const NOW = Date.parse("2026-10-10T12:00:00Z");

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
    expect(cacheShort(43 * 60_000 + 20_000)).toBe("43m");
    expect(cacheShort(192_000)).toBe("3:12");
  });

  test("names, counts and spans read the way people say them", () => {
    expect(modelLabel("claude-haiku-5-5")).toBe("Haiku 5.5");
    expect(modelLabel("claude-opus-5-5[1m]")).toBe("Opus 5.5");
    expect(modelLabel("some-other-model")).toBe("some-other-model");
    expect(modelLabel(null)).toBe(null);
    expect(fmtK(75_200)).toBe("75.2k");
    expect(fmtK(1_000_000)).toBe("1M");
    expect(fmtK(950)).toBe("950");
    expect(untilReset("2026-10-10T13:09:00Z", NOW)).toBe("1h 9m");
    expect(untilReset("2026-10-10T12:09:00Z", NOW)).toBe("9m");
    expect(untilReset(undefined, NOW)).toBe(null);
  });

  test("the hit rate is the share of input the cache served", () => {
    expect(hitRate({ input_tokens: 10, cache_read_input_tokens: 63, cache_creation_input_tokens: 27 })).toBe(63);
    expect(hitRate({ input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toBe(null);
    expect(hitRate(null)).toBe(null);
  });

  test("the limits are read from the engine's windows", () => {
    expect(limitsOf([{ kind: "five_hour", percentUsed: 2, resetsAt: "2026-10-10T13:09:00Z" }, { kind: "seven_day", percentUsed: 41 }]))
      .toEqual({ fiveHour: 2, fiveHourResetsAt: "2026-10-10T13:09:00Z", week: 41 });
    expect(limitsOf([])).toEqual({ fiveHour: null, fiveHourResetsAt: undefined, week: null });
  });

  test("it warns once per reply, in the last minute, while still warm", () => {
    expect(shouldWarn(60_000, 60_000, 0, 5)).toBe(true);
    expect(shouldWarn(60_000, 60_000, 5, 5)).toBe(false);
    expect(shouldWarn(61_000, 60_000, 0, 5)).toBe(false);
    expect(shouldWarn(0, 60_000, 0, 5)).toBe(false);
    expect(shouldWarn(null, 60_000, 0, 0)).toBe(false);
  });

  test("the line reads model, context, limits, cache, hit rate and cost, most important first", () => {
    const parts = rowParts({
      model: "claude-haiku-5-5", contextPct: 8, tokens: 75_200, window: 1_000_000, working: false,
      cacheLeftMs: 43 * 60_000, leadMs: 60_000, fiveHour: 2, fiveHourResetsAt: "2026-10-10T13:09:00Z", week: 41,
      hitPct: 63, usd: 0.012, nowMs: NOW,
    });
    expect(parts.map(p => p.text)).toEqual([
      "Haiku 5.5", "█░░░░░░░░░░░░░░░ 8%", "75.2k/1M", "5h 2% · resets 1h 9m", "week 41%", "⏳ 43m", "63% hit", "$0.01",
    ]);
    expect(parts.map(p => p.tone)).toEqual(["model", "ok", "dim", "ok", "ok", "ok", "ok", "dim"]);
  });

  test("before any reading the line says so, and the cache shows warm, cold or its last minute", () => {
    const base = { model: null, contextPct: null, working: false, leadMs: 60_000, fiveHour: null, week: null, hitPct: null, usd: null, nowMs: NOW };
    expect(rowParts({ ...base, cacheLeftMs: null }).map(p => p.text)).toEqual(["ctx —", "5h —", "⏳ —"]);
    expect(rowParts({ ...base, cacheLeftMs: -5 }).at(-1)).toEqual({ text: "⏳ cold", tone: "bad" });
    expect(rowParts({ ...base, cacheLeftMs: 30_000 }).at(-1)).toEqual({ text: "⏳ 0:30", tone: "warn" });
    expect(rowParts({ ...base, working: true, cacheLeftMs: null }).at(-1)).toEqual({ text: "⏳ warm", tone: "ok" });
    expect(rowParts({ ...base, contextPct: 92, cacheLeftMs: null })[0]!.tone).toBe("bad");
  });

  test("a cold cache's next send is priced at the model's write rate for the cache's lifetime", () => {
    expect(coldWriteUsd("claude-opus-5-5", 1_000_000, 3_600_000)).toBe(10);
    expect(coldWriteUsd("claude-opus-5-5", 1_000_000, 300_000)).toBe(6.25);
    expect(coldWriteUsd("unknown-model", 1_000_000, 3_600_000)).toBe(null);
    const cold = rowParts({ model: null, contextPct: null, working: false, leadMs: 60_000, fiveHour: null, week: null, hitPct: null, usd: null, nowMs: NOW, cacheLeftMs: -1, coldUsd: 4.01 });
    expect(cold.at(-1)!.text).toBe("⏳ cold · next send ≈ $4.01");
  });

  test("a refresh that read the prefix kept it warm; one that wrote it again found it cold", () => {
    const warm = refreshVerdict({ input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 75_000, cache_creation_input_tokens: 40 }, "claude-opus-5-5", 3_600_000);
    expect(warm.warm).toBe(true);
    expect(Math.round(warm.usd! * 1e4)).toBe(380);
    expect(refreshVerdict({ input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 75_000 }, null, 3_600_000).warm).toBe(false);
  });

  test("keep warm refreshes inside its window, near cold, never while a turn runs or once cold", () => {
    const d = { nowMs: 0, until: 7_200_000, ttl: 3_600_000, working: false };
    expect(keepWarmDue({ ...d, left: 9 * 60_000 })).toBe(true);
    expect(keepWarmDue({ ...d, left: 11 * 60_000 })).toBe(false);
    expect(keepWarmDue({ ...d, left: 0 })).toBe(false);
    expect(keepWarmDue({ ...d, left: 9 * 60_000, working: true })).toBe(false);
    expect(keepWarmDue({ ...d, left: 9 * 60_000, until: 0 })).toBe(false);
  });

  test("the ledger adds each agent's steps and marks it done; the project sums its sessions", () => {
    const u = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 };
    let l = addStep([], { id: "a1", name: "builder T005", model: "claude-sonnet-5-5", usage: u, usd: 0.1, nowMs: 5 });
    l = addStep(l, { id: "a1", name: "Agent", model: null, usage: u, usd: 0.2, nowMs: 9 });
    expect(l).toEqual([{ id: "a1", name: "builder T005", model: "claude-sonnet-5-5", running: true, startMs: 5, endMs: null, input: 2000, output: 100, steps: 2, usd: 0.30000000000000004 }]);
    expect(endAgent(l, "a1", 20)[0]).toMatchObject({ running: false, endMs: 20 });
    expect(addStep([], { id: "main", name: "Main thread", model: null, usage: u, usd: null, nowMs: 0 })[0]!.running).toBe(false);
    expect(projectTotal({ s1: 12.4, s2: 0.6 })).toBe(13);
    expect(projectTotal(undefined)).toBe(0);
    const parts = rowParts({ model: "claude-opus-5-5", contextPct: 8, working: false, leadMs: 60_000, fiveHour: null, week: null, hitPct: null, usd: 0.42, nowMs: NOW, cacheLeftMs: null, projectUsd: 12.4 });
    expect(parts[1]!.text).toBe("project $12.40 (session $0.42)");
  });
});
