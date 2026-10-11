import { describe, expect, test } from "claude-code/testing";

// @ts-ignore: a plain .mjs script beside the skill
import { countTests, verdictOf } from "../scripts/gate-verdict.mjs";

describe("the gate script records a run only on its real result", () => {
  test("tests are counted from runner output; an unknown output counts zero", () => {
    expect(countTests("collected 12 items\n===== 12 passed in 0.8s =====")).toBe(12);
    expect(countTests("Tests:  3 failed, 9 passed, 12 total")).toBe(9);
    expect(countTests("random words")).toBe(0);
    expect(countTests("3 checks passed")).toBe(3);
  });

  test("a red run must fail; a green run needs exit 0, tests, and an earlier red", () => {
    expect(verdictOf({ phase: "red", exitCode: 1, tests: 3, hasRed: false }).ok).toBe(true);
    expect(verdictOf({ phase: "red", exitCode: 0, tests: 3, hasRed: false }).ok).toBe(false);
    expect(verdictOf({ phase: "green", exitCode: 0, tests: 3, hasRed: true }).ok).toBe(true);
    expect(verdictOf({ phase: "green", exitCode: 0, tests: 0, hasRed: true }).why).toMatch(/zero tests/);
    expect(verdictOf({ phase: "green", exitCode: 1, tests: 3, hasRed: true }).ok).toBe(false);
    expect(verdictOf({ phase: "green", exitCode: 0, tests: 3, hasRed: false }).why).toMatch(/no red run/);
  });
});

import { ledgerProves, readLedger, resumePlan } from "../scripts/gate-verdict.mjs";

describe("the ledger is the record a resume trusts", () => {
  const text = [
    JSON.stringify({ task: "T001", phase: "red", recorded: true }),
    JSON.stringify({ task: "T001", phase: "green", recorded: true }),
    JSON.stringify({ task: "T002", phase: "red", recorded: true }),
    JSON.stringify({ task: "T003", phase: "green", recorded: false }),
    "not json",
  ].join("\n");
  test("a resume re-uses green tasks, resumes red-only tasks at green, and counts damaged lines", () => {
    const { entries, damaged } = readLedger(text);
    expect(damaged).toBe(1);
    expect(resumePlan(entries)).toEqual({ verified: ["T001"], inProgress: ["T002"], refused: 1 });
    expect(ledgerProves(entries, "T001")).toBe(true);
    expect(ledgerProves(entries, "T003")).toBe(false);
  });
});

test("a verifier pass needs a green before it and at least one check run", () => {
  expect(verdictOf({ phase: "verify", exitCode: 0, tests: 4, hasRed: true, hasGreen: true }).ok).toBe(true);
  expect(verdictOf({ phase: "verify", exitCode: 0, tests: 4, hasRed: true, hasGreen: false }).why).toMatch(/no green/);
  expect(verdictOf({ phase: "verify", exitCode: 0, tests: 0, hasRed: true, hasGreen: true }).why).toMatch(/zero checks/);
  expect(verdictOf({ phase: "verify", exitCode: 2, tests: 4, hasRed: true, hasGreen: true }).ok).toBe(false);
});


import { failedAttempts, nextAttempt } from "../scripts/gate-verdict.mjs";

describe("the fix loop is bounded", () => {
  test("failures count; the third calls a fresh implementer; the fourth needs a ruling", () => {
    const fail = { task: "T001", phase: "green", recorded: false };
    const entries = [fail, fail, { task: "T001", phase: "verify", recorded: false }];
    expect(failedAttempts(entries, "T001")).toBe(3);
    expect(nextAttempt(2, false)).toEqual({ ok: true, fresh: false });
    expect(nextAttempt(3, false).fresh).toBe(true);
    expect(nextAttempt(4, false).ok).toBe(false);
    expect(nextAttempt(4, true).ok).toBe(true);
    expect(failedAttempts([{ task: "T001", phase: "red", recorded: false }], "T001")).toBe(0);
  });
});
