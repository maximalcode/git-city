# Releasing Git City

Installers are built in CI by the [`Release`](.github/workflows/release.yml) workflow: an NSIS
`.exe` on `windows-latest`, native DMGs on `macos-latest` (arm64) and
`macos-15-intel` (x64), and an AppImage + `.deb` on `ubuntu-latest`.

## Cut a release

1. **Bump the version** in [`package.json`](package.json) and both root version fields in
   `package-lock.json` together. The installers are named after `package.json`.
2. Open the preparation PR against `develop`, then promote `develop` to `main` through a
   release PR after checks pass. Tag the accepted `main` commit, never the preparation branch.
3. **Tag and push the tag:**

   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

Each build job verifies the tag matches `package.json`, runs the tests and builds its installer.
The publish job then collects every artifact into one **GitHub Release** at
`https://github.com/maximalcode/git-city/releases` with auto-generated notes. The build jobs
never create the Release themselves, so the platforms cannot race each other for it.

You get five files:

| File                             | For                                         |
| -------------------------------- | ------------------------------------------- |
| `git-city-1.0.0-setup.exe`       | Windows                                     |
| `git-city-1.0.0-arm64.dmg`       | Apple Silicon (M1 onward)                   |
| `git-city-1.0.0-x64.dmg`         | Intel Macs                                  |
| `git-city-1.0.0-x86_64.AppImage` | Any Linux (`chmod +x` and run — no install) |
| `git-city-1.0.0-amd64.deb`       | Debian / Ubuntu / Mint                      |

Linux needs no signing: there is no SmartScreen or Gatekeeper equivalent, so the unsigned-build
caveats below apply to Windows and macOS only.

> The tag must equal `v` + the `package.json` version, or the build fails on purpose.

### Dry run (build without releasing)

Use the **Run workflow** button on the Actions tab (`workflow_dispatch`). It builds and tests on
all three platforms, then uploads the installers as **run artifacts** (Actions run page, 90-day
retention) — no Release is created. Good for smoke-testing the packaged app before you commit to
a version tag.

The repository is public, so Actions minutes are free on standard runners. Dry-run as often as
you like.

---

## Code signing (not yet configured)

Right now the installer is **unsigned**. It runs fine, but Windows **SmartScreen** shows a
"Windows protected your PC / unknown publisher" warning on download, and users must click
"More info -> Run anyway". Fine for your own testing; not ideal for public distribution.

Signing is a **later** step because it requires buying a certificate. Nothing in the repo needs
to change structurally — `electron-builder` picks up signing from environment variables, so you
only add GitHub **secrets** and reference them in the workflow.

### 1. Get a certificate

Since June 2023, code-signing private keys **must live on FIPS hardware** (a USB token or a cloud
HSM) — you can no longer just email yourself a `.pfx`. Practical options:

| Option                                          | Cost         | SmartScreen                   | Notes                                                                                     |
| ----------------------------------------------- | ------------ | ----------------------------- | ----------------------------------------------------------------------------------------- |
| **Azure Trusted Signing**                       | ~$10/month   | Builds reputation over time   | Cheapest; needs a verified org **or** a 3+ year-old identity. Integrates cleanly with CI. |
| **OV certificate** (Sectigo, SSL.com, DigiCert) | ~$200–400/yr | Builds reputation over time   | Key on a cloud-signing service (eSigner / KeyLocker) so CI can use it.                    |
| **EV certificate**                              | ~$300–500/yr | **Instant** trust, no warning | Highest bar to obtain; hardware token or cloud HSM.                                       |

For a solo/indie launch, **Azure Trusted Signing** is usually the best value if you're eligible;
otherwise an **OV cert via a cloud-signing provider** (so it works in headless CI).

### 2. Store the secrets in GitHub

Repo -> **Settings -> Secrets and variables -> Actions**. Never commit these. For a classic
`.pfx`-style cert (older certs / cloud providers that expose one):

- `CSC_LINK` — base64 of the `.pfx`, or a URL electron-builder can fetch
- `CSC_KEY_PASSWORD` — the cert password

For **Azure Trusted Signing** or **eSigner**, follow the provider's electron-builder guide — they
use a custom sign step / dedicated action rather than `CSC_LINK`.

### 3. Wire the secrets into the build step

In [`release.yml`](.github/workflows/release.yml), add them to the "Build Windows installer" step:

```yaml
- name: Build Windows installer
  env:
    CSC_LINK: ${{ secrets.CSC_LINK }}
    CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
  run: npm run dist:win
```

`electron-builder` auto-detects `CSC_LINK` / `CSC_KEY_PASSWORD` and signs the installer — no
config change in `electron-builder.yml` needed. Verify by right-clicking the downloaded `.exe` ->
**Properties -> Digital Signatures**.

---

## macOS notarization (not yet configured)

The DMGs are built but **unsigned**, and macOS treats that harder than Windows does: Gatekeeper
does not merely warn, it reports a downloaded unsigned app as _"damaged and can't be opened"_,
which reads like a corrupt download rather than a security prompt. The workaround is right-click
-> **Open** (or `xattr -d com.apple.quarantine`). The README says so next to the download link,
and [docs/troubleshooting.md](docs/troubleshooting.md) covers it at length, because otherwise Mac
users assume the build is broken.

Fixing it properly needs an **Apple Developer account ($99/yr)** for signing + notarization. Same
pattern as Windows: store `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / the signing certificate as
repository secrets and reference them from the macOS build step.

### Pinned Rehearse packages

Before a local `dist:*` build, run `npm run tool:prepare` (requires authenticated
`gh` and Python 3.10+). Pass a target such as `-- darwin-arm64` to prepare one target.
The build fails if any selected architecture lacks the exact executable and MIT
license checksums in `rehearse-toolchain.json`. No PATH tool or latest release is
accepted. Git City v0.9.1 pins the published
[git-rehearse v1.3.0 release](https://github.com/maximalcode/git-rehearse/releases/tag/v1.3.0),
including its tag, source revision and exact archive names. Preparation downloads those
release assets and verifies each archive before extracting files, then verifies the
executable and license. Missing assets or checksum mismatches fail the build; update
the reviewed pin in a PR rather than bypassing checks.

When updating the pin, download all four archives and their published `.sha256`
files. Compare each computed archive hash with both the checksum file and GitHub
release asset digest, then record the extracted executable and license hashes.
Run the preparation tests, real-tool acceptance and all four native package jobs.
The [v0.9.1 integration issue](https://github.com/maximalcode/git-city/issues/182) is
linked to [release tracking #175](https://github.com/maximalcode/git-city/issues/175);
merging preparation does not publish or tag a release.

The release workflow also runs on PRs without publishing. Each of Windows x64,
Linux x64, macOS arm64 and macOS x64 builds on its native runner and launches the
packaged executable for version, integrity, rehearsal/Apply and retained-metadata
upgrade checks. Intel macOS is tested natively rather than only cross-built.
`node scripts/smoke-package.mjs "<packaged executable>"` runs the same local check.
Only tag builds publish installers, after all four package jobs succeed.

The current unsigned macOS distribution preserves the reviewed tool bytes using
`signIgnore` for `rehearse/`. Adding signing/notarization requires signed upstream
tool artifacts and a new reviewed digest pin; do not silently sign the binary after
hashing it. Tool updates are app updates, with no independent background updater.
