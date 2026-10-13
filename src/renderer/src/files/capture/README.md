# Files capture (dev only)

Renders the Files view over a **real worktree** — this checkout, read through the engine's own
`createFiles`, behind endpoints (`/__files-api/places|tree|open`, and `/__files-api/language/…` for T115) that
stand in for the Files IPC — so it can be compared with `design/screens/ZNpqJ.png`. Nothing here ships:
`files-capture.html` is not the app's entry, and no app module imports this folder.

```sh
npx vite --config src/renderer/src/files/capture/vite.config.mts
# then, in a browser or headless Chrome at 1512x944:
#   http://localhost:5188/files-capture.html?path=src/shared/ipc.ts
```

Every further `path` in the query opens as another tab (T121), the way a path clicked in a message
does — through the shell's own router, not a back door of the capture's:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=20000 \
  --window-size=1512,944 --force-device-scale-factor=1 \
  --screenshot=design/office/t121-tabs.png \
  "http://localhost:5188/files-capture.html?path=src/renderer/src/files/tabs-model.ts&path=AGENTS.md&path=src/renderer/public/office/office-marker-sheet.png"
```

**There is no `?hover` any more (T222).** The type card is Monaco's own hover now, and Monaco hides
it the moment the pointer is not really over the symbol — a headless browser has no pointer to keep
there, and neither `editor.action.showHover` nor a synthetic `mousemove` holds it open. The card is
shot by hand, by hovering a symbol in `pnpm dev`; `design/office/t115-language.png` is the old,
hand-written card and is stale until somebody re-shoots it.

The place's own TypeScript is still behind everything else: `/__files-api/language/read|hover|definition`
run the engine's real `createLanguage` over this checkout, so the card, the gutter glyphs, the
outline and the problems list are what the compiler really says.

`?openWith` draws the list behind the `Open in …` chevron, to compare with
`design/screens/CwBoJ.png`:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=20000 \
  --window-size=1512,944 --force-device-scale-factor=1 \
  --screenshot=design/office/t123-open-with.png \
  "http://localhost:5188/files-capture.html?path=docs/decisions.md&openWith=1"
```

`?edited=<text>` puts that line at the top of the file and leaves it unsaved, so the editing frame
(T122) can be shot dirty by a headless browser that cannot type. It goes in through Monaco's own
`executeEdits`, which is the same change a keystroke makes. Markdown reads as Markdown until `Edit`
is clicked, which the trick does first, the way the boss would:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=20000 \
  --window-size=1512,944 --force-device-scale-factor=1 \
  --screenshot=design/office/t122-editing.png \
  "http://localhost:5188/files-capture.html?path=docs/decisions.md&edited=%7C%2054%20%7C%20The%20boss%20edits%20a%20file%20in%20the%20app.%20%7C"
```

Nothing in the query draws Markdown as Markdown, because opening a `.md` already does; the
rendered view is shot by opening one, and `design/office/t153-markdown-table.png` is
`docs/decisions.md` with its table in it.

`?changes=<row>` opens the Changes tab (T160) and the nth row's diff beside it, for
`design/screens/LFdty.png`. The frame draws three groups and a capture has no Company behind it,
so `?changes` declares this one checkout three times — Ada's worktree, Nova's, and the repo
itself — which is why the three groups list the same files. `?limit=<n>` is the reader's **real**
cap, so a checkout with fifty changed files still shows a group short enough to compare, and the
list says it stopped short:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=25000 \
  --window-size=1512,944 --force-device-scale-factor=1 \
  --screenshot=design/office/t160-changes.png \
  "http://localhost:5188/files-capture.html?changes=2&limit=3"
```

Behind it is the engine's own `git status --porcelain` over this checkout, through
`/__files-api/changes` and `/__files-api/change-diff`. The five actions answer as if they had run:
the capture never writes to the checkout it is reading, and never commits it.

The captures live in `design/office/t113-files.png`, `design/office/t121-tabs.png`,
`design/office/t122-editing.png`, `design/office/t123-open-with.png`,
`design/office/t115-language.png`, `design/office/t153-markdown-table.png` and
`design/office/t160-changes.png`, next to the Pen
export. Each draws the view alone at the window's size, as the frame does — the frame has no rail
or sidebar in it. The place is this checkout on its own branch; the Employee holding it is named
`Ada`, as the frame does, because no Company is running behind a capture.

## Against the frame

Structure, geometry, type and colour match `ZNpqJ`, measured column for column: the tree is 300px
wide with its divider on 299, the rows are 28px, the breadcrumb bar is 40px, the code sits on a
20px line, and the read-only foot is 34px. Eight deliberate differences:

- **The header is 64px, not the frame's 70px.** It is the shell's own content header, the same one
  above every view; moving it would move every screen. Everything under it rides 6px up with it,
  the tree's find box and its rows included: the block over the tree keeps the frame's own
  12px / 32px / 12px, rather than being padded out to put the rows back where the frame's are.

- **The code is coloured, and it is Monaco that colours it** (T222). The frame draws every token in
  three greys, because the design tool has no highlighter. The editor is VS Code's, themed from
  `--code` and the seven `--syntax-*`, so plain text keeps the frame's own `#C9D3E4` and the rest
  takes the palette the viewer has always had. Monaco brings its own gutter, its own scrollbars and
  an overview ruler down the right of the file, none of which the frame draws.
- **A size chip** (`25 KB`) sits after the line count. The frame has only the line count, and
  without the size a truncated file has nothing to say how much was left out.
- **A `Source` toggle** appears in the head for a Markdown file, which the frame never opens. The
  rendered side of that toggle is the viewer's own: headings, lists, quotes, rules, fenced code
  and tables, drawn as React elements so nothing a repo holds can inject markup. A table keeps
  the prose column's 760px, since no frame says how wide a table in a doc should be.
- **The subtitle is a picker** when the Company has more than one repo or worktree. It reads
  exactly as the frame's line until then; with a second place it gains a chevron, since the view
  shows one place at a time and there has to be a way to the next.
- **The `Open in …` button says the editor by name** (T123), with a chevron for the list, where
  the frame `ZNpqJ` reads `Open in editor`. `CwBoJ` is the frame for that button and its list: the
  capture matches it row for row, and the system default's line follows the file that is open, so
  a Markdown tab reads `whatever opens a .md today` where the frame draws a `.ts`. `CwBoJ` puts the
  list at the window's left edge, over the tree, rather than under the chevron, so the frame only
  shows that it is at least 320px wide; the capture draws it at 320px under the chevron, and its
  244px height, 46px row pitch and ruleless note are measured against the frame as drawn.

- **A `New file` button** opens before the other two (T122), and the foot reads what editing writes
  instead of the read-only promise. `CwBoJ` draws both, and the editing capture is measured against
  its right-hand half: the dot before `Edited, not saved`, `Discard` and `Save ⌘S` where the chips
  sit when there is nothing to save, and the Session warning under the breadcrumb bar. The capture's
  worktree is declared with a Session running in it, so the warning is always in frame.
- **An outline** runs down the right of the file and a **problems list** sits under it (T115),
  where the frame draws neither. The ticket asks for the language server's diagnostics "marked on
  the line and listed under the file" and for the file's symbols "to jump inside a long file"; both
  take the frame's own code surface and its colours, and both disappear for a place with no server.

Against `LFdty` the Changes tab matches the frame's structure — the two tabs with the count, the
group head (holder, ticket key, count) over a mono `repo · branch` line, the rows with their
`M`/`A`/`D` marks, the Session warning in the group whose Employee is at work, and the commit box
under that group's own files — with four deliberate differences:

- **A staged row's second button is `−`, not `+`.** The frame draws `+` on all three of the first
  group's rows while its box says `Commit 2 staged`, so two of those three are already in the
  index and `+` would do nothing. A staged row offers Unstage instead.
- **The row actions are on every row of every group.** The frame draws them on the first group's
  rows and on no others; the difference between those groups is not something a row knows, so it
  reads as the designer drawing one group in full. Making them appear on hover would also put them
  out of reach of a headless capture and of the keyboard.
- **The folder follows the name**, in small grey, which the frame's rows have none of. Two changed
  files in one worktree are very often `x.ts` and `x.test.ts` in different folders, and without it
  the two rows read the same. It is the first thing to give way when the row runs out of width.
- **The commit box shows for a group that has something staged, or something to push.** The frame
  draws a box under the first group and none under the other two, which have nothing staged; the
  ticket says three groups open means three boxes, which is what happens once all three have
  something waiting. A branch nobody has published yet says `Publish` where the frame says `Push`.

- **A row of tabs** sits over the breadcrumb bar (T121). The frame has none, because it draws one
  file; the ticket asks for the files the boss has open to stay open. The strip is 34px on the
  shell's own sidebar surface, and the active tab is lifted onto the bar's card colour with the
  accent across its top, so the two read as one piece.

## `?fixture` — the tree that does not move (T209)

The capture is over a real worktree on purpose: this checkout, read by the engine's own reader.
That is what makes it worth looking at, and it is exactly what `pnpm design:compare` cannot use —
a screen whose content is whatever the branch holds today has no baseline.

`?fixture` points the same reader at the four files committed under `src/renderer/src/files/capture/tree`
and answers the Changes list empty. Everything else is the screen as it always was.

**The files are copied out of the repo before they are read.** The reader marks a tree with what
`git status` says, and a folder inside this checkout inherits the checkout's own changes: the
branch that deleted a stylesheet had that stylesheet appear in the fixture tree as `removed`,
opened as a tab, and shot. The copy goes to a fixed path under `os.tmpdir()`, so there is nothing
for git to say and nothing in the picture depends on where it landed.

```sh
#   http://localhost:5188/files-capture.html?fixture&path=src/currency.ts
#   http://localhost:5188/files-capture.html?fixture&path=docs/billing.md&openWith=1
#   http://localhost:5188/files-capture.html?fixture&path=docs/usage-totals.png
```

`docs/usage-totals.png` is the fixture's one image, 1600 x 1000 — bigger than the panel, so the
image viewer's `Fit` (T236) has something to do and every zoom key is in frame. It is a bar chart
drawn straight into the file's bytes rather than a screenshot of anything, so it is 14 KB and says
the same thing on every machine. The frame is `design/screens/aPsKD.png`.

The **Changes** tab has no baseline state and cannot have one here: it is this checkout's own
`git status`. `pnpm design:compare` still covers it against `LFdty`, where a person reads the sheet.

This config also names the three readers it uses one file at a time rather than importing the
module's front door. The front door exports the desktop file tools and the wiring too, both of
which reach for `electron` — and `electron` in plain Node is the path to a binary, not a module —
so bundling this config failed with `Named export 'powerSaveBlocker' not found` and the harness
would not start at all.
