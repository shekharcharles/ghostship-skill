import { describe, expect, mock, test } from "claude-code/testing";

const BOARD = "| Task | Phase | Status | Covers |\n|--|--|--|--|\n| T001 | 1 | done | setup |\n| T002 | 1 | todo | add command |\n";
const DONE_BOARD = "| Task | Phase | Status | Covers |\n|--|--|--|--|\n| T001 | 1 | done | setup |\n| T002 | 1 | parked | add command |\n";

// The engine's side: STATE.md and BOARD.md as given, and a record of the tool calls that got past the plugin.
function world(on: any, state: string, board: string) {
  mock.clock(on);
  const reached: string[] = [];
  on("session.start", (_$: any, e: any) => ({ cwd: e.cwd }));
  on("command.register", (_$: any, e: any) => ({ value: { command: e.name } }));
  on("fs.read", (_$: any, e: any) => {
    if (e.path.endsWith("STATE.md")) return { value: state };
    if (e.path.endsWith("BOARD.md")) return { value: board };
    return { deny: `ENOENT ${e.path}` };
  });
  on("fs.list", () => ({ value: [] }));
  on("tool.call", (_$: any, e: any) => { reached.push(e.tool); return { result: { answers: {} } }; });
  on("classic.Stop", () => ({}));
  on("ui.toast", () => ({ value: undefined }));
  on("ui.status", () => ({ value: undefined }));
  return { reached };
}

const START = { surface: "terminal" as const, isInteractive: true, cwd: "/work" };

describe("the build is never stalled on the owner", () => {
  test("during the build, a question to the owner is refused with the way to park it", {}, async ($, on) => {
    const w = world(on, "stage: build\nautonomy: autopilot\n", BOARD);
    await $.session.start(START);
    const r: any = await ($ as any).tool.call({ tool: "AskUserQuestion", questions: [] });
    expect(w.reached).not.toContain("AskUserQuestion");
    expect(JSON.stringify(r)).toContain("DECISIONS.md");
  });

  test("before STOP 1, and at a stop that waits on the owner, questions go through", {}, async ($, on) => {
    const w = world(on, "stage: spec\nawaiting: STOP 1 — approve the spec\n", BOARD);
    await $.session.start(START);
    await ($ as any).tool.call({ tool: "AskUserQuestion", questions: [] });
    expect(w.reached).toContain("AskUserQuestion");
  });

  test("a turn that ends with tasks left is sent back, at most three times without progress", {}, async ($, on) => {
    world(on, "stage: build\n", BOARD);
    await $.session.start(START);
    const stops: any[] = [];
    for (let i = 0; i < 4; i++) stops.push(await ($ as any).classic.Stop({ stop_hook_active: i > 0 }));
    expect(String(stops[0].block)).toContain("T002");
    expect(stops[1].block).toBeTruthy();
    expect(stops[2].block).toBeTruthy();
    expect(stops[3].block).toBeUndefined();
  });

  test("once every task is done or parked, the turn may end", {}, async ($, on) => {
    world(on, "stage: build\n", DONE_BOARD);
    await $.session.start(START);
    const stop: any = await ($ as any).classic.Stop({ stop_hook_active: false });
    expect(stop.block).toBeUndefined();
  });
});
