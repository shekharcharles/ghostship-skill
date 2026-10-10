import { describe, expect, test } from "claude-code/testing";
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

function world(on: any, state: string | null) {
  on("session.start", ($: any, e: any) => ({ cwd: e.cwd }));
  on("command.register", ($: any, e: any) => ({ value: { command: e.name } }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("fs.read", ($: any, e: any) => {
    if (e.path.endsWith("STATE.md") && state !== null) return { value: state };
    return { deny: `ENOENT ${e.path}` };
  });
  on("fs.list", () => ({ value: [] }));
}

describe("the voyage pane body", () => {
  test("a folder with no Ghostship project says so", { options: { autoOpen: false } }, async ($, on) => {
    world(on, null);
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await $.ui.mount({ plugin: "ghostship", surface: "terminal", ...PANE });
    await shows(ui, "No Ghostship project here yet");
  });

  test("a Ghostship project shows its stage", { options: { autoOpen: false } }, async ($, on) => {
    world(on, STATE);
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await $.ui.mount({ plugin: "ghostship", surface: "terminal", ...PANE });
    await shows(ui, "BUILD");
  });
});
