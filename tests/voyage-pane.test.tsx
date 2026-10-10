import { describe, expect, mock, test } from "claude-code/testing";
import type { Mounted } from "claude-code/testing";

const STATE = ["stage: build", "phase: 2/3", "autonomy: auto", "active task: T005"].join("\n");

const PANE = {
  component: "Pane" as const,
  requestId: "ghostship-voyage",
  props: { title: "Ghostship", isFocused: false, bodyColumns: 44, placement: "dock" as const, scroll: { offset: 0, bodyRows: 30 }, view: {} },
};

// Passes when a Text shows the text; fails listing what the drawing shows.
async function shows(ui: Pick<Mounted, "findAll">, text: string): Promise<void> {
  const all = (await ui.findAll({ type: "Text" })).map(t => t.text);
  expect(all.some(t => t.includes(text)), `${text} in ${JSON.stringify(all)}`).toBe(true);
}

const BOARD = ["| Task | Phase | Status | Covers |", "|------|-------|--------|--------|", "| T001 | 1 | done | project setup |"].join("\n");

function world(on: any, state: string | null, board: string | null = null, evidence: string | null = null) {
  mock.clock(on);
  on("session.start", ($: any, e: any) => ({ cwd: e.cwd }));
  on("command.register", ($: any, e: any) => ({ value: { command: e.name } }));
  const opened: string[] = [];
  on("ui.open", ($: any, e: any) => { opened.push(e.id); return { value: { isPlaced: true } }; });
  on("fs.read", ($: any, e: any) => {
    if (e.path.endsWith("STATE.md") && state !== null) return { value: state };
    if (e.path.endsWith("BOARD.md") && board !== null) return { value: board };
    if (e.path.endsWith("EVIDENCE.md") && evidence !== null) return { value: evidence };
    if (e.path.endsWith("plugin.json")) return { value: JSON.stringify({ version: "9.9.9" }) };
    return { deny: `ENOENT ${e.path}` };
  });
  on("fs.list", () => ({ value: [] }));
  return { opened };
}

describe("the voyage pane body", () => {
  test("a folder with no Ghostship project says so", { options: { autoOpen: false } }, async ($, on) => {
    world(on, null);
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await $.ui.mount({ plugin: "ghostship", surface: "terminal", ...PANE });
    await shows(ui, "No voyage here yet");
  });

  test("a Ghostship project shows its stage", { options: { autoOpen: false } }, async ($, on) => {
    world(on, STATE);
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await $.ui.mount({ plugin: "ghostship", surface: "terminal", ...PANE });
    await shows(ui, "● Build");
  });

  test("the pane header shows the version loaded", { options: { autoOpen: false } }, async ($, on) => {
    world(on, STATE);
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await $.ui.mount({ plugin: "ghostship", surface: "terminal", ...PANE });
    await shows(ui, "v9.9.9");
  });

  test("the board section opens with a disclosure triangle", { options: { autoOpen: false } }, async ($, on) => {
    world(on, STATE, BOARD);
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await $.ui.mount({ plugin: "ghostship", surface: "terminal", ...PANE });
    const buttons = (await ui.findAll({ type: "Button" })).map((b: any) => JSON.stringify(b));
    expect(buttons.some((l: string) => l.includes("▾ BOARD")), `▾ BOARD in ${JSON.stringify(buttons)}`).toBe(true);
  });

  test("the recorder lists the verdicts in EVIDENCE.md", { options: { autoOpen: false } }, async ($, on) => {
    world(on, STATE, BOARD, "T001 · PASS · exit 0\nT002 · PARKED · blocked by T001\n");
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await $.ui.mount({ plugin: "ghostship", surface: "terminal", ...PANE });
    await shows(ui, "✓ T001");
    await shows(ui, "⚠ T002");
  });

  test("– minimizes the pane, and the session never opens it unasked", { options: { autoOpen: false } }, async ($, on) => {
    const { opened } = world(on, STATE);
    const closed: string[] = [];
    on("ui.close", ($: any, e: any) => { closed.push(e.id); return { value: undefined }; });
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    // Only the cleanup of the Overview pane older versions opened; the Ghostship pane waits to be asked for.
    expect(opened).toEqual([]);
    expect(closed).toEqual(["ghostship-overview"]);

    const ui = await $.ui.mount({ plugin: "ghostship", surface: "terminal", ...PANE });
    await ui.press({ key: "pane-dock" });
    expect(closed).toEqual(["ghostship-overview", "ghostship-voyage"]);
  });
});
