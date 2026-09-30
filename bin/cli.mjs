#!/usr/bin/env node
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
import { allowed, parseArgs, optionsFor } from "../scripts/options.mjs";
import { safeErrorMessage } from "../scripts/lib.mjs";
const require = createRequire(import.meta.url);
const { version } = require("../package.json");
const argv = process.argv.slice(2);
const json = argv.includes("--json");
const command = argv[0];
const help = `UIport ${version} — bring a web section into your next project.

Usage:
  uiport capture --url URL --selector CSS --out DIRECTORY [options]
  uiport validate --url URL --selector CSS --dir DIRECTORY [options]
  uiport serve --dir DIRECTORY [--port 4173] [--json]
  uiport browser install

Capture / validate:
  --viewports 1440x900,1024x768,768x1024,375x812
  --wait 1200                 Settle time per navigation (ms, 0–60000)
  --timeout 120000            Whole operation deadline (ms, 1000–600000)
  --max-scroll-steps 80       Bounded lazy-loading scroll (1–1000)
  --locale en-US              Browser locale
  --color-scheme light        light | dark
  --json                     One JSON result on stdout; progress on stderr
Capture:
  --max-resource-mb 20        Maximum copied resource size (0.001–100 MiB)
  --max-total-mb 100          Total resource download budget (0.001–500 MiB)
Validate:
  --max-diff-ratio 0.02       Maximum differing pixels (0–1)
  --allow-external            Allow remote requests; result is not an offline check

Exit codes: capture 0 = complete, 2 = partial, 1 = error.
Validate 0 = requested visual/network checks passed, 1 = failed.
Visual checks do not certify behavior. Use pages you own or have permission to reuse.
Browser installation is explicit. Set UIPORT_BROWSER_PATH to choose an executable.
--help and --version work without a browser. Documentation: https://github.com/LorranHippolyte/uiport
`;
try {
  if (!command || command === "--help")
    console.log(
      json ? JSON.stringify({ command: "help", version, help }) : help,
    );
  else if (command === "--version")
    console.log(json ? JSON.stringify({ version }) : version);
  else {
    if (!Object.hasOwn(allowed, command))
      throw new Error(`Unknown command: ${command}`);
    const args = parseArgs(
      argv.slice(command === "browser" && argv[1] === "install" ? 2 : 1),
      allowed[command],
    );
    if (args.help)
      console.log(args.json ? JSON.stringify({ command, help }) : help);
    else if (args.version)
      console.log(args.json ? JSON.stringify({ version }) : version);
    else if (command === "browser") {
      if (argv[1] !== "install")
        throw new Error("Usage: uiport browser install");
      const child = spawn(
        process.execPath,
        [
          path.join(
            path.dirname(require.resolve("playwright-core/package.json")),
            "cli.js",
          ),
          "install",
          "chromium",
        ],
        { stdio: ["inherit", json ? "pipe" : "inherit", "inherit"] },
      );
      if (json) child.stdout.pipe(process.stderr);
      const stop = () => child.kill("SIGTERM");
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      const code = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => resolve(code ?? 1));
      });
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      if (json)
        console.log(
          JSON.stringify({
            command: "browser",
            status: code === 0 ? "complete" : "failed",
          }),
        );
      process.exitCode = Number(code);
    } else {
      const options = optionsFor(command, args);
      const { [command]: run } = await import(`../scripts/${command}.mjs`);
      const result = await run(options);
      if (command !== "serve")
        console.log(JSON.stringify(result, null, args.json ? undefined : 2));
      process.exitCode =
        result.status === "partial" ? 2 : result.status === "failed" ? 1 : 0;
    }
  }
} catch (error) {
  if (json)
    console.log(
      JSON.stringify({
        command: Object.hasOwn(allowed, command) ? command : "help",
        status: "failed",
        error: { code: "OPERATION_FAILED", message: safeErrorMessage(error) },
      }),
    );
  else process.stderr.write(`UIport: ${safeErrorMessage(error)}\n`);
  process.exitCode = 1;
}
