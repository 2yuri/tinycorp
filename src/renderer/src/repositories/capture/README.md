# Repositories capture (dev only)

Renders the Repositories view with a repo on each rung of the ladder and the **Add repository**
panel open, so it can be compared with `design/screens/FuDXm.png` (#295, T143). Nothing here ships:
`repositories-capture.html` is not the app's entry, and no app module imports this folder.

```sh
npx vite --config src/renderer/src/repositories/capture/vite.config.mts
# then, in a browser or headless Chrome at 1512x944:
#   http://localhost:5195/repositories-capture.html
```

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=20000 \
  --window-size=1512,944 --force-device-scale-factor=1 \
  --screenshot=design/office/t143-repositories.png \
  "http://localhost:5195/repositories-capture.html"
```

The capture lives in `design/office/t143-repositories.png`. The cards and the panel are the app's
own `RepoCard` and `StackPanel`; only the repos behind them are the frame's.

## Against the frame

The chip is in the card's head, between the name block and the `Ready` badge, and reads `merges`
neutral, `PR only` in `--brand-warning` and `local only` in `--destructive`, with a merge, a
pull-request and a lock icon — which is what `FuDXm` draws. The foot is untouched: branch, worktree
root and `1 PR per repo`, then the access line.

Deliberate differences, each one a thing the frame could not know:

- **The panel's picker is three stacked rows**, not a chip row. The frame's Add repository panel
  scrolls past where the rung would sit, so it never draws one; the panel is 400px wide and each
  rung needs its sentence ("never merges", "may merge, subject to the Company's autonomy level"),
  which no chip holds. They read bottom-up, as the ladder does.
- **The `…` menu carries the ladder too**, under a `WHAT TINYCORP MAY DO` label, so a repo can be
  moved without opening the panel. The frame draws the menu closed.
- **The frame's `infra` has no checks**, which is the soft "No checks yet" hint, and the capture
  keeps it: it is the state the ticket's `local only` repo is most likely to be in.

## New repository (T144)

`new-repo-capture.html` renders the Add repository panel on its **New repository** source, filled in
the way frame `gFdvh` draws it, over a stand-in engine; `?state=in-place`, `?state=refused` and
`?state=signed-out` show the other rows the states frame `zzGk4` draws. Same server, same Chrome
command, with the page and the file swapped:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=8000 \
  --window-size=1512,944 --force-device-scale-factor=1 \
  --screenshot=design/office/t144-new-repo-new-folder.png \
  "http://localhost:5195/new-repo-capture.html"
```

The captures are `design/office/t144-new-repo-*.png`. Deliberate differences from the frame: the
Clone and Remote URL cards keep the app's `Not available yet`, since neither source exists; and the
last row keeps the app's `Detect the stack automatically` wording, which already differed from
`n7zRW0`.

## Found repositories (T168)

`found-repos-capture.html` renders the **Found repositories** picker over the boss's reference
folder — 110 repositories under `~/Projects/acme`, seven at the top, group folders of 67, 19, 8, 6
and 2, one a level deeper, six worktrees of `subscriptions` and one folder with no repos in it — so
it can be compared with frame `UohF8`. `?state=scanning`, `?state=empty` and `?state=self` draw the
three states of `XHkqC`. Same server, same Chrome command, with the page and the file swapped:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=8000 \
  --window-size=1512,944 --force-device-scale-factor=1 \
  --screenshot=docs/design-audit/t168-found-repositories.png \
  "http://localhost:5195/found-repos-capture.html"
```

The captures are `docs/design-audit/t168-found-*.png`. The picker, the tree, the modal and every
count are the app's own; only the folder behind them is `found-repos-fixture.ts`.

Deliberate differences from the frame:

- **Group folders are ordered biggest first**, then by name, so `payments/` (67) is at the top and
  is the one open when the picker draws. The frame draws them in that order; nothing in the walk
  imposes it, so the tree sorts them.
- **A group's rows are in path order**, which is what keeps a worktree directly under the repo it
  belongs to. The frame's `payments/` names three repos and the fixture's filler is called `svc-*`
  so that those three sort first, as they do in the frame.
- **The empty state has no filter row**, since there is nothing to filter. The frame draws that
  state as a card of its own, with no toolbar above it either.
- **`Start a repository here` is the app's New repository flow (T144)** with the folder filled in,
  which is what the frame's button promises.

## `?state=local`, and the click that never landed (T209)

`new-repo-capture.html` chose its source by looking for `[role="radio"]`. The source cards are
`<label>`s over a real radio and have no such role, so the click never landed and every
`?state=` of this page had been shooting the modal's opening source — `new-repo.css` was drawn by
no capture at all. It now finds the card by its title, keeps trying while `StrictMode` throws the
first mount away, and stops once the values are in.

`?state=local` stays on the source the modal opens with and types a folder that holds no repo,
which is where `Not a git repository yet` and its offer are drawn (`initialise-repo.css`).

```sh
#   http://localhost:5195/new-repo-capture.html?state=local
```
