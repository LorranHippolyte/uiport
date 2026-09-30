import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { resources } from "../scripts/resources.mjs";
import { optionsFor } from "../scripts/options.mjs";

async function setup(t, handler, overrides = {}) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "uiport-resources-"),
  );
  await fs.mkdir(path.join(directory, "assets"));
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    await fs.rm(directory, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const options = optionsFor("capture", {
    url,
    selector: "#hero",
    out: directory,
    ...overrides,
  });
  const controller = new AbortController();
  const limitations = [];
  return {
    directory,
    url,
    controller,
    limitations,
    assets: resources(directory, options, controller.signal, limitations),
  };
}

test("streaming export enforces size budgets without content-length and redacts URL queries", async (t) => {
  const fixture = await setup(
    t,
    (_req, res) => {
      res.writeHead(200, { "content-type": "image/svg+xml" });
      res.write("x".repeat(3000));
      res.end();
    },
    { "max-resource-mb": "0.001" },
  );
  const { assets, url, limitations, directory } = fixture;
  const original = `${url}/large.svg?private=value`;
  assert.equal(await assets.localize(original, url), original);
  assert.equal(assets.stats().assets, 0);
  assert.deepEqual(await fs.readdir(path.join(directory, "assets")), []);
  assert.ok(limitations.some((entry) => entry.code === "RESOURCE_UNAVAILABLE"));
  assert.doesNotMatch(JSON.stringify(limitations), /private|value/);
});

test("total export budget counts multiple resources and repeated URLs reuse downloaded bytes", async (t) => {
  let requests = 0;
  const { assets, url, limitations } = await setup(
    t,
    (_req, res) => {
      requests++;
      res.writeHead(200, { "content-type": "image/svg+xml" });
      res.end("x".repeat(700));
    },
    { "max-total-mb": "0.001" },
  );
  const first = await assets.localize(`${url}/one.svg#shape`, url);
  assert.match(first, /^\.\/assets\/.*\.svg#shape$/);
  assert.equal(
    await assets.localize(`${url}/one.svg#other`, url),
    first.replace("#shape", "#other"),
  );
  assert.equal(requests, 1);
  assert.equal(await assets.localize(`${url}/two.svg`, url), `${url}/two.svg`);
  assert.ok(limitations.length);
  assert.equal(assets.stats().assets, 1);
});

test("CSS import cycles terminate with a limitation and imported URLs keep their own base", async (t) => {
  const { assets, url, limitations, directory } = await setup(t, (req, res) => {
    if (req.url === "/nested/a.css") {
      res.setHeader("content-type", "text/css");
      res.end('@import "a.css"; .tile{background:url(tile.svg#shape)}');
    } else if (req.url === "/nested/tile.svg") {
      res.setHeader("content-type", "image/svg+xml");
      res.end('<svg xmlns="http://www.w3.org/2000/svg"/>');
    } else res.writeHead(404).end();
  });
  const css = await assets.css(
    '@import "nested/a.css" layer(example) supports(display:grid) screen;',
    `${url}/index.html`,
  );
  assert.doesNotMatch(css, /@import/);
  assert.match(css, /@layer example/);
  assert.match(css, /@supports \(display:grid\)/);
  assert.match(css, /@media screen/);
  assert.match(css, /\.\/assets\/.*\.svg#shape/);
  assert.ok(limitations.some((entry) => entry.code === "CSS_IMPORT_CYCLE"));
  assert.equal((await fs.readdir(path.join(directory, "assets"))).length, 1);
});

test("an aborted download propagates cancellation rather than emitting partial success", async (t) => {
  const { assets, url, controller, limitations } = await setup(t, (_req, res) =>
    res.end("content"),
  );
  controller.abort(new Error("test cancellation"));
  await assert.rejects(
    assets.localize(`${url}/image.svg`, url),
    /test cancellation/,
  );
  assert.deepEqual(limitations, []);
});
