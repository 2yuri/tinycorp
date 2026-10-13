# Launcher capture (dev only)

Renders the Launcher at its designed 680×740, so it can be compared with `design/screens/jPSiE.png`
(frame `Desktop App / Launcher`). Nothing here ships: `launcher-capture.html` is not the app's
entry, and no app module imports this folder.

```sh
npx vite --config src/renderer/src/launcher/capture/vite.config.mts
# then screenshot at 680x740:
#   http://localhost:5192/launcher-capture.html
# `?unfinished=0` drops the row that still owes its setup wizard, for a before/after.
# `?step=create` draws the Create step with the folder it suggests, and `&onedrive=1` puts that
# folder inside OneDrive, which adds the line under the field (T252).
```

The list is `fixture.ts`, written against a fixed clock so the meta lines read the same every time.
The second row is T59's: a Company created but never taken through the setup wizard, wearing the
kit's `Badge`/`warning` as `Setup unfinished`. The capture lives in
`docs/design-audit/t59-setup-unfinished.png`.

The frame has no such row — it predates a wizard that could be left unfinished — so the badge is
not compared against it; the rest of the screen is. As with every capture here, Chromium writes a
Display-P3 profile, so colours read 2-3 low per channel against the untagged-sRGB design exports:
convert before measuring, as the design audit notes says.
