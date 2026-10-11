import { describe, expect, test } from "claude-code/testing";

import { orphans, reaches, scanFile, sitemapMarkdown } from "../scripts/sitemap-rules.mjs";

describe("the sitemap finds routes and links in the code", () => {
  test("routes from Express, Flask, FastAPI and React Router are found with their lines", () => {
    const express = scanFile("server.js", "app.get('/orders/:id', h)\nrouter.post(\"/login\", h)");
    expect(express.routes.map(r => [r.route, r.line])).toEqual([["/orders/:id", 1], ["/login", 2]]);
    const flask = scanFile("app.py", "@app.route('/search')\ndef s(): pass");
    expect(flask.routes[0]).toMatchObject({ route: "/search", line: 1 });
    const fast = scanFile("api.py", "@router.get('/items')");
    expect(fast.routes[0]!.route).toBe("/items");
    const rr = scanFile("App.tsx", '<Route path="/settings" element={<S/>} />');
    expect(rr.routes[0]!.route).toBe("/settings");
  });

  test("links from href, to and navigate are found", () => {
    const { links } = scanFile("nav.tsx", '<a href="/orders">o</a>\n<Link to="/settings/">s</Link>\nnavigate("/login")');
    expect(links.map(l => l.target)).toEqual(["/orders", "/settings/", "/login"]);
  });

  test("a route nothing links to is an orphan; the root and API routes are not", () => {
    const routes = [{ route: "/", file: "a", line: 1 }, { route: "/orders", file: "a", line: 2 }, { route: "/reports", file: "a", line: 3 }, { route: "/api/x", file: "a", line: 4 }];
    const links = [{ target: "/orders/", file: "nav", line: 1 }];
    expect(orphans(routes, links).map(r => r.route)).toEqual(["/reports"]);
    const md = sitemapMarkdown(routes, links);
    expect(md).toContain("## Orphans (1)");
    expect(md).toContain("`/orders` | a:2 | nav:1");
  });
});

describe("the sitemap does not double count and reads every link on a line", () => {
  test("a Flask route on one line is one route; two links on one line are both found", () => {
    expect(scanFile("app.py", "@app.route('/search')").routes).toHaveLength(1);
    const { links } = scanFile("i.html", '<a href="/orders/1">o</a> <a href="/login">s</a>');
    expect(links.map(l => l.target)).toEqual(["/orders/1", "/login"]);
  });
  test("a link with a value fits a parameterised route", () => {
    expect(reaches("/orders/:id", "/orders/1")).toBe(true);
    expect(reaches("/orders/:id", "/orders")).toBe(false);
    expect(reaches("/login", "/login/")).toBe(true);
  });
});

