import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cli, project, result } from "./helpers.mjs";
import {
  lifecycle,
  launchChromium,
  safeErrorMessage,
} from "../scripts/lib.mjs";

test(
  "browser installation preserves download failures and JSON output",
  { timeout: 30000 },
  async (t) => {
    const temp = await fs.mkdtemp(
      path.join(os.tmpdir(), "uiport-install-failure-"),
    );
    t.after(() => fs.rm(temp, { recursive: true, force: true }));
    let requests = 0;
    const server = createServer((_request, response) => {
      requests++;
      response.writeHead(503).end("Installer test: download unavailable");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    for (const json of [false, true]) {
      const run = await cli(
        ["browser", "install", ...(json ? ["--json"] : [])],
        {
          cwd: temp,
          env: {
            ...process.env,
            PLAYWRIGHT_BROWSERS_PATH: path.join(temp, "browsers"),
            PLAYWRIGHT_DOWNLOAD_HOST: `http://127.0.0.1:${server.address().port}`,
            PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST: `http://127.0.0.1:${server.address().port}`,
          },
          timeout: 12000,
        },
      );
      assert.equal(run.code, 1, run.stdout + run.stderr);
      assert.match(run.stderr, /503/);
      assert.doesNotMatch(
        run.stdout + run.stderr,
        /Chromium installation complete/,
      );
      if (json)
        assert.deepEqual(result(run), { command: "browser", status: "failed" });
    }
    assert.ok(requests > 0);
  },
);

test("operational messages redact every URL and omit verbose call logs", () => {
  const error = new Error(
    "page.goto: failed at https://user:password@example.test/page?token=DUMMY_QUERY#DUMMY_FRAGMENT and http://example.test/next?key=DUMMY_OTHER\nCall log:\n - navigating with private source content",
  );
  const message = safeErrorMessage(error);
  assert.equal(
    message,
    "page.goto: failed at https://example.test/page and http://example.test/next",
  );
});

test(
  "navigation errors do not expose URL queries or fragments in JSON or text",
  { timeout: 20000 },
  async (t) => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "uiport-errors-"));
    t.after(() => fs.rm(temp, { recursive: true, force: true }));
    for (const json of [true, false]) {
      const run = await cli([
        "capture",
        "--url",
        "http://127.0.0.1:1/?token=DUMMY_QUERY#DUMMY_FRAGMENT",
        "--selector",
        "#hero",
        "--out",
        path.join(temp, "out"),
        ...(json ? ["--json"] : []),
      ]);
      assert.equal(run.code, 1, run.stdout + run.stderr);
      assert.doesNotMatch(run.stdout + run.stderr, /DUMMY_|token=|Call log:/);
      assert.match(json ? result(run).error.message : run.stderr, /page.goto/);
    }
  },
);

test("an already cancelled operation does not start a browser or try fallback", async () => {
  const life = lifecycle(1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  try {
    await assert.rejects(launchChromium({}, life), /exceeded/);
  } finally {
    await life.close();
  }
});

async function slowBrowser(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "uiport-startup-"));
  const executable = path.join(temp, "slow-browser");
  const pidFile = path.join(temp, "pid");
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  await fs.writeFile(
    executable,
    `#!/bin/sh\necho $$ > ${quote(pidFile)}\nsleep 30 &\necho $! > ${quote(pidFile + ".child")}\nwait\n`,
    { mode: 0o755 },
  );
  t.after(async () => {
    try {
      process.kill(-Number(await fs.readFile(pidFile, "utf8")), "SIGKILL");
    } catch {
      /* already terminated */
    }
    await fs.rm(temp, { recursive: true, force: true });
  });
  return { temp, executable, pidFile };
}

async function waitForPid(pidFile) {
  for (let i = 0; i < 200; i++) {
    try {
      return Number(await fs.readFile(pidFile, "utf8"));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error("Fake browser never started");
}

for (const command of ["capture", "validate"])
  test(
    `${command} deadline terminates the browser while it is starting`,
    {
      timeout: 15000,
      skip:
        process.platform === "win32" && "Synthetic executable uses POSIX shell",
    },
    async (t) => {
      const { temp, executable, pidFile } = await slowBrowser(t);
      await fs.writeFile(
        path.join(temp, "index.html"),
        '<main data-uiport-root="true"></main>',
      );
      const start = Date.now();
      const run = await cli(
        [
          command,
          "--url",
          "http://127.0.0.1:1/",
          "--selector",
          "#hero",
          command === "capture" ? "--out" : "--dir",
          command === "capture" ? path.join(temp, "out") : temp,
          "--timeout",
          "1000",
          "--json",
        ],
        { env: { ...process.env, UIPORT_BROWSER_PATH: executable } },
      );
      assert.equal(run.code, 1, run.stdout + run.stderr);
      assert.match(result(run).error.message, /exceeded/);
      assert.ok(
        Date.now() - start < 5000,
        "Operation must not wait for the 30-second fake browser",
      );
      const pid = await waitForPid(pidFile);
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      await assert.rejects(fs.access(path.join(temp, "out")));
    },
  );

for (const signal of ["SIGTERM", "SIGINT"])
  test(
    `${signal} cancels startup and terminates the owned browser`,
    {
      timeout: 15000,
      skip:
        process.platform === "win32" &&
        "Windows does not deliver POSIX signals",
    },
    async (t) => {
      const { temp, executable, pidFile } = await slowBrowser(t);
      const child = spawn(
        process.execPath,
        [
          path.join(project, "bin/cli.mjs"),
          "capture",
          "--url",
          "http://127.0.0.1:1/",
          "--selector",
          "#hero",
          "--out",
          path.join(temp, "out"),
          "--timeout",
          "60000",
          "--json",
        ],
        {
          env: { ...process.env, UIPORT_BROWSER_PATH: executable },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      t.after(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      });
      let stdout = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      const done = new Promise((resolve) => child.once("close", resolve));
      const pid = await waitForPid(pidFile);
      const start = Date.now();
      child.kill(signal);
      assert.equal(await done, 1);
      assert.match(JSON.parse(stdout).error.message, /cancelled/);
      assert.ok(Date.now() - start < 5000);
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    },
  );
