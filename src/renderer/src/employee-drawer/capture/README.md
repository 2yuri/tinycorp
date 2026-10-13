# Employee drawer / Chats capture (dev only)

Renders the Employee drawer with its Chats tab open against a fixture built from the design's own
frame, so it can be compared with `design/screens/VkcVg.png`. Nothing here ships:
`drawer-capture.html` is not the app's entry, and no app module imports this folder.

```sh
npx vite --config src/renderer/src/employee-drawer/capture/vite.config.mts
# then screenshot at 440x836:
#   http://localhost:5188/drawer-capture.html
```

The drawer itself is `position: fixed` against the window's right edge, and macOS will not open a
Chrome window narrower than 500px — so the harness gives its 440x836 box a transform, which is what
a fixed box is laid out against, and the drawer fills it at any window size.

The stub answers every call the drawer makes on mount, not only the Chats tab's: one missing member
throws while React renders and the page comes back as bare background, which reads as a broken
capture rather than a broken stub. This harness rendered nothing from the day it was written —
`useInbox` began reading `window.tinyCorp.company` two and a half minutes after it landed, and
nobody noticed for eighteen days (T146). `DrawerCapture.test.tsx` mounts it and fails `pnpm test`
the moment it stops drawing the drawer.

The capture lives in `docs/design-audit/employee-drawer-chats.png`. 440x836 is the drawer itself:
the 1512x944 window less the 44px title bar and the 64px content header. Compare against the drawer
region of the design frame — inside the window (offset `(72, 54)`) it sits flush right, so
`(1144, 162)` in the frame. Chromium writes captures with a Display-P3 profile unless it is run with
`--force-color-profile=srgb`, so colours otherwise read 2-3 low per channel against the untagged-sRGB
design exports — convert before measuring, as the design audit notes says.

## The frame's raster against its HTML export

`design/html/employee-drawer-chats.html` is Pen's translation of frame `VkcVg`, and a browser lays it
out 1-3px looser than Pen's own renderer wrote the PNG: a nested box comes out about a pixel taller
per text line. Where the two disagree, T81 took the PNG, because that is what the frame shows and
what the ticket asks the capture to line up with. Two places needed it, and the CSS names both
numbers:

- the tab row is 41 tall (a 40px tab over the rule), not the export's 44 — `.ui-tab` is a button, so
  its line box gains a pixel each side, and the count badge lifted the row again;
- `Stop Session` is 132x34 with its 1px stroke inside the 9px 14px padding, not the export's 134x36.

With those, every band of the capture sits within 1px of the frame: the head rule, the meta rule, the
active tab's underline, all four conversation rows, the read-along head and messages, the read-only
bar and the footer.

## Deliberate deviations

- **The head's avatar** is the Employee's character, where the frame draws a neutral `NV` initials
  tile. The frame predates the character avatars, which landed with T70 and which the frame itself
  uses for the conversation rows and the read-along.
- **The boss's row** keeps the kit's neutral initials tile rather than the frame's indigo `YM` one,
  for the same reason.
- **The Wakes disclosure** below the conversations is not in the frame: T72 kept it so nothing the
  old Inbox tab held is lost. It now draws only once the Employee has been woken — the frame's
  Employee has none, so the capture is the frame — and it sits above the read-along rather than under
  it, so the read-only bar keeps the foot of the drawer as the frame pins it.
- **The meta strip** draws the model only where one has been chosen. The frame's Employee runs on the
  provider default, so the strip reads `Session live · Claude Code · Skips permissions · 4h 12m`,
  and then the handoff button of T164.
- Text wraps a word later than the frame in one message: the app ships Inter Variable, whose glyphs
  are a shade narrower than the static Inter the export loads from Google Fonts.

## The Terminal tab's subagent strip (T162)

`http://localhost:5188/drawer-capture.html?view=subagents` opens the drawer on its Terminal tab with
the strip from `design/screens/CuLyV.png` — Nova, then `tests` and `migration` running and `docs`
done — and picks `tests`, as the frame does. The capture lives in
`docs/design-audit/t162-employee-drawer-subagents.png`, and beside the frame's drawer region in
`docs/design-audit/t162-subagents-vs-frame.png`.

Deliberate deviations from `CuLyV`, because the frame draws Sessions an Employee starts (#340) and
these are Claude Code's own subagents, running inside the Employee's process:

- **No `own worktree` line** in the card: they work in the Employee's own folder.
- **No Session-seats caption** under the card: they take no seat, and they cannot start more.
- **Picking a subagent does not swap the terminal**: they have none of their own.
- **The elapsed time** sits at the card's right edge rather than just after a 290-wide title, so it
  stays put when the drawer is resized.

## The Terminal tab with Sessions an Employee started (T163)

`http://localhost:5188/drawer-capture.html?view=sessions` draws the strip `design/screens/CuLyV.png`
was drawn for: Nova, then `tests` and `migration` in worktrees of their own and `docs` sharing hers,
done — and picks `tests`, which swaps the terminal to `tests`' own (the fixture gives Nova's terminal
a different replay, so the swap shows). The capture lives in
`docs/design-audit/t163-employee-drawer-sessions.png`, and beside the frame's drawer region in
`docs/design-audit/t163-sessions-vs-frame.png`. Unlike the subagents view, this one draws the
frame's where line and its seat caption.

Deliberate deviations from `CuLyV`:

- **The terminal's content** is the fixture's replay, without the frame's permission prompt.
- **The ticket card** under the terminal is not drawn: the stub's board is empty, as in the T162
  capture.
- **The apostrophes** in `off Nova’s branch` and the seat line are the app's curly ones, where the
  frame types straight ones.

## The handoff button and the resume command (T164)

`design/screens/Ysu8a.png` gained a 22px `square-terminal` button (`NnYV6`) after the uptime, and
`design/screens/zOVl6.png` draws what it does. The default view is the live half — the button off,
with the frame's sentence on it — and `?view=handoff` is the stopped half, where it can be pressed:

```sh
# the live strip, button off (`docs/design-audit/t164-employee-drawer-vs-frame.png`):
google-chrome --headless=new --disable-gpu --hide-scrollbars --force-color-profile=srgb \
  --force-device-scale-factor=2 --virtual-time-budget=9000 --window-size=440,836 \
  --screenshot=/tmp/drawer-live.png http://localhost:5188/drawer-capture.html
# the stopped strip with the toast (`docs/design-audit/t164-resume-command-vs-frame.png`):
google-chrome --headless=new --disable-gpu --hide-scrollbars --force-color-profile=srgb \
  --force-device-scale-factor=2 --virtual-time-budget=2000 --window-size=440,836 \
  --screenshot=/tmp/drawer-copied.png \
  'http://localhost:5188/drawer-capture.html?view=handoff&copy=1'
```

`&copy=1` presses the button, because the toast only exists after a copy. Two things about that
shot: the budget is **2000**, not the usual 9000, because virtual time runs the toast's own 3s
dismissal and a longer budget shoots an empty strip; and the harness stands in for
`navigator.clipboard`, which headless Chrome refuses on a document it has not focused. The app
itself uses the real one.

Deliberate deviations from `zOVl6`:

- **`Session off`, not `Session stopped`**, and no `stopped 3m` beside it: those are the meta
  strip's existing words and its existing rule that the uptime is drawn only while a Session runs.
  Changing them is a wording change to a field this ticket did not touch.
- **The tooltips are the platform's**, from `title`, as every other icon button in the drawer has
  them. The frame draws the kit's Tooltip component, which the kit does not have yet.

**The routing chip** landed in T173, against `design/screens/tdI8o.png` (a): while an Employee's
own Provider is out and the Company's rule moved it elsewhere, the drawer says where it is working
and until when, with the way back beside it. Moving back happens at the next turn boundary — the
button asks, it never interrupts an edit.

```sh
# the routing chip (T173), against design/screens/tdI8o.png (a):
google-chrome --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --virtual-time-budget=9000 --window-size=560,836 \
  --screenshot=docs/design-audit/t173-drawer-routing-chip.png \
  'http://localhost:5188/drawer-capture.html?view=routed'
```

## `?rtk=on` and `?wakes` (T209)

Two states the frames were not drawn with, and the only states two stylesheets are ever drawn in:

- `?rtk=on` answers with a Company that is compressing, so the terminal header draws its RTK chip
  (`rtk-chip.css`, T179). Without it the harness answers RTK off and the chip draws nothing, which
  is what `zOVl6` and `CuLyV` were drawn against.
- `?wakes` gives the Employee a wake list and opens the Chats tab's `Wakes` fold over it
  (`inbox.css`). The fixture's list is empty otherwise, so the fold never appears.

```sh
#   http://localhost:5188/drawer-capture.html?view=subagents&rtk=on
#   http://localhost:5188/drawer-capture.html?wakes
```
