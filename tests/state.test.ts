import { test, expect } from "claude-code/testing";
import { parseState, parseBoard, parseEvidence, progressBar, statusMark, voyageOf as parseVoyage, cmpVersion } from "../hooks/state";

test("parseState reads stage, task, autonomy, phase and the in-flight fields", () => {
  const s = parseState(`autonomy: auto\nstage: build\nphase: 2/3\nactive task: T005\njudge: verifying\nred: done.test.mjs\ngreen: suite 24/24\n`);
  expect(s.stage).toBe("build");
  expect(s.task).toBe("T005");
  expect(s.autonomy).toBe("auto");
  expect(s.phase).toBe("2/3");
  expect(s.judge).toBe("verifying");
  expect(s.green).toBe("suite 24/24");
});

test("parseState marks an unknown or empty stage as null, and reads an awaited stop", () => {
  expect(parseState("stage: banana").stage).toBe(null);
  expect(parseState("").stage).toBe(null);
  const s = parseState("stage: spec\nawaiting: stop1\n");
  expect(s.stage).toBe("spec");
  expect(s.awaiting).toBe("stop1");
});

test("parseBoard reads task rows, ignoring header and separators", () => {
  const md = ["# Board","| Task | Phase | Status | Covers |","|--|--|--|--|",
    "| T001 | 1 | done | setup |","| T005 | 2 | judging | done command |","| T008 | 3 | parked | import |"].join("\n");
  const b = parseBoard(md);
  expect(b.length).toBe(3);
  expect(b[0].id).toBe("T001");
  expect(b[0].status).toBe("done");
  expect(b[1].status).toBe("judging");
  expect(b[1].label).toBe("done command");
  expect(b[2].status).toBe("parked");
});

test("parseBoard ignores an empty or headers-only board", () => {
  expect(parseBoard("").length).toBe(0);
  expect(parseBoard("| Task | Phase | Status | Covers |\n|--|--|--|--|").length).toBe(0);
});

test("progressBar and statusMark", () => {
  expect(progressBar(5, 8, 8)).toBe("█████░░░");
  expect(statusMark("done").glyph).toBe("✓");
  expect(statusMark("judging").glyph).toBe("◆");
  expect(statusMark("parked").glyph).toBe("⚠");
  expect(statusMark("todo").glyph).toBe("○");
});

test("voyageOf tags stages done/current/todo around the current stage", () => {
  const v = parseVoyage("spec");
  expect(v.map(s => s.state).join("")).toBe("ddctttt"); // interview,prd done · spec current · rest todo
});

test("cmpVersion orders dotted versions", () => {
  expect(cmpVersion("0.1.2","0.1.1")>0).toBe(true);
  expect(cmpVersion("0.1.1","0.1.1")).toBe(0);
  expect(cmpVersion("0.2.0","0.1.9")>0).toBe(true);
  expect(cmpVersion("1.0.0","0.9.9")>0).toBe(true);
});

test("parseEvidence reads one verdict per line and skips everything else", () => {
  const md = [
    "# Evidence",
    "",
    "T005 · PASS   · npm test -- done.test.mjs → exit 0 · suite 24/24 · 2026-10-10",
    "- T007 · FAIL · exit 1",
    "T008 · PARKED · blocked by T007",
    "T009 PASS no separators",
  ].join("\n");
  expect(parseEvidence(md)).toEqual([
    { task: "T005", verdict: "pass", note: "npm test -- done.test.mjs → exit 0 · suite 24/24 · 2026-10-10" },
    { task: "T007", verdict: "fail", note: "exit 1" },
    { task: "T008", verdict: "parked", note: "blocked by T007" },
  ]);
  expect(parseEvidence("")).toEqual([]);
});
