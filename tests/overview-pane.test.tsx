import { describe, expect, mock, test } from "claude-code/testing";
import type { Mounted } from "claude-code/testing";

const STATE = ["stage: build", "phase: 2/3", "autonomy: auto", "active task: T005"].join("\n");
const BOARD = [
  "| Task | Phase | Status | Covers |",
  "|--|--|--|--|",
  "| T001 | 1 | done | setup |",
  "| T005 | 2 | judging | store |",
].join("\n");

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

describe("the pane shows the app", () => {
  test("shows the app name, the stage, what is built and the files", { options: { autoOpen: false } }, async ($, on) => {
    mock.clock(on);
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("command.register", ($, e) => ({ value: { command: e.name } }));
    on("ui.open", () => ({ value: { isPlaced: true } }));
    on("fs.read", ($, e) => {
      if (e.path.endsWith("STATE.md")) return { value: STATE };
      if (e.path.endsWith("BOARD.md")) return { value: BOARD };
      if (e.path.endsWith("package.json")) return { value: JSON.stringify({ name: "shop", description: "A small shop" }) };
      return { deny: `ENOENT ${e.path}` };
    });
    on("fs.list", () => ({
      value: [
        { name: "src", kind: "dir", size: 0, mtimeMs: 0, isLink: false },
        { name: "package.json", kind: "file", size: 10, mtimeMs: 0, isLink: false },
      ],
    }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });

    const ui = await $.ui.mount({ plugin: "ghostship", surface: "terminal", ...PANE });
    await shows(ui, "shop");
    await shows(ui, "A small shop");
    await shows(ui, "G H O S T S H I P");
    await shows(ui, "● Build");
    await shows(ui, "1/2 tasks · 50%");
    await ui.press({ key: "tab-plan" });
    await shows(ui, "setup");
    await shows(ui, "store");
    await ui.press({ key: "tab-files" });
    await shows(ui, "2 at the top level");
  });
});

describe("the pane outside a Ghostship project", () => {
  test("shows the banner, the README pitch and no voyage yet", { options: { autoOpen: false } }, async ($, on) => {
    mock.clock(on);
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("command.register", ($, e) => ({ value: { command: e.name } }));
    on("ui.open", () => ({ value: { isPlaced: true } }));
    on("fs.read", ($, e) => {
      if (e.path.endsWith("README.md")) return { value: "# Shop\n\nA tiny shop for teams.\n" };
      if (e.path.endsWith("plugin.json")) return { value: JSON.stringify({ version: "9.9.9" }) };
      return { deny: `ENOENT ${e.path}` };
    });
    on("fs.list", () => ({ value: [] }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });

    const ui = await $.ui.mount({ plugin: "ghostship", surface: "terminal", ...PANE });
    await shows(ui, "v9.9.9");
    await shows(ui, "Shop");
    await shows(ui, "A tiny shop for teams.");
    await shows(ui, "No Ghostship project in this folder yet");
  });
});
