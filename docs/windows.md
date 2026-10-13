# TinyCorp on Windows

Everything on this page is about the Windows build. On a Mac or a Linux desktop there is one place
a CLI can be, and none of it shows.

Three tickets made the Windows build real:

- **T166** made the app run: the CLI resolver that knows a `.cmd` shim is not an image, the hook
  commands in the shells Windows really has, the window chrome, the path fixtures.
- **T167** made a Provider installed **inside WSL** a first-class place to run one. This page is
  mostly that.
- **T249** asked the boss, on the first launch, where their team runs — instead of leaving them to
  find the Providers card.
- **T252** kept `Create company` from failing with *database is locked*: the Company folder is on a
  drive of the PC, and never on a share.

## The first launch (T249)

The first time TinyCorp opens on Windows it draws one screen, before the Launcher and before the
preflight cards, and it asks two things (frames `laIUL`, `QFh5u`):

- **Where your team runs** — Windows, or a WSL distro. It is the default for *every* Provider; one
  Provider is still moved on its own in Your profile → Providers, and both screens say so. It opens
  on WSL when the machine has a distro, because that is where a developer's toolchain already is.
- **Right-click in the terminal** — paste, or the menu. It opens on paste, which is what every
  terminal on a Windows machine already does, and the other one is always `Ctrl` + right-click.

**It is the one screen in the app that holds.** There is no *Skip for now* and `Escape` does
nothing, because of the third thing it does: it looks for **Git for Windows' `bash.exe`**. A
Provider whose catalogue entry says `needsGitBash` runs its shell tools through `bash`, and a stock
Windows has none — nor a `git`, which comes from the same install. So a team set to run on Windows
without it cannot work at all, and `Continue` stays out until either `Check again` finds it or the
boss moves the team into WSL, where none of it applies. Both answers come preselected, so on a
machine that is already fine `Continue` is one press.

What is **not** Git Bash: `C:\Windows\System32\bash.exe`. That is the WSL launcher Windows ships,
it is on the `PATH` of every machine that ever enabled the feature, and taking it for Git Bash
would report success on precisely the machines this exists to warn.

Everything it asks is kept in the boss's own profile (`boss-profile.json`: `defaultRuntime`,
`rightClick`, `windowsSetupDone`) and never in a Company database — the same reason the rest of
that file is there, and it is why the step is shown once per boss rather than once per Company.
Afterwards, **Your profile → On this PC** (frame `t1VDYQ`) is where all of it is changed, and where
the Git Bash row says what this machine has.

The right-click setting is the one part of this that is not a Windows question: the card draws that
row on a Mac and on a Linux desktop too, where the default is the menu.

## The Company folder (T252, T256)

A Company is a SQLite database in a folder, and every write takes a lock on that file. Over a
network share there is no lock to take: Windows reaches a distro's own filesystem as
`\\wsl.localhost\<distro>\…` and a NAS as `\\nas\share\…`, and the very first write on either
fails with `SQLITE_BUSY: database is locked`.

That is not a hypothetical. A boss on Windows 11 met it on their first run, and they had not chosen
the folder: Windows' picker opened inside the WSL share where it had last been, and accepting it was
one click. So the app does not rely on the picker:

- **The Create step already has a folder** — `C:\Users\<you>\TinyCorp\<Company name>`, following
  the name until the boss picks something else, and created on Create if it is not there yet.
- **The picker opens at the home folder**, on every platform, rather than where it was last.
- **A share other than WSL is refused the moment it is picked**, in the words the boss needs — *A
  Company folder has to be on a drive of this PC … Pick a folder on C: or another drive; your repos
  can still live in WSL* — and `Create company` stays out until they pick another folder. The
  engine refuses it again in `createCompany`, `openCompany` and the move flow, before a file is
  written. A folder in WSL is accepted; the section below is where its database goes.
- **A folder OneDrive syncs is a warning, not a refusal** (`%OneDrive%`, `%OneDriveConsumer%`,
  `%OneDriveCommercial%`, never a folder called `OneDrive`): it works, and a sync can hold the
  database for a moment, so the field says a folder outside it is safer.

Two more things keep a Company on `C:` from meeting the same error for other reasons: every database
is opened with a five-second busy timeout, so a write waits for Defender or the indexer instead of
failing at once, and the whole schema is applied in one transaction rather than one per step. And
`app.requestSingleInstanceLock()` means the boss who clicks the shortcut after the installer already
opened the app gets the window they have, not a second copy reading the same files.

**The repos are untouched by all of it.** They can live inside the distro, on the UNC path, as the
git section below describes. An Employee running in WSL reaches a Company on `C:` as `/mnt/c/…`,
which is what T167 translates.

### A Company folder in WSL: the database stays on this PC (T256)

The boss's answer to T252 was that it is impossible every app does this, and they were right — no
app does. VS Code keeps its own SQLite state, `state.vscdb`, in AppData and runs a server inside
the distro for a folder in WSL; JetBrains keeps its indexes in `%LOCALAPPDATA%`. The project folder
holds files and the databases stay on the PC. TinyCorp was the odd one out only because a Company
folder carried its database.

So a Company folder in WSL is accepted, and for that folder alone the database moves:

- `company.sqlite` and its journal live in `%LOCALAPPDATA%\TinyCorp\Companies\<company id>\`.
  `LOCALAPPDATA` and never `APPDATA`: a roaming profile is synced between machines, and a live
  SQLite database copied out from under the process is the failure this all exists to avoid.
- **Everything else stays in the Company folder**: the memory wiki, Employees' notes, worktrees,
  attachments, restore points. That is where the Employees inside the distro reach them natively.
- The folder carries `.tinycorp\company.json` — `{ "id": …, "database": "this-pc" }` — which is a
  plain write the share handles fine. Opening the folder reads it and opens the database from
  AppData. It is written **only** for a folder in WSL; a Company on a drive has no such file and
  keeps its database in its folder exactly as before.
- **Where the team runs decides the folder the Create step offers.** A boss whose team default is a
  distro (*On this PC* → the first-launch question) is offered
  `\\wsl.localhost\<distro>\home\<you>\TinyCorp\<Company name>`, and the picker opens there;
  a team on Windows keeps `C:\Users\<you>\TinyCorp\<name>`. Under the field, with an `info`
  mark: *Lives in WSL. Its database stays on this PC, in AppData — SQLite can't lock a file across
  the WSL share.*
- **Move** carries the database across in either direction: into the folder when the Company leaves
  WSL, out to AppData when it enters. **Delete company** takes the AppData database too;
  **Forget** leaves everything where it is.
- A folder whose `.tinycorp\company.json` names a database this PC does not hold — another PC's, or
  an AppData that has been wiped — opens nothing and says *This Company's database is on another
  PC.* The Launcher shows that row as unavailable, with `Forget` as its only action.

**Any other share is still refused**, with the sentence above. A folder a second PC can open would
end up with one database per PC and no way to say which one is the Company.

## Where a Provider can be

A boss on Windows has installed `claude`, `codex` or `opencode` in one of two places, and often in
the second:

- **Windows itself**, on the Windows `PATH`. `where claude` finds it; so does TinyCorp, through
  `cli-command.ts`.
- **Inside a WSL distro** — Ubuntu, usually — where the rest of their toolchain already lives.
  Nothing on the Windows `PATH` knows about it.

TinyCorp looks in both — and inside a distro it looks **on the `PATH` the boss's own shell there
builds**, not on a login `sh`'s (T258):

```
wsl.exe -d Arch -e sh -c 'shell="$SHELL"; […]; exec "$shell" -ilc \'printf …"$PATH"\''
```

A login `sh` reads `/etc/profile` and `~/.profile` and nothing else, and Arch ships no `~/.profile`
— so `~/.local/bin` (which is where Claude Code's own installer puts itself), npm-global, nvm and
bun are all invisible to it while the boss's terminal has had them since the day they installed the
CLI. `-ilc` is interactive *and* login, because `~/.zshrc` is where that boss's `PATH` is really
written. It is the same question `readLoginShellPath` asks on a Mac and on a Linux desktop
(`login-path.ts`), asked inside the distro; it is read **once per distro per run of the app**, and
`Check again` forgets it. A shell that does not answer within `WSL_PATH_TIMEOUT_MS` falls back to
the old login `sh`, and says so in the log rather than quietly finding less.

**A hit under `/mnt/<drive>/` is not a hit.** WSL puts the Windows `PATH` on every distro's, so
`command -v claude` in Arch answers with the *Windows* npm shim — and running that would start the
Windows installation, with the Windows login, from inside Linux. So those paths are ignored, which
is what stops a machine with `claude` only on Windows from reading as "installed in Arch".

**The distros are asked in the boss's own order**: this Provider's pick first, then the distro the
team runs in, then the rest with the default one leading. The search stops at the first distro that
has the CLI, so an order that reached the team's distro third would often never reach it at all.

Your profile's Providers card says which it found:

| What was found | What the row shows |
| --- | --- |
| Both | a switch, `Windows │ WSL · Ubuntu`, and the line *Found in both. New Sessions start where you pick; a running one keeps its place.* |
| WSL only | a chip, `WSL · Ubuntu` |
| Windows only | a chip, `Windows` |
| Neither | the Provider Missing card, with both install commands and where the app looked |

The pick is the boss's, kept in their profile beside the rest of it (`boss-profile.json`,
`providerRuntimes`). It is a boss-level setting rather than a Company one for the same reason the
name and the sprite are: which `claude` this machine runs is a fact about the machine, and every
Company on it gets the same answer.

Without a pick of its own, a Provider runs where **the team runs** — the `defaultRuntime` the first
launch asked for — and, failing that, where it was found: a CLI found on Windows runs on Windows
(no path translation, no network hop, no distro to wake) and one found only in a distro runs there.
The three are settled in one place, `chooseRuntime`.

**The third is a last resort and never a correction** (T258). When the boss's own answer — their
pick, or where the team runs — names a place the CLI is not in, that Provider is **not installed
there**, and nothing falls through to Windows:

| | |
| --- | --- |
| The card | *Claude Code is not installed in WSL · Arch*, with that place's own install command and nothing else |
| The body | *…could not find the `claude` command in WSL · Arch, where you chose to run it* — and, when the CLI is somewhere else, *Or pick Windows for this Provider in Your profile → Providers.* |
| The row | the places the CLI really is, none of them selected, and *Not installed in WSL · Arch — pick a place below, or install it there.* |

Until T258 this machine — WSL chosen, `claude` on the Windows `PATH` too — got Windows Employees
and no word about it, which is the bug the ticket is named after. Falling back is now only for a
boss who has answered nothing at all.

**A running Session keeps where it started.** Changing the switch rebuilds the adapters in place;
a Session that is already running holds its own adapter, and its own place, until it stops.

### The Usage meter reads the login where the Provider is (T257)

Where a Provider runs is also where it is **signed in**, so it is where the meter reads. On Windows
Claude Code keeps its login in `%CLAUDE_CONFIG_DIR%\.credentials.json`, or in
`%USERPROFILE%\.claude\.credentials.json` when nothing names a folder — not in a keychain, which is what the meter used to
read on every platform and why it drew nothing here. Codex keeps `%CODEX_HOME%\auth.json`, or
`%USERPROFILE%\.codex\auth.json`.

A Provider whose Sessions run **inside a distro** signed in inside it, so its login is read from the
distro's home over the share — `\\wsl.localhost\<distro>\home\<you>\.claude\.credentials.json`,
your own Windows account name tried first among the homes, as T256's Create step tries it. One
Provider can be in each place, and each is read where it is.

An **added account** (Your profile → Providers → *Add another account*) is a config folder TinyCorp
made under the app's own data folder on this PC, so it is read from this side whichever place its
Sessions run in. A row that found no login says where it looked.

## How a Session runs inside a distro

`wsl-runtime.ts` wraps the two seams every adapter already takes, so no adapter knows any of this
and a Provider added tomorrow runs in WSL without a line about it.

```
wsl.exe -d Ubuntu --cd /mnt/c/work/acme -e sh -lc 'PATH=…; exec "$0" "$@"' claude --resume …
```

- `sh -lc` is a **login** shell. `wsl.exe -e claude` runs with WSL's bare environment and reports a
  CLI missing that the boss's own terminal finds every day.
- `PATH=…` in front of the script is the distro's own `PATH`, read once as above (T258). The Session
  therefore starts on the same `PATH` the lookup found the CLI on — which is the only way the two
  can agree — while the login profile still contributes everything else it sets.
- `exec "$0" "$@"` puts the command and its arguments in `argv` rather than inside a string the
  shell re-parses. Nothing is quoted, nothing is word-split, and `exec` makes the CLI the process
  the PTY is attached to — its signals, its exit code, its resizes.
- Every path that crosses is translated (`wsl-path.ts`): the cwd, the arguments, and the paths
  inside the files the adapters write. `C:\Users\b\x` ↔ `/mnt/c/Users/b/x`;
  `\\wsl$\Ubuntu\home\b\x` and `\\wsl.localhost\Ubuntu\home\b\x` ↔ `/home/b/x`. A UNC path into a
  *different* distro is left exactly as it was: opening the wrong file is worse than failing.
- The environment the app added — the hook token, and whatever else the app set rather than
  inherited — crosses through `WSLENV`. Windows's own `PATH` and `HOME` do not: the distro has its
  own, and crossing them would break the login shell this all depends on. A variable whose **value**
  is a Windows path gets `/p`, so `wsl.exe` translates it: `RTK_DB_PATH`, and every product's config
  folder (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `OPENCODE_CONFIG`) — which until T258 arrived as
  `C:\Users\…` and pointed an added account's sign-in at a folder no Linux process can open (T257).
  It is read off the value rather than a list of names, because `platform` sits below every Provider
  and may not name one.
- `handoffCommand` (T164) comes back as the `wsl.exe` line, so the terminal the boss opens is the
  machine the Session is on. So does **the product's own login** (T258): it used to open a Windows
  `cmd /k` running the Windows CLI, so a boss whose Employees are in Arch signed in the wrong
  installation and the card kept saying signed out however many times they did it. That line is
  quoted for `cmd.exe` rather than for `sh`, and built without a double quote in it, because it is
  parsed by `cmd.exe`, by `wsl.exe`'s own C runtime and by `sh` in turn.
- **Hooks are written for the runtime, not the host.** A Session in a distro is a Linux process and
  a product runs a hook command where it runs itself, so it gets the POSIX form whatever this
  Windows has installed — `hookPlatform`. Chosen by host, a `claude` in Arch was handed a PowerShell
  command line on any Windows without Git for Windows: a hook that fires and does nothing, so the
  Session never reported ready and the boss watched a terminal that worked beside a card that said
  it did not.

Signed in is checked **where the CLI runs**. A `claude` on Windows and a `claude` in Ubuntu are two
installations with two logins; asking the wrong one produces a card telling the boss to sign in
somewhere they already are.

## Networking: the hard part

The app listens on `127.0.0.1` — the hook receiver, so a Session can say what it is doing, and the
Company MCP server, which is the Session's hands. Inside a WSL2 distro on the **default NAT
network**, `127.0.0.1` is the distro itself. A Session starts, looks alive, and can do nothing at
all.

| Mode | What happens |
| --- | --- |
| **mirrored** (`networkingMode=mirrored` in `%USERPROFILE%\.wslconfig`) | the distro shares the host's interfaces. `127.0.0.1` is the host's loopback and nothing changes. |
| **NAT** (the default) | the host is the distro's default gateway — the Windows side of the `vEthernet (WSL)` adapter. The hook URL and the MCP URL are rewritten to that address, and the receivers listen on it as well as on loopback. |

The mode is read from `.wslconfig`, which costs nothing and starts nothing; `wslinfo
--networking-mode` confirms it from inside a distro that is awake anyway.

**Never `0.0.0.0`.** Binding every interface would put the Company MCP server — chat, the board,
approvals, the repos — on whatever wifi the boss is on. `listenOn` refuses `0.0.0.0` and `::`
outright, and a test says so. What is bound is loopback and one address on a virtual switch only
this machine's own distros are on. Every hook still carries its Session's token and every MCP call
its bearer: this widens where the bytes arrive, not who is answered.

`$(hostname).local` is the other address people use for this, and it is not used here: it needs the
distro's resolver to answer for a name the host has to be publishing, and it is empty or wrong on a
machine with mDNS off. The gateway is a number the distro already routes through.

### The Windows Firewall prompt

The first time the app binds the WSL switch address, Windows may raise a firewall prompt behind the
window — and a `curl` from inside a distro to a blocked port does not refuse, it hangs. So a
Session whose hooks are being eaten looks exactly like a Session that is thinking.

TinyCorp asks the network before a Session depends on it: from inside the distro it `curl`s the
hook receiver's `/health` path with the app's own probe token, and the Providers card's row says
what it found. Blocked reads:

> Sessions here cannot reach TinyCorp yet — Windows Firewall is blocking the WSL network. Allow
> TinyCorp on private networks and press Check again.

Allow **TinyCorp** on **private** networks. Public is not needed and should not be granted.

## Where the team runs: everything, not just Sessions (T259)

On the first launch a boss on Windows answers one question — **where does the team run**, this PC or a
distro — and that answer is `runtimes.team()`. It used to decide only where a Provider's *Session*
started. It now decides where every process TinyCorp runs for a Company starts: git, `gh` and `glab`,
`rtk`, a repo's run command under **Run it**, and the language server behind the Files view.

Every one of them starts on the **same `PATH` the Sessions do** — the distro's own, read once as above
(T258) and shared with the lookup through the same per-distro cache. It has to be the same one: T258
finds a CLI on that `PATH`, so a `gh` or an `rtk` in `~/.local/bin` or under nvm is one the app would
otherwise report installed and then fail to start, which is the exact disagreement T258 exists to end.

It has to, and the reason is one line of git's on-disk format. `git worktree add` writes an
**absolute** `gitdir:` link into the new worktree and an absolute `worktree` line back into the repo.
A Windows git writes `C:/code/acme/.git/worktrees/x` or `//wsl.localhost/Arch/home/b/acme/…`, and the
Employee's Linux git cannot follow either; the other way round is just as broken. So **a repo is
all-Windows or all-distro**, never both, and `runtimeForPath` is the one place that is decided:

| The repo is | The team runs | The git that runs |
| --- | --- | --- |
| on a drive (`D:\code\acme`) | anywhere | Windows |
| in a distro (`\\wsl.localhost\Arch\…`) | on this PC | Windows, with `safe.directory` |
| in a distro | in a distro | **that distro's own git** |

A drive stays with Windows even when the team is in Arch: `/mnt/d/code/acme` is the same bytes, but
the worktree links under it were written by the Windows git that made them.

A repo in a distro *while the team runs on this PC* keeps the T256 behaviour exactly: Windows's git
over `\wsl.localhost\<distro>\homecme`, with `-c safe.directory=<that path>` in both spellings on
the app's own command line — git writes the repo's path as a UNC with forward slashes while this
process holds the backslashed one, and `safe.directory` is multi-valued, so both are named. Never
`safe.directory=*`, which would turn the protection off for every repo on the machine, and never a
write to the boss's global config, which is theirs. A path alone never moves a command into a distro,
because a distro with no `git` installed has to stay a machine the app works on.

Once the team **is** in that distro, none of that is needed: there git is simply the owner of those
files. It is also faster — the 9P share this process reads `\wsl.localhost\…` over is several times
slower than the same repo on a drive, and a `git status` run inside the distro never touches it.

### Worktrees that are already on disk

They keep working, and nothing is rewritten. A worktree a Windows git made for a repo on a drive is
still worked on by the Windows git, because the repo is still on a drive — the table above is about
where the repo is, and that has not changed.

The one case that can move is a repo **in a distro** whose worktrees a Windows git made while the
team ran on this PC, on a boss who then switches the team to WSL. Those links are
`//wsl.localhost/Arch/…`, and the distro's git cannot follow them. TinyCorp does **not** run
`git worktree repair` for this: repair rewrites the links of every worktree of a repo, and doing that
unasked on a switch the boss may switch straight back would break the worktrees that were fine. The
boss finishes the ticket — the merge removes the worktree — or runs `git worktree repair` in the repo
themselves, which is one command and is what `Move company…` already runs for the same reason.

### Where a ticket's worktree goes

A worktree lives on the **repo's** filesystem, not the Company's (T255).

Worktrees normally go under the Company folder, `<Company>\worktrees\<repo>\<branch>`. A repo can
be anywhere, and a boss whose repos are in the distro with the Company folder on `C:` would get
`git worktree add` writing the worktree onto `C:` — and the Employee inside the distro would edit,
build and `npm install` through `/mnt/c`, drvfs, where `node_modules` crawls and file watchers do
not fire.

So the rule is the *kind* of filesystem, asked of both sides: worktrees go under the Company folder
only when the Company folder and the repo are on the same kind. A repo at
`\\wsl.localhost\Arch\home\b\app` with a Company folder on `C:` gets
`\\wsl.localhost\Arch\home\b\app-worktrees\<branch>` — the same `<repo>-worktrees` folder
decision 45 already writes for a repo that contains the Company folder. A Company folder that is
itself in the distro — which T256 allows — is on the same kind as the repo, so its worktrees stay
under it, already inside the distro and with nothing to move. macOS, Linux, and Windows with both
on a drive keep the layout they had.

Worktrees already on disk are **not** moved: the `worktree` table says where each one is and
everything reads it from there, so only new ones follow the rule. A boss who wants an old one
moved finishes the ticket — the merge removes the worktree — or removes it by hand with
`git worktree remove` in the repo and lets the next ticket land in the new place. Removing a
finished ticket's worktree takes that folder and nothing else: never the repo, and never the
`<repo>-worktrees` folder, which is left alone even when it empties.

One thing this does not reach: `Delete company…` clears `<Company>\worktrees`, so worktrees beside
a repo in the distro survive it. They are ordinary git worktrees of a repo the boss keeps, and
removing them would mean reaching outside the Company folder.

## What stays on Windows, and why

Not everything should cross, and these do not:

- **the Electron app and the renderer** — it is a Windows desktop app, and that is what draws the
  windows the boss uses;
- **the pty**, which is attached to `wsl.exe`: a Session in a distro is a `wsl.exe` process on
  Windows with a Linux process inside it, so the terminal, its resizes and its keystrokes are the
  Windows ones they always were;
- **the hook and MCP receivers**, which listen on host addresses — a Session inside the distro dials
  the host, which is what `wsl-network.ts` and the self-test are about;
- **the SQLite database**, on this PC even for a Company folder in the distro (T252, T256): SQLite's
  locking over the 9P share is not something to trust a Company's history to;
- **secrets**, through DPAPI, which is a Windows API and has no meaning inside a distro;
- **file dialogs, Explorer and notifications** — the boss's own desktop;
- **the Testing screenshot window**, which reaches a dev server inside the distro through
  `localhost`, because that is what WSL already forwards;
- **the UI's own reads of files** — the Files view, the tree, an image preview — which cross the
  share with `node:fs`. A whole `wsl.exe` to read one file the process can already open buys nothing.

## Checking it by hand

Real WSL is not available on hosted runners, so the unit tests fake `wsl.exe` and the end-to-end is
manual. On a Windows with WSL:

1. **Install a Provider inside the distro only.** In `wsl`:
   `curl -fsSL https://claude.ai/install.sh | bash`, then `claude /login`. Make sure it is **not**
   on the Windows `PATH` (`where claude` in PowerShell finds nothing).
2. **Start TinyCorp.** Your profile → Providers. The row reads `Connected` with the chip
   `WSL · Ubuntu`, and the account under it is the one you signed in with inside the distro.
3. **Stop the distro first** (`wsl --shutdown`) and press `Check again`. The row says
   *WSL · Ubuntu is stopped — it starts when a Session does.* The probe takes a few seconds and
   wakes it; nothing turns red.
4. **Hire an Employee on that Provider and start a Session.** The terminal shows the CLI's TUI.
   Check `wsl -d Ubuntu -e ps aux | grep claude` finds the process.
5. **The hooks arrive.** The Employee goes `busy` and then `idle` in the drawer. If it stays `off`,
   the hooks are not reaching the receiver: look for the firewall line on the Providers row.
6. **The MCP hands work.** Ask the Employee something in chat. A reply means the Company MCP server
   was reachable from inside the distro, which is the whole networking story in one message.
7. **Paths.** Give it a ticket in a repo on `C:\`. Its worktree is `C:\…` in Windows Explorer and
   `/mnt/c/…` inside the distro, and the Employee edits the same files the app diffs.
8. **Install it on Windows too**, and press `Check again`. The row grows the switch. Move it to
   `Windows`; the next Session starts there, and a Session that was already running stays in the
   distro until it stops.
9. **A repo inside the distro.** Add `\\wsl.localhost\Ubuntu\home\<you>\somerepo` as a repository.
   It should be inspected, branched and diffed without a *dubious ownership* error. Give it a
   ticket: the worktree is `\\wsl.localhost\Ubuntu\home\<you>\somerepo-worktrees\<branch>`,
   which is `~/somerepo-worktrees/<branch>` inside the distro and nothing under `/mnt/c`.
10. **A Company folder in the distro (T256).** With the team default set to that distro, open
    `Create company`: the folder it already offers is
    `\\wsl.localhost\<distro>\home\<you>\TinyCorp\<name>`, and the line under the field says the
    database stays on this PC. Press Create. Then check all three:
    - `wsl -d <distro> -e ls ~/TinyCorp/<name>` shows `.tinycorp`, `memory` and, once a ticket is
      moving, `worktrees` — and **no** `company.sqlite`;
    - `%LOCALAPPDATA%\TinyCorp\Companies\<company id>\company.sqlite` is there, and the id is the
      one in `~/TinyCorp/<name>/.tinycorp/company.json`;
    - a Session in that Company starts with its cwd at `~/TinyCorp/<name>` inside the distro
      (`wsl -d <distro> -e ls -l /proc/$(pgrep -n claude)/cwd`), not under `/mnt/c`.

    Then `Company settings → Move…` it to `C:\Users\<you>\TinyCorp\<name>`: `company.sqlite` is
    in the folder, `.tinycorp` is gone, and `%LOCALAPPDATA%\TinyCorp\Companies` is empty. Move it
    back and the three checks above hold again.
11. **A network share that is not WSL.** In `Create company`, browse into `\\<a NAS>\<share>` and
    pick it. The footer says the folder has to be on a drive of this PC and `Create company` is
    out; the folder the field had before is still offered, and pressing Create with it works.
12. **Mirrored mode.** Put `networkingMode=mirrored` under `[wsl2]` in `%USERPROFILE%\.wslconfig`,
    `wsl --shutdown`, restart TinyCorp. Everything above still works, and nothing is bound beyond
    loopback.

## What CI covers

`.github/workflows` runs the whole suite, the build and `node tools/smoke-packaged.mjs` on
`windows-latest` as well as on Linux. Everything WSL is unit-tested against a fake `wsl.exe`:

- path translation, both directions, with spaces, drive letters and UNC paths;
- the distro listing, including its UTF-16LE output, no WSL at all, a stopped distro and a probe
  that timed out;
- the argv a WSL Session is spawned with, and the environment that crosses;
- the hook and MCP URLs in NAT and mirrored modes;
- that the receivers never bind `0.0.0.0`;
- the whole provider conformance suite, run a second time for every adapter with the CLI inside a
  distro.
