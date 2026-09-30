import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
for (const dir of ["bin", "scripts", "tools", "test"])
  for (const file of await fs.readdir(dir))
    if (file.endsWith(".mjs")) {
      const result = spawnSync(
        process.execPath,
        ["--check", path.join(dir, file)],
        { encoding: "utf8" },
      );
      if (result.status) {
        process.stderr.write(result.stderr);
        process.exit(1);
      }
    }
console.log(
  "All ESM entrypoints pass syntax validation; no transpilation required.",
);
