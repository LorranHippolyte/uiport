import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { parseFragment, serialize } from "parse5";
import parseSrcset from "parse-srcset";
import { extractSection } from "./dom.mjs";
import { resources } from "./resources.mjs";
import {
  inspectOutput,
  stageOutput,
  escapeHtml,
  jsonForInlineScript,
  launchChromium,
  limitation,
  lifecycle,
  log,
  redactedUrl,
  scrollForLazyContent,
  serializeAttributes,
  waitForPageStable,
} from "./lib.mjs";

export async function capture(options) {
  const { sourceUrl, selector, viewports, settleMs, locale, colorScheme } =
    options;
  await inspectOutput(options.directory);
  const life = lifecycle(options.timeoutMs);
  const limitations = [];
  const captures = [];
  let stage;
  try {
    const { browser, selected } = await launchChromium(chromium);
    life.add(() => browser.close());
    life.check();
    const context = await browser.newContext({
      viewport: viewports[0],
      deviceScaleFactor: 1,
      locale,
      colorScheme,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(Math.min(10000, options.timeoutMs));
    page.on("pageerror", () =>
      limitation(
        limitations,
        "SOURCE_SCRIPT_ERROR",
        "The source page raised a JavaScript error",
      ),
    );
    // Keep diagnostics bounded and omit URL queries, page content and form values.
    page.on("requestfailed", () =>
      limitation(
        limitations,
        "SOURCE_REQUEST_FAILED",
        "At least one source request failed",
      ),
    );
    for (const viewport of viewports) {
      life.check();
      log(`Capturing ${viewport.name}…`);
      await page.setViewportSize(viewport);
      await page.goto(sourceUrl, {
        waitUntil: "domcontentloaded",
        timeout: Math.min(60000, options.timeoutMs),
      });
      await waitForPageStable(page, settleMs);
      if (await scrollForLazyContent(page, options.maxScrollSteps))
        limitation(
          limitations,
          "SCROLL_LIMIT",
          "Lazy-loading scroll reached its configured limit",
        );
      await waitForPageStable(page, settleMs);
      const root = page.locator(selector);
      const count = await root.count();
      if (count !== 1)
        throw new Error(
          `Selector must resolve to exactly one element; found ${count}`,
        );
      await root.scrollIntoViewIfNeeded();
      captures.push(await page.evaluate(extractSection, selector));
    }
    await browser.close();
    life.check();
    const primary = captures[0];
    if (captures.some((c) => c.structure !== primary.structure))
      limitation(
        limitations,
        "RESPONSIVE_DOM_CHANGED",
        "The element structure changes across viewports; output uses the first DOM",
      );
    if (captures.some((c) => c.sourceScripts || c.removedExecutable))
      limitation(
        limitations,
        "SOURCE_RUNTIME_OMITTED",
        "Source scripts and executable attributes are omitted; JavaScript interactions require manual review",
      );
    if (captures.some((c) => c.featureCounts.canvas))
      limitation(
        limitations,
        "CANVAS_STATIC",
        "Canvas is captured only as an observed static frame when readable",
      );
    if (captures.some((c) => c.canvasFailures))
      limitation(
        limitations,
        "CANVAS_UNREADABLE",
        "At least one canvas frame could not be read",
      );
    if (captures.some((c) => c.featureCounts.iframe))
      limitation(
        limitations,
        "EMBED_OMITTED",
        "Embedded documents are disabled in the output",
      );
    stage = await stageOutput(options.directory);
    await fs.mkdir(path.join(stage.directory, "assets"));
    const assets = resources(
      stage.directory,
      options,
      life.signal,
      limitations,
    );
    const parts = [];
    for (const sheet of primary.stylesheets.filter((s) => !s.disabled)) {
      life.check();
      const resource =
        sheet.text === null && sheet.href
          ? await assets.download(sheet.href)
          : null;
      const text = sheet.text ?? resource?.body.toString("utf8");
      if (text == null) {
        limitation(
          limitations,
          "STYLESHEET_UNAVAILABLE",
          "An original stylesheet could not be read",
        );
        continue;
      }
      const css = await assets.css(text, resource?.url || sheet.baseUrl);
      parts.push(sheet.media ? `@media ${sheet.media} {\n${css}\n}` : css);
    }
    const ancestorOpen = primary.ancestors
      .map((a) => `<${a.tag}${serializeAttributes(a.attributes)}>`)
      .join("\n");
    const ancestorClose = [...primary.ancestors]
      .reverse()
      .map((a) => `</${a.tag}>`)
      .join("\n");
    const fragment = parseFragment(ancestorOpen + primary.html + ancestorClose);
    async function rewrite(node) {
      if (node.attrs) {
        for (const attr of node.attrs) {
          if (
            ["src", "poster", "data-src", "data-background-image"].includes(
              attr.name,
            ) ||
            (["use", "image"].includes(node.tagName) &&
              ["href", "xlink:href"].includes(attr.name))
          )
            attr.value = await assets.localize(attr.value, primary.baseUrl);
          if (attr.name === "srcset") {
            const candidates = [];
            for (const item of parseSrcset(attr.value))
              candidates.push(
                `${await assets.localize(item.url, primary.baseUrl)}${item.w ? ` ${item.w}w` : item.d ? ` ${item.d}x` : ""}`,
              );
            attr.value = candidates.join(", ");
          }
          if (attr.name === "style")
            attr.value = await assets.cssValue(attr.value, primary.baseUrl);
        }
      }
      if (node.tagName === "style")
        for (const child of node.childNodes || [])
          if (child.nodeName === "#text")
            child.value = await assets.css(child.value, primary.baseUrl);
      for (const child of node.childNodes || []) await rewrite(child);
      if (node.content) await rewrite(node.content);
    }
    await rewrite(fragment);
    await rewrite({ attrs: primary.htmlAttributes });
    await rewrite({ attrs: primary.bodyAttributes });
    // Keep custom properties in their original rules so media queries can override them.
    const animations = primary.animations.filter(
      (a) =>
        a.kind === "Animation" &&
        a.targetId &&
        a.keyframes?.length &&
        (!a.timeline || a.timeline === "DocumentTimeline"),
    );
    if (
      primary.animations.some(
        (a) => a.kind === "Animation" && !animations.includes(a),
      )
    )
      limitation(
        limitations,
        "ANIMATION_UNSUPPORTED",
        "Some observed animations cannot be replayed on DocumentTimeline",
      );
    const metadata = {
      limitations,
      behavior: "not-tested",
      source: redactedUrl(sourceUrl),
    };
    const html = `<!doctype html>
<html lang="${escapeHtml(locale)}"${serializeAttributes(primary.htmlAttributes)}>
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>UIport — extracted section</title>
<style>${parts.join("\n").replaceAll("</style", "<\\/style")}</style>
</head>
<body${serializeAttributes(primary.bodyAttributes)}>
${serialize(fragment)}
<script type="application/json" id="uiport-metadata">${jsonForInlineScript(metadata)}</script>
<script type="application/json" id="uiport-animations">${jsonForInlineScript(animations)}</script>
<script>
(() => {
  const find = (id, root = document) => {
    const direct = root.querySelector('[data-uiport-id="' + CSS.escape(id) + '"]');
    if (direct) return direct;
    for (const element of root.querySelectorAll('*')) if (element.shadowRoot) { const found = find(id, element.shadowRoot); if (found) return found; }
    return null;
  };
  for (const record of JSON.parse(document.getElementById('uiport-animations').textContent)) {
    const target = find(record.targetId);
    if (!target) continue;
    try {
      const timing = { ...record.timing, iterations: record.timing.iterations === 'Infinity' ? Infinity : record.timing.iterations };
      if (record.pseudoElement) timing.pseudoElement = record.pseudoElement;
      const animation = new Animation(new KeyframeEffect(target, record.keyframes, timing), document.timeline);
      animation.playbackRate = record.playbackRate ?? 1;
      animation.play();
      if (record.currentTime != null) animation.currentTime = record.currentTime;
      if (record.playState === 'paused') animation.pause();
    } catch (error) { console.error('UIport animation replay failed:', error.message); }
  }
  document.addEventListener('submit', event => event.preventDefault(), true);
})();
</script>
</body></html>`;
    life.check();
    await fs.writeFile(path.join(stage.directory, "index.html"), html);
    life.check();
    await stage.commit();
    return {
      command: "capture",
      status: limitations.length ? "partial" : "complete",
      outputDirectory: options.directory,
      browser: { selected, version: browser.version() },
      ...assets.stats(),
      elements: primary.featureCounts.elements,
      animationsReplayed: animations.length,
      behavior: "not-tested",
      limitations,
    };
  } finally {
    await life.close();
    await stage?.cleanup();
  }
}
