# Your desk capture (dev only)

Renders the `Your desk` panel against the design's own chat fixture, so it can be compared with the
`Your Desk Panel` of `design/screens/KP0yY.png`. Nothing here ships: `desk-capture.html` is not the
app's entry, and no app module imports this folder.

```sh
npx vite --config src/renderer/src/office/desk-capture/vite.config.mts
# then screenshot http://localhost:5187/desk-capture.html at exactly 440x836, 1x:
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --hide-scrollbars --force-device-scale-factor=1 --virtual-time-budget=6000 \
  --window-size=440,836 --screenshot=docs/design-audit/t71-your-desk.png \
  http://localhost:5187/desk-capture.html
```

The 440 is the panel's 420 plus 20px of office canvas at its left, so the panel's border reads as it
does in the window. The capture lives in `docs/design-audit/t71-your-desk.png`; compare against the
panel region of the frame, which is `sips -c 836 420 --cropOffset 162 1164 design/screens/KP0yY.png`
(the window sits at `(72, 54)` inside the 1656x1088 export, the panel at `(1092, 108)` inside the
window). Headless Chrome writes untagged sRGB, so the Display-P3 conversion the design audit notes
asks for after an Electron `capturePage` does not apply here.

Known differences from the frame, all of them other tickets' decisions rather than this panel's:
the boss keeps the neutral avatar tile T70 gives them everywhere (the frame draws it indigo); the
Inbox rows carry T65's kind pills rather than the frame's bare accent word; and the shared composer
offers a fourth `Reference a repo` tool the frame's narrower box leaves out.
