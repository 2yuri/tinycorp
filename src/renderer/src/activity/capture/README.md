# Activity capture (dev only)

Renders the Activity feed and its rail against a fixture built from the design's own frame, so the
view can be compared with `design/screens/Andvt.png`. Nothing here ships: `activity-capture.html` is
not the app's entry, and no app module imports this folder.

```sh
npx vite --config src/renderer/src/activity/capture/vite.config.mts
# then screenshot at 1512x944:
#   http://localhost:5186/activity-capture.html
```

The capture lives in `docs/design-audit/t36-activity.png`. The left 344px stand in for the shell's
rail and sidebar, so the feed sits where the window puts it. Compare against the frame cropped at
**`(72, 98)`, 1512x846** — not `(72, 54)`: the window region starts at the title bar, and the
harness draws no title bar, so a `(72, 54)` crop puts the frame 44px below the capture. (T152: the
same 44px mistake the design audit notes found in the sidebar harness's README. The audit's numbers
for this screen are in `(72, 54)` coordinates, i.e. 44 higher than this crop's.) Chromium writes
captures with a Display-P3 profile, so colours read 2-3 low per channel against the untagged-sRGB
design exports — convert before measuring, as the design audit notes says.

These are deliberately not drawn as the design has them, as the audit's section 10 calls for:

- the `Spend` chip is `Capacity`;
- the `$84 spent` tile and the `BUDGET` card are gone (no per-dollar accounting, decisions 3, 18
  and 31);
- the retention pill says what is true — the log keeps everything;
- two TODAY tiles count something else: the frame's `commits` is `tickets opened` and its
  `tickets closed` is `merges`, because the log has neither a commit event nor a closed-ticket
  event to count (`activity-view.ts`, `TODAY_STATS`).
