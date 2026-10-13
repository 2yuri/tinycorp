# Office capture (dev only)

Renders the PixiJS office stage at 1040×660 against a fixed team, so the glass door and the spots can
be screenshotted for a PR. Nothing here ships: `office-capture.html` is not the app's entry, and no
app module imports this folder.

```sh
npx vite --config src/renderer/src/office/capture/vite.config.mts
# then, in a browser at 1040x660:
#   http://localhost:5184/office-capture.html            two Employees set off after 3s
#   http://localhost:5184/office-capture.html?delay=300  they set off at once
#   http://localhost:5184/office-capture.html?delay=0    they are already in the room
#   http://localhost:5184/office-capture.html?delay=0&room=warm-loft     in another measured room
#   http://localhost:5184/office-capture.html?delay=0&room=night-shift   and any of the other four
#   http://localhost:5184/office-capture.html?delay=0&boss=3&approval=1  the boss at their own desk
#   http://localhost:5184/office-capture.html?delay=0&look=18            the sitters from that row on
#   http://localhost:5184/office-capture.html?delay=0&approval=4         one at the boss desk, three hands up
```

`?boss` picks the character the boss sits at their own desk with (T86) and `?approval=1` gives one
Employee a pending approval, so they stand beside the boss with their `!`. The plumbob's bob and turn
come straight off the clock, so a burst of `--virtual-time-budget` values catches it face-on and edge-on.

The team is one Employee per painted desk plus three more: two who answer each other in `#tech`
after `?delay` ms, which makes the exchange a meeting (T74) and walks them into the glass room, and
one who is Blocked and waits at the coffee counter with a mug. Those three are away from a desk, so
they borrow desk indices the sitters already have and the office never grows an annex under the
painting, which would take the capture off 1040×660. A burst of screenshots catches the door open
with someone in the gap and, once they arrive, the pair seated at the table.

The animation only runs at full speed in a headed browser; a headless tab throttles
`requestAnimationFrame`, so `?delay=0` starts them in their chairs instead:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --hide-scrollbars --virtual-time-budget=8000 --window-size=1040,660 \
  --screenshot=design/office/t74-meeting.png "http://localhost:5184/office-capture.html?delay=0"
```

The captures live in `design/office/t68-doors-and-spots.png`, `design/office/t74-meeting.png`,
`design/office/t84-warm-loft.png` (`?delay=0&room=warm-loft`),
`design/office/t85-night-shift.png` (`?delay=0&room=night-shift`),
`design/office/t86-boss-desk.png` and `design/office/t86-plumbob.png` (three frames of the turn).

T91 shot all six rooms the same way, one file each, each with every painted desk taken, two in the
meeting room and one at the counter:

```sh
for room in night-studio warm-loft scandi-daylight night-shift greenhouse garage-startup night-city; do
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
    --hide-scrollbars --virtual-time-budget=9000 --window-size=1040,660 \
    --screenshot="design/office/t91-$room.png" \
    "http://localhost:5184/office-capture.html?delay=0&room=$room"
done
```

T93 shot the same six again as `design/office/t93-$room.png`, once every room seated as many
Employees as its art draws chairs for: `staffFor` puts one at every painted desk, so each capture is
the check that the count is right and that no room grew an annex under the painting to hold them.

`?everyone=<state>` checks the other half of that: the states that move the whole Company at once.
It drops the three who are there for the meeting and the queue, so the team is exactly what the
painting seats, and puts all of them in one state — `parked`, `out_of_budget` and `blocked` send
everybody to the coffee corner, `idle` and `starting` leave everybody at a desk.

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --hide-scrollbars --virtual-time-budget=9000 --window-size=1040,660 \
  --screenshot=/tmp/parked.png \
  "http://localhost:5184/office-capture.html?delay=0&room=scandi-daylight&everyone=parked"
```

T94 shot the two things the floor now says: the status that travels with the Employee and the count
the glass room keeps. `?everyone=parked` puts the whole Company at the counter, so every chair reads
its owner's name alone and the `· Parked` is under the person; `?delay=0` is the pair in the glass
room with `Meeting · 2` on it; and `?meeting=<n>` puts the first `n` sitters in one exchange, which
is how a meeting bigger than the table is checked — four walk in, the rest stay at their own desks,
and the room still states the whole number.

```sh
for shot in "everyone=parked|away-labels" "delay=0|meeting-count" "delay=0&meeting=6|meeting-of-six"; do
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
    --hide-scrollbars --virtual-time-budget=9000 --window-size=1040,660 \
    --screenshot="design/office/t94-${shot##*|}.png" \
    "http://localhost:5184/office-capture.html?${shot%%|*}"
done
```

T98 shot the emerald and the bubbles off the sheets rather than out of `Graphics`.

T101 took the annex away: the office is the painting and nothing else, so `?over=<n>` replaces
`?annex=<n>`. It hires `n` past what the room seats, which leaves them at the counter with
`Waiting for a desk` — and the window stays 1040×660, because the office cannot grow past its own
art any more.

```sh
for room in night-studio warm-loft scandi-daylight night-shift greenhouse garage-startup night-city; do
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
    --hide-scrollbars --force-device-scale-factor=1 --virtual-time-budget=9000 --window-size=1040,660 \
    --screenshot="design/office/t101-$room.png" \
    "http://localhost:5184/office-capture.html?delay=0&over=2&room=$room"
done
```

`design/office/t98-plumbob.png` is the boss desk close-up, three frames of the turn side by side as
T86's was. The emerald's step comes straight off the clock, so the budget picks it: one full turn is
`PLUMBOB.spinMs` (4200 ms), face on at a multiple of it, the middle step 580 ms after, the sliver at
a quarter of it. The three shots are cropped to (20, 310) 131×100 and scaled 3×.

```sh
for budget in 8400 8980 9450; do
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
    --hide-scrollbars --force-device-scale-factor=1 --virtual-time-budget=$budget \
    --window-size=1040,660 --screenshot="/tmp/turn-$budget.png" \
    "http://localhost:5184/office-capture.html?delay=0&boss=3&approval=1"
done
```

T100 shot the three places the floor packs people together, now that each of them speaks for itself
and the people in it go quiet: `?everyone=parked` is the counter with six under one
`At the counter · 6 parked`; `?meeting=6` is the glass room's full table saying nothing under
`Meeting · 6`, with the two it could not seat keeping their own chair labels; and
`?room=night-shift&approval=1` is the boss chair at the painting's edge, where the visitor's label
is flipped over their head instead of onto the same line as `Your chair`.

```sh
for shot in "delay=0&everyone=parked|counter" "delay=0&meeting=6|meeting" \
            "delay=0&room=night-shift&approval=1|night-shift-boss"; do
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
    --hide-scrollbars --force-device-scale-factor=1 --virtual-time-budget=9000 --window-size=1040,660 \
    --screenshot="design/office/t100-${shot##*|}.png" \
    "http://localhost:5184/office-capture.html?${shot%%|*}"
done
```

T104 shot the kit desks against their own sitters, once every pod a room grows is taken: the Night
Studio's two and the Greenhouse's three, the deepest and the shallowest of the kit's desks. T111
took those desks out again, so `design/office/t104-*.png` is the last picture of them.

Another worktree may already hold port 5184; `npx vite … --port <free>` moves this one and the
screenshot URLs with it.

T105 put a layout pass in front of the drawing, so no two labels the floor draws sit on top of each
other. `design/office/bug-audit-scandi.png` is what it fixes: Scandi Daylight seated to its last
chair printed `Bo · Attaking` and `Gus · Evorking`, two labels over each other under desks a sprite
apart. The two captures are that room and the Night Studio at full seats, with the visitor at the
boss desk, which is the shot the audit took:

```sh
for room in scandi-daylight night-studio; do
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
    --hide-scrollbars --force-device-scale-factor=1 --virtual-time-budget=9000 --window-size=1040,660 \
    --screenshot="design/office/t105-$room.png" \
    "http://localhost:5184/office-capture.html?delay=0&approval=1&room=$room"
done
```

`?team=N` shoots a Company of exactly N, so the room a new Company opens with — nobody hired, the
boss alone at their chair — can be looked at too. The fixture's meeting, its blocked Employee and
its visitor are all optional now: with nobody to play them, the room is simply empty.

T103 shot all six again, one file each at every painted chair taken, to check the rule that a sitter
sits on a chair the painting draws and behind the desk in front of them: no sitter floating in an
aisle, and none drawn over the desk they sit at.

```sh
for room in night-studio warm-loft scandi-daylight night-shift greenhouse garage-startup night-city; do
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
    --hide-scrollbars --force-device-scale-factor=1 --virtual-time-budget=9000 --window-size=1040,660 \
    --screenshot="design/office/t103-$room.png" \
    "http://localhost:5184/office-capture.html?delay=0&room=$room"
done
```

T107 re-measured every coffee corner as the line people stand in, so a parked Company reads as
people rather than as one blob with six heads. `design/office/t107-$room.png` is each of the six with
the whole Company at the counter — the shot `design/office/bug-counter-pile.png` and the parked
column of `design/office/audit-contact-sheet.png` are the before:

```sh
for room in night-studio warm-loft scandi-daylight night-shift greenhouse garage-startup night-city; do
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
    --hide-scrollbars --force-device-scale-factor=1 --virtual-time-budget=9000 --window-size=1040,660 \
    --screenshot="design/office/t107-$room.png" \
    "http://localhost:5184/office-capture.html?delay=0&room=$room&everyone=parked"
done
```

`?reading=1` puts every Session on a tool that only looks, which is the state that draws the reading
pose: a sheet of paper in both hands, held out to the side by a sitter seen from behind and up in
front of one drawn from the front.

T111 took the kit desks out: a room seats the chairs its own painting draws, plus the boss's, and
past them an Employee waits at the counter. `design/office/t111-$room.png` is each of the six at
full seats and two more waiting, which is `?over=2` — the same shot T101 took, with no furniture the
painting did not draw:

```sh
for room in night-studio warm-loft scandi-daylight night-shift greenhouse garage-startup night-city; do
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
    --hide-scrollbars --force-device-scale-factor=1 --virtual-time-budget=9000 --window-size=1040,660 \
    --screenshot="design/office/t111-$room.png" \
    "http://localhost:5184/office-capture.html?delay=0&over=2&room=$room"
done
```

T156 told the layout pass about bubbles: a sitter's `Zzz` hangs level with the chair label of the
desk above theirs, and Night Studio with everyone Idle printed `Bo · Idlez`. Every bubble is now a
fixed box the labels move around. `design/office/t156-$room.png` is each of the six with everyone
Idle, so every sitter has a bubble; `design/office/t156-compare-*.png` put the audit's two floors and
the meeting sitter's short tag (`?meeting=6`) next to what they were, shot at
`--force-device-scale-factor=2`:

```sh
for room in night-studio warm-loft scandi-daylight night-shift greenhouse garage-startup night-city; do
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
    --hide-scrollbars --force-device-scale-factor=1 --virtual-time-budget=9000 --window-size=1040,660 \
    --screenshot="design/office/t156-$room.png" \
    "http://localhost:5184/office-capture.html?delay=0&room=$room&everyone=idle"
done
```
