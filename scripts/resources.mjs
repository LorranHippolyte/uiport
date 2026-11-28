// @ts-check
import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import valueParser from "postcss-value-parser";
import {
  extensionFor,
  normalizeUrl,
  sha256,
  redactedUrl,
  safeErrorMessage,
  limitation,
} from "./lib.mjs";

/** @param {string} directory @param {import('./options.mjs').optionsFor extends (...args: any[]) => infer T ? T : never} options @param {AbortSignal} signal @param {{code:string,message:string}[]} limitations @param {{get:(url:string)=>Promise<any>} | undefined} [browserCache] */
export function resources(
  directory,
  options,
  signal,
  limitations,
  browserCache,
) {
  // A pending download is stored as its promise so that concurrent requests
  // for the same URL share one transfer.
  const downloaded = new Map();
  const localized = new Map();
  const written = new Map();
  let consumed = 0;
  const localPaths = new Set();
  const maxConcurrentDownloads = 8;
  let activeDownloads = 0;
  const waitingDownloads = [];
  // Bytes received from the network count against the total budget as they
  // arrive. The check and the reservation happen in the same synchronous step,
  // so concurrent transfers cannot pass the limit together.
  function consume(bytes) {
    if (consumed + bytes > options.maxTotalBytes)
      throw new Error("Resource size limit exceeded");
    consumed += bytes;
  }
  async function acquireDownloadSlot() {
    if (activeDownloads < maxConcurrentDownloads) {
      activeDownloads++;
      return;
    }
    await new Promise((resolve) => waitingDownloads.push(resolve));
  }
  function releaseDownloadSlot() {
    const next = waitingDownloads.shift();
    if (next) next();
    else activeDownloads--;
  }
  /** @param {string} input */
  async function download(input) {
    const url = normalizeUrl(input);
    if (downloaded.has(url)) return downloaded.get(url);
    if (!/^https?:/i.test(url)) return null;
    const pending = (async () => {
      let response;
      try {
        if (consumed >= options.maxTotalBytes)
          throw new Error("Total resource budget exceeded");
        const cached = await browserCache?.get(url);
        if (cached) {
          if (cached.body.length > options.maxResourceBytes)
            throw new Error("Resource size limit exceeded");
          consume(cached.body.length);
          return cached;
        }
        await acquireDownloadSlot();
        try {
          response = await fetch(url, {
            signal: AbortSignal.any([
              signal,
              AbortSignal.timeout(Math.min(options.timeoutMs, 15000)),
            ]),
            headers: { "user-agent": "UIport/0.1" },
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const length = Number(response.headers.get("content-length") || 0);
          if (
            length > options.maxResourceBytes ||
            length + consumed > options.maxTotalBytes
          )
            throw new Error("Resource size limit exceeded");
          const chunks = [];
          let size = 0;
          for await (const chunk of /** @type {any} */ (response.body)) {
            size += chunk.length;
            consume(chunk.length);
            if (size > options.maxResourceBytes)
              throw new Error("Resource size limit exceeded");
            chunks.push(chunk);
          }
          const resource = {
            body: Buffer.concat(chunks),
            contentType: response.headers.get("content-type") || "",
            url: response.url || url,
          };
          return resource;
        } finally {
          releaseDownloadSlot();
        }
      } catch (error) {
        signal.throwIfAborted();
        limitation(
          limitations,
          "RESOURCE_UNAVAILABLE",
          `${redactedUrl(url)}: ${safeErrorMessage(error)}`,
        );
        return null;
      } finally {
        if (response?.body && !response.body.locked)
          await response.body.cancel().catch(() => {});
      }
    })();
    downloaded.set(url, pending);
    return pending;
  }
  /** @param {string} raw @param {string} base @param {string} [usage] */
  async function localize(raw, base, usage) {
    if (!raw || /^(data:|#)/i.test(raw)) return raw;
    // The usage decides the file extension, so it belongs to the key.
    const key = `${base}|${raw}|${usage || ""}`;
    if (localized.has(key)) return localized.get(key);
    const pending = localizeResource(raw, base, usage);
    localized.set(key, pending);
    return pending;
  }
  /** @param {string} raw @param {string} base @param {string} [usage] */
  async function localizeResource(raw, base, usage) {
    if (localPaths.has(raw.split("#")[0].replace(/^\.\//, ""))) return raw;
    let url;
    try {
      url = new URL(raw, base);
    } catch {
      limitation(
        limitations,
        "INVALID_RESOURCE_URL",
        "A resource URL could not be resolved",
      );
      return raw;
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      limitation(
        limitations,
        "RESOURCE_UNAVAILABLE",
        `Unsupported resource protocol: ${url.protocol}`,
      );
      return raw;
    }
    const resource = await download(url.href);
    if (!resource) return url.href;
    let extension = extensionFor(resource.url, resource.contentType);
    if (
      extension === ".bin" &&
      (usage === "script" || resource.resourceType === "script")
    )
      extension = ".js";
    const file = `assets/${sha256(resource.body).slice(0, 24)}${extension}`;
    // Two different URLs can carry the same bytes and therefore the same file
    // name. One shared write keeps the file intact, and every caller waits
    // for that write before the export is assembled.
    if (!written.has(file))
      written.set(
        file,
        fs.writeFile(path.join(directory, file), resource.body),
      );
    await written.get(file);
    localPaths.add(file);
    return `./${file}${url.hash}`;
  }
  /** @param {string} value @param {string} base */
  async function cssValue(value, base) {
    // Most declarations carry no URL at all: parsing them is wasted work.
    if (!/url\(|image-set\(/i.test(value)) return value;
    const parsed = valueParser(value);
    const nodes = [];
    parsed.walk((node) => {
      if (node.type === "function" && node.value.toLowerCase() === "url") {
        nodes.push(node);
        return false;
      }
      if (
        node.type === "function" &&
        ["image-set", "-webkit-image-set"].includes(node.value.toLowerCase())
      ) {
        // Only direct string candidates are URLs. Strings nested in type()
        // describe MIME types and must remain untouched.
        for (const candidate of node.nodes)
          if (candidate.type === "string") nodes.push(candidate);
      }
    });
    for (const node of nodes) {
      const raw =
        node.type === "string" ? node.value : node.nodes[0]?.value || "";
      const localized = await localize(raw, base);
      if (node.type === "string")
        node.value = localized.replaceAll(
          node.quote,
          node.quote === '"' ? "%22" : "%27",
        );
      else
        node.nodes = [
          {
            type: "string",
            quote: '"',
            value: localized.replaceAll('"', "%22"),
          },
        ];
    }
    return parsed.toString();
  }
  /** @param {string} text @param {string} base @param {Set<string>} [stack] */
  async function css(text, base, stack = new Set()) {
    const root = postcss.parse(text, { from: undefined });
    const declarations = [];
    root.walkDecls((decl) => {
      declarations.push(decl);
    });
    const imports = [];
    root.walkAtRules(/^import$/i, (rule) => {
      imports.push(rule);
    });
    for (const rule of imports) {
      const parsed = valueParser(rule.params);
      const first = parsed.nodes.find(
        (n) => n.type !== "space" && n.type !== "comment",
      );
      const raw =
        first?.type === "string"
          ? first.value
          : first?.type === "function" && first.value === "url"
            ? first.nodes[0]?.value
            : null;
      if (!raw) {
        limitation(
          limitations,
          "CSS_IMPORT_UNSUPPORTED",
          "An import could not be parsed",
        );
        continue;
      }
      const url = new URL(raw, base).href;
      if (stack.has(url) || stack.size >= 16) {
        rule.remove();
        limitation(
          limitations,
          "CSS_IMPORT_CYCLE",
          "Circular or excessively nested stylesheet import omitted",
        );
        continue;
      }
      const imported = await download(url);
      if (!imported) {
        rule.params = `url(${JSON.stringify(url)}) ${valueParser.stringify(parsed.nodes.slice(parsed.nodes.indexOf(first) + 1))}`;
        continue;
      }
      let body = await css(
        imported.body.toString("utf8"),
        imported.url,
        new Set([...stack, url]),
      );
      const tail = parsed.nodes
        .slice(parsed.nodes.indexOf(first) + 1)
        .filter((n) => n.type !== "space" && n.type !== "comment");
      const wrappers = [];
      if (tail[0]?.value === "layer") {
        const layer = tail.shift();
        wrappers.push([
          "layer",
          layer.type === "function" ? valueParser.stringify(layer.nodes) : "",
        ]);
      }
      if (tail[0]?.type === "function" && tail[0].value === "supports") {
        const supports = tail[0];
        tail.shift();
        const v = valueParser.stringify(supports.nodes);
        wrappers.push([
          "supports",
          v.includes(":") && !v.trim().startsWith("(") ? `(${v})` : v,
        ]);
      }
      const media = tail.map((n) => valueParser.stringify(n)).join(" ");
      if (media) wrappers.push(["media", media]);
      for (const [name, params] of wrappers.reverse())
        body = `@${name} ${params} {\n${body}\n}`;
      rule.replaceWith(postcss.parse(body).nodes);
    }
    // Imported declarations have already been rewritten against their own base.
    // Each declaration is independent, so the resources they reference are
    // localized concurrently. A cancellation must not leave sibling
    // rejections unhandled.
    const rewritten = await Promise.allSettled(
      declarations.map((decl) =>
        cssValue(decl.value, base).then((value) => {
          decl.value = value;
        }),
      ),
    );
    const failure = rewritten.find((entry) => entry.status === "rejected");
    if (failure) throw failure.reason;
    root.walkComments((comment) => {
      if (/sourceMappingURL/.test(comment.text)) comment.remove();
    });
    root.walkAtRules(/^charset$/i, (rule) => {
      rule.remove();
    });
    return root.toString();
  }
  return {
    download,
    localize,
    css,
    cssValue,
    stats: () => ({ assets: localPaths.size, downloadedBytes: consumed }),
  };
}
