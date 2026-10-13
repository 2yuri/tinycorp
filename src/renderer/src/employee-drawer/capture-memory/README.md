# Memory tab capture (dev only)

Renders the drawer's Memory tab against the design's own fixture, so it can be compared with the
Memory panel of `design/screens/x40RJd.png`. Nothing here ships: `memory-capture.html` is not the
app's entry, and no app module imports this folder.

`pnpm design:compare` is the way to use it. That state is the audit's first **panel**
row: the frame draws the whole app around the drawer, so the row names the drawer's own region of
the export — `{ x: 1144, y: 306, width: 440, height: 634 }` — and the harness is shot at that
region's own size, which is what the constants in `NotesCapture.tsx` are. The pair then lines up
pixel for pixel without anybody cropping by hand. The region is the frame's own `Memory Body` box
and not a measurement off the PNG: T193 read it by eye as starting at 304, which asked this harness
for two rows of the tab bar above it that it does not draw (T204).

```sh
# Or by hand, which is the same shot without the scoring:
npx vite --config src/renderer/src/employee-drawer/capture-memory/vite.config.mts
# then screenshot http://localhost:5188/memory-capture.html at 440x634, 1x.
```

The fixture is the frame's own Company: 142 notes, 9 summaries, a wake of 3.1k of 4k tokens, three
recent notes — one of them the boss's, badged `From you` — and two summarised ranges with one
summary due. One line differs from the frame on purpose: `#64–95`'s summary says *mid-ticket* where
the frame names a Provider, because no renderer file may name one (`no-provider-names.test.ts`).
