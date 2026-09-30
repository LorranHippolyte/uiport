import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  allowed,
  parseArgs,
  optionsFor,
  parseViewports,
} from "../scripts/options.mjs";
import {
  stageOutput,
  startStaticServer,
  lifecycle,
  launchChromium,
} from "../scripts/lib.mjs";

test("arguments reject unknown, duplicated, missing and non-finite values", () => {
  for (const argv of [
    ["--wat"],
    ["--url"],
    ["--json=true"],
    ["--json", "--json"],
    ["stray"],
  ])
    assert.throws(() => parseArgs(argv, allowed.capture));
  const base = {
    url: "http://localhost:4173/",
    selector: "#hero",
    out: "output",
  };
  for (const url of [
    "file:///tmp/index.html",
    "https://user:password@example.org/",
  ])
    assert.throws(() => optionsFor("capture", { ...base, url }));
  for (const [key, value] of [
    ["timeout", "NaN"],
    ["wait", "Infinity"],
    ["max-resource-mb", "0"],
    ["max-total-mb", "501"],
    ["max-scroll-steps", "1.5"],
    ["port", "2.5"],
    ["max-diff-ratio", "NaN"],
    ["color-scheme", "sepia"],
  ])
    assert.throws(() => optionsFor("capture", { ...base, [key]: value }));
  assert.throws(() => parseViewports("10x20"));
  assert.throws(() => parseViewports("800x600,wat"));
  assert.deepEqual(
    parseViewports("800x600,800x600").map((v) => v.name),
    ["800x600"],
  );
  assert.equal(
    optionsFor(
      "capture",
      parseArgs(
        ["--url=http://localhost", "--selector", "#hero", "--out", "output"],
        allowed.capture,
      ),
    ).selector,
    "#hero",
  );
});

test("staging preserves nonempty destinations and cleans failed temporary output", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "uiport-unit-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const protectedDir = path.join(temp, "protected");
  await fs.mkdir(protectedDir);
  await fs.writeFile(path.join(protectedDir, "keep"), "mine");
  await assert.rejects(stageOutput(protectedDir), /new or empty/);
  await assert.rejects(stageOutput(path.parse(temp).root), /root/);
  const output = path.join(temp, "output");
  const stage = await stageOutput(output);
  await fs.writeFile(path.join(stage.directory, "index.html"), "hello");
  await stage.commit();
  await stage.cleanup();
  assert.equal(
    await fs.readFile(path.join(output, "index.html"), "utf8"),
    "hello",
  );
  assert.equal(
    await fs.readFile(path.join(protectedDir, "keep"), "utf8"),
    "mine",
  );
  const empty = path.join(temp, "empty");
  await fs.mkdir(empty);
  const failed = await stageOutput(empty);
  await failed.cleanup();
  assert.deepEqual(await fs.readdir(empty), []);
  assert.ok(
    !(await fs.readdir(temp)).some((name) => name.startsWith(".uiport-")),
  );
});

test("loopback server rejects traversal, methods, symlink files and directory indexes", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "uiport-server-"));
  const root = path.join(temp, "public");
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, "index.html"), "home");
  await fs.writeFile(path.join(temp, "secret"), "private");
  const server = await startStaticServer(root);
  t.after(async () => {
    await server.close();
    await fs.rm(temp, { recursive: true, force: true });
  });
  assert.equal(await (await fetch(server.url)).text(), "home");
  assert.equal((await fetch(server.url, { method: "POST" })).status, 405);
  assert.notEqual((await fetch(`${server.url}/..%2fsecret`)).status, 200);
  assert.equal((await fetch(`${server.url}/missing`)).status, 404);
  assert.equal((await fetch(server.url, { method: "HEAD" })).status, 200);
  if (process.platform !== "win32") {
    await fs.symlink(path.join(temp, "secret"), path.join(root, "link"));
    await fs.mkdir(path.join(root, "nested"));
    await fs.symlink(
      path.join(temp, "secret"),
      path.join(root, "nested", "index.html"),
    );
    for (const suffix of ["/link", "/nested/"])
      assert.equal((await fetch(server.url + suffix)).status, 403);
  }
});

test("deadline aborts and cleanup also handles late registered resources", async () => {
  let closed = 0;
  const life = lifecycle(10);
  life.add(async () => {
    closed++;
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.throws(() => life.check(), /exceeded/);
  life.add(async () => {
    closed++;
  });
  await life.close();
  assert.equal(closed, 2);
  assert.ok(life.signal.aborted);
});

test("browser failures give actionable instructions", async () => {
  const current = process.env.UIPORT_BROWSER_PATH;
  process.env.UIPORT_BROWSER_PATH = path.join(
    os.tmpdir(),
    "uiport-missing-browser-executable",
  );
  try {
    await assert.rejects(launchChromium({}), /does not exist/);
  } finally {
    if (current === undefined) delete process.env.UIPORT_BROWSER_PATH;
    else process.env.UIPORT_BROWSER_PATH = current;
  }
});
