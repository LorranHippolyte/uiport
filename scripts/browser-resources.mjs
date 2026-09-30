import { normalizeUrl } from "./lib.mjs";

// Retain the bytes received by this capture's fresh browser context. No personal
// browser profile/cookies are imported. Playwright materializes response.body();
// these budgets limit retention, not the source browser's peak memory usage.
export function browserResources(page, options, signal) {
  const entries = new Map();
  let retained = 0;
  let pending = Promise.resolve();
  const receive = (response) => {
    const request = response.request();
    if (
      !["stylesheet", "image", "media", "font", "script"].includes(
        request.resourceType(),
      ) ||
      response.status() < 200 ||
      response.status() >= 300 ||
      !/^https?:/i.test(response.url())
    )
      return;
    const url = normalizeUrl(response.url());
    if (entries.has(url)) return;
    const task = pending.then(async () => {
      if (signal.aborted || retained >= options.maxTotalBytes) return null;
      const length = Number(response.headers()["content-length"] || 0);
      if (
        length > options.maxResourceBytes ||
        retained + length > options.maxTotalBytes
      )
        return null;
      try {
        const body = await response.body();
        if (
          signal.aborted ||
          body.length > options.maxResourceBytes ||
          retained + body.length > options.maxTotalBytes
        )
          return null;
        retained += body.length;
        return {
          body,
          contentType: response.headers()["content-type"] || "",
          url: response.url(),
        };
      } catch {
        return null;
      }
    });
    pending = task.then(() => {});
    entries.set(url, task);
    for (let alias = request; alias; alias = alias.redirectedFrom()) {
      const key = normalizeUrl(alias.url());
      if (!entries.has(key)) entries.set(key, task);
    }
  };
  page.on("response", receive);
  return {
    async get(url) {
      signal.throwIfAborted();
      const resource = await entries.get(normalizeUrl(url));
      signal.throwIfAborted();
      return resource || null;
    },
    async settle() {
      await pending;
      signal.throwIfAborted();
    },
    dispose() {
      page.off("response", receive);
      entries.clear();
    },
  };
}
