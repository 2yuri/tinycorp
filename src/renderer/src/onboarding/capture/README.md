# Onboarding Repositories capture (dev only)

Renders the setup wizard on its **Repositories** step with the Found repositories picker in it
(T168), so it can be compared with `design/screens/DxNcO.png`. Nothing here ships:
`onboarding-repos-capture.html` is not the app's entry, and no app module imports this folder.

```sh
npx vite --config src/renderer/src/onboarding/capture/vite.config.mts
```

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=8000 \
  --window-size=1512,944 --force-device-scale-factor=1 \
  --screenshot=docs/design-audit/t168-onboarding-repositories.png \
  "http://localhost:5196/onboarding-repos-capture.html"
```

The capture is `docs/design-audit/t168-onboarding-repositories.png`. The wizard chrome, the step,
the side summary and the picker are the app's own; the folder behind them is the repositories
capture's fixture, shared so the two frames are about the same 110 repositories.

## Against the frame

The side summary is the frame's: Connected (core), Described, Selected to connect, Found not
selected, and the warning that nothing is added until Continue. The tree is the same component the
Add Repository modal draws, so everything said in `src/renderer/src/repositories/capture/README.md`
about ordering holds here too.

Deliberate differences, each one a thing the frame could not know:

- **The CONNECTED card stays above the tree.** The frame shows `core` only as an `Already added`
  row, with no card; but the card is where a connected repo's brief is typed, and the frame's own
  summary counts `Described`, which nothing else on the step can change. The card is kept and the
  row marks the same repo as added, which is what the tree does for every repo the Company has.
- **The warning reads "Each one comes in with its checks detected and a brief you can fill in
  afterwards."** The frame says "gets its own brief on the next screen", and there is no next
  screen: Continue goes to the Office step. The promise was changed to the one the app keeps.
- **The tree stops at 380px and scrolls** inside the step, because the card above it and the
  footer below it are the step's, not the picker's.

## The wizard's other two steps (T209)

`?step=team` and `?step=first-ticket` draw steps 3 and 5 in the same chrome, so `team-step.css`
and `first-ticket-step.css` are drawn by a baseline at all. Neither has a Pen frame here; they are
rows in `tools/design-baseline.mjs` and not in the audit's table.

```sh
#   http://localhost:5196/onboarding-repos-capture.html?step=team
#   http://localhost:5196/onboarding-repos-capture.html?step=first-ticket
```
