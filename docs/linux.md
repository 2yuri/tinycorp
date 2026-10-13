# TinyCorp on Linux

Everything on this page is about the Linux build. On a Mac or a Windows machine none of it shows.

TinyCorp was written for three platforms from the first line, and the unit suite has run on Ubuntu
since T166 — but nobody had ever *packaged* it for Linux or started what came out. **T177** is
that: an AppImage and a `.deb`, node-pty compiled against Electron, the Mac affordances given a
Linux behaviour, and a CI job that starts the packaged app under `xvfb` on every pull request.

## Supported distros

| Distro | From | Why that line |
| --- | --- | --- |
| Ubuntu | **22.04 LTS** | glibc 2.35, which is what Electron 44 needs. 20.04 has 2.31 and will not start. |
| Debian | **12 (bookworm)** | the same glibc floor. |
| Fedora | **39** | the first still-current release; the `.deb` is not for it, the AppImage is. |

Anything newer than those works. Anything older is a glibc the Electron binary will not load, and
that is Electron's floor rather than TinyCorp's.

**x86-64 only.** There is no arm64 Linux build yet: the AppImage would have to be cross-built on an
x64 runner, and the `node-pty` inside it is compiled for the host — so an arm64 image built that
way carries an x86-64 terminal that cannot open. It wants an arm64 runner, which is its own ticket.

## What it needs installed

The `.deb` declares all of this and `apt` installs it for you. The AppImage cannot, so this is the
list for an AppImage on a minimal desktop:

| Package (Debian / Ubuntu name) | What stops working without it |
| --- | --- |
| `libgtk-3-0`, `libnss3`, `libgbm1`, `libasound2t64` | nothing at all: Electron does not start |
| **`libsecret-1-0`** | Environments and MCP tokens are **refused**, with the reason on screen |
| `libnotify4` | native notifications |
| `xdg-utils` | *Open in editor* falling back to the system default |

### libsecret, and the keyring

Every secret TinyCorp holds — the Environments' values and the boss's MCP tokens — goes through one
store with one backend per platform (`src/main/platform/safe-storage-secrets.ts`). On Linux that
backend is Electron's `safeStorage`, which is libsecret: **GNOME Keyring** or **KWallet**.

If there is no keyring running, `safeStorage` falls back to a hard-coded key that is in Electron's
own source. `isEncryptionAvailable()` still answers true and the bytes on disk are readable by
anything that knows the algorithm. **TinyCorp refuses to store a secret there** and says so:

> There is no keyring running on this desktop, so Electron would "encrypt" these values with a key
> that is in its own source — anything on this machine could read them back. TinyCorp will not
> store a secret there. Start GNOME Keyring or KWallet, then reopen TinyCorp.

The Environments tab shows that line in place of the variables table, and every attempt to save a
value or an MCP token is refused with the same sentence. A lock drawn over no lock is worse than no
lock.

A GNOME or KDE desktop has a keyring running already. A window manager started by hand — i3,
sway, a `startx` session — often does not: start `gnome-keyring-daemon --start --components=secrets`
from the session's own startup, or run `kwalletd6`.

*Reveal* and *Copy* ask you to confirm every time, the way they ask for Touch ID on a Mac. There is
no Linux equivalent of the Touch ID prompt for an unsigned desktop app, so the footer under the
table says *ask you to confirm* rather than promising a fingerprint — and the screen says out loud
that the confirmation is the only thing standing between the value and whoever is at the keyboard.

## Installing

### The AppImage

One file, no install, no root.

```sh
chmod +x TinyCorp-0.0.0-x86_64.AppImage
./TinyCorp-0.0.0-x86_64.AppImage
```

It is unsigned, like the DMG and the Windows installer. On a machine with no FUSE — a container, a
CI runner, some hardened images — start it with `APPIMAGE_EXTRACT_AND_RUN=1`, which unpacks it to a
temp folder instead of mounting itself, or install `libfuse2`.

The AppImage puts no desktop entry in your menu by itself. Tools like
[AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher) do it for you, or the `.deb`
does it as a matter of course.

### The .deb

```sh
sudo apt install ./TinyCorp-0.0.0-amd64.deb
```

It installs to `/opt/TinyCorp`, puts `tinycorp` on `PATH`, and writes
`/usr/share/applications/tinycorp.desktop` — named TinyCorp, with the app's icon, filed under
**Development**. The entry's `StartupWMClass` and its filename are both `tinycorp`, which is the
`app_id` Electron takes from `desktopName` in `package.json`: without the three agreeing, GNOME
shows a running TinyCorp as a second, nameless item beside its own launcher, and a notification
arrives with no icon.

It also carries `Recommends: libappindicator3-1`, which is the tray — a recommendation rather than
a dependency, because a desktop with no indicator is a TinyCorp that works and has no tray, not a
TinyCorp that will not install.

## Building it yourself

```sh
pnpm install
pnpm package:linux      # AppImage, .deb and release/linux-unpacked/, all x64
node tools/smoke-packaged.mjs
```

`pnpm package:linux` builds **on Linux**, not from a Mac: it compiles `node-pty`, and a
cross-compile is not something this repo sets up. It needs `build-essential` and `python3` for that
compile.

**Why node-pty is compiled here and nowhere else.** It ships N-API prebuilds for darwin-arm64 and
win32-x64, so those two hosts pack the binary they already have. There is no Linux prebuild, and the
`.node` that `pnpm install` leaves behind was built against the Node that ran the install — a
different ABI from Electron's. Loading it inside the packaged app fails with
`NODE_MODULE_VERSION`, which on this app means a terminal that never opens. So `npmRebuild` is on
for the Linux host and off for the other two (`src/build/packaging.ts`), and it stays outside the
asar either way, because node-pty's `spawn-helper` is run as a file.

## What is different from the Mac

| Thing | On a Mac | On Linux |
| --- | --- | --- |
| Secret store | the login keychain, via `security` | `safeStorage` → libsecret, refused with no keyring |
| *Reveal* / *Copy* | Touch ID or your password | a confirmation dialog, and the screen says so |
| Keep-awake mug | `powerSaveBlocker` | the same call — it is all three platforms since T177 |
| Menu-bar item | the menu bar | an AppIndicator where the desktop has one, else nothing, quietly |
| Notifications | the Notification Center | libnotify. There is no settings pane to open, so the app offers none |
| Title bar | hidden, with the traffic lights placed | hidden, with `titleBarOverlay` drawing the three buttons |
| *Open in editor* | the `.app` in `/Applications` | the executable on `PATH`, plus `/snap/bin`, the flatpak exports and the JetBrains Toolbox scripts |
| The `PATH` the app gets | launchd's, widened from the login shell | the session's, widened the same way — with `$SHELL`, bash where none is set |
| Hook commands | POSIX sh with `curl` | POSIX sh, `curl` **if it is there**, else a `node -e` POST |

### The tray

GNOME has shipped no tray of its own since 3.26, so a plain GNOME session has nowhere to put the
item unless the boss installed the AppIndicator extension. KDE, Cinnamon, XFCE and Budgie all do.
Where there is none, `new Tray(...)` throws, TinyCorp catches it and says nothing — and the last
window closing then **quits** the app rather than leaving a process nobody can see or get back to.
Clicks on an AppIndicator never reach the app either, which is why everything the item can do lives
in its context menu and always has.

### Hooks without curl

A hook is the one thing TinyCorp asks another product's shell to run, and it is POSIX sh here as on
the Mac. `curl` is on every Mac and on plenty of Linux installs — and not on a Debian netinstall,
not in most container images. The command's own `|| true` is there so a receiver that is not
listening never fails the Employee's command, and it swallowed a missing `curl` just as quietly:
the Session ran and the office never heard a word from it.

So the command asks first, and falls back to a `node -e` POST that does the same thing — `node` is
there whenever `claude` or `opencode` is, because both are npm packages. With neither, the hook
stays silent and still exits 0, which is exactly what it did before.

### Open in editor

Discovery is the executable, not a bundle: each editor's commands are looked for on `PATH` — which
`adoptLoginShellPath` has already widened with your login shell's own — plus `/snap/bin`,
`/var/lib/flatpak/exports/bin`, `~/.local/share/flatpak/exports/bin` and
`~/.local/share/JetBrains/Toolbox/scripts`, none of which a `.desktop` launch inherits.

| Editor | Found as |
| --- | --- |
| VS Code | `code`, `code-insiders`, `com.visualstudio.code` (flatpak) |
| Cursor | `cursor`, `co.anysphere.cursor` |
| Zed | `zed`, `zeditor`, `dev.zed.Zed` |
| JetBrains | `idea`, `idea-ce`, `webstorm`, `pycharm`, `pycharm-ce`, `goland`, `phpstorm`, `rubymine`, `clion`, `rider`, `datagrip`, `rustrover` |

Nothing is run to find out: a command is found when it is a file with the execute bit. The file is
then handed to it as its one argument, detached, so closing the office never closes the window you
are reading.

## What CI covers

`.github/workflows/ci.yml` has one job per platform, and each does the same five things: install,
typecheck, `pnpm test`, `pnpm build`, package, and start what came out. The Linux job runs
`pnpm package:linux` and then `xvfb-run node tools/smoke-packaged.mjs`, which starts the **AppImage
itself** — not the unpacked folder — opens no Company, loads one window, and quits. The run passes
on exit code 0, the line the app prints when its window has loaded, and an empty crash log.

A runner has no FUSE and an extracted AppImage cannot carry a setuid sandbox helper, so the smoke
run sets `APPIMAGE_EXTRACT_AND_RUN=1` and `--no-sandbox` on Linux and on no other platform.
