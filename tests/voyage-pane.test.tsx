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
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("fs.read", ($: any, e: any) => {
    if (e.path.endsWith("STATE.md") && state !== null) return { value: state };
    if (e.path.endsWith("BOARD.md") && board !== null) return { value: board };
    if (e.path.endsWith("EVIDENCE.md") && evidence !== null) return { value: evidence };
    if (e.path.endsWith("plugin.json")) return { value: JSON.stringify({ version: "9.9.9" }) };
    return { deny: `ENOENT ${e.path}` };
  });
  on("fs.list", () => ({ value: [] }));
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

  test("– docks the pane into the band and ✕ closes it, and each is remembered", { options: { autoOpen: false } }, async ($, on) => {
    world(on, STATE);
    const closed: string[] = [];
    const store = new Map<string, unknown>();
    on("ui.close", ($: any, e: any) => { closed.push(e.id); return { value: undefined }; });
    on("store.get", ($: any, e: any) => ({ value: store.get(e.key) }));
    on("store.set", ($: any, e: any) => { store.set(e.key, e.value); return { value: undefined }; });
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await $.ui.mount({ plugin: "ghostship", surface: "terminal", ...PANE });

    await ui.press({ key: "pane-dock" });
    expect(store.get("pane")).toBe("docked");
    expect(closed).toEqual(["ghostship-voyage"]);

    await ui.press({ key: "pane-close" });
    expect(store.get("pane")).toBe("closed");
  });
});
