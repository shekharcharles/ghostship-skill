import { describe, expect, test } from "claude-code/testing";

// @ts-ignore: a plain .mjs module beside the skill
import { autonomyOf, convert, unhook } from "../skills/ghostship/scripts/engine-convert.mjs";
import { parseBoard, parseState } from "../hooks/state.ts";

const task = (id: string, status: string, blockedBy: string[] = []) => ({ id, status, blockedBy, title: `task ${id}`, phase: "2-core" });
const STATE = {
  stage: "build",
  prd: { path: "docs/01-requirements/PRD.md", approved: true },
  acceptance: { path: "docs/03-acceptance/ACCEPTANCE-CHECKS.md", approved: true },
  tasks: {
    T001: task("T001", "MERGED"), T002: task("T002", "BUILDING"), T003: task("T003", "RETIRED"),
    T004: task("T004", "TODO", ["T003"]), T005: task("T005", "TODO", ["T004"]), T006: task("T006", "TODO", ["T001"]),
  },
};

describe("moving a project from the engine edition", () => {
  test("the board and state read as this plugin's files, and a retired task's chain is parked with one decision", () => {
    const { files, report } = convert(STATE, "autonomy:\n  mode: auto\n");
    const st = parseState(files["docs/ghostship/STATE.md"]);
    expect(st.stage).toBe("build");
    expect(st.task).toBe("T002");
    expect(st.autonomy).toBe("auto");
    expect(parseBoard(files["docs/ghostship/BOARD.md"]).map(t => `${t.id}:${t.status}`))
      .toEqual(["T001:done", "T002:building", "T003:parked", "T004:parked", "T005:parked", "T006:todo"]);
    expect(files["docs/ghostship/DECISIONS.md"]).toContain("## D1 · T003 was retired");
    expect(files["docs/ghostship/EVIDENCE.md"]).toContain("- T001 · PASS");
    expect(report).toBe("6 tasks: 1 done, 3 parked, 2 to build; stage build; 1 decision for STOP 2");
  });

  test("autonomy defaults to autopilot, and only the engine's hooks leave the settings", () => {
    expect(autonomyOf("autonomy:\n  mode: autopilot\n")).toBe("autopilot");
    expect(autonomyOf("")).toBe("autopilot");
    const settings = {
      hooks: { Stop: [{ hooks: [{ type: "command", command: "node \"$CLAUDE_PROJECT_DIR/.ghostship/core/runtime/hooks/stop.mjs\"" }, { type: "command", command: "echo mine" }] }] },
      statusLine: { type: "command", command: "node .ghostship/core/runtime/hooks/statusline.mjs" },
      model: "opus",
    };
    expect(unhook(settings)).toEqual({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo mine" }] }] }, model: "opus" });
    expect(unhook({ model: "opus" })).toBe(null);
  });
});
