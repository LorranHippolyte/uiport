# Changelog

Notable changes are documented here. Versions follow Semantic Versioning.

## [Unreleased]

### Fixed
- Keep stdout clean: a capture or a validation writes exactly one JSON document, and anything a dependency prints meanwhile goes to the diagnostics channel.
- Preserve an unparsable `srcset` unchanged and report `SRCSET_INVALID`, instead of dropping the attribute silently and changing which image the browser picks.
- Report a selected root that does not render (`SECTION_NOT_VISIBLE`, `SECTION_EMPTY_AREA`) instead of waiting for a screenshot that cannot succeed, and refuse it during validation with an actionable message.
- Document `INVALID_RESOURCE_URL` in the support matrix.

## [0.1.1] — 2026-10-01

### Fixed
- Avoid Playwright's misleading project-dependency warning when installing Chromium through `npx uiport`; report successful browser installation explicitly.
- Keep browser installation working when Node defaults to ES modules through `NODE_OPTIONS`.
- Clarify that the `npx` workflow works in an empty directory without `package.json` or `npm install`.

## [0.1.0] — 2026-09-30

### Added
- CLI capture, serve, validate and explicit browser installation; JSON diagnostics.
- Original responsive and CSS motion examples and coding-agent skill.
- Bounded downloads, optional source runtime omission, staged output and confined preview server.
- CSS import/resource localization, srcset, SVG fragments and observed WAAPI replay.
- Visual and network comparison, behavior limitations, cross-platform CI and package consumer tests.
- English/Portuguese documentation, MIT license, contribution and governance guides.

### Fixed
- Restore prototype migration parity: body/html captures, source scripts/handlers and recognized visual libraries, browser-response reuse, contextual CSS variables and pt-BR defaults.
- Validate existing prototype artifacts without rewriting them; restore WebAssembly MIME and case-insensitive preview extensions.
- Localize string candidates in CSS `image-set()` and `-webkit-image-set()`, including inline and imported styles.
- Apply operation deadlines and cancellation during browser startup and terminate the owned process tree.
- Redact URL credentials, queries and fragments from operational error output.

### Changed
- Standardize the agent guide as `uiport.md` and browser configuration as `UIPORT_BROWSER_PATH` before the first release.
