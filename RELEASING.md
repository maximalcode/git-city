# Releasing Git City

Windows installers are built in CI by the [`Release (Windows)`](.github/workflows/release.yml)
workflow. macOS is not built yet (add a `macos-latest` job later — see the bottom of this file).

## Cut a release

1. **Bump the version** in [`package.json`](package.json) (e.g. `0.1.0` -> `1.0.0`). This is the
   single source of truth; the installer is named after it (`git-city-1.0.0-setup.exe`).
2. Commit it: `git commit -am "release: v1.0.0"` and push to `main` (via PR as usual).
3. **Tag and push the tag:**

   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

The workflow then: verifies the tag matches `package.json`, runs the tests, builds the NSIS
installer, and publishes a **GitHub Release** at
`https://github.com/maximalcode/git-city/releases` with the `.exe` attached and auto-generated
notes. The download link is `.../releases/download/v1.0.0/git-city-1.0.0-setup.exe`.

> The tag must equal `v` + the `package.json` version, or the build fails on purpose.

### Dry run (build without releasing)

Use the **Run workflow** button on the Actions tab (`workflow_dispatch`). It builds and tests,
then uploads the `.exe` as a **run artifact** (Actions run page, 90-day retention) — no Release
is created. Good for smoke-testing the packaged app before you commit to a version tag.

### Cost note (private repo)

Windows runners bill at 2x minutes against the private-repo free tier (2,000 min/month). A build
is a few minutes, so occasional releases are comfortably free. macOS, if added later, bills at
**10x** — the reason we start Windows-only.

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

| Option | Cost | SmartScreen | Notes |
|---|---|---|---|
| **Azure Trusted Signing** | ~$10/month | Builds reputation over time | Cheapest; needs a verified org **or** a 3+ year-old identity. Integrates cleanly with CI. |
| **OV certificate** (Sectigo, SSL.com, DigiCert) | ~$200–400/yr | Builds reputation over time | Key on a cloud-signing service (eSigner / KeyLocker) so CI can use it. |
| **EV certificate** | ~$300–500/yr | **Instant** trust, no warning | Highest bar to obtain; hardware token or cloud HSM. |

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

## Adding macOS later

Add a second job to the workflow on `macos-latest` running `npm run dist:mac` (the `mac: dmg`
target already exists in `electron-builder.yml`). macOS distribution additionally needs an **Apple
Developer account ($99/yr)** for signing + notarization, or Gatekeeper blocks the app on other
Macs. Same pattern: store `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / signing cert as secrets.
