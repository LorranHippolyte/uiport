import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import http from "node:http";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { startBrowser } from "./browser-process.mjs";

export const sha256 = (buffer) =>
  crypto.createHash("sha256").update(buffer).digest("hex");
export const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export const serializeAttributes = (attributes) =>
  attributes
    .map(
      ({ name, value }) =>
        ` ${name}="${escapeHtml(value).replaceAll("'", "&#39;")}"`,
    )
    .join("");
export const jsonForInlineScript = (value) =>
  JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
export function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}
export function redactedUrl(value) {
  try {
    const u = new URL(value);
    u.username = "";
    u.password = "";
    u.search = "";
    u.hash = "";
    return u.href;
  } catch {
    return "(invalid URL)";
  }
}
export function safeErrorMessage(error) {
  // Keep the useful first line, excluding Playwright's verbose call log and
  // source snippets. Redact every URL, not just the originally requested one.
  return String(error?.message || "Operation failed")
    .split(/[\r\n]/, 1)[0]
    .replace(/https?:\/\/[^\s<>"'`]+/gi, (url) => redactedUrl(url));
}
export function limitation(list, code, message) {
  if (!list.some((item) => item.code === code && item.message === message))
    list.push({ code, message });
}
export const log = (message) => process.stderr.write(`${message}\n`);

export function extensionFor(url, contentType = "") {
  const mime = contentType.split(";")[0].toLowerCase();
  const extension = new Map([
    ["text/css", ".css"],
    ["text/javascript", ".js"],
    ["application/javascript", ".js"],
    ["application/ecmascript", ".js"],
    ["text/ecmascript", ".js"],
    ["image/svg+xml", ".svg"],
    ["image/png", ".png"],
    ["image/jpeg", ".jpg"],
    ["image/webp", ".webp"],
    ["image/avif", ".avif"],
    ["image/gif", ".gif"],
    ["font/woff2", ".woff2"],
    ["font/woff", ".woff"],
    ["font/ttf", ".ttf"],
    ["font/otf", ".otf"],
    ["video/mp4", ".mp4"],
    ["video/webm", ".webm"],
  ]).get(mime);
  if (extension) return extension;
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : ".bin";
}

export async function inspectOutput(directory) {
  const destination = path.resolve(directory);
  if (destination === path.parse(destination).root)
    throw new Error("Refusing a filesystem root as output");
  let existing = false;
  try {
    const stat = await fs.lstat(destination);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (await fs.readdir(destination)).length
    )
      throw new Error(
        "Output must be a new or empty directory (not a symlink)",
      );
    existing = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return { destination, existing };
}

/** Stage alongside the destination; never delete or overwrite a user's existing output. */
export async function stageOutput(directory) {
  const { destination, existing } = await inspectOutput(directory);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = await fs.mkdtemp(
    path.join(path.dirname(destination), ".uiport-"),
  );
  let committed = false;
  return {
    directory: temporary,
    async commit() {
      // Recheck immediately before moving. Exclusive mkdir prevents replacing a concurrent output.
      if (existing) await fs.rmdir(destination); // only succeeds when still empty
      await fs.mkdir(destination);
      const moved = [];
      try {
        for (const name of await fs.readdir(temporary)) {
          await fs.rename(
            path.join(temporary, name),
            path.join(destination, name),
          );
          moved.push(name);
        }
        committed = true;
      } catch (error) {
        for (const name of moved)
          await fs
            .rename(path.join(destination, name), path.join(temporary, name))
            .catch(() => {});
        await fs.rmdir(destination).catch(() => {});
        throw error;
      }
    },
    async cleanup() {
      await fs.rm(temporary, { recursive: true, force: true });
      if (existing && !committed)
        await fs.mkdir(destination, { recursive: true });
    },
  };
}

export async function waitForPageStable(page, settleMs) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 2000 }).catch(() => {});
  await page.evaluate(async () => {
    await Promise.race([
      Promise.all([
        document.fonts?.ready,
        ...[...document.images].map((img) => img.decode?.().catch(() => {})),
      ]),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  });
  await page.waitForTimeout(settleMs);
}

export async function scrollForLazyContent(page, maxSteps = 80) {
  return page.evaluate(async (maxSteps) => {
    const root = document.scrollingElement || document.documentElement;
    const step = Math.max(240, Math.floor(innerHeight * 0.7));
    let position = 0,
      count = 0;
    while (position < root.scrollHeight && count < maxSteps) {
      root.scrollTo(0, position);
      await new Promise((resolve) => setTimeout(resolve, 30));
      position += step;
      count++;
    }
    const truncated = position < root.scrollHeight;
    root.scrollTo(0, 0);
    return truncated;
  }, maxSteps);
}

export function mimeForFile(filePath) {
  return (
    new Map([
      [".html", "text/html; charset=utf-8"],
      [".css", "text/css; charset=utf-8"],
      [".js", "text/javascript"],
      [".mjs", "text/javascript"],
      [".svg", "image/svg+xml"],
      [".png", "image/png"],
      [".jpg", "image/jpeg"],
      [".jpeg", "image/jpeg"],
      [".webp", "image/webp"],
      [".avif", "image/avif"],
      [".gif", "image/gif"],
      [".woff2", "font/woff2"],
      [".woff", "font/woff"],
      [".ttf", "font/ttf"],
      [".mp4", "video/mp4"],
      [".webm", "video/webm"],
      [".json", "application/json"],
      [".wasm", "application/wasm"],
    ]).get(path.extname(filePath).toLowerCase()) || "application/octet-stream"
  );
}
const within = (root, file) => {
  const relative = path.relative(root, file);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};
export async function startStaticServer(rootDirectory, requestedPort = 0) {
  const root = await fs.realpath(rootDirectory);
  if (!(await fs.stat(root)).isDirectory())
    throw new Error("Server root must be a directory");
  const server = http.createServer(async (request, response) => {
    try {
      if (!["GET", "HEAD"].includes(request.method)) {
        response.writeHead(405).end();
        return;
      }
      const pathname = decodeURIComponent(
        new URL(request.url || "/", "http://localhost").pathname,
      );
      if (pathname === "/favicon.ico") {
        response.writeHead(204).end();
        return;
      }
      let file = path.resolve(root, `.${pathname}`);
      if (!within(root, file)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      file = await fs.realpath(file);
      if ((await fs.stat(file)).isDirectory())
        file = await fs.realpath(path.join(file, "index.html"));
      if (!within(root, file)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      if (!(await fs.stat(file)).isFile()) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "Content-Type": mimeForFile(file),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      if (request.method === "HEAD") response.end();
      else {
        const stream = fsSync.createReadStream(file);
        stream.on("error", () => response.destroy());
        stream.pipe(response);
      }
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}

export async function launchChromium(chromium, life) {
  const override = process.env.UIPORT_BROWSER_PATH;
  const launch = (options) =>
    startBrowser(
      chromium,
      {
        headless: true,
        ...options,
        timeout: life?.remaining() ?? 30000,
      },
      life,
    );
  if (override) {
    if (!fsSync.existsSync(override))
      throw new Error("UIPORT_BROWSER_PATH does not exist");
    return {
      ...(await launch({ executablePath: override }).catch((error) => {
        life?.check();
        throw new Error(
          "Could not start UIPORT_BROWSER_PATH; check the executable or run: uiport browser install",
          { cause: error },
        );
      })),
      selected: "explicit path",
    };
  }
  for (const channel of [undefined, "chrome", "msedge"]) {
    life?.check();
    try {
      return {
        ...(await launch(channel ? { channel } : {})),
        selected: channel || "Playwright Chromium",
      };
    } catch {
      life?.check();
      /* try next installed browser */
    }
  }
  throw new Error(
    "No supported browser found. Run: uiport browser install (or set UIPORT_BROWSER_PATH).",
  );
}

/** Tracks resources so timeouts and SIGINT/SIGTERM also close failed runs. */
export function lifecycle(timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  const controller = new AbortController();
  const cleanups = [];
  let reason;
  let cleanupPromise;
  const cleanup = () =>
    (cleanupPromise ||= (async () => {
      for (const fn of [...cleanups].reverse()) await fn().catch(() => {});
    })());
  const cancel = (message) => {
    reason ||= new Error(message);
    controller.abort(reason);
    void cleanup();
  };
  const interrupt = () => cancel("Operation cancelled");
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const timer = setTimeout(
    () => cancel(`Operation exceeded ${timeoutMs} ms`),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    add(fn) {
      cleanups.push(fn);
      if (controller.signal.aborted) void fn().catch(() => {});
    },
    check() {
      if (!reason && performance.now() >= deadline)
        cancel(`Operation exceeded ${timeoutMs} ms`);
      if (reason) throw reason;
    },
    remaining() {
      this.check();
      return Math.max(1, Math.ceil(deadline - performance.now()));
    },
    async close() {
      clearTimeout(timer);
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
      await cleanup();
    },
  };
}
