import { describe, expect, test } from "claude-code/testing";

import { riskyDelete } from "../hooks/guard.ts";

describe("destructive deletes are refused, so the build never stops to ask", () => {
  test("a recursive or forced delete with a wildcard, variable, root or parent target is refused", () => {
    expect(riskyDelete("cd /tmp/x && rm -rf * && cp -r src .")).toMatch(/"\*"/);
    expect(riskyDelete("rm -rf $HOME/cache")).toMatch(/\$HOME/);
    expect(riskyDelete("rm -fr /")).toMatch(/"\/"/);
    expect(riskyDelete("rm -rf ~")).toMatch(/"~"/);
    expect(riskyDelete("rm -rf ..")).toMatch(/"\.\."/);
  });

  test("named deletes and everything else run", () => {
    expect(riskyDelete("rm -rf node_modules dist")).toBe(null);
    expect(riskyDelete("rm build/out.log")).toBe(null);
    expect(riskyDelete("npm test && ls -la")).toBe(null);
    expect(riskyDelete("git status --short")).toBe(null);
  });
});
