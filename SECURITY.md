# Security policy

The latest 0.1.x release is the supported line once released. Before the first release, report against the current development branch.

Please use GitHub's **Report a vulnerability** feature:
https://github.com/LorranHippolyte/uiport/security/advisories/new

Provide version, operating system, a minimal original reproduction and impact. Do not post credentials, captured client HTML or personal data in public issues. There is no paid bug bounty or guaranteed response SLA.

UIport runs JavaScript from the source URL in a local browser. It does not import your everyday browser's sessions, but capture is not a hardened sandbox for hostile sites. Source scripts inside the selection, inline event handlers and recognized visual library scripts are retained by default. Review that code before running or redistributing an export. `capture --omit-scripts` omits source execution, but does not make the output a universally sanitized document.

The preview server is loopback-only and confines resolved file paths to its root. The export reuses responses from its fresh browser context; no personal browser session is imported. Retained response bytes and fallback downloads have budgets, but Playwright materializes response bodies before their actual size can be checked. These limits do not bound peak source-browser/process memory. Review captured material before redistributing or running it in another context.
