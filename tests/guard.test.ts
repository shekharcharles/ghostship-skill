import { describe, expect, test } from "claude-code/testing";

import { riskyDelete } from "../hooks/guard.ts";

describe("destructive deletes are refused, so the build never stops to ask", () => {
  test("a recursive or forced delete with a wildcard, variable, root or parent target is refused", () => {
    expect(riskyDelete("cd /tmp/x && rm -rf * && cp -r src .")).toMatch(/"\*"/);
    expect(riskyDelete("rm -rf $HOME/cache")).toMatch(/\$HOME/);
    expect(riskyDelete("rm -fr /")).toMatch(/"\/"/);
    expect(riskyDelete("rm -rf ~")).toMatch(/"~"/);
    expect(riskyDelete("rm -rf ..")).toMatch(/"\.\."/);
  });

  test("named deletes and everything else run", () => {
    expect(riskyDelete("rm -rf node_modules dist")).toBe(null);
    expect(riskyDelete("rm build/out.log")).toBe(null);
    expect(riskyDelete("npm test && ls -la")).toBe(null);
    expect(riskyDelete("git status --short")).toBe(null);
  });
});

import { unprovenDone } from "../hooks/guard.ts";

describe("a task is marked done only with its red and end-to-end proof", () => {
  const proven = "- T001 · PASS · red: npm test -- x → fail: 1 failing · green: npm test -- x → pass · e2e: curl /scan → 3 findings";
  test("a done row with its proof passes; one without a red run, or without e2e, is refused", () => {
    expect(unprovenDone("| T001 | Name | 1 | done | A1 |", proven)).toEqual([]);
    expect(unprovenDone("| T002 | Name | 1 | done | A2 |", proven)).toEqual(["T002"]);
    expect(unprovenDone("| T001 | Name | 1 | done | A1 |", "- T001 · PASS · green: npm test → pass")).toEqual(["T001"]);
    expect(unprovenDone("| T001 | Name | 1 | done | A1 |", "- T001 · PASS · red: npm test → fail · green: npm test → pass")).toEqual(["T001"]);
  });
  test("rows that are not marked done are not refused", () => {
    expect(unprovenDone("| T003 | Name | 1 | todo | A3 |", "")).toEqual([]);
    expect(unprovenDone("| T003 | Name | 1 | judging | A3 |", "")).toEqual([]);
  });
});
