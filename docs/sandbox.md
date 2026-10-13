# The Sandbox add-on

An Employee is a coding agent with a shell, working in a repo on the boss's own computer. The
**Sandbox** add-on (T260, Company settings → Add-ons) puts every one of that Company's Sessions
inside [ai-jail](https://github.com/akitaonrails/ai-jail): a fresh home each launch, its worktrees
writable, its Session config read-only, its Provider login mounted so the CLI can start, and the
boss's own home unreachable.

It is off until the boss turns it on, and it is read at every spawn — so turning it off takes at
each Employee's next Session and never mid-turn.

## TinyCorp never ships it, and never installs it

ai-jail is **GPL-3.0-only**. TinyCorp finds it on the runtime's `PATH` and runs it as a separate
program: it is never vendored, never a dependency, never bundled. That is the same shape RTK has
(T179) for a different reason — RTK is Apache-2.0 and we still do not ship it; ai-jail we could not.

The card offers the line and the boss runs it:

| Machine | Line |
| --- | --- |
| macOS | `brew tap akitaonrails/tap && brew install ai-jail` |
| Arch, or a distro like one | `yay -S ai-jail-bin` |
| Any other Linux | `cargo install --locked ai-jail` |
| Inside WSL | the Linux line, run **in the distro**, labelled with its name |
| Windows itself | none — ai-jail does not run there |

Which Linux it is comes from `ID` and `ID_LIKE` in `/etc/os-release`, so Manjaro and EndeavourOS
(`ID_LIKE=arch`) get the AUR line too. A machine that ships no `os-release` is offered Cargo, which
works wherever Rust does.

## The line a Session is started with

Built in the runtime layer (`src/main/platform/sandbox-runtime.ts`), below every adapter, so it is
the same on macOS, on Linux and inside WSL:

```
ai-jail --agent-state --worktree --network [--ro-map DIR]… [--rw-map DIR]… [--env NAME]… -- <the Provider's command>
```

- `--agent-state` mounts the Provider's own sign-in folder. It is the only thing from the boss's
  home a Session gets, and without it the CLI starts signed out.
- `--worktree` makes the per-worktree git dir **and the shared common dir** writable. This one is
  not optional: every Employee works in a linked worktree, whose `.git` is a file pointing into the
  main repo, so without it `git commit` fails inside the jail and the Employee can do no work.
- `--network` leaves the network open. See below.
- `--ro-map` is the folder TinyCorp writes that Session's own config into; `--rw-map` is RTK's
  per-Company history folder, which a hooked Session creates its file in.
- `--env NAME` carries a variable the app itself put on the process. ai-jail's default is a minimal
  environment allowlist, so without these a Session would start without its hook token and be deaf
  to TinyCorp. Names only: the value is already on the process, so no secret is written into an
  argument list where `ps` would show it.

The worktree itself needs no map — it is the working directory, which ai-jail makes the project and
writable.

Inside WSL the jail composes **outside** the `wsl.exe` wrap, so what reaches the distro is

```
wsl.exe -d Arch --cd … -e sh -lc 'exec "$0" "$@"' ai-jail --agent-state … -- claude --resume …
```

and every mapped path is translated on the way in by the same rule every other argument is.

Hooks, MCP stdio servers and RTK need nothing: they are children of the CLI, so they are already in
the jail. TinyCorp's own processes stay outside it.

## Why the network is open

**This is the part of the add-on that is not finished, and the card says so rather than implying
otherwise.** The frame's `NETWORK` block has one state, `Open`, and this sentence under it:

> The jail guards your files, not the network. ai-jail cannot yet let a Session reach TinyCorp on
> this computer while it filters everything else, so the network stays open.

The add-on was meant to ship with a filtered network — the Provider's API, the forge, the package
registries and the hosts the Employee's MCP servers name, and nothing else. It cannot, and the
reason is in ai-jail rather than in us. Read from its source at **v2.2.0**:

- With `--allow-host`, the sandbox keeps **no route off the host except ai-jail's own CONNECT
  proxy**: on macOS one seatbelt rule, `(allow network-outbound (remote ip "localhost:<proxyport>"))`
  and deny-default for everything else; on Linux a private network namespace (`--unshare-net`).
- That proxy carries an SSRF guard that refuses loopback **and every private range**, applied to
  each resolved address at dial time. Upstream pins it with a test named
  `e2e_ssrf_range_is_403_even_when_allowlisted`: `--allow-host 127.0.0.1` is a `403`, and so is any
  other address of this machine.
- `--allow-tcp-port` exists but **fails the launch outright** — "UDP cannot be isolated".
- Filtered mode grants no `system-socket` and no unix-socket rule either, so TinyCorp cannot expose
  its receivers on a socket and have the jail reach it.
- `--network` reaches loopback, and **cannot be combined with `--allow-host`**.

TinyCorp's hook receiver and Company MCP server are both HTTP on this computer's loopback
(`src/main/platform/net/listen-on.ts`), and neither is optional: the first is how TinyCorp sees what
an Employee is doing at all, the second is how the Employee reads the board, the chat and the
Company memory. A filtered Session is a deaf Session, so the add-on guards the files and leaves the
network alone.

There **is** an undocumented `AI_JAIL_TEST_PROXY_ALLOW_PRIVATE` environment variable that turns the
SSRF guard off. TinyCorp does not set it and should not: it disables the guard *wholly* — loopback,
the entire RFC1918 LAN and cloud metadata at `169.254.169.254` — rather than opening one port, and
upstream's own comment says it is never to be set in normal operation.

### Future work: one loopback port

What would unlock the other half is a single flag upstream: **an allowance for one
operator-named loopback port**, kept distinct from the test-only escape hatch — enough to let a
sandboxed process reach `127.0.0.1:<the port TinyCorp is listening on>` while the CONNECT proxy
still filters everything else. With it, the `NETWORK` block becomes the two states the add-on was
designed around, and item 4 of T260 — the Provider API hosts declared in each Provider's catalogue
entry, the forge hosts, the package registries and the MCP hosts — becomes worth building.

A second backend would also make it moot: **the Providers' own built-in sandboxes** (Claude Code's
and Codex's Seatbelt/Landlock modes) already know how to let their own agent reach a local MCP
server. That is a bigger change than a flag, and its own ticket.

None of this has been filed upstream. It is written here first, deliberately.

## What was not executed

The behaviour above is read from ai-jail's source and its own tests, **not run**: ai-jail was not
installed on the machine this was built on, and TinyCorp does not install it. The commands that
would prove it by hand, against a throwaway local server and plain `curl` — never an agent Session,
which would spend the boss's subscription — are:

```sh
python3 -m http.server 7377 &                     # outside the jail
ai-jail --agent-state --allow-host 127.0.0.1 -- curl -sS -m 5 http://127.0.0.1:7377/   # expect 403
ai-jail --agent-state --network      -- curl -sS -m 5 http://127.0.0.1:7377/           # expect 200
ai-jail --dry-run --agent-state --worktree -- claude --version                          # prints the plan
```

## Windows

ai-jail does not run on Windows itself; upstream says to use WSL2 with the Linux backend. So:

- A team whose Providers run **inside a distro** is jailed normally, and ai-jail is looked for and
  installed in that distro (T167, T258).
- A team on **Windows itself** cannot use the add-on. The toggle is disabled with the card's *On
  Windows* sentence, and an Employee whose Sessions are starting without the jail the boss asked for
  says so on its drawer's meta strip — *Not sandboxed — ai-jail does not run on Windows itself.*

## It is not a virtual machine

The card's last line, and worth repeating: ai-jail constrains a process. It does not stop a kernel
or driver exploit, and its own README says it is "not 100% secure, but enough".
