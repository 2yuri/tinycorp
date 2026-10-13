# Review capture (dev only)

Renders the Review screen against the design's own fixture so it can be compared with
`design/screens/ZCYGy.png`. Nothing here ships: `review-capture.html` is not the app's entry, and
no app module imports this folder.

```sh
npx vite --config src/renderer/src/review/capture/vite.config.mts
# then, in a browser or through Electron's capturePage at 1512x944:
#   http://localhost:5184/review-capture.html                 ZCYGy — the boss's own line comments
#   http://localhost:5184/review-capture.html?threads         VtAMR — the agents' conversation (T170)
#   http://localhost:5184/review-capture.html?threads&split   the same, read side by side (T244)
```

`split` writes the remembered layout into `localStorage` before the screen mounts, and the page
clears it without the parameter — so neither of the other two depends on which shot ran first. At
this width the diff opens inline of its own accord (`SPLIT_MIN_WIDTH`), so side by side is
something the boss has to have asked for, and that shot is what says a thread still spans both
panes when they do.

The captures live in `docs/design-audit/review.png` and, for `?threads`,
`docs/design-audit/t170-review-threads.png`. The left 344px stand in for the shell's rail
and sidebar, so the split sits where the window puts it; compare against the window region of the
frame (offset `(72, 54)`, 1512x944). Chromium writes captures with a Display-P3 profile, so colours
read 2-3 low per channel against the untagged-sRGB design exports — convert before measuring, as
the design audit notes says.

## Against the frame

Structure, geometry, type and colour match `ZCYGy`. Four deliberate differences:

- A comment thread hangs **under the line it is on**, not after the whole hunk as the frame draws
  it. The ticket asks for comments that "thread under the line", and it is the only placement that
  stays right for a comment on any other line.
- The file list carries a small comment count beside a file that has one; the frame has none, and
  without it a comment on a file the boss is not reading is invisible.
- The header's right side holds the member avatars only. The frame's pin / search / panel-right
  icons belong to the chat header and have nothing to act on here. It also omits the boss's own
  chip, which the frame draws first in the stack.
- The two actions above the diff are their icons and a tooltip, not `Mark viewed` and `Open file`
  as the frame spells them: the frame predates the diff's own control bar (T243), and at 559px of
  header the three together do not fit. They spell themselves out again above 640px — closing the
  conversation panel is enough.
- A role chip takes its author's accent from `accentFor(employee.id)`, the same colour their avatar
  and every other surface carries. Iris lands on the frame's own pink; Vega lands on red, where the
  frame itself draws two different colours for the same person (cyan in the thread, green in the
  panel), so there is no single frame value to match.

## Against `VtAMR` (T170)

`?threads` is the same screen once the reviewer and the assignee have talked on it: two settled
threads collapsed to a row with the commit that fixed them, one left open as a non-blocking note,
and the panel's Conversation tab with the reviewer card, the rounds and `Jump to open thread`.

Three deliberate differences from the frame:

- The PR is `billing-api #131`, not the frame's `web-app #88`. `VtAMR` is drawn on top of `ZCYGy`,
  and this harness keeps `ZCYGy`'s own world so both captures come from one fixture.
- The frame's `Managed — you approve every merge · Change` chip is the app's existing verdict
  notice (`Iris (QA) approved`). The autonomy level has its own place in Company settings, and
  nothing in this ticket moved it.
- The frame's `2 more resolved threads in src/ui/PriceTag.tsx · Show` footer under the diff is not
  built: a thread on a file the boss is not reading is reached through the file list, which already
  carries a count.
