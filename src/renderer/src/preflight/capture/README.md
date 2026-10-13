# Preflight screen capture (dev only)

Renders the preflight screen at its designed 680×740, so it can be compared with
`design/screens/KB9AX.png` (frame `KB9AX`, "Desktop App / Claude Code Missing"). Nothing here ships: `preflight-capture.html` is not the app's entry,
and no app module imports this folder.

```sh
npx vite --config src/renderer/src/preflight/capture/vite.config.mts
# then screenshot at 680x740:
#   http://localhost:5191/preflight-capture.html?state=signed-out
# `&providers=claude,codex,opencode` draws three Providers in trouble, one card each: two is
#   T135's Company on two products, three is the first run on a Mac that holds none of them (T169).
```

`?state=` takes any of `missing`, `signed-out` (the frame as drawn), `warning` and `ready`. The
words the cards carry are each Provider's own — in the app they come over the bridge from that
Provider's adapter, and this page spells out what those adapters write, so the capture needs no
main process.

This card has no smaller variant, and Company settings draws none. Where the app shows each
Provider's state outside this screen is Your profile's Providers card — a different component,
`profile/ProvidersCard.tsx`, drawn to its own frame `Oykzs` and shot by its own harness,
`src/renderer/src/profile/capture`.

The captures live in `docs/design-audit/t129-claude-code-missing.png` (one card, the frame),
`docs/design-audit/t135-provider-missing.png` (two) and
`docs/design-audit/t169-no-provider-ready.png` (three: a Mac with none of the CLIs, which is the
only state that blocks the Launcher before the first hire — T169). The first two were shot before
OpenCode joined the catalogue, so their tagline names two products where the app now names three;
nothing else in them has moved. Three cards do not fit the 740px window, so the column scrolls, as
the Launcher's own Company list does. They are taken at `--force-device-scale-factor=2` so
they line up pixel for pixel with the frame's own window region (`(144, 108)` to `(1504, 1588)`
inside `KB9AX.png`). Chromium writes captures with a Display-P3 profile, so colours read 2-3 low
per channel against the untagged-sRGB design exports — convert before measuring, as
the design audit notes says.

Everything in the frame lines up: the 78px mark, `Tiny Corp` at 30/700 with -1px tracking, the
592-wide card in the Launcher's 44px gutters with 20px padding and 14px between its rows, the 30px
warning chip, the title at 15/700, the body at 13/16, the mono box at 12.5px with 24px rows and a
14px copy icon, the note at 11.5px wrapping after `this is`, and the 144x39 primary button. Two
things are deliberately not the frame's:

- the frame's traffic lights are macOS's own and no headless capture draws them;
- the frame's tagline sits 20px left of the window's centre while the mark and the wordmark above
  it are centred. That is a Pen positioning artifact, not a design: the tagline here is centred
  with the rest of the head, exactly as the Launcher's own head centres its three lines.

The card says "so no Employee on Claude Code can start", where the frame as first drawn said "so no
Employee can start" — true when one Provider was the whole app, but the boss may now be reading two
cards and each has to be true on its own (T135). T158 changed the frame's copy in Pen to match, so
the two say the same words again. Two cards are the frame's card repeated, 12px apart, with only
the last of them carrying the note and `Check again`: one check asks them all.
