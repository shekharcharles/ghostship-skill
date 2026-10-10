import { describe, expect, test } from "claude-code/testing";

import { activityOf, partialArgsOf, thoughtOf, wordsAdded } from "../hooks/activity.ts";

describe("what the model is doing, in words (from What's Agent Doing)", () => {
  test("the thought shows its latest sentence, with the one before when the current has barely started", () => {
    expect(thoughtOf("First I read the file. Then I check the test", 70)).toBe("First I read the file. Then I check the test");
    expect(thoughtOf("First I read the file. Then I", 70)).toBe("First I read the file. Then I");
    expect(thoughtOf("", 70)).toBe("");
    expect(thoughtOf("a".repeat(200), 20).length).toBe(20);
  });

  test("words are counted once as they stream in, across chunk boundaries", () => {
    const first = wordsAdded("hello wor", false);
    expect(first).toEqual({ added: 2, isInWord: true });
    expect(wordsAdded("ld again", first.isInWord)).toEqual({ added: 1, isInWord: true });
  });

  test("a tool call is named by what it does, from its arguments as far as they have streamed", () => {
    expect(activityOf("Read", { file_path: "/a/b/band.tsx" })).toBe("Reading band.tsx");
    expect(activityOf("Bash", { description: "Run the tests", command: "npm test" })).toBe("Run the tests");
    expect(activityOf("Bash", { command: "npm test" })).toBe("Running npm test");
    expect(activityOf("Grep", { pattern: "stepOf" })).toBe('Searching for "stepOf"');
    expect(activityOf("mcp__github__list_prs", {})).toBe("Using github: list_prs");
    expect(partialArgsOf('{"file_path": "/x/y.ts", "old_st')).toEqual({ file_path: "/x/y.ts" });
  });
});
