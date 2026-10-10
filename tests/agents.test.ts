import { describe, expect, test } from "claude-code/testing";

import { roleOf, stepOf } from "../hooks/agents.ts";

describe("subagent rows", () => {
  test("stepOf names a step in words", () => {
    expect(stepOf("Read", { file_path: "/a/b/band.tsx" })).toBe("Reading band.tsx");
    expect(stepOf("Bash", { command: "bun test", description: "Run the suite" })).toBe("Run the suite");
    expect(stepOf("Bash", { command: "bun   test" })).toBe("Running bun test");
    expect(stepOf("Grep", { pattern: "TODO" })).toBe('Searching for "TODO"');
    expect(stepOf("WebFetch", {})).toBe("WebFetch");
  });

  test("roleOf tells builder and judge apart", () => {
    expect(roleOf("Judge T004")).toBe("judge");
    expect(roleOf("Build T005: done command")).toBe("builder");
    expect(roleOf("Explore the repo")).toBe("other");
  });
});
