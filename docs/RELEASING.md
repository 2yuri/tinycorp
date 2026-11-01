# Releasing

A release is built by `.github/workflows/release.yml` when a version tag is pushed: every OS builds
its installers, and a **draft** GitHub release collects them. Nothing is public until the draft is
published, and the app only reads published releases (`src/shared/app/updates.ts`).

The macOS DMG is **signed with the Developer ID, notarised by Apple and stapled** when the repository
has the five secrets below, so it opens on any Mac without a Gatekeeper warning. Without them the
release still succeeds, unsigned exactly as `pnpm package` builds it locally, and the run carries a
`macOS build is unsigned` warning. The Windows installer and the Linux AppImage and `.deb` are
unsigned either way.

## Cutting a release

1. Set `version` in `package.json` to the new version and merge that to `main`.
2. Tag the merge commit with the same version, prefixed with `v`, and push the tag:

   ```sh
   git switch main && git pull
   git tag v0.2.0
   git push origin v0.2.0
   ```

   The workflow refuses a tag that does not match `package.json`.
3. Watch the **Release** run. Each OS runs the suite, packages, and starts what it packaged
   (`tools/smoke-packaged.mjs`). On macOS, with the secrets, it also:
   - signs the app with the hardened runtime and a secure timestamp, notarises it and staples the
     ticket (electron-builder, configured by `macSigning` in `src/build/packaging.ts`);
   - checks the app with `codesign --verify --deep --strict`, `stapler validate` and
     `spctl --assess --type execute`;
   - signs the DMG with a timestamp, notarises it with `notarytool`, staples it, checks it with
     `spctl --assess --type open`, and rebuilds its blockmap.

   Notarisation usually takes a few minutes. When Apple rejects a submission, the step prints the
   notary log and fails.
4. Open the draft under **Releases**, check the generated notes and the assets, and **Publish**.

If the run shows a `macOS build is unsigned` warning, the secrets are missing; the DMG still works
but has to be opened with right-click → **Open** the first time.

## One-time setup: the repository secrets

Settings → Secrets and variables → Actions → **New repository secret**. The names are shared with
the owner's other repositories. Set all five or none: a run that finds only some of them fails,
because that is a mistake rather than a fork.

| Secret | What it is |
| --- | --- |
| `DEVELOPER_ID_P12_BASE64` | The "Developer ID Application" certificate with its private key, exported as `.p12`, base64-encoded. |
| `DEVELOPER_ID_P12_PASSWORD` | The password chosen when exporting that `.p12`. |
| `NOTARY_KEY_P8_BASE64` | An App Store Connect API key (`.p8`), base64-encoded. Used for notarisation only. |
| `NOTARY_KEY_ID` | That key's Key ID. |
| `NOTARY_ISSUER_ID` | The Issuer ID shown above the keys list in App Store Connect. |

The workflow writes the `.p12` and the `.p8` to the runner's temp folder and hands them to
electron-builder as `CSC_LINK` / `CSC_KEY_PASSWORD` and `APPLE_API_KEY` / `APPLE_API_KEY_ID` /
`APPLE_API_ISSUER`. It also imports the certificate into a keychain of its own for signing the DMG,
and deletes the keychain and both files at the end of the job.

### The signing certificate

The certificate is a **Developer ID Application** one, from the Apple Developer Program (team
`RQTYDUV329`, *Developer ID Application: YURI ALVES MIGUEL (RQTYDUV329)*). The one Xcode manages in
the cloud cannot be exported, so make one with a private key on this Mac:

1. Xcode → Settings → Accounts → select the team → **Manage Certificates…** → **+** →
   **Developer ID Application**.
2. Keychain Access → login → My Certificates → right-click **Developer ID Application: …** →
   **Export…** → save as `developer-id.p12` with a strong password.
3. Add the secrets:

   | Secret | Value |
   | --- | --- |
   | `DEVELOPER_ID_P12_BASE64` | `base64 -i developer-id.p12 \| pbcopy`, then paste |
   | `DEVELOPER_ID_P12_PASSWORD` | the export password |

4. Delete `developer-id.p12` from disk.

### The notarisation API key

1. [App Store Connect](https://appstoreconnect.apple.com/access/integrations/api) → Users and
   Access → Integrations → App Store Connect API → Team Keys → **+**, access **Developer**.
2. Download the `.p8` — Apple allows that once — and note the **Key ID** and the **Issuer ID**.
3. Add the secrets:

   | Secret | Value |
   | --- | --- |
   | `NOTARY_KEY_P8_BASE64` | `base64 -i AuthKey_XXXXXXXXXX.p8 \| pbcopy`, then paste |
   | `NOTARY_KEY_ID` | the Key ID |
   | `NOTARY_ISSUER_ID` | the Issuer ID |

4. Delete the `.p8` from disk. Revoke the key in App Store Connect if it ever leaks.

## What signing changes in the app

- **The hardened runtime**, which notarisation requires. The one entitlement the app takes back is
  `com.apple.security.cs.allow-jit` in `resources/entitlements.mac.plist`, because V8 compiles
  JavaScript to machine code. Library validation stays on: node-pty's native module and its
  `spawn-helper` are signed with the same identity as the app that loads them.
- **The asar fuses** (`electronFuses` in `src/build/packaging.ts`) are sealed by a signature that
  nobody else can make, which is what they were turned on for.
- **The keychain items the app wrote while it was unsigned** belong to a different code signature,
  so macOS asks once, the first time a signed build reads them, whether to allow it.

## Signing on a Mac by hand

`pnpm package` never signs, even when the keychain holds a Developer ID: `macSigning` gives
electron-builder no identity unless `CSC_LINK` is set. To build a signed, notarised DMG locally,
export the same variables the workflow does and run it:

```sh
export CSC_LINK=/path/to/developer-id.p12 CSC_KEY_PASSWORD='…'
export APPLE_API_KEY=/path/to/AuthKey_XXXXXXXXXX.p8 APPLE_API_KEY_ID=… APPLE_API_ISSUER=…
pnpm package
```

That signs, notarises and staples the app. The DMG is signed, notarised and stapled only by the
workflow's step, which you can run by hand the same way: `codesign --sign "Developer ID Application"
--timestamp`, then `xcrun notarytool submit --wait` and `xcrun stapler staple`.
