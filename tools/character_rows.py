"""Append characters drawn one-per-sheet to the office sheets.

`front_cells.py` and `append_front.py` cut the sheets Pen draws six characters at a time, poses
across the columns. A sheet that draws **one** character in every pose is laid out the other way —
four turns across, one pose per row — so it cannot go through those tools. This one turns such a
sheet into a single row of `characters.png`, plus its row of `characters-coffee.png`.

The source grid, 4 across and 6 down:

    row 0  standing        away-left, away-right, front-left, front-right
    row 1  seated          the same four turns
    row 2  seated reading   "
    row 3  standing, mug    "
    row 4  seated, hand up  "   (no pose in the office uses it yet)
    row 5  walking          four steps of the cycle

Run from the repo root with Pillow installed:

    python3 tools/character_rows.py out-dir sheet-a.png sheet-b.png ...

It writes `characters.png` and `characters-coffee.png` into the output directory, with every source
sheet appended as one more row, scaled so the new bodies stand the same height as the ones already
there and on the same baseline.
"""
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from front_cells import green, keep_largest  # noqa: E402
from append_front import CHROMA, GUTTER, CELL_W, CELL_H, FOOT, sheet_cells  # noqa: E402


def cut(path, grid, inset=8):
    """A sheet drawn edge to edge on chroma green, cut into trimmed cells.

    `front_cells.cells` seeds its flood fill from the commonest colour on the cell's border, which
    is right for the older sheets: they draw a light background inside each green gutter. These
    sheets have no such background, and their figures are big enough to touch the cell border — so
    that seed lands on a character's hair, and the fill eats the hair, then the shirt within its
    tolerance, and leaves the trousers behind as the largest blob. Here the background is only ever
    green, so only green is taken: the fill runs from the border through green alone, and the green
    left inside a fold or under an arm is cleared after it.
    """
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    down, across = grid
    out = []
    for r in range(down):
        line = []
        for c in range(across):
            cell = im.crop((
                round(c * w / across) + inset,
                round(r * h / down) + inset,
                round((c + 1) * w / across) - inset,
                round((r + 1) * h / down) - inset,
            ))
            px = cell.load()
            for x in range(cell.width):
                for y in range(cell.height):
                    p = px[x, y]
                    # The art uses no chroma green, so every green pixel is background, whether it
                    # is the gutter, the field, or a fringe the export left round a shoulder.
                    if green(p):
                        px[x, y] = (0, 0, 0, 0)
                    elif 0 < p[3] < 40:
                        # Too faint to see, but `getbbox` counts it and stands the cell off its
                        # baseline by the height of a ghost.
                        px[x, y] = (0, 0, 0, 0)
            keep_largest(cell)
            box = cell.getbbox()
            line.append(cell.crop(box) if box else None)
        out.append(line)
    return out

SOURCE_GRID = (6, 4)
"""Rows down, cells across, of a sheet that draws one character in every pose."""

AWAY_LEFT, AWAY_RIGHT, FRONT_LEFT, FRONT_RIGHT = 0, 1, 2, 3
STANDING, SEATED, READING, MUG, WAITING, WALKING = 0, 1, 2, 3, 4, 5

# Which source cell each column of `characters.png` takes, as (row, cell). The column numbers are
# `Column` in `src/renderer/src/office/characters.ts`; keep the two in step.
COLUMNS = [
    (STANDING, FRONT_LEFT),   # 0  IdleFacingViewer
    (SEATED, AWAY_LEFT),      # 1  SeatedTurnedLeft
    (SEATED, AWAY_RIGHT),     # 2  SeatedTurnedRight
    (WALKING, 0),             # 3  WalkingRight, the cycle's first step
    (SEATED, FRONT_LEFT),     # 4  SeatedFrontLeft
    (SEATED, FRONT_RIGHT),    # 5  SeatedFrontRight
    (WALKING, 0),             # 6  WalkCycleFirst
    (WALKING, 1),             # 7
    (WALKING, 2),             # 8
    (WALKING, 3),             # 9
    (READING, AWAY_LEFT),     # 10 ReadingFirst
    (READING, AWAY_RIGHT),    # 11
    (READING, FRONT_LEFT),    # 12
    (READING, FRONT_RIGHT),   # 13
    (WAITING, AWAY_LEFT),     # 14 WaitingFirst: seated with a hand up
    (WAITING, AWAY_RIGHT),    # 15
    (WAITING, FRONT_LEFT),    # 16
    (WAITING, FRONT_RIGHT),   # 17
]

COLUMN_COUNT = 18
"""How wide `characters.png` is. The sheets that draw six characters apiece stop at 14; the rows
built here fill the four after that, and the older rows leave them empty — the office falls back to
the seated pose for a look that has no hand-up art, the way it falls back for reading."""

# The coffee sheet is four columns wide and the office reads only the first: whoever waits at the
# counter is drawn facing the viewer with a mug. The rest are filled so no cell is empty.
COFFEE_COLUMNS = [(MUG, FRONT_LEFT), (MUG, AWAY_LEFT), (MUG, AWAY_RIGHT), (MUG, FRONT_RIGHT)]


def standing_height(rows):
    """The height the bodies already on the sheet stand at: the median of its idle column."""
    heights = sorted(cell.height for row in rows if (cell := row[0]) is not None)
    return heights[len(heights) // 2]


def place(sheet, art, column, row_top, scale):
    """One cell, scaled to the sheet's own bodies and stood on the row's baseline."""
    if art is None:
        return
    w = max(1, round(art.width * scale))
    h = max(1, round(art.height * scale))
    art = art.resize((w, h), Image.NEAREST)
    # Scaling can leave a transparent row under the feet, which would stand the drawing off the
    # baseline its neighbours are on: trim it again before it is placed.
    art = art.crop(art.getbbox() or (0, 0, w, h))
    w, h = art.size
    sheet.paste(art, (column * CELL_W + (CELL_W - w) // 2, row_top + CELL_H - FOOT - h), art)


def build(base, coffee_base, sources, out_dir):
    rows = sheet_cells(base)
    coffee_rows = sheet_cells(coffee_base)
    target = standing_height(rows)
    added = [cut(path, SOURCE_GRID) for path in sources]

    main = Image.new("RGBA", (CELL_W * COLUMN_COUNT, CELL_H * (len(rows) + len(added))), CHROMA)
    coffee = Image.new("RGBA", (CELL_W * 4, CELL_H * (len(coffee_rows) + len(added))), CHROMA)
    for r, row in enumerate(rows):
        for c, cell in enumerate(row[:COLUMN_COUNT]):
            place(main, cell, c, r * CELL_H, 1)
    for r, row in enumerate(coffee_rows):
        for c, cell in enumerate(row[:4]):
            place(coffee, cell, c, r * CELL_H, 1)

    for i, grid in enumerate(added):
        stood = grid[STANDING][FRONT_LEFT]
        if stood is None:
            raise SystemExit(f"{sources[i]}: no standing cell to scale by")
        scale = target / stood.height
        top = (len(rows) + i) * CELL_H
        for c, (row, cell) in enumerate(COLUMNS):
            place(main, grid[row][cell], c, top, scale)
        for c, (row, cell) in enumerate(COFFEE_COLUMNS):
            place(coffee, grid[row][cell], c, (len(coffee_rows) + i) * CELL_H, scale)

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for sheet, columns, name in ((main, COLUMN_COUNT, "characters.png"), (coffee, 4, "characters-coffee.png")):
        gutters(sheet, columns)
        sheet.convert("RGB").save(out / name)
    print(f"{len(rows)} + {len(added)} rows -> {out / 'characters.png'}")


def gutters(sheet, columns):
    """The darker green lines between the cells.

    They are not decoration: `sliceSheet` in the renderer finds the cells by looking for them, so a
    sheet saved without them loads as one enormous cell and every character disappears. The first
    build of this tool did exactly that, and the sheet test caught it — `expected […] to have a
    length of 18 but got 1`.
    """
    draw = sheet.load()
    for r in range(1, sheet.height // CELL_H):
        for x in range(sheet.width):
            draw[x, r * CELL_H] = GUTTER
            draw[x, r * CELL_H - 1] = GUTTER
    for c in range(1, columns):
        for y in range(sheet.height):
            draw[c * CELL_W, y] = GUTTER
            draw[c * CELL_W - 1, y] = GUTTER


if __name__ == "__main__":
    here = Path("src/renderer/public/office")
    build(here / "characters.png", here / "characters-coffee.png", sys.argv[2:], sys.argv[1])
