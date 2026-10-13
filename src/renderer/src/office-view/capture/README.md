# Keep awake capture (dev only)

Renders the map dock with the coffee cup lit and its menu open, so it can be compared with
`design/screens/sMIWE.png`. Nothing here ships: `keep-awake-capture.html` is not the app's entry,
and no app module imports this folder.

```sh
npx vite --config src/renderer/src/office-view/capture/vite.config.mts
# then screenshot http://localhost:5192/keep-awake-capture.html at 460x420
```

The committed capture is `design/office/t99-keep-awake.png`, taken true-1x through headless
Chrome, which writes plain sRGB so the colours compare byte for byte with the export.

## `?capture=budget` (T209)

The dim overlay and the Budget Card over the office floor (`design/screens/d9m0M.png`,
decision 31), at 1040x660. It is the only state `out-of-budget.css` is drawn in.

```sh
#   http://localhost:5192/keep-awake-capture.html?capture=budget
```
