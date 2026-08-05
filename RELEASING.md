# Releasing Git City

Installers are built in CI by the [`Release`](.github/workflows/release.yml) workflow: an NSIS
`.exe` on `windows-latest`, two DMGs on `macos-latest` (arm64 and a cross-built x64, since
Intel Macs are still common), and an AppImage + `.deb` on `ubuntu-latest`.

## Cut a release

1. **Bump the version** in [`package.json`](package.json) (e.g. `0.1.0` -> `1.0.0`). This is the
   single source of truth; the installers are named after it.
2. Commit it: `git commit -am "release: v1.0.0"` and push to `main` (via PR as usual).
3. **Tag and push the tag:**

   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

Each build job verifies the tag matches `package.json`, runs the tests and builds its installer.
A third job then collects every artifact into one **GitHub Release** at
`https://github.com/maximalcode/git-city/releases` with auto-generated notes. The build jobs
never create the Release themselves, so the platforms cannot race each other for it.

You get five files:

| File                          | For                                        |
| ----------------------------- | ------------------------------------------ |
| `git-city-1.0.0-setup.exe`    | Windows                                    |
| `git-city-1.0.0-arm64.dmg`    | Apple Silicon (M1 onward)                  |
| `git-city-1.0.0-x64.dmg`      | Intel Macs                                 |
| `git-city-1.0.0-x64.AppImage` | Any Linux (`chmod +x` and run — no install) |
| `git-city-1.0.0-x64.deb`      | Debian / Ubuntu / Mint                     |

Linux needs no signing: there is no SmartScreen or Gatekeeper equivalent, so the unsigned-build
caveats below apply to Windows and macOS only.

> The tag must equal `v` + the `package.json` version, or the build fails on purpose.

### Dry run (build without releasing)

Use the **Run workflow** button on the Actions tab (`workflow_dispatch`). It builds and tests on
both platforms, then uploads the installers as **run artifacts** (Actions run page, 90-day
retention) — no Release is created. Good for smoke-testing the packaged app before you commit to
a version tag.

### Cost note (private repo)

Against the private-repo free tier (2,000 min/month), Windows runners bill at **2x** minutes and
macOS at **10x** — so a macOS build is by far the expensive half, and dry runs are worth using
sparingly while the repo is private. On a **public** repo, Actions minutes are free on standard
runners, so this stops mattering the moment the repo goes public.

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
-> **Open** (or `xattr -d com.apple.quarantine`), and the README needs to say so plainly next to
the download link, or Mac users will assume the build is broken.

Fixing it properly needs an **Apple Developer account ($99/yr)** for signing + notarization. Same
pattern as Windows: store `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / the signing certificate as
repository secrets and reference them from the macOS build step.
