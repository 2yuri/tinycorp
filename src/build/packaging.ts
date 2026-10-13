// The extension is explicit: Node loads this module as it is, with type stripping, when
// electron-builder reads `electron-builder.config.mjs`.
import { APP_ID, APP_NAME } from '../shared/app/app-name.ts'

/**
 * What `pnpm package`, `pnpm package:win` and `pnpm package:linux` hand to electron-builder: a
 * macOS `TinyCorp.app` and a DMG, a Windows NSIS installer, and a Linux AppImage and `.deb`.
 *
 * The product name and the bundle identifier are not written here — they come from
 * `src/shared/app/app-name.ts`, the same module the running app names itself with — so the menu bar,
 * the app switcher, Finder, the Start menu and the desktop entry all say the one name, and macOS
 * files the packaged app and the development bundle (`tools/dev-identity.mjs`) under the one
 * identifier.
 *
 * It is a function of the platform it is building **on**, not only of the target, because one
 * answer genuinely depends on the host: whether node-pty has to be compiled. {@link packaging} is
 * the answer for this machine, and the tests ask for all three.
 */
export function packagingFor(platform: NodeJS.Platform) {
  return {
    appId: APP_ID,
    productName: APP_NAME,
    // `out/` is the electron-vite build; `release/` is what the boss gets handed.
    directories: { output: 'release', buildResources: 'resources' },
    // The built app plus its package.json: `main` points at `out/main/index.js`, and `type: module`
    // is what lets Electron load it as ESM. Production dependencies come along on their own.
    files: ['out/**', 'package.json'],
    // `appIconPath()` reads `process.resourcesPath/icon.png` in a packaged build.
    extraResources: [{ from: 'resources/icon.png', to: 'icon.png' }],
    /**
     * node-pty ships N-API prebuilds for darwin-arm64 and win32-x64, so on those two hosts nothing
     * is compiled and this stays off — a rebuild there would need a toolchain the boss may not
     * have, to produce a binary they already have.
     *
     * **Linux has no prebuild.** The `.node` that `pnpm install` leaves behind is built against
     * the Node that ran the install, and Electron's V8 is a different ABI: loading it inside the
     * packaged app fails with `NODE_MODULE_VERSION`, which is a terminal that never opens. So on a
     * Linux host electron-builder rebuilds the native dependency against Electron's own headers
     * before it packs anything. It needs `python3`, `make` and a C++ compiler, which is what
     * `docs/linux.md` asks a packager to install.
     */
    npmRebuild: platform === 'linux',
    // node-pty's `spawn-helper` binary is run as a file, so it cannot stay inside the asar.
    asarUnpack: ['**/node_modules/node-pty/**'],
    /**
     * The fuses Electron burns into the packaged binary (T199, finding H4). An Electron binary
     * ships as a general-purpose Node interpreter unless the build says otherwise, and this one
     * holds the boss's keychain items, every Company's database and a live token per running
     * Session — so the defaults matter here more than in most apps.
     *
     * Without the first three, any process running as the boss — a postinstall script in a repo an
     * Employee just installed, which is a thing Employees do all day — loads its own code into the
     * real app with `NODE_OPTIONS='--require …'`, or uses the bundle as a Node that inherits every
     * permission macOS has already granted it with `ELECTRON_RUN_AS_NODE=1`. Neither needs a bug in
     * TinyCorp's own code. `--inspect` is a third door into the same room.
     *
     * The next two hold the app to the asar the build shipped, so the same process cannot edit
     * `app.asar` in place and own every launch after this one. They get much stronger once there is
     * a Developer ID signature — decision 54 says there is none yet — and turning them on now means
     * signing is the only step left rather than one of two.
     *
     * `resetAdHocDarwinSignature` is not a fuse but the price of one: flipping a fuse rewrites the
     * binary, which invalidates the ad-hoc signature Electron ships with, and Apple Silicon refuses
     * to run a binary whose signature does not match. `mac.identity` is null, so nothing re-signs
     * the bundle afterwards and the flip has to do it itself.
     *
     * electron-builder flips these itself, right before signing, through its own `@electron/fuses`
     * — which is why this is data here and not an `afterPack` hook with a dependency behind it.
     */
    electronFuses: {
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      enableCookieEncryption: true,
      resetAdHocDarwinSignature: true,
    },
    /**
     * arm64 only, not a universal binary: a universal build has to lipo two complete app bundles
     * together, and the only Macs this runs on are Apple Silicon. Unsigned and un-notarised: the
     * app keeps the ad-hoc signature Electron's own binary ships with, which is the least Apple
     * Silicon will run, and the boss opens it the first time with a right-click → Open. Going
     * further needs a Developer ID Application certificate in the keychain and an Apple ID with an
     * app-specific password for notarytool; nothing here has to change but `mac.identity` and a
     * `notarize` block.
     */
    mac: {
      icon: 'resources/icon.png',
      category: 'public.app-category.developer-tools',
      target: [
        { target: 'dmg', arch: ['arm64'] },
        { target: 'dir', arch: ['arm64'] },
      ],
      // No Developer ID here, so signing is skipped and Electron's own ad-hoc signature stands.
      identity: null,
      // macOS reads the menu bar and the app switcher from the bundle, never from `app.setName`.
      extendInfo: { CFBundleName: APP_NAME, CFBundleDisplayName: APP_NAME },
    },
    dmg: { title: `${APP_NAME} \${version}` },
    /**
     * `pnpm package:win`: a one-click NSIS installer for Windows x64, and the unpacked app beside
     * it that CI starts to prove the build opens a window (T166, `tools/smoke-packaged.mjs`).
     * node-pty ships its win32-x64 prebuild, so nothing is compiled. Unsigned either way:
     * SmartScreen warns once.
     *
     * The exe is **stamped on every host and signed on none.** electron-builder 26 writes the
     * icon and the version strings — `ProductName`, `FileDescription`, which is the name Windows
     * search, the taskbar and Task Manager show — with `resedit`, plain JavaScript, so a Mac builds
     * the same exe the Windows runner does. It used to need Wine off Windows, and turning the
     * whole step off there (`signAndEditExecutable: false`) shipped an installer whose app was
     * Electron's own icon under the name "Electron" (T249's first Windows run). `signExecutable:
     * false` skips only the signature, which there is no certificate for anyway.
     */
    win: {
      icon: 'resources/icon.png',
      target: [
        { target: 'nsis', arch: ['x64'] },
        { target: 'dir', arch: ['x64'] },
      ],
      signExecutable: false,
    },
    nsis: {
      oneClick: true,
      perMachine: false,
      artifactName: `${APP_NAME}-Setup-\${version}-\${arch}.\${ext}`,
    },
    /**
     * `pnpm package:linux` (T177): an **AppImage**, which runs on any desktop with no install and
     * no root, and a **.deb** for the Debian and Ubuntu boss who would rather their package
     * manager knew about it. The unpacked app sits beside them, which is what the smoke run starts
     * when the runner has no FUSE.
     *
     * x64 only. arm64 was not cheap: an arm64 AppImage cross-built on an x64 runner would carry an
     * x64 `node-pty`, because the rebuild above compiles for the host, and a Linux desktop whose
     * terminal cannot open is worse than no build at all. It wants an arm64 runner, which is a
     * ticket of its own.
     *
     * Unsigned, like the others: an AppImage nobody signed is the ordinary way one is handed over,
     * and the `.deb` is installed by a boss who fetched it themselves.
     */
    linux: {
      icon: 'resources/icon.png',
      // freedesktop's own category for an IDE-shaped thing, so it files under Development.
      category: 'Development',
      // `.deb` refuses to build without one, and a package with no maintainer is one nobody owns.
      maintainer: `${APP_NAME} <noreply@tinycorp.club>`,
      synopsis: 'A desktop orchestrator where a Company is a team of AI Employees.',
      target: [
        { target: 'AppImage', arch: ['x64'] },
        { target: 'deb', arch: ['x64'] },
        { target: 'dir', arch: ['x64'] },
      ],
      /**
       * The window association that stops GNOME and KDE showing a running TinyCorp as a second,
       * nameless, iconless item beside its own launcher, and stops a notification arriving with no
       * icon.
       *
       * Electron takes its `app_id` from `desktopName` in `package.json`; this makes
       * electron-builder name the `.desktop` file and write its `StartupWMClass` from the same
       * string, so the three agree by construction rather than by a guess about what Chromium
       * derives from `argv[0]`. The rest of the entry is generated: `Name` from the product name,
       * `Comment` from `synopsis`, `Icon` from the executable, and `Categories` from `category`
       * above — which is why none of them is written out here.
       */
      syncDesktopName: true,
    },
    // Type 2 is the AppImage that `--appimage-extract-and-run` understands, which is how it starts
    // on a CI runner with no FUSE (`.github/workflows/ci.yml`).
    appImage: { artifactName: `${APP_NAME}-\${version}-\${arch}.\${ext}` },
    deb: {
      artifactName: `${APP_NAME}-\${version}-\${arch}.\${ext}`,
      /**
       * libsecret is what Electron's `safeStorage` talks to, and it is the difference between a
       * Company that can hold an Environment's values and one that refuses them out loud (T176,
       * `safe-storage-secrets.ts`). Depending on it means apt installs it rather than the boss
       * meeting the refusal. The rest is Electron's own list for a Debian desktop.
       */
      depends: [
        'libgtk-3-0',
        'libnotify4',
        'libnss3',
        'libxss1',
        'libxtst6',
        'xdg-utils',
        'libatspi2.0-0',
        'libsecret-1-0',
      ],
    },
  }
}

/** The configuration for this machine. `electron-builder.config.mjs` is one line pointing here. */
export const packaging = packagingFor(process.platform)
