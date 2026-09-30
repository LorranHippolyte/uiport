# Contributing to UIport

Issues, reduced original fixtures, documentation and pull requests are welcome. Lorran Hippolyte reviews releases and merges, with development and maintenance by LuminaSoft.

## Development

Use Node 24 LTS (minimum supported: 22.14).

```sh
npm ci
node bin/cli.mjs browser install
npm run check
```

`check` runs ESLint, JSDoc type checks, ESM syntax checks, tests and a real packed-package consumer test. Browser tests use local servers and original fixtures. Dependency/browser installation can access the network; no extraction test targets a third-party website.

- `npm run test:unit`: fast boundary tests.
- `npm test`: unit and browser tests, four-viewports capture/validation, source runtime omission and failure paths.
- `npm run test:package`: inspect the tarball and install it outside the checkout without devDependencies, then run CLI capture and validation.
- `tools/create-test-font.py`: optional regeneration of our original geometric test font; requires Python fonttools, never needed to run tests.

Read [architecture](docs/architecture.md) and [support](docs/support.md). Keep fixes bounded and add a regression test for behavior that can fail. Avoid tests that only mirror implementation text.

## Pull requests

Branch from main. Explain the observed problem, changed behavior and verification. Do not commit captured customer pages, credentials, sessions, node_modules, generated capture output or personal data. Reproduce bugs with original local fixtures; links to public sites are optional context, not CI dependencies.

Report supported/unsupported behavior honestly. A screenshot match does not prove a working interaction. Preserve original observed effects; do not silently substitute invented animation.

Contributions are accepted under the repository MIT license. No CLA is required for 0.1. Follow the [code of conduct](CODE_OF_CONDUCT.md); report vulnerabilities through [SECURITY.md](SECURITY.md).
