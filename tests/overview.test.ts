import { test, expect } from "claude-code/testing";
import { appIdentity, appEntries, featuresOf } from "../hooks/overview";
import { parseBoard } from "../hooks/state";

test("appIdentity reads the name and description from package.json", () => {
  const pkg = JSON.stringify({ name: "shop", description: "A small shop" });
  expect(appIdentity(pkg, "# Other Title")).toEqual({ name: "shop", about: "A small shop" });
});

test("appIdentity falls back to the README title when there is no usable package.json", () => {
  expect(appIdentity(null, "# Notes\n\ntext")).toEqual({ name: "Notes", about: "text" });
  expect(appIdentity("not json", "# Notes")).toEqual({ name: "Notes", about: null });
  expect(appIdentity(null, null)).toEqual({ name: null, about: null });
});

test("appIdentity takes the README's opening line as the description when package.json has none", () => {
  const readme = [
    '<p align="center"><img src="x.png"></p>',
    "# Shop",
    "",
    "![badge](b.svg)",
    "> A **tiny** shop for [Acme](https://acme.dev) teams.",
    "",
    "More text.",
  ].join("\n");
  expect(appIdentity(JSON.stringify({ name: "shop" }), readme)).toEqual({ name: "shop", about: "A tiny shop for Acme teams." });
  expect(appIdentity(JSON.stringify({ name: "shop", description: "From pkg" }), readme).about).toBe("From pkg");
});

test("featuresOf groups board tasks into built, building and planned", () => {
  const tasks = parseBoard([
    "| Task | Phase | Status | Covers |",
    "|--|--|--|--|",
    "| T001 | 1 | done | setup |",
    "| T002 | 1 | done | add |",
    "| T003 | 2 | judging | store |",
    "| T004 | 2 | todo | clear |",
    "| T005 | 3 | parked | import |",
  ].join("\n"));
  const f = featuresOf(tasks);
  expect(f.built).toEqual(["setup", "add"]);
  expect(f.active).toEqual(["store"]);
  expect(f.planned).toEqual(["clear"]);
});

test("appEntries lists folders first, hides dotfiles and node_modules", () => {
  const out = appEntries([
    { name: "README.md", kind: "file" },
    { name: "src", kind: "dir" },
    { name: ".git", kind: "dir" },
    { name: "node_modules", kind: "dir" },
    { name: "docs", kind: "dir" },
  ]);
  expect(out.map(e => e.name)).toEqual(["docs", "src", "README.md"]);
  expect(out[0].isDir).toBe(true);
});
