import js from "@eslint/js";
const names = [
  "process",
  "Buffer",
  "console",
  "URL",
  "fetch",
  "AbortSignal",
  "AbortController",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "document",
  "window",
  "innerHeight",
  "getComputedStyle",
  "Element",
  "HTMLImageElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLOptionElement",
  "HTMLCanvasElement",
  "HTMLScriptElement",
  "SVGUseElement",
  "Animation",
  "KeyframeEffect",
  "CSS",
  "requestAnimationFrame",
];
export default [
  js.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: Object.fromEntries(names.map((name) => [name, "readonly"])),
    },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
];
