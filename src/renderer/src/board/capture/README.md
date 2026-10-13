# Board capture (dev only)

Renders the Board with the **ticket drawer open**, or with **New ticket open**, against a fixture
built from the design's own frames, so each can be compared with `design/screens/Izdc9.png` and
`design/screens/Y5daiS.png`. Nothing here ships: `board-capture.html` is not the app's entry, and no
app module imports this folder.

```sh
npx vite --config src/renderer/src/board/capture/vite.config.mts
# then, in a browser or headless Chrome at 1512x944:
#   http://localhost:5190/board-capture.html
```

The drawer is opened the way a `#128` link in chat opens it — through `openTicket`, the board's own
door — not a back door of the capture's. The switches in the query:

- `?ticket=<id>` opens another one of the fixture's tickets.
- `?closed` leaves the drawer shut, which is the board's own frame (`SZUeE`).
- `?foot` scrolls the body to its end, so the sections under the divider can be shot by a headless
  browser that cannot scroll.
- `?new` clicks the header's `New ticket` and fills the modal with what the frame writes — every
  value goes in through a control, so nothing here is a door the boss does not have.
- `?plan` draws the drawer's PLAN section in both of its states, as the states sheet `hZrUN` draws
  them (T171): a plan the boss approved, and the replan an engineer asked for on top of it.
- `?delete` presses the drawer's `Delete ticket`, so its confirmation stands over the board, as
  `xdaOR` draws it (T275). With `?ticket=142` it is the ticket the fixture's removal names.

```sh
for q in "" "?foot"; do
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=20000 \
    --window-size=1512,944 --force-device-scale-factor=1 \
    --screenshot=shot.png "http://localhost:5190/board-capture.html$q"
done
```

`design/office/t157-board.png` is the board's own frame beside `?closed` as it stood at T157, when
every card's dot was the frame's muted slate. Since T274 a card in an epic draws the epic's own dot
and its title there (`design/screens/RIko3.png`).

## Planning (T171)

`?closed` is now the board of `design/screens/Oumw5.png`: **Planning · Ready · Doing · Review ·
Done**, with the Planning column's state chips, its `2 need you`, the `Q 2/3` question count beside
a card's id, the `EP-3 EPIC` card for an epic still being planned, and `Plan approved` on every
Ready card. The captures live in `docs/design-audit/t171-board-planning.png` and
`docs/design-audit/t171-plan-states.png`.

Deliberate differences from `Oumw5` and `hZrUN`:

- **The epic card's foot reads `Nova` and `3 tickets`**, where the frame reads `Nova · PM` and
  `3 tickets`: a card names a person the same way everywhere on the board, without their title.
- **`Plan approved` leads with a green dot**, where the frame draws a green tick. Every other state
  on a card is a dot, and the two live in the same chip.
- **The approved plan's rows are the ticket drawer's own section language** — a label, an icon and
  a mono count per row — which is what the frame draws, with `Planning thread`, `Edit` and `Replan`
  under them. `Edit` opens the planning thread, where the plan is written.

The captures live in `design/office/t127-board-drawer.png` and
`design/office/t127-board-drawer-foot.png`, next to the Pen export, and
`design/office/t127-ticket-drawer.png` is the three of them side by side — the frame's drawer, the
drawer's head and the drawer's foot — cropped to the same 440x900 the frame draws.

## Against the frame

Measured on the drawer region alone (`x 1072..1512`, `y 44..944` of the 1512x944 window, which is
`(72, 54) + (1072, 44)` inside the 1656x1088 export, at 2x). Anatomy, geometry, type and colour
follow `Izdc9`: the panel is 440px with a 1px `#334155` on its left and the frame's own
`-16px 0 40px #00000066` thrown across the board; the scrim is the frame's `#0B122099` over the
whole body; the header is 16/20 padding with the title at 16/700 over an 11.5 muted line and the
close at its right; the body is 14px padding on a 7px gap; every field is a 40px box with a 12px
inset and an 11/700/0.5 muted upper-case label; the textarea is the kit's designed 82px; chips,
badges, the toggle and both buttons are the kit's own, which measure to the frame exactly
(`5/11` badges with a 6px dot, a 40x22 track with a 16px knob, `11/18` primary buttons); the footer
is 14/20 with `⌘↵ to save` and Save. The header stroke lands on row 67 against the frame's 66 and
the footer's on 832 against 833 — one pixel each way, from the line box the browser gives Inter.

Deliberate differences, each one a thing the frame could not know:

- **An `EPIC` and a `COLUMN` row** sits under `LABELS`. The frame has neither — it says the column
  in the header line instead — but the board has no other way to change an existing ticket's epic,
  and dropping the pair would lose that outright. They are the New Ticket modal's own two fields,
  in the drawer's section language.
- **A `WHY` field** appears under Blocked while Blocked is on, as the ticket asks. The frame draws
  Blocked on with no reason typed, so it never shows.
- **A `RESTORE POINTS` section** follows `CODE & REVIEW` (T118, which landed after the frame was
  drawn). It speaks the frame's own section language: an 11/700 muted label over the same card.
- **The branch row names its repo** when the ticket works in more than one, before the branch and
  in muted. A ticket in one repo reads exactly as the frame does, and the worktree's path is the
  row's `title`.
- **The PR row reads `#412` alone**, where the frame reads `#412 Refresh the token before charging`.
  A ticket's PR title is not in what the board reads (`TicketCode` carries the url and the number),
  and this ticket does not send the app looking for more.
- **The line beside `Open review` is the round's own state** — `Waiting for review · by you` —
  where the frame reads `Waiting on you · 3 files, +84 −12`. The file and line counts belong to the
  PR's details, which the drawer does not read.
- **The description reads in `--foreground`**, not the frame's muted, because it is a field the boss
  types into; muted is this kit's placeholder colour everywhere else.
- **The subtask row's repo picker and its remove come out on hover or focus.** The frame draws the
  row as a checkbox and a title alone; both controls were already there, and they take no height
  (T157), so the row is the frame's 18px on a 26px pitch. Before T157 the 30px remove, invisible
  but in flow, boxed every row to 30px.
- **A label chip's remove comes out on hover** for the same reason.
- **The assignee field has no avatar.** The frame leads it with a 24px `AD` chip; the kit's `Select`
  leads with a lucide icon, and the drawer keeps the kit.
- **The board behind the drawer starts at x=344, not the frame's shell.** The capture stands the
  rail and the Company drawer in as one block, the way the Review capture does: the drawer is fixed
  to the window's right edge in both, so the region compared lands in the same place.

---

## New ticket against the frame (`Y5daiS`, T49)

`design/office/t49-new-ticket.png` is the frame's modal beside the app's, each cropped to its own
640px box (`(508, 245)` in the 1656x1088 export; `(436, 163)` in the 1512x944 window), and
`design/office/t49-new-ticket-modal.png` is the whole window the crop comes from.

Anatomy, geometry, type and colour follow the frame: the backdrop is the frame's `#0B1220CC` over
everything below the 44px title bar with 24px of padding; the modal is 640px with a 1px `#334155`,
`r12` and the frame's own `0 16px 40px #00000066`; the header and footer bars are 16/20 and 14/20
with a `#334155` hairline between them and the form; the title is 16/700 over an 11.5 muted
`Tiny Corp · Board · Todo`; every field is a 40px box with a 12px inset under an 11/700/0.5 muted
upper-case label; the textarea is the kit's designed 82px; the fields run Title → Description →
[Repositories | Base branch] → [Assignee | Priority] → Labels, then the frame's divider and the
`Start work immediately` row with its 40x22 track and 16px knob; the footer reads `⌘` `↵` in
hairline caps beside `to create`, then `Cancel` and `Create ticket` with its 15px plus.

Deliberate differences, each one a thing the frame could not know:

- **The repo chips wrap.** The frame's three chips are 308px of chip in a 294px column, so the
  export overflows them silently; the row wraps instead, which is why the app's modal is ~34px
  taller than the frame's.
- **The frame's own export drew no chips and no hint at all** under `REPOSITORIES` — the modal's
  HTML has both, and the app follows the HTML.
- **`BASE BRANCH` is a free-text field, not a picker.** The frame draws a chevron; nothing in the
  app reads a repo's branch list yet, and a chevron with nothing behind it would lie. The value is
  in the frame's mono face and reaches `addWorktree` either way.
- **The assignee tile is the Employee's own pixel character**, where the frame draws `AD` initials.
  Every avatar in the app is that character (T79); the initials are still the fallback.
- **The frame's `↵` is tofu in the export** — the face it was drawn with has no glyph for it. The
  app's cap draws the arrow.
- **The description keeps its resize grip**, as the drawer's does: the boss may drag it taller.
