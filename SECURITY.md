# Security policy

The latest 0.1.x release is the supported line once released. Before the first release, report against the current development branch.

Please use GitHub's **Report a vulnerability** feature:
https://github.com/LorranHippolyte/uiport/security/advisories/new

Provide version, operating system, a minimal original reproduction and impact. Do not post credentials, captured client HTML or personal data in public issues. There is no paid bug bounty or guaranteed response SLA.

UIport runs JavaScript from the source URL in a local browser. It does not import your everyday browser's sessions, but capture is not a hardened sandbox for hostile sites. Source scripts are removed from exported sections by default; that does not make the output a universally sanitized document.

The preview server is loopback-only and confines resolved file paths to its root. Export downloads have byte/deadline limits; these do not bound every resource used by the source browser itself. Review captured material before redistributing or running it in another context.
