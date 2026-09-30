import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startStaticServer } from "../scripts/lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "uiport-package-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
async function run(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
    shell: process.platform === "win32" && command === npm,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (c) => (stdout += c));
  child.stderr.on("data", (c) => (stderr += c));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(code, 0, `${command} ${args.join(" ")}\n${stdout}\n${stderr}`);
  return stdout;
}
let server;
try {
  const [pack] = JSON.parse(
    await run(npm, ["pack", "--json", "--pack-destination", temporary], root),
  );
  assert.ok(pack.size < 2_000_000, `Unexpected tarball size: ${pack.size}`);
  for (const { path: file } of pack.files) {
    assert.match(
      file,
      /^(bin\/cli\.mjs|scripts\/[a-z-]+\.mjs|examples\/(responsive-hero|css-motion)\/(index\.html|section\.svg)|skills\/uiport\/SKILL\.md|docs\/(support\.md|architecture\.md|demo\.png)|package\.json|README(?:\.pt-BR)?\.md|(?:CONTRIBUTING|SECURITY|CODE_OF_CONDUCT|GOVERNANCE|CHANGELOG)\.md|LICENSE|NOTICE)$/,
    );
    assert.doesNotMatch(
      file,
      /node_modules|\.context|extractions|\.env|package-lock/,
    );
  }
  const consumer = path.join(temporary, "consumer");
  await fs.mkdir(consumer);
  await run(
    npm,
    [
      "install",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      path.join(temporary, pack.filename),
    ],
    consumer,
  );
  const installed = path.join(consumer, "node_modules", "uiport");
  const cli = path.join(installed, "bin", "cli.mjs");
  assert.match(
    await run(process.execPath, [cli, "--help"], consumer),
    /UIport/,
  );
  assert.equal(
    (
      await run(
        npm,
        ["exec", "--offline", "--", "uiport", "--version"],
        consumer,
      )
    ).trim(),
    "0.1.0",
  );
  server = await startStaticServer(
    path.join(installed, "examples", "responsive-hero"),
  );
  const out = path.join(consumer, "capture");
  const common = [
    "--url",
    server.url,
    "--selector",
    "#hero",
    "--viewports",
    "800x600",
    "--wait",
    "0",
    "--json",
  ];
  const captured = JSON.parse(
    await run(
      process.execPath,
      [cli, "capture", ...common, "--out", out],
      consumer,
    ),
  );
  assert.equal(captured.status, "complete");
  const validated = JSON.parse(
    await run(
      process.execPath,
      [cli, "validate", ...common, "--dir", out],
      consumer,
    ),
  );
  assert.equal(validated.status, "complete");
  const globalPrefix = path.join(temporary, "global");
  await run(
    npm,
    [
      "install",
      "--global",
      "--prefix",
      globalPrefix,
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      path.join(temporary, pack.filename),
    ],
    temporary,
  );
  const globalCli = path.join(
    globalPrefix,
    process.platform === "win32" ? "node_modules" : "lib/node_modules",
    "uiport",
    "bin",
    "cli.mjs",
  );
  assert.equal(
    (await run(process.execPath, [globalCli, "--version"], temporary)).trim(),
    "0.1.0",
  );
  console.log(
    `Tarball verified: ${pack.files.length} allowlisted files, ${pack.size} bytes; local/global install, npm exec, capture and offline validation passed outside the checkout.`,
  );
} finally {
  await server?.close();
  await fs.rm(temporary, { recursive: true, force: true });
}
