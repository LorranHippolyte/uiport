import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
