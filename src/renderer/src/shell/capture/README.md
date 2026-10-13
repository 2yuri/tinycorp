# Sidebar capture (dev only)

Renders the shell's sidebar against a fixture built from the design's own frame, so its nav can be
compared with `design/screens/rPfPD.png`. Nothing here ships: `sidebar-capture.html` is not the
app's entry, and no app module imports this folder.

```sh
npx vite --config src/renderer/src/shell/capture/vite.config.mts
# then screenshot at 276x900:
#   http://localhost:5189/sidebar-capture.html
#   http://localhost:5189/sidebar-capture.html?drafts   # rows with an unsent draft (TI-1)
#   http://localhost:5189/sidebar-capture.html?rail     # the Company rail alone, at 68x356 (T251)
```

`?rail` draws the Company rail on its own, which is what frame `u9sLao` measures its marks
against: the Company you are in with a one-digit badge and a working dot, one with a two-digit
badge, one only working, and one with nothing to say. It is the audit's `company-rail-needs-you`
row, cropped out of that frame at `(32, 32)`. The rail prints `9+` where the frame prints `12`,
because a count past nine would outgrow a 40px tile (T145) — two characters either way.

The capture lives in `docs/design-audit/t147-sidebar.png`, beside the frame's crop in
`t147-sidebar-vs-frame.png`. 276x900 is the sidebar as the app draws it: the 1512x944 window less
the 68px Company rail and the 44px title bar. Compare
against the sidebar region of the frame — inside the window (offset `(72, 54)`) it starts after the
rail and below the title bar, so `(140, 98)`-`(416, 998)` in the frame. Chromium writes captures
with a Display-P3 profile unless it is run with `--force-color-profile=srgb`, so colours otherwise
read 2-3 low per channel against the untagged-sRGB design exports — convert before measuring, as
the design audit notes says.

Two things the harness has to keep true of the app, both of which it once did not (T146):

- the sidebar is drawn inside `.shell`, as `App` draws it. `--shell-text-soft` is defined there, so
  a sidebar captured outside it reads the wrong colour on every label that token paints;
- it is drawn 900 tall, which is every height the app ever gives it. At 944 the nav had room it
  never has in the app, which is what hid Company settings sliding under the fold until T147.
  `SidebarCapture.test.tsx` pins the number against the title bar's own height in `shell.css`.

Only the tree scrolls (`.shell-nav__scroll`); Company settings sits in `.shell-nav__pinned` below it,
so it stays where the frame draws it — its text 22px above the next divider — however long the tree
grows. The fixture's tree is 1px taller than the scroller at 900, so it is at the edge of
overflowing already. To see the overflow, shrink `.shell` in the page (640 is a short window) or
clone a DM row: the tree fades at whichever edge has more past it, by as much as is left to scroll.
`t147-sidebar-overflow.png` shows 900 with one more row, then 640 at the top, midway and the end.

## What the frame shows that the app does not

The frame's `BETWEEN AGENTS` section — the label band and the `Nova & Vega` / `Iris & Atlas` rows —
has no counterpart to compare against any more. `997a1b2` (T113, "the rail lists the boss's
conversations, not other people's") took it out on purpose, and `nav-model.ts` says why; the
fixture no longer carries the pairs that fed it either. Everything below it in the frame is still
the app's, and still worth comparing.

Four more things are deliberately not the frame's, and none is this harness's to change:

- an `Inbox` row above the channels, which decision 43 added after the frame was drawn;
- one DM row per Employee, so the fixture's five characters all appear where the frame samples three;
- the Company header therefore reads `5 Employees`, and since T251 the Chat row carries no count
  at all while its own lines are on screen, each with its own red Needs You pill;
- avatars are the pixel character portraits T70 landed, not the frame's tinted half-tiles.
