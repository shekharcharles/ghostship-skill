import { describe, expect, test } from "claude-code/testing";

// @ts-ignore: a plain .mjs script beside the skill
import { countTests, verdictOf } from "../scripts/gate-verdict.mjs";

describe("the gate script records a run only on its real result", () => {
  test("tests are counted from runner output; an unknown output counts zero", () => {
    expect(countTests("collected 12 items\n===== 12 passed in 0.8s =====")).toBe(12);
    expect(countTests("Tests:  3 failed, 9 passed, 12 total")).toBe(9);
    expect(countTests("random words")).toBe(0);
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
