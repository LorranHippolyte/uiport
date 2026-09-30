import { fork, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function startBrowser(chromium, options, life) {
  life?.check();
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "uiport-browser-"));
  const removeTemporary = () =>
    fs.rm(temporary, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  let child;
  try {
    life?.check();
    child = fork(
      fileURLToPath(new URL("./browser-host.mjs", import.meta.url)),
      [],
      {
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: {
          ...process.env,
          TMPDIR: temporary,
          TMP: temporary,
          TEMP: temporary,
        },
      },
    );
  } catch (error) {
    await removeTemporary();
    throw error;
  }
  let closed = false;
  const exited = new Promise((resolve) =>
    child.once("close", () => {
      closed = true;
      resolve();
    }),
  );
  let closing;
  const close = () =>
    (closing ||= (async () => {
      if (closed) {
        await removeTemporary();
        return;
      }
      if (child.connected) child.send({ action: "close" }, () => {});
      let treeKill;
      // A second POSIX signal makes Playwright force-close a browser that ignores
      // graceful shutdown. Its handler owns the browser's separate process group.
      const retry = setTimeout(
        () => {
          if (closed) return;
          if (process.platform === "win32" && child.pid) {
            // Only force the owned tree if cooperative cleanup has not finished.
            const killer = spawn(
              "taskkill",
              ["/pid", String(child.pid), "/t", "/f"],
              { stdio: "ignore", timeout: 1500 },
            );
            treeKill = new Promise((resolve) => {
              killer.once("error", resolve);
              killer.once("close", resolve);
            });
          } else child.kill("SIGTERM");
        },
        process.platform === "win32" ? 1000 : 250,
      );
      const force = setTimeout(
        () => {
          if (!closed) child.kill("SIGKILL");
        },
        process.platform === "win32" ? 3000 : 1500,
      );
      await exited;
      clearTimeout(retry);
      clearTimeout(force);
      await treeKill;
      // The parent owns this directory, so forced startup cancellation can also
      // remove profiles whose child-side cleanup could not finish.
      await removeTemporary();
    })());
  life?.add(close);
  let timeout;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      child.once("error", () =>
        reject(new Error("Browser host could not start")),
      );
      child.once("close", () => reject(new Error("Browser startup failed")));
      child.once("message", (message) => resolve(message.endpoint));
      timeout = setTimeout(() => void close(), options.timeout);
      child.send(options, (error) => {
        if (error) reject(new Error("Browser host could not start"));
      });
    });
    life?.check();
    const browser = await chromium.connect(endpoint, {
      timeout: life?.remaining() ?? options.timeout,
    });
    browser.on("disconnected", () => void close());
    life?.check();
    return { browser, close };
  } catch (error) {
    await close();
    life?.check();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
