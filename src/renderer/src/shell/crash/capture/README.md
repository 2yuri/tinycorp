# Something Broke capture (dev only)

Renders the crash card on the content area's background, so it can be compared with the card in
`design/screens/Y6xWi.png` (frame `Y6xWi`). Nothing here ships: `crash-capture.html` is not the
app's entry, and no app module imports this folder.

```sh
npx vite --config src/renderer/src/shell/crash/capture/vite.config.mts
# then screenshot at 1010x880 (the content area of the 1512x944 window, less rail and sidebar):
#   http://localhost:5190/crash-capture.html
```

The capture lives in `docs/design-audit/t128-something-broke.png`. The frame is 2x, so its card —
`(1440, 889)` to `(2560, 1445)` — is 560x278.5 at 1x. Chromium writes
captures with a Display-P3 profile, so colours read 2-3 low per channel against the untagged-sRGB
design exports; convert before measuring, as the design audit notes says.

Measured against the frame's card, the capture matches within a pixel: 560x277 against 560x278.5,
the icon chip at 24/33, the text column at 72, the mono box at 94-154, the buttons at 169-211 and
the two fine-print lines at 235 and 249.
