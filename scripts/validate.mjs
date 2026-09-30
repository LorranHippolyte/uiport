import fs from "node:fs/promises";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { chromium } from "playwright-core";
import {
  launchChromium,
  lifecycle,
  log,
  redactedUrl,
  scrollForLazyContent,
  startStaticServer,
  waitForPageStable,
} from "./lib.mjs";
function canvas(width, height) {
  const png = new PNG({ width, height, fill: true });
  png.data.fill(0);
  return png;
}

function copy(source, destination) {
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const sourceIndex = (source.width * y + x) << 2;
      const destinationIndex = (destination.width * y + x) << 2;
      source.data.copy(
        destination.data,
        destinationIndex,
        sourceIndex,
        sourceIndex + 4,
      );
    }
  }
}

export async function validate(options) {
  await fs.access(path.join(options.directory, "index.html"));
  const life = lifecycle(options.timeoutMs);
  const results = [];
  try {
    const server = await startStaticServer(options.directory);
    life.add(server.close);
    life.check();
    const { browser, selected } = await launchChromium(chromium, life);
    life.check();
    for (const viewport of options.viewports) {
      life.check();
      log(`Validating ${viewport.name}…`);
      const settings = {
        viewport,
        deviceScaleFactor: 1,
        locale: options.locale,
        colorScheme: options.colorScheme,
        serviceWorkers: "block",
      };
      // Separate contexts ensure the exported page cannot inherit source cookies/storage.
      const sourceContext = await browser.newContext(settings);
      const localContext = await browser.newContext(settings);
      try {
        const source = await sourceContext.newPage();
        source.setDefaultTimeout(10000);
        await source.goto(options.sourceUrl, {
          waitUntil: "domcontentloaded",
          timeout: Math.min(options.timeoutMs, 60000),
        });
        await waitForPageStable(source, options.settleMs);
        const scrollLimited = await scrollForLazyContent(
          source,
          options.maxScrollSteps,
        );
        await waitForPageStable(source, options.settleMs);
        const root = source.locator(options.selector);
        if ((await root.count()) !== 1)
          throw new Error("Source selector is missing or ambiguous");
        const box = await root.boundingBox();
        if (!box || box.width * box.height > 20_000_000)
          throw new Error(
            "Source section is empty or exceeds the 20 megapixel screenshot limit",
          );
        const sourceBuffer = await root.screenshot({
          animations: "disabled",
          caret: "hide",
        });
        const externalRequests = [],
          failedRequests = [],
          errors = [];
        await localContext.route("**/*", async (route) => {
          const url = new URL(route.request().url());
          if (
            ["http:", "https:"].includes(url.protocol) &&
            url.origin !== server.url
          ) {
            if (externalRequests.length < 100)
              externalRequests.push(redactedUrl(url.href));
            if (!options.allowExternal) {
              await route.abort();
              return;
            }
          }
          await route.continue();
        });
        const local = await localContext.newPage();
        local.setDefaultTimeout(10000);
        local.on("pageerror", () => {
          if (errors.length < 100)
            errors.push("Exported page raised a JavaScript error");
        });
        local.on("console", (message) => {
          if (message.type() === "error" && errors.length < 100)
            errors.push("Exported page logged an error");
        });
        local.on("requestfailed", (request) => {
          if (failedRequests.length < 100)
            failedRequests.push(redactedUrl(request.url()));
        });
        local.on("response", (response) => {
          if (response.status() >= 400 && failedRequests.length < 100)
            failedRequests.push(redactedUrl(response.url()));
        });
        await local.goto(`${server.url}/index.html`, {
          waitUntil: "domcontentloaded",
        });
        await waitForPageStable(local, options.settleMs);
        const localRoot = local.locator('[data-uiport-root="true"]');
        if ((await localRoot.count()) !== 1)
          throw new Error("UIport extraction root is missing or ambiguous");
        const localBox = await localRoot.boundingBox();
        if (!localBox || localBox.width * localBox.height > 20_000_000)
          throw new Error("Exported section exceeds screenshot limit");
        const localBuffer = await localRoot.screenshot({
          animations: "disabled",
          caret: "hide",
        });
        const sourcePng = PNG.sync.read(sourceBuffer),
          localPng = PNG.sync.read(localBuffer);
        const width = Math.max(sourcePng.width, localPng.width),
          height = Math.max(sourcePng.height, localPng.height);
        if (width * height > 20_000_000)
          throw new Error("Comparison exceeds screenshot limit");
        const left = canvas(width, height),
          right = canvas(width, height);
        copy(sourcePng, left);
        copy(localPng, right);
        const differentPixels = pixelmatch(
          left.data,
          right.data,
          null,
          width,
          height,
          { threshold: 0.1, includeAA: false },
        );
        const differenceRatio = differentPixels / (width * height);
        const dimensionsMatch =
          sourcePng.width === localPng.width &&
          Math.abs(sourcePng.height - localPng.height) <= 5;
        const visualPass =
          dimensionsMatch && differenceRatio <= options.maximumDifferenceRatio;
        const networkPass =
          failedRequests.length === 0 &&
          (options.allowExternal || externalRequests.length === 0);
        const captureLimitations = (await local
          .locator("#uiport-metadata")
          .count())
          ? await local
              .locator("#uiport-metadata")
              .evaluate((el) => JSON.parse(el.textContent).limitations)
          : [];
        results.push({
          viewport: viewport.name,
          pass: visualPass && networkPass && !errors.length && !scrollLimited,
          visual: {
            pass: visualPass,
            dimensionsMatch,
            differentPixels,
            differenceRatio,
            maximumDifferenceRatio: options.maximumDifferenceRatio,
            animations: "disabled",
          },
          network: {
            pass: networkPass,
            externalRequests,
            failedRequests,
            externalBlocked: !options.allowExternal,
          },
          behavior: "not-tested",
          captureLimitations,
          errors,
          scrollLimited,
        });
      } finally {
        await sourceContext.close();
        await localContext.close();
      }
    }
    life.check();
    return {
      command: "validate",
      status: results.every((r) => r.pass) ? "complete" : "failed",
      browser: { selected, version: browser.version() },
      behavior: "not-tested",
      results,
    };
  } finally {
    await life.close();
  }
}
