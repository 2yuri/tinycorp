# Testing capture (dev only)

Renders the Testing screen against the design's own fixture so it can be compared with
`design/screens/BRzY6.png`, and with `?cards` the three evidence cards of `design/screens/vKIwf.png`.
Nothing here ships: `testing-capture.html` is not the app's entry, and no app module imports this
folder.

```sh
npx vite --config src/renderer/src/testing/capture/vite.config.mts
# then, in a browser or through Electron's capturePage at 1512x944:
#   http://localhost:5197/testing-capture.html          BRzY6 — Manual QA, mid-attempt
#   http://localhost:5197/testing-capture.html?cards    vKIwf — the evidence card in three states
```

The captures live in `docs/design-audit/t174-testing.png` and `docs/design-audit/t174-evidence-cards.png`.
The left 344px stand in for the shell's rail and sidebar, so the split sits where the window puts
it; compare against the window region of the frame (offset `(72, 54)`, 1512x944).

The screen is drawn on the attempt the frame is drawn on: Iris tested all four criteria and passed
them, the boss has since failed step 3 on 90d with a note and a screenshot, and step 4 — the one
Iris added — is still to test. `pnpm dev` is running on 5173 from the ticket's worktree.

## Against the frame

Anatomy and order follow `BRzY6`: the Run it row with its play, command, `Running`, Log, Stop and
Open, and the one-line output strip under it; the script header with its step count, where the
steps came from and `2 passed · 1 failed · 1 to test`; each step with its criterion tag, Pass /
Fail, its note and what is attached to it; the Agent evidence panel with the mode strip, Iris's
card, what she verified, the checks and the before-merge timeline; the two actions along the bottom
with `Pass testing → ready to merge` off while a step is failed.

Deliberate differences, each a thing the frame could not know:

- **The panel's tabs are `Agent evidence` and `Review`.** The frame draws a third, `Plan`; the plan
  has its own place in the ticket drawer (T171), and a second copy of it here would be a second
  thing to keep right.
- **`Report bug → back to Doing` is off until a step is marked failed**, with the reason in its
  title. The frame draws it live beside one failed step, which is the same state; what it does not
  draw is what the button would mean with nothing failed, and the answer is nothing.
- **A screenshot is a thumbnail with its file name under it**, not the frame's bare tile: the file
  is what the assignee gets, so the name is worth showing.
- **The header's avatars are the shell's**, not this screen's: the frame draws the member stack in
  the content header, which the shell owns.
