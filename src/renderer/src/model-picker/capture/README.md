# Model picker capture (dev only)

Draws MODEL and EFFORT, the two controls of frame `CLSj9` — three states of them on the left, the
open catalogue on the right — so they can be compared with `design/screens/CLSj9.png`. Nothing here
ships: `model-picker-capture.html` is not the app's entry, and no app module imports this folder.

```sh
npx vite --config src/renderer/src/model-picker/capture/vite.config.mts
# then screenshot at 1280x700:
#   http://localhost:5193/model-picker-capture.html
#   http://localhost:5193/model-picker-capture.html?menu=end
# `?menu=end` scrolls the catalogue to its last group; `?open=0` leaves the menu shut.
```

The states are the catalogue's, not this page's: every Provider but the last is signed in and the
last has no CLI on this Mac, so the third field takes the destructive stroke and its line, and the
last group of the menu is greyed with `not installed` beside its name. Each field sits on that
Provider's first model that carries a level, so all three draw a populated EFFORT control. The
levels under each are the ones that model's own entries carry, in catalogue order — the page
invents none. In the app those answers come over the bridge from each Provider's adapter (T135);
here they are handed in directly, so the page needs no main process.

The captures live in `docs/design-audit/t139-model-picker.png` (the closed field in its three
states, and the head of the open catalogue) and `docs/design-audit/t139-model-picker-not-installed.png`
(the same menu scrolled to the Provider with no CLI), taken at `--force-device-scale-factor=2` so
they line up with the frame's own export. Two shots because the catalogue is taller than the menu:
in the app it scrolls, and the frame draws it with every group unrolled at once. Both were re-shot
in T150, and `docs/design-audit/t150-model-picker-compare.png` sets the frame, the scrolled menu
before T150 (its outline scrolled away with the rows) and after it side by side.

Two things are deliberately not the frame's:

- the frame draws the `default` row nowhere, because it draws a boss who has already chosen. The
  menu here heads every group with it: an Employee with no model runs on the product's own default
  (decision 31), and without that row a boss who picked a model could never go back to it;
- the frame's EFFORT rows carry every level its CLI accepts; these carry the levels the catalogue
  holds entries for, which is fewer — an entry is a level someone read off the installed binary,
  and the rest are left out rather than guessed. OpenCode's row was filled from `opencode models`
  in T140; the other two carry what their own PRs confirmed;
- the frame's menu floats free on the page. Here it hangs off the field it belongs to, which is
  where it hangs in the app.
