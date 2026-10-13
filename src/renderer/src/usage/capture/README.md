# Usage capture (dev only)

Renders the drawer's Usage button and the Usage popover against the design's own fixture, so they
can be compared with `design/screens/AAI0w.png` and `TMviL.png`. Nothing here ships:
`usage-capture.html` is not the app's entry, and no app module imports this folder.

```sh
npx vite --config src/renderer/src/usage/capture/vite.config.mts
# then screenshot:
#   http://localhost:5191/usage-capture.html?capture=button   → 276x36
#   http://localhost:5191/usage-capture.html?capture=popover  → 360x296 against TMviL's 360x293
#   http://localhost:5191/usage-capture.html?capture=unavailable  → the same card, Claude unreadable
#   http://localhost:5191/usage-capture.html?capture=accounts     → 360x370 against nV8jR's 360x370
#   http://localhost:5191/usage-capture.html?capture=sign-in      → 780x477, the card of Tmldc
#   http://localhost:5191/usage-capture.html?capture=signed-in    → 780x477, the card of iA8Wm
```

`sign-in` and `signed-in` are the sign-in modal's card (T263). The terminal is drawn as the
frames' own lines of text, because a PTY is the one part of it a capture cannot have.

`accounts` is frame `nV8jR` (T257): two sign-ins under Claude, each with the numbers read from its
own config folder, the `Default` mark on the one Employees take, and no meters of the Provider's
own — the accounts carry them.

The popover fixture is the frame's own three Providers, Codex included. The app has no usage source
for Codex and so really draws it as `Not connected`, the way OpenCode draws here: the harness exists
to lay the card over the frame, not to stand in for what the Providers report.

The captures live in `docs/design-audit/`. Chromium writes them with a Display-P3 profile, so
colours read 2-3 low per channel against the untagged-sRGB design exports — convert before
measuring, as the design audit notes says.
