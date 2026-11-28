import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { parseFragment, serialize } from "parse5";
import { extractSection, measureRoot } from "./dom.mjs";
import { parseSrcsetAttribute } from "./srcset.mjs";
import { resources } from "./resources.mjs";
import { browserResources } from "./browser-resources.mjs";
import { contextualCss } from "./css-context.mjs";
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
    const { browser, selected, close } = await launchChromium(chromium, life);
    life.check();
    const context = await browser.newContext({
      viewport: viewports[0],
      deviceScaleFactor: 1,
      locale,
      colorScheme,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const cache = browserResources(page, options, life.signal);
    life.add(async () => cache.dispose());
    stage = await stageOutput(options.directory);
    await fs.mkdir(path.join(stage.directory, "assets"));
    const assets = resources(
      stage.directory,
      options,
      life.signal,
      limitations,
      cache,
    );
    let cssContext;
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
      // A root that does not render is reported instead of waiting for a
      // screenshot that can never succeed.
      const rendered = await page.evaluate(measureRoot, { selector });
      if (!rendered.visible)
        limitation(
          limitations,
          "SECTION_NOT_VISIBLE",
          `The selected root is not visible at ${viewport.name}; its markup is exported but renders empty`,
        );
      else if (rendered.width <= 0 || rendered.height <= 0)
        limitation(
          limitations,
          "SECTION_EMPTY_AREA",
          `The selected root has no rendered size at ${viewport.name}; its markup is exported but renders empty`,
        );
      else await root.scrollIntoViewIfNeeded();
      const snapshot = await page.evaluate(extractSection, {
        selector,
        omitScripts: options.omitScripts,
      });
      captures.push(snapshot);
      await cache.settle();
      if (!cssContext) {
        const cssParts = [];
        for (const sheet of snapshot.stylesheets.filter((s) => !s.disabled)) {
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
          cssParts.push(
            sheet.media ? `@media ${sheet.media} {\n${css}\n}` : css,
          );
        }
        cssContext = contextualCss(cssParts);
      }
      await cssContext.observe(page, snapshot);
    }
    await cache.settle();
    await close();
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
        options.omitScripts
          ? "SOURCE_RUNTIME_OMITTED"
          : "SOURCE_RUNTIME_UNVERIFIED",
        options.omitScripts
          ? "Source scripts and executable attributes are omitted by request"
          : "Source scripts and inline handlers are retained where captured; external initialization and runtime dependencies still require manual validation",
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
    const parts = cssContext.render();
    const ancestorOpen = primary.ancestors
      .map((a) => `<${a.tag}${serializeAttributes(a.attributes)}>`)
      .join("\n");
    const ancestorClose = [...primary.ancestors]
      .reverse()
      .map((a) => `</${a.tag}>`)
      .join("\n");
    const fragment = parseFragment(ancestorOpen + primary.html + ancestorClose);
    const runtimeHtml = primary.runtimeScripts
      .map((script) => {
        const attrs = [
          { name: "src", value: script.src },
          ...(script.type ? [{ name: "type", value: script.type }] : []),
          ...(script.async ? [{ name: "async", value: "" }] : []),
          ...(script.defer ? [{ name: "defer", value: "" }] : []),
          ...(script.noModule ? [{ name: "nomodule", value: "" }] : []),
        ];
        return `<script${serializeAttributes(attrs)}></script>`;
      })
      .join("\n");
    const head = parseFragment(runtimeHtml + primary.headHtml);
    // Every referenced resource is localized concurrently and the document is
    // assembled once all of them are known. The download pool inside the
    // resource layer bounds how many transfers run at the same time.
    const pending = [];
    const localizeSrcset = async (value) => {
      const parsed = parseSrcsetAttribute(value);
      if (!parsed.length && value.trim()) {
        // An unparsable descriptor list is preserved unchanged: dropping it
        // would silently change which image the browser picks.
        limitation(
          limitations,
          "SRCSET_INVALID",
          "A srcset attribute could not be parsed and was preserved unchanged",
        );
        return value;
      }
      const candidates = [];
      for (const item of parsed)
        candidates.push(
          `${await assets.localize(item.url, primary.baseUrl)}${item.w ? ` ${item.w}w` : item.d ? ` ${item.d}x` : ""}`,
        );
      return candidates.join(", ");
    };
    function rewrite(node) {
      if (node.attrs) {
        for (const attr of node.attrs) {
          if (
            ["src", "poster", "data-src", "data-background-image"].includes(
              attr.name,
            ) ||
            (["use", "image"].includes(node.tagName) &&
              ["href", "xlink:href"].includes(attr.name))
          ) {
            const original = attr.value;
            pending.push(
              assets
                .localize(
                  original,
                  primary.baseUrl,
                  node.tagName === "script" && attr.name === "src"
                    ? "script"
                    : undefined,
                )
                .then((value) => {
                  attr.value = value;
                }),
            );
          }
          if (attr.name === "srcset") {
            const original = attr.value;
            pending.push(
              localizeSrcset(original).then((value) => {
                attr.value = value;
              }),
            );
          }
          if (attr.name === "style") {
            const original = attr.value;
            pending.push(
              assets.cssValue(original, primary.baseUrl).then((value) => {
                attr.value = value;
              }),
            );
          }
        }
      }
      if (node.tagName === "style")
        for (const child of node.childNodes || [])
          if (child.nodeName === "#text") {
            const original = child.value;
            pending.push(
              assets.css(original, primary.baseUrl).then((value) => {
                child.value = value;
              }),
            );
          }
      for (const child of node.childNodes || []) rewrite(child);
      if (node.content) rewrite(node.content);
    }
    rewrite(fragment);
    rewrite(head);
    rewrite({ attrs: primary.htmlAttributes });
    rewrite({ attrs: primary.bodyAttributes });
    // Every pending localization settles before the document is assembled. A
    // cancellation must not leave sibling rejections unhandled.
    const settled = await Promise.allSettled(pending);
    const failure = settled.find((entry) => entry.status === "rejected");
    if (failure) throw failure.reason;
    // Resources are localized concurrently, so the order in which problems
    // are observed is not stable. Sorting keeps the reported result
    // reproducible from one run to the next.
    limitations.sort((a, b) =>
      a.code === b.code
        ? a.message.localeCompare(b.message)
        : a.code.localeCompare(b.code),
    );
    // Context-dependent custom properties retain their original conditions;
    // ordinary inherited/responsive variables are never frozen to one viewport.
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
<title>${escapeHtml(primary.title || "UIport — extracted section")}</title>
<style>${parts.join("\n").replaceAll("</style", "<\\/style")}</style>
${serialize(head)}
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
