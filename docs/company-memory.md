# The Company memory (T175)

Each Employee has its own notes (T73). The Company has this: one markdown wiki in the Company
folder that every Employee reads and writes through MCP, on any Provider, and that the boss reads
and edits in the **Memory** screen. It is captured from tickets automatically, and **no model
writes any of it**.

The design borrows from [akitaonrails/ai-memory](https://github.com/akitaonrails/ai-memory) (MIT):
markdown as the source of truth, a derived index, zero-LLM capture, aging, and claim-once handoffs.
It is built natively here rather than depended on.

## Where it lives

```
<company folder>/memory/company/        ← a git repo of its own
  decisions/<slug>.md
  conventions/<slug>.md
  gotchas/<slug>.md
  architecture/<slug>.md
  glossary/<slug>.md
  handoffs/<slug>.md
  archive/<slug>.md
```

A page is YAML front matter and a markdown body:

```markdown
---
kind: decision
title: Locale handling in billing
repos: [billing-api, web-app]
sources: [ticket:TC-142, pr:billing-api#88, review:TC-142 thread 7]
links: [currency-defaults]
created: 2026-09-20T09:00:00.000Z
updated: 2026-09-21T09:00:00.000Z
updatedBy: Vega
pinned: false
---

Money is stored in minor units and formatted once, at the edge.
```

`memory/` is already one of `COMPANY_DATA_PATTERNS`, so none of this can enter a work repo
(decision 45).

**The files are the source of truth.** The SQLite index in `company.sqlite` — `memory_page`,
`memory_source`, `memory_link`, `memory_fts` (FTS5) — is derived, and `rebuild()` fills it from the
folder again. `memory_use` is the one table a rebuild leaves alone: how often a page was read is
the app's own record, not the file's.

Every write is a git commit authored by whoever made it — an Employee, the boss, or the Company
itself for a capture — so History and restore are git's.

**The boss writes a page in a rich editor, and can see the file at any time (T225).** The Memory
editor is TipTap, the way Orca's own is built: a heading is a heading the moment `## ` is typed,
`- ` makes a list, `**` makes bold, and a toolbar offers the same blocks for anyone who would
rather press a button. The switch above it is **Edit · Preview · Markdown** — the document, the
reading pane's own renderer over it, and the file that will be committed.

T219 wrote the same screen on CodeMirror to avoid exactly what a model costs: ProseMirror parses
the page in and serialises it back, so a page opened and saved unchanged could come back
normalised. The boss asked for the WYSIWYG anyway, so the normalisation is what
`renderer/src/markdown/rich-markdown.ts` exists to prevent, and `rich-markdown.dom.test.ts` opens a
page using every block the toolbar can make and asserts the markdown comes back byte for byte:
`-` bullets, ATX headings, fenced code with its language, tight lists, and the hard wrapping an
Employee wrote. **One thing is normalised on purpose:** a page written with `*` or `+` bullets comes
back with the `-` the rest of the wiki uses, because a document model holds a list and not a marker.

## What an Employee gets

Four tools on the Company MCP server:

| Tool | What it does |
| --- | --- |
| `memory_search(query, kind?, repo?)` | Titles and slugs, never bodies. Every hit counts as a use. |
| `memory_read(slug)` | One page. Reading counts as a use, which is what keeps a page warm. |
| `memory_write(kind, title, body, sources?, repos?, mode?)` | Creates a page or adds to one, attributed to the caller. |
| `memory_link(a, b)` | Links two pages, both ways. |

The Employee's own notes are a different thing with five tools of their own — `note`, `recall`,
`zoom`, `nap` and `forget` — and the section below says what they are. They took the name
`memory_write` once; the shared pages have it now, because it is what an Employee reaching for
"memory" almost always wants.

Every Session's instructions carry a **bounded brief**: the titles of the pinned and most-used pages
that touch this Employee's repos, twelve at most, and never a body. Bodies are read on demand, so a
Company with a thousand pages costs a Session the same as one with ten.

## Capture, with no model

When a ticket reaches Done the app writes pages from what the ticket already holds. It is
templating — the same ticket writes the same pages, word for word — and every page links back:

- the **approved plan** becomes a **Decision**, from its goal, approach, acceptance criteria and
  risks;
- a **resolved review thread** where the assignee answered without a commit and the reviewer
  resolved it anyway — a pushback the reviewer accepted — becomes a **Convention**, quoting the
  thread;
- a **resolved review thread that names a failure and was answered with a fix commit** becomes a
  **Gotcha**, with the commit.

One Activity line per ticket, whatever it wrote, badged `No model`. Clicking it opens Memory cut to
the pages that ticket touched.

Architecture and Glossary pages have no automatic source: Employees and the boss write those.

## Handoffs

A provider switch (T173) writes a **Handoff** page — where the work stands, what is open, what is
next — and the prompt the next Session gets names it. That Session claims the page exactly once:
a second claim is refused by the store, not by asking nicely. The page closes when its ticket lands.

## Aging

Every read or search hit is a use. A page nothing has used for the Company's threshold (30 days by
default) is marked **cold**. It is never deleted. **Archive** moves the file to `archive/`; git
still has it, and writing the page again brings it back.

## Contradictions

Two pages are flagged when they are the same kind, share a repo, and write the same key with two
different values — `DEFAULT_CURRENCY=EUR` on one, `DEFAULT_CURRENCY=USD` on the other. Three shapes
count as writing a key: `KEY=value`, a line that starts `KEY: value`, and `` `KEY` is value ``. The
banner says in as many words that terms found it and not a model, and the boss resolves it by
editing, merging or dismissing.

It finds what it finds. It is deliberately narrow: a wrong flag costs a click, and a semantic
disagreement that shares no term goes unnoticed — catching that would need a model, which this
feature does not have.

## Platforms

A page is named by a POSIX key (`decisions/locale-handling-in-billing.md`) everywhere above the
file layer: it is what the index stores, what git is given, and what the path bar shows, and it
reads the same on macOS, Windows and Linux. Turning one into a path on this machine happens in
`company-memory-files.ts` and only there, through `node:path`. Git runs with the app's own
`gitSettings` (`core.longpaths`) in the folder's native realpath, like every other git call the app
makes (T166).

## The files

| File | What it is |
| --- | --- |
| `src/shared/memory/company-memory.ts` | The types, and every string the screen reads. |
| `src/main/features/memory/company-memory-page.ts` | The file format: front matter in, front matter out. |
| `src/main/features/memory/company-memory-files.ts` | Where the pages are, on disk or in a test's map. |
| `src/main/features/memory/company-memory-git.ts` | The memory folder's own git repo. |
| `src/main/features/memory/company-memory-terms.ts` | The contradiction heuristic. |
| `src/main/features/memory/company-memory-capture.ts` | What a finished ticket writes. |
| `src/main/features/memory/company-memory.ts` | The store: files, index, usage, aging, handoffs. |
| `src/main/features/memory/company-memory-tools.ts` | The four tools. |
| `src/main/features/memory/company-memory-ipc.ts` | What the Memory screen calls. |
| `src/renderer/src/memory/` | The screen (frames `E40vSb`, `I44S1a`, `V2v4hd`). |
| `src/renderer/src/markdown/` | The rich markdown editor a page is written in, and the settings that keep its round trip byte for byte. |

## An Employee's own notes (T193)

The Company memory is what everybody shares. Beside it, each Employee keeps **its own notes**:
private, never read by a colleague, and handed back to it at every Session start.

They used to be one markdown file capped at 32,000 characters, which meant that remembering one
more thing eventually meant deciding what to forget. They are now an **append-only log with a
fixed-size wake**.

### On disk

Per Employee, in the Company folder:

- `memory/<employee id>/log` — one note per line, at most 280 bytes of text each, appended and
  never edited. A note's id is where its line sits in the file, so the log's length is the next id
  and no id is ever reused.
- `memory/<employee id>/tree/<lo>-<hi>.md` — a summary of the notes `[lo, hi)`, for aligned
  power-of-two ranges of at least eight. It is a **cache**: every file here can be thrown away and
  written again from the log, which is why `forget` is a delete and nothing is lost by it.

T73's `memory/<employee id>.md` is read into the log once, oldest entry first, one note per entry
and more than one where an entry is longer than a note may be. The old file is kept beside it as
`.md.bak`.

### The wake

At session start the Employee is given the whole of its history inside a budget in tokens — the
Company's `Read at session start`, 2k, 4k or 8k, in Company settings → Tokens. The newest notes go
in word for word; everything behind them is covered by summaries that double their reach going
back, so a million notes cost about as many lines as a million takes bits. A range nobody has
summarised yet is named rather than dropped, and `zoom` opens it.

### The tools

| Tool | What it does |
| --- | --- |
| `note(text)` | Appends one line. Over 280 bytes is refused, with the limit and *write two* in the message. |
| `recall(pattern)` | Searches every note ever written, word for word. Takes a regular expression. |
| `zoom(range)` | Opens a summary into its two halves, down to the raw notes. |
| `nap(range, summary)` | Writes a summary that is due. Every `note` answer names the next one. |
| `forget(range)` | Drops a summary so it is written again. It never drops a note. |

A Session an Employee started of its own reaches none of them, the same rule that keeps a model out
of the Company memory: a sub-session's token reaches `session_report` and nothing else.

### Where the idea came from

The shape — an append-only log, summaries over aligned power-of-two ranges, and a wake of fixed
size assembled from the coarsest summary that still fits — is
[OptMem](https://github.com/VictorTaelin/OptMem)'s, by Victor Taelin. That repository carries no
licence, so **the idea is all that was taken**: no code, no prompt text, and no file from it is in
this one. The credit is in `NOTICE` as well as here, because the thinking was theirs first.
