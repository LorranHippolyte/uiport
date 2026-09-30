import { fork, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export async function startBrowser(chromium, options, life) {
  life?.check();
  const child = fork(
    fileURLToPath(new URL("./browser-host.mjs", import.meta.url)),
    [],
    {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
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
      if (closed) return;
      if (process.platform === "win32") {
        // Windows signals terminate the host without running JS handlers. Kill
        // only this owned process tree, including a browser still starting up.
        if (child.pid) {
          const killer = spawn(
            "taskkill",
            ["/pid", String(child.pid), "/t", "/f"],
            { stdio: "ignore" },
          );
          await new Promise((resolve) => {
            killer.once("error", resolve);
            killer.once("close", resolve);
          });
        }
      } else {
        child.kill("SIGTERM");
      }
      // A second POSIX signal makes Playwright force-close a browser that ignores
      // graceful shutdown. Its handler owns the browser's separate process group.
      const retry = setTimeout(() => {
        if (!closed && process.platform !== "win32") child.kill("SIGTERM");
      }, 250);
      const force = setTimeout(() => {
        if (!closed) child.kill("SIGKILL");
      }, 1500);
      await exited;
      clearTimeout(retry);
      clearTimeout(force);
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
