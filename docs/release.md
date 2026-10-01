# Release procedure

Every release must use a reviewed commit on main and explicit maintainer approval for publication. The protected `release` environment is the final publishing gate; merging a pull request alone does not publish a package.

## Before the release

1. Confirm the npm account controlled by the maintainer, package name availability, 2FA and permissions. Do not infer the npm username from GitHub.
2. Verify `npm run check` and all CI jobs on the reviewed commit, including Windows/macOS and Node 22.14/24.
3. Prepare installation documentation and a dated changelog in a release pull request. Merge those changes when ready to publish; do not announce availability before the registry check succeeds.
4. Confirm the GitHub `release` environment requires Lorran's review; verify the protected tag/commit is on main and its package version matches the tag.
5. Configure npm trusted publishing for owner `LorranHippolyte`, repo `uiport`, workflow `publish.yml`, environment `release`. Permit direct `npm publish` if using the provided workflow. `repository.url` must match the repository.

The workflow uses Node 24, a compatible npm CLI, GitHub-hosted runners and `id-token: write`. No NPM_TOKEN is stored. Current npm trusted publishing requires npm >=11.5.1 and Node >=22.14; recheck the [official documentation](https://docs.npmjs.com/trusted-publishers/) before release. Provenance is expected from OIDC for this public repository.

## First-package bootstrap

Trusted publisher settings may require an existing package. If the registry supports creating that binding first, publish 0.1.0 directly via OIDC. Otherwise, after explicit maintainer approval:

- Publish a reviewed `0.0.0-bootstrap.0` package under dist-tag `bootstrap` through a maintainer-controlled, 2FA-authenticated session.
- Configure the trusted publisher on that package.
- Publish the reviewed 0.1.0 tag via the protected OIDC workflow.

The bootstrap is not the official release and does not have the same provenance guarantee. Never silently replace the official release with a manual publish, create a long-lived automation token, or publish a different brand if the package name is taken.

## Verify and announce

Confirm the registry reports the intended version under `latest`, the expected maintainer and repository, and an attestation bound to the reviewed GitHub commit. Then exercise the version being released (for example, `npx uiport@0.1.1`) capture/serve/validate in a clean consumer directory, not only help. Create the corresponding GitHub release from the same tag. Use the prepared launch kit after receiving authorization to send community messages.

Each npm name/version pair is immutable after publication. Stop on mismatched version, failing checks or missing review; do not reuse a published version.
