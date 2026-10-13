# Sheet tools

`characters.png` is assembled here, never drawn here: every pose comes from pen.dev.

- `front_cells.py <sheet.png> <preview.png>` cuts a generated sheet into cells. It finds the green
  gutters, then floods the background away from each cell's border inwards, so a white shirt in the
  middle of a figure survives while a white page behind it does not.
- `desk_kit.py <design/office/desks> <out dir>` cuts the desk kit out of the chroma green it is
  exported on. The screen is flooded away from the border inwards, so the plant on the greenhouse
  desk keeps its green, and the blocks the trestle frames enclose are cleared too. Nothing ships the
  kit since T111 — a room seats the chairs its own painting draws — so this runs only the day Pen
  draws a desk with its own sitter on it.
- `character_rows.py <out dir> <sheet.png ...>` appends characters drawn **one to a sheet** — four
  turns across, one pose per row — as one row each of `characters.png` and `characters-coffee.png`.
  The sheets the other tools take draw six characters at a time with the poses across the columns;
  these are laid out the other way round, so they need their own cut. It scales each new body to the
  height the ones already on the sheet stand at, stands it on the same baseline, and redraws the
  gutters — without those the renderer's `sliceSheet` reads the whole sheet as one cell.
- `append_front.py <characters.png> <out.png> [--front a.png ...] [--walk a.png ...]` rebuilds the
  office sheet with the generated columns appended, each scaled to the row's own height and stood on
  the same baseline: the two front-seated poses at columns 5 and 6, and the four steps of a walk
  cycle at 7 to 10 when those sheets exist. A row with no such art keeps those cells empty and the
  renderer falls back to the pose it has.

Run them from the repo root with Pillow installed.

## Looking at the whole office

`office-audit.sh [out-dir]` shoots all six measured rooms in three states — a Company at work with an
approval pending, the whole Company parked at the counter, and everyone idle — and lays the eighteen
shots out as one contact sheet. Start the capture harness first. It is the cheap way to see a change
in every room at once instead of finding out one room at a time.
