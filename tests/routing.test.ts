import { describe, expect, test } from "claude-code/testing";

import { DEFAULT_ROUTING, cleanRouting, modelFor, roleOf } from "../hooks/routing.ts";

describe("which model each subagent runs on", () => {
  test("search and reading go to the cheapest model, building and judging to the middle one", () => {
    expect(roleOf("Explore", undefined, "find the band")).toBe("grunt");
    expect(roleOf("general-purpose", "builder T005", "build T005")).toBe("builder");
    expect(roleOf("general-purpose", "judge T005", "judge T005")).toBe("judge");
    expect(roleOf("general-purpose", undefined, "judge the gate")).toBe("judge");
    expect(modelFor(DEFAULT_ROUTING, "grunt")).toBe("claude-haiku-5-5");
    expect(modelFor(DEFAULT_ROUTING, "builder")).toBe("claude-sonnet-5-5");
    expect(modelFor(DEFAULT_ROUTING, "judge")).toBe("claude-sonnet-5-5");
  });

  test("a routing the user set is kept; anything unknown falls back to the default for its role", () => {
    expect(cleanRouting({ grunt: "sonnet", builder: "opus", judge: "opus" })).toEqual({ grunt: "sonnet", builder: "opus", judge: "opus" });
    expect(cleanRouting({ grunt: "gpt" })).toEqual(DEFAULT_ROUTING);
    expect(cleanRouting(undefined)).toEqual(DEFAULT_ROUTING);
  });
});
