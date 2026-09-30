# Migration to UIport

UIport packages the original local extractor as an installable CLI. The initial release preserves the demonstrated extraction workflow before adding new product capabilities.

| Existing behavior | UIport |
|---|---|
| Extract one section or a complete page | Use a unique section selector, `body` or `html`. The document contains one html/body pair; `html` also retains original head scripts. |
| Inline handlers and scripts inside the selection | Preserved by default. Recognized visual library scripts outside the selection are also copied, as in the prototype. `capture --omit-scripts` explicitly omits source execution. |
| Assets received during navigation | Reuse responses from the fresh capture browser, including redirects and Referer-dependent resources, before independent HTTP fallback. No personal browser profile is imported. |
| Custom properties whose selector context was outside the section | Preserve original declarations and their conditions for the captured elements; do not freeze all computed variables to the first viewport. |
| Existing exported folders | `validate` recognizes the previous `data-effect-extractor-root` marker without modifying the files. New exports use `data-uiport-*`. The legacy name in this compatibility path is intentional. |
| Preview file types | WebAssembly MIME and case-insensitive extensions remain supported. |
| Default locale | `pt-BR` in both capture and validate; specify `--locale` to change it. |

## Commands and intentional operational changes

Install dependencies at the repository root with `npm ci`. Use `node bin/cli.mjs capture`, `serve` and `validate` from source, or the `uiport` command after installation. The old `scripts/` package and its npm scripts are replaced by this entrypoint. Browser installation is explicit. `UIPORT_BROWSER_PATH` is the current executable override.

The package retains the release candidate's resource/time budgets, strict option validation, protected output staging and browser cleanup. Defaults are 20 MiB per copied resource, 100 MiB total, 120 seconds and 80 scroll steps. They are configurable; migration does not mean unbounded execution. Viewports and comparisons also have the limits listed in [support](support.md).

Capture exit 2 means a partial artifact was created and must be inspected. Original source code is reported as `SOURCE_RUNTIME_UNVERIFIED`, even if a particular click works. Preserving scripts is not generic framework reconstruction: outside initialization, relative JavaScript dependencies, dynamic state and unobserved interactions may need manual integration. The original extractor did not guarantee those either. Screenshots still do not certify behavior.

Browser-response budgets limit retained bytes. Playwright materializes a response body before actual-size validation; these budgets do not cap peak browser/process memory. Independent fallback downloads enforce streaming byte limits.

## Evidence

`test/migration.test.mjs` exercises full-page/section output, inline and registered clicks, visual library loading, locale, redirect/Referer resources with the source offline, contextual variables (including native CSS nesting) together with media queries and inherited/fluid values, extensionless script execution through browser-response reuse and HTTP fallback, old export validation without mutation, and WebAssembly preview. Existing tests cover `--omit-scripts`, WAAPI replay, staging, deadlines, cleanup and the packaged consumer workflow.

This is evidence for these cases, not a promise that every website or application runtime can be exported faithfully. See the [complete agent guide](../uiport.md) for inspection, correction and delivery.
