import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startStaticServer } from "../scripts/lib.mjs";
export const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export function cli(
  args,
  { cwd = project, env = process.env, timeout = 120000 } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(project, "bin/cli.mjs"), ...args],
      { cwd, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`CLI timeout: ${args[0]}`));
    }, timeout);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}
export function result(run) {
  try {
    return JSON.parse(run.stdout);
  } catch {
    throw new Error(`Invalid JSON: ${run.stdout}\n${run.stderr}`);
  }
}

/** Temporary directory removed when the test ends. */
export async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "uiport-test-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  return temp;
}

/** Static loopback server for a fixture directory, closed when the test ends. */
export async function local(t, dir) {
  const server = await startStaticServer(dir);
  t.after(server.close);
  return server;
}

export const captureArgs = (
  url,
  out,
  selector = "#hero",
  views = "800x600",
) => [
  "capture",
  "--url",
  url,
  "--selector",
  selector,
  "--out",
  out,
  "--viewports",
  views,
  "--wait",
  "0",
  "--json",
];

export const validateArgs = (
  url,
  out,
  selector = "#hero",
  views = "800x600",
) => [
  "validate",
  "--url",
  url,
  "--selector",
  selector,
  "--dir",
  out,
  "--viewports",
  views,
  "--wait",
  "0",
  "--json",
];
