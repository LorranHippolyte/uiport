# UIport 0.1 support matrix

UIport exports a rendered section or a selected whole page. It does not reconstruct a complete application backend or crawl a site. A successful capture is not a general proof of fidelity.

| Capability | Scope in 0.1 | Evidence / limitation |
|---|---|---|
| DOM and original CSS | Supported for section containers and body/html roots | Original fixtures tested at four viewports; entire stylesheets retained conservatively |
| Responsive CSS | Media queries retained | The first DOM is exported; an observed change in element structure at another viewport produces a limitation |
| Images, srcset, CSS resources (including image-set) | Reuse captured browser responses, then HTTP fallback | Copied resources have byte/deadline budgets; missing resources produce partial output |
| Fonts and CSS imports | Supported | Local font fixture; nested imports, layers, supports and media tested |
| SVG fragments | Preserved | Hash stays on local URL, e.g. `assets/…svg#shape` |
| Hover/focus and CSS animations | Original CSS preserved | Example states and animations exercised by integration tests |
| Web Animations API | Observed keyframes/timing on DocumentTimeline | Paused/infinite timing tested; does not reconstruct triggering events |
| Open Shadow DOM | Partial | Declarative shadow tree and inline/adopted styles; simple local fixture covered |
| Source scripts, handlers and visual libraries | Preserved as in the prototype; capture --omit-scripts opts out | Scripts in the selection and recognized visual libraries are copied; initialization outside the selection, module dependencies and arbitrary listeners still need review. Preserved source code reports SOURCE_RUNTIME_UNVERIFIED |
| Canvas | Static readable frame only | An unreadable frame is reported; no dynamic WebGL guarantee |
| Iframes, object/embed | Disabled | Embedded documents are not extracted or allowed to run automatically |
| Closed shadow roots | Unsupported | They cannot be generically inspected; absence cannot be reliably detected |
| Dynamic layouts and interactions | Manual review | Structural diagnostics do not detect every text/state change; no arbitrary listener equivalence proof |

## Validation semantics

`validate` visits the source and output in separate browser contexts. Each requested viewport gets a screenshot of the selected root. Animations are disabled for the screenshot; pixelmatch uses threshold 0.1 and excludes antialias differences. Defaults permit a 0.02 differing-pixel ratio, identical width and up to 5 px height difference.

Output requests to any other HTTP(S) origin are blocked by default, even another localhost port. Request failures, HTTP errors and browser errors fail the check. `--allow-external` permits external requests but still reports them; the result does not establish offline portability. Links not clicked, hover states not exercised and future media loads are not certified by screenshots.

The report always says `behavior: "not-tested"`. Capture limitations are also embedded as JSON inside `index.html` and surfaced by validation, so moving the artifact does not discard that context. A partial capture may pass a static visual check without becoming a complete behavioral clone.

Contextual custom-property rules that matched the source but lose structural context in the export are adapted for the captured elements. Their original declarations, specificity and media/supports/container/layer conditions remain intact. This does not infer unseen states or guarantee arbitrary CSS/runtime layouts.

Existing prototype exports are accepted by their legacy root marker; validate does not rewrite them. The locale default remains pt-BR.

## Limits and diagnostics

- One CSS selector matching one section container, body or html. Body/html export a single whole page without nesting another html/body; html also includes original head scripts.
- Viewports: 1–8, dimensions 200–3840 pixels. Screenshot comparisons capped at 20 megapixels.
- Total operation: default 120 seconds, configurable 1–600 seconds. The deadline also covers browser startup; cancellation closes the owned browser process tree. Process cleanup can add a short shutdown interval. Source navigation is bounded; resource fetches have up to 15 seconds each.
- Lazy scroll: default 80 steps, configurable 1–1000. `SCROLL_LIMIT` means content may remain unloaded.
- Export resource budget: default 20 MiB/file, 100 MiB total; controls downloaded copies, not source browser memory. Successful responses from the fresh capture context are reused, including Referer-dependent resources. Retention has the same per-file/aggregate budgets, but Playwright materializes response bodies before actual-size validation; peak memory is not bounded by these budgets. All referenced CSS resources may be retained, including resources unused by the selected DOM, because CSS is conservative.
- Public HTTP(S) only; no session/cookie import. Local development URLs are supported. The capture reuses its own navigation responses; fallback fetch does not import browser cookies.
- Source JavaScript executes in the capture browser. The optional --omit-scripts mode is not a general-purpose sanitizer or sandbox for hostile websites.
- Source style values and content remain in the HTML. Review artifacts before redistribution. The CLI redacts URL credentials, queries and fragments in resource diagnostics and operational errors and does not print source page content or form values.
- Network/rendering differences, DOM changed by runtime, special CSS/HTML features and states not observed can still require manual work. No invented replacement effects.

Common partial-result codes: `SOURCE_RUNTIME_UNVERIFIED`, `SOURCE_RUNTIME_OMITTED`, `RESOURCE_UNAVAILABLE`, `STYLESHEET_UNAVAILABLE`, `SCROLL_LIMIT`, `RESPONSIVE_DOM_CHANGED`, `CANVAS_STATIC`, `CANVAS_UNREADABLE`, `EMBED_OMITTED`, `ANIMATION_UNSUPPORTED`, `SOURCE_REQUEST_FAILED`, `SOURCE_SCRIPT_ERROR`, `CSS_IMPORT_CYCLE`, `CSS_IMPORT_UNSUPPORTED`.

## Supported environments

Node >=22.14; Node 24 LTS recommended. CI covers Linux (Node 22.14 and 24), macOS and Windows (Node 24). Browser installation uses the Playwright version pinned in the package. Chrome/Edge fallback is supported, but controlled visual comparisons are most repeatable with bundled Chromium. Firefox/WebKit and browser extension workflows are outside 0.1.
