import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { startStaticServer, launchChromium } from "../scripts/lib.mjs";
import { optionsFor } from "../scripts/options.mjs";
import { capture } from "../scripts/capture.mjs";
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "uiport-demo-"));
const root = path.resolve(import.meta.dirname, "..");
let source, local, browser, closeBrowser;
try {
  source = await startStaticServer(path.join(root, "examples/responsive-hero"));
  const output = path.join(temp, "output");
  const result = await capture(
    optionsFor("capture", {
      url: source.url,
      selector: "#hero",
      out: output,
      viewports: "1440x900,375x812",
      wait: "0",
    }),
  );
  if (result.status !== "complete")
    throw new Error("Demo capture has limitations");
  local = await startStaticServer(output);
  ({ browser, close: closeBrowser } = await launchChromium(chromium));
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    recordVideo: { dir: temp, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();
  await page.goto(local.url);
  await page.locator("img").evaluate((img) => img.decode());
  await page.screenshot({
    path: path.join(root, "docs/demo.png"),
    fullPage: true,
  });
  await page.waitForTimeout(1000);
  await page.locator(".button").hover();
  await page.waitForTimeout(1000);
  await page.setViewportSize({ width: 768, height: 900 });
  await page.waitForTimeout(1000);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(1000);
  await page.locator(".art").scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);
  const video = page.video();
  await context.close();
  await video.saveAs(path.join(root, "docs/demo.webm"));
  console.log(
    "Generated docs/demo.png and docs/demo.webm from a real UIport extraction.",
  );
} finally {
  await closeBrowser?.();
  await local?.close();
  await source?.close();
  await fs.rm(temp, { recursive: true, force: true });
}
