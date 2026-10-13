# Memory capture (dev only)

Renders the Memory screen and the four states beside it against a fixture built from the design's
own frames, so they can be compared with `design/screens/E40vSb.png` and `design/screens/I44S1a.png`.
Nothing here ships: neither HTML page is the app's entry, and no app module imports this folder.

`?state=edit` draws the boss rewriting a page in the rich editor, against `design/screens/DHYKn.png`
— the state where the TipTap document has something to draw (T225). `?state=new` is the same editor
over an empty page, against `design/screens/V2v4hd.png`.

`?state=empty` draws the screen a Company that has written nothing shows — which is every real
Company until its first ticket closes — against `design/screens/SlxSy.png`. That state had never
been captured by anyone: the fixture has 42 pages, so the screen passed its audit while the boss
opened an empty list beside *Pick a page to read it.* (T181). `pnpm design:compare` shoots both.

```sh
npx vite --config src/renderer/src/memory/capture/vite.config.mts
# a Company with no page at all, against design/screens/SlxSy.png:
google-chrome --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --virtual-time-budget=4000 --window-size=1512,900 \
  --screenshot=docs/design-audit/t181-memory-new-company.png \
  'http://localhost:5186/company-memory-capture.html?state=empty'
# the screen, at 1512x944:
google-chrome --headless --force-device-scale-factor=1 --window-size=1512,944 \
  --screenshot=docs/design-audit/t175-memory.png \
  http://localhost:5186/company-memory-capture.html
# the four states, at 760x1860. The states page imports the drawer's panel after mount, so give
# the headless browser time to run it or it shoots an empty page:
google-chrome --headless --force-device-scale-factor=1 --window-size=760,1860 \
  --virtual-time-budget=4000 \
  --screenshot=docs/design-audit/t175-memory-states.png \
  http://localhost:5186/company-memory-states-capture.html
```

The capture draws the real Company rail and drawer around the screen, because the frame does: a
harness that filled that 344px with a grey block left a fifth of the window unchecked, and the
audit scored the pair as if it were drift (T192). The drawer is handed `fixture.shellData()` — the
frame's own 8 Employees, 12 unread, 31 tickets, 3 repos and 42 pages — and the two modules under it
that read the preload API themselves (the Usage row, the channel-delete prompt) are stubbed. Compare against `E40vSb` cropped at **(72, 98), 1512x846** — not
`(72, 54)`: the window region starts at the title bar and the harness draws none, the same 44px the
Activity harness's README explains. Chromium writes captures with a Display-P3 profile, so colours
read 2–3 low per channel against the untagged-sRGB design exports; convert before measuring, as
the design audit notes says.

Every block of the states page is drawn by the component the app really uses — `MemoryList` for the
Handoffs filter and the empty state, `ActivityFeed` for the capture line, `NotesPanel` for the
drawer's Memory tab — so a change to any of them shows up here. The boxes are sized to fit the rows,
not to match the frame's own card sizes: `I44S1a` is a specification sheet, not a screen.

These are deliberately not drawn as the frame has them:

- the Activity block shows the feed's own chips and search above the row, because the row is not a
  component of its own — the frame draws the row alone;
- `I44S1a`(a)'s rows carry both the second line (`claimed by Vega`) and the state pill, as the frame
  does, but the done row reads `closed with the ticket` rather than `closed when TC-131 merged`: the
  page does not record which merge closed it, only that its ticket did. The pill is the Handoffs
  filter's: in `E40vSb`'s All list the same row carries none, which is what the app draws (T178);
- a row's right-hand column says how long ago the page was used (`5h ago`), where `E40vSb` writes a
  Handoff's clock time (`18:47`). One clock answers for every row, and it is `whenLabel`.

The empty state's pane draws the six kinds in the catalogue's order, which is the order the filter
chips above it are already in; frame `SlxSy` pairs them differently (Gotcha with Handoff, then
Architecture with Glossary). `KIND_EXPLAINED` is a `Record` over `MemoryKind`, so a kind added to
the catalogue cannot compile without its line and is drawn without anyone remembering to.
