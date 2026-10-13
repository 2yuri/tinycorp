# MCP presets, and what TinyCorp finds on your machine

Company settings → Integrations has three sections (T242, frames `mPqN9` and `gue8i`):

- **In this Company** — the catalogue an Employee is actually handed from (T136).
- **Found on this machine** — the MCP servers already configured in your own tools.
- **Popular** — servers set up in one step.

All three are searchable from the one field at the top of the tab.

## Found on this machine

Every Session is spawned with its Provider's strictest MCP flag, so an Employee never inherits
what you have configured for yourself. That is deliberate, and it is also why a boss who already
has six servers in Claude Code had to type all six in again. This section reads those files.

`src/main/features/catalogue/mcp-sources.ts` is the reader. **It only ever reads.** Nothing in
TinyCorp writes to a file belonging to another program, and the values it parses never leave the
main process: the renderer is handed names, and one click sends a name back, at which point the
values go from that process's memory to the OS secret store (`src/main/platform/`) and nowhere
else. `mcp-sources.test.ts` and `mcp-ipc.test.ts` both go looking for the secrets in what crosses
and expect not to find them.

Six tools, and where each keeps its servers per OS:

| Tool | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Claude Code | `~/.claude.json` | same | same |
| Codex | `~/.codex/config.toml` | same | same |
| OpenCode | `~/.config/opencode/opencode.json` | `%APPDATA%\opencode\` | `$XDG_CONFIG_HOME/opencode/` |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` | `%APPDATA%\Claude\` | `$XDG_CONFIG_HOME/Claude/` |
| Cursor | `~/.cursor/mcp.json` | same | same |
| VS Code | `~/Library/Application Support/Code/User/mcp.json` | `%APPDATA%\Code\User\` | `$XDG_CONFIG_HOME/Code/User/` |

`CLAUDE_CONFIG_DIR` and `CODEX_HOME` move the first two, the way those products' own CLIs read
them. `XDG_CONFIG_HOME` moves the other three on Linux.

Three things the reader does that are worth knowing:

- **Claude Code's project scope is read too**, because `claude mcp add` writes the project by
  default. The user scope is read first, and a project server whose name the user scope already
  used is not listed twice.
- **Two of the files are JSON with comments.** VS Code ships `mcp.json` commented and Cursor's is
  edited by hand, so comments and a trailing comma come out before it is parsed.
- **A server TinyCorp cannot carry is listed and refused, never guessed at.** `sse`, a name the
  catalogue could not hold, a header name no adapter could write: each says why on its own row and
  offers no button.
- **A server that authenticates with named headers comes across with them** (T245). Its header
  names go in the catalogue and every one of their values goes to the OS store — the same rule a
  `stdio` server's environment travels under, and for the same reason: this is your config, and
  TinyCorp cannot tell which half of it is private, so it treats all of it as private.

Codex names an `http` server's token by the *variable* it is in rather than holding the value, so
there is nothing to carry across for one of those — the row comes over without a token and you
type it in once.

## Presets

`src/shared/catalogue/mcp-presets.ts` is the whole table. Adding one is an entry there: its
transport, its URL or its command, the fields the boss has to fill, where to get them, the page
the facts were read off and the day they were read. `mcp-presets.test.ts` checks every entry
against those rules.

There are four kinds of field, and the kind says where the value goes:

| Kind | Where it goes |
| --- | --- |
| `secret` | The OS store: the bearer token of an `http` server, or a named environment value of a `stdio` one |
| `text` | Into the URL or the arguments, in place of `{key}` — so it may never hold anything private |
| `header` | An HTTP header, plain text in the Company database beside the URL |
| `header-secret` | An HTTP header whose **value** is in the OS store, under `<server id>:<header>` |

A field may name `options` instead of taking anything typed: the dialog draws a select, opens on
the first of them, and the URL in front of the boss is a real one before they have touched
anything. A preset may carry more than one `links` row, because a server can want two things from
two pages — and a link is filled in from the same `{key}` placeholders the URL is, so Datadog's key
pages are the ones on the site that was just chosen.

A preset is a claim about somebody else's product that a boss will act on without checking, so
the bar is: **an official server, checked against its own current documentation.** Eleven made it.

| Preset | Transport | What it is | Checked against |
| --- | --- | --- | --- |
| GitHub | http | `https://api.githubcopilot.com/mcp/`, bearer PAT | github/github-mcp-server |
| Linear | http | `https://mcp.linear.app/mcp`, bearer API key | linear.app/docs/mcp |
| Sentry | stdio | `npx -y @sentry/mcp-server@latest`, `SENTRY_ACCESS_TOKEN` | getsentry/sentry-mcp |
| Stripe | http | `https://mcp.stripe.com`, bearer agent key | docs.stripe.com/mcp |
| Supabase | http | `https://mcp.supabase.com/mcp`, bearer PAT | supabase.com/docs |
| Context7 | http | `https://mcp.context7.com/mcp`, bearer key (optional) | upstash/context7 |
| Datadog | http | `https://mcp.{site}/v1/mcp`, `DD_API_KEY` + `DD_APPLICATION_KEY` headers | docs.datadoghq.com/mcp_server |
| SigNoz | http | `https://mcp.{region}.signoz.cloud/mcp`, `SIGNOZ-API-KEY` + `X-SigNoz-URL` headers | signoz.io/docs/ai |
| Playwright | stdio | `npx -y @playwright/mcp@latest`, no secret | microsoft/playwright-mcp |
| Filesystem | stdio | `npx -y @modelcontextprotocol/server-filesystem <folder>` | modelcontextprotocol/servers |
| Figma | http | `http://127.0.0.1:3845/mcp`, no secret | developers.figma.com |

Every URL in that table is in the preset entry with its source link and its date.

### The three that were dropped

The ticket named twelve candidates. Three are not here, and each for a reason that would be the
same tomorrow:

- **Postgres** — the reference `@modelcontextprotocol/server-postgres` is archived, and there is
  no official successor. The alternatives are community servers with no standard among them, so a
  preset would be TinyCorp picking one on the boss's behalf. Supabase covers a Postgres that has
  an official server; anything else is one `Add an MCP server` away.
- **Slack** — the reference server is archived too, and the README now points at a third party's.
  It may well be the right one, but "de facto standard" is not something a maintainer handoff
  establishes on its own.
- **Notion** — the hosted server is OAuth only, which an Employee cannot complete: it needs a
  browser and a person. The stdio package that takes an integration token says in its own README
  that it is no longer maintained. Either half would work; neither half is one TinyCorp should
  put its name to.

An OAuth-only server is the general shape of what cannot be a preset here: an Employee cannot
complete a consent screen, because that needs a browser and a person. Sentry and Figma are in the
table because each has a second door — a token for one, a server running inside the desktop app for
the other — and Datadog and SigNoz are in it for the same reason (T245): both say in their own
documentation that named headers are the way in for a client that cannot do their OAuth, and named
headers are now something TinyCorp carries.

**Self-hosted SigNoz is not a preset**, and the SigNoz entry's caveat says so. It is a
`signoz-mcp-server` binary you download or `go install` yourself; a preset would have to write the
absolute path of a binary TinyCorp does not fetch, and its two values are plain environment rather
than a secret in a header. Once it is on the machine it is one `Add an MCP server` away, which is
an honest sentence where a preset would have been a promise.

## Where the values live

Nothing about any of this changes where a secret is kept. A preset's token, a found server's
environment and a header-authenticated server's keys all go to the one OS-backed store
(`src/main/platform/safe-storage-secrets.ts`) —
the macOS keychain, DPAPI on Windows, libsecret on Linux — under the Company's own key. The
Company database holds the variable's **name** and never its value, and no IPC channel returns
one: a catalogue row says only whether a secret is there, which is what `secretLine` in
`src/shared/catalogue/mcp-servers.ts` draws — and it counts, because a header-authenticated server
keeps one value per header rather than a single token.

A named value is kept under `<server id>:<name>`, where the name is an environment variable's for a
`stdio` server and a header's for an `http` one; a server is only ever one of the two. Removing the
server forgets every one of them, and an edit that drops a name forgets that one.
