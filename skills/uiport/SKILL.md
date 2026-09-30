---
name: uiport
description: Capture a rendered web section as editable HTML, original CSS and local assets using UIport, then inspect its limitations and validate the result.
---

# UIport

Use for a request to extract an existing web section into local files. Use pages the user owns or has permission to reuse. Do not redesign or invent replacement effects.

1. Inspect the requested URL and choose one CSS selector matching a section container, or body/html for a full page. Include wrappers/decorations that belong to it; html also includes original head scripts.
2. Use the installed CLI or source checkout. Once published, `npx uiport@0.1.0` is the pinned form. Before the first release, use `node bin/cli.mjs` from the checkout; never assume an unpublished npm package exists.
3. If needed, install the matching browser with `uiport browser install`. No browser download is hidden inside capture.
4. Run `uiport capture --url "URL" --selector "SELECTOR" --out "NEW_DIRECTORY" --json`. The default locale is pt-BR. Match locale/color scheme/viewports to the requested source. Never overwrite an existing nonempty directory.
5. Read the result. Exit 0 means no known reported limitations, not universal fidelity. Exit 2 means a partial artifact exists; inspect every limitation. Exit 1 means failure. Stdout is JSON, progress is stderr.
6. Preview with `uiport serve --dir "DIRECTORY"` and compare with `uiport validate --url "URL" --selector "SELECTOR" --dir "DIRECTORY" --json`, using the same viewport/locale/color-scheme options.
7. Inspect hover/focus, animation and relevant interactions separately. Validation disables animation for screenshots and reports behavior as not tested. Source scripts inside the selection, inline handlers and recognized visual library scripts are retained by default. Use capture --omit-scripts to omit them explicitly. Outside initialization, listeners and framework dependencies are not generically recovered; inspect SOURCE_RUNTIME_UNVERIFIED.
8. If an effect cannot be isolated from original source, explain the limitation. Do not create a visually similar substitute and call it an extraction. Manual integration of necessary original runtime code is separate work requiring inspection and validation.
9. Deliver `index.html` and `assets/` only in the extraction folder. Put reports/screenshots outside it. State the path, verified behavior and remaining limitations.

The tool does not generate React/Next components or clone application backends. The project license covers UIport, not third-party captured assets. Never publish customer extracts or credentials as fixtures.
