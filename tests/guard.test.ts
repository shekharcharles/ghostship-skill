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

import { releaseCommand } from "../hooks/guard.ts";

test("a release tag or publish is recognised; ordinary commands are not", () => {
  expect(releaseCommand("git commit -m x && git tag v1.0.0")).toBe(true);
  expect(releaseCommand("gh release create v1.0.0 --notes x")).toBe(true);
  expect(releaseCommand("npm publish")).toBe(true);
  expect(releaseCommand("git commit -m 'tag the fix'")).toBe(false);
  expect(releaseCommand("npm test")).toBe(false);
});

import { boardHasTasks } from "../hooks/guard.ts";

test("an empty or unreadable board cannot pass the release gate", () => {
  expect(boardHasTasks("")).toBe(false);
  expect(boardHasTasks("# Board\n\n| Task | Phase |\n|--|--|\n")).toBe(false);
  expect(boardHasTasks("| T001 | Name | 1 | done | A1 |")).toBe(true);
});


import { doneNotInLedger, isLedgerPath } from "../hooks/guard.ts";

test("a done row needs a green in the ledger, and the ledger file is not hand-editable", () => {
  const ledger = JSON.stringify({ task: "T001", phase: "green", recorded: true });
  expect(doneNotInLedger("| T001 | n | 1 | done | A1 |", ledger)).toEqual(["T001"]);
  expect(doneNotInLedger("| T001 | n | 1 | done | A1 |", ledger + "\n" + JSON.stringify({ task: "T001", phase: "verify", recorded: true }))).toEqual([]);
  expect(doneNotInLedger("| T002 | n | 1 | done | A2 |", ledger)).toEqual(["T002"]);
  expect(isLedgerPath("/work/docs/ghostship/LEDGER.jsonl")).toBe(true);
  expect(isLedgerPath("/work/docs/ghostship/EVIDENCE.md")).toBe(false);
});

import { resumeFrom } from "../hooks/guard.ts";

test("a resume summary counts verified and in-progress tasks from the ledger", () => {
  const ledger = [
    JSON.stringify({ task: "T001", phase: "red", recorded: true }),
    JSON.stringify({ task: "T001", phase: "green", recorded: true }),
    JSON.stringify({ task: "T002", phase: "red", recorded: true }),
    "broken",
  ].join("\n");
  expect(resumeFrom(ledger)).toEqual({ verified: 1, inProgress: 1, damaged: 1 });
});

import { gateRecordCommand } from "../hooks/guard.ts";

test("a done row needs a verifier's pass, and only a gate command records runs", () => {
  const greenOnly = JSON.stringify({ task: "T001", phase: "green", recorded: true });
  const verified = greenOnly + "\n" + JSON.stringify({ task: "T001", phase: "verify", recorded: true });
  expect(doneNotInLedger("| T001 | n | 1 | done | A1 |", greenOnly)).toEqual(["T001"]);
  expect(doneNotInLedger("| T001 | n | 1 | done | A1 |", verified)).toEqual([]);
  expect(gateRecordCommand("node scripts/task-done.mjs verify T001 . -- npm e2e").phase).toBe("verify");
  expect(gateRecordCommand("npm test").recordsRun).toBe(false);
});

import { fixLoopRefusal } from "../hooks/guard.ts";

test("the mod refuses a fourth failure's retry until a ruling exists", () => {
  const fails = Array.from({ length: 4 }, () => JSON.stringify({ task: "T001", phase: "green", recorded: false })).join("\n");
  expect(fixLoopRefusal("node scripts/task-done.mjs green T001 . -- x", fails, "")).toMatch(/no ruling/);
  expect(fixLoopRefusal("node scripts/task-done.mjs green T001 . -- x", fails, "Ruling: T001 — park it")).toBe(null);
  expect(fixLoopRefusal("node scripts/task-done.mjs green T002 . -- x", fails, "")).toBe(null);
  expect(fixLoopRefusal("npm test", fails, "")).toBe(null);
});

import { releaseBlockersOf } from "../hooks/guard.ts";

test("the mod's release check refuses a damaged ledger and an unresolved unverified run", () => {
  expect(releaseBlockersOf("")).toEqual([]);
  expect(releaseBlockersOf("broken")).toHaveLength(1);
  expect(releaseBlockersOf(JSON.stringify({ task: "T003", phase: "green", status: "unverified", recorded: false, reason: "no runner" }))[0]).toMatch(/T003: green was not verified/);
});

