// Own the browser in a separate process so startup can be cancelled through
// Playwright's process signal handlers, before a BrowserServer is available.
import { chromium } from "playwright-core";

let server;
let closing;
const close = () =>
  (closing ||= (async () => {
    if (server) {
      // Keep the owner alive until Playwright has reaped the browser and removed
      // its profiles/artifacts, including on Windows.
      await server.close();
      if (process.connected) process.disconnect();
    } else if (process.platform !== "win32") {
      process.kill(process.pid, "SIGTERM");
    }
  })());
process.on("message", (message) => {
  if (message.action === "close") void close();
});
process.once("message", async (options) => {
  try {
    server = await chromium.launchServer({
      ...options,
      host: "127.0.0.1",
      handleSIGINT: true,
      handleSIGTERM: true,
      handleSIGHUP: true,
    });
    if (!process.connected) {
      await server.kill();
      return;
    }
    process.send({ endpoint: server.wsEndpoint() });
  } catch {
    // Browser startup logs can contain arbitrary executable output. The parent
    // supplies a controlled, actionable diagnostic instead of forwarding it.
    if (process.connected) process.disconnect();
  }
});
process.once("disconnect", () => void close());
