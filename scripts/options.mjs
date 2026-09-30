// @ts-check
import path from "node:path";

export const common = ["json", "help", "version"];
export const browserOptions = [
  "url",
  "selector",
  "viewports",
  "wait",
  "locale",
  "color-scheme",
  "timeout",
];
export const allowed = {
  capture: [
    ...common,
    ...browserOptions,
    "out",
    "max-resource-mb",
    "max-total-mb",
    "omit-scripts",
    "max-scroll-steps",
  ],
  validate: [
    ...common,
    ...browserOptions,
    "dir",
    "max-diff-ratio",
    "allow-external",
    "max-scroll-steps",
  ],
  serve: [...common, "dir", "port"],
  browser: common,
};
const booleans = new Set([
  "json",
  "help",
  "version",
  "allow-external",
  "omit-scripts",
]);

/** @param {string[]} argv @param {string[]} keys */
export function parseArgs(argv, keys) {
  /** @type {Record<string, string | boolean>} */
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--"))
      throw new Error(`Unexpected argument: ${token}`);
    const [key, ...parts] = token.slice(2).split("=");
    if (!keys.includes(key)) throw new Error(`Unknown option: --${key}`);
    if (Object.hasOwn(result, key))
      throw new Error(`Repeated option: --${key}`);
    if (booleans.has(key)) {
      if (parts.length) throw new Error(`--${key} does not accept a value`);
      result[key] = true;
    } else {
      const value = parts.length ? parts.join("=") : argv[++i];
      if (!value || value.startsWith("--"))
        throw new Error(`Missing value for --${key}`);
      result[key] = value;
    }
  }
  return result;
}

/** @param {Record<string, string | boolean>} args @param {string} key */
export function required(args, key) {
  const value = args[key];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Missing required --${key}`);
  return value.trim();
}

/** @param {unknown} value @param {string} key @param {number} fallback @param {number} min @param {number} max */
export function numeric(value, key, fallback, min, max) {
  const n = value === undefined ? fallback : Number(value);
  if (typeof value === "boolean" || !Number.isFinite(n) || n < min || n > max) {
    throw new Error(
      `--${key} must be a finite number between ${min} and ${max}`,
    );
  }
  return n;
}

/** @param {string} [value] */
export function parseViewports(value = "1440x900,1024x768,768x1024,375x812") {
  const seen = new Set();
  const items = value
    .split(",")
    .map((item) => {
      const match = /^(\d{2,4})x(\d{2,4})$/i.exec(item.trim());
      if (!match)
        throw new Error(`Invalid viewport '${item}'. Use WIDTHxHEIGHT.`);
      const width = Number(match[1]),
        height = Number(match[2]);
      if (width < 200 || height < 200 || width > 3840 || height > 3840)
        throw new Error("Viewport dimensions must be between 200 and 3840");
      return { width, height, name: `${width}x${height}` };
    })
    .filter((v) => !seen.has(v.name) && seen.add(v.name));
  if (!items.length || items.length > 8)
    throw new Error("Use between 1 and 8 viewports");
  return items;
}

/** @param {string} value */
export function httpUrl(value) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("--url must be HTTP(S) without embedded credentials");
  return url.href;
}

/** @param {string} command @param {Record<string, string | boolean>} args */
export function optionsFor(command, args) {
  const options = {
    json: args.json === true,
    omitScripts: args["omit-scripts"] === true,
    sourceUrl: "",
    selector: "",
    directory: "",
    viewports: parseViewports(
      typeof args.viewports === "string" ? args.viewports : undefined,
    ),
    settleMs: numeric(args.wait, "wait", 1200, 0, 60000),
    timeoutMs: numeric(args.timeout, "timeout", 120000, 1000, 600000),
    locale: typeof args.locale === "string" ? args.locale : "pt-BR",
    colorScheme: /** @type {'light' | 'dark'} */ (
      args["color-scheme"] || "light"
    ),
    maxResourceBytes:
      numeric(args["max-resource-mb"], "max-resource-mb", 20, 0.001, 100) *
      1024 *
      1024,
    maxTotalBytes:
      numeric(args["max-total-mb"], "max-total-mb", 100, 0.001, 500) *
      1024 *
      1024,
    maxScrollSteps: numeric(
      args["max-scroll-steps"],
      "max-scroll-steps",
      80,
      1,
      1000,
    ),
    maximumDifferenceRatio: numeric(
      args["max-diff-ratio"],
      "max-diff-ratio",
      0.02,
      0,
      1,
    ),
    allowExternal: args["allow-external"] === true,
    port: numeric(args.port, "port", 4173, 0, 65535),
  };
  if (!["light", "dark"].includes(options.colorScheme))
    throw new Error("--color-scheme must be light or dark");
  if (
    !Number.isInteger(options.port) ||
    !Number.isInteger(options.maxScrollSteps)
  )
    throw new Error("--port and --max-scroll-steps must be integers");
  if (command === "capture" || command === "validate") {
    options.sourceUrl = httpUrl(required(args, "url"));
    options.selector = required(args, "selector");
  }
  if (["capture", "validate", "serve"].includes(command))
    options.directory = path.resolve(
      required(args, command === "capture" ? "out" : "dir"),
    );
  return options;
}
