"""Append the two front-seated columns to the office character sheet.

Column 4 is the sitter turned down and to the left, column 5 down and to the right: the poses a
chair on the far side of a desk needs. Rows whose art has not been drawn yet keep those two cells
empty, and the renderer falls back to the pose it uses today.
"""
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from front_cells import cells  # noqa: E402

CHROMA = (40, 244, 22, 255)
GUTTER = (12, 175, 3, 255)
CELL_W, CELL_H, FOOT = 271, 242, 17
# The four poses the base sheet draws: idle, the two seated from behind, and the one walking step.
# Only these are carried over, so re-running the tool on a sheet it already built rebuilds every
# generated column from its own source sheet instead of pasting the new art over whatever was in it,
# which left the old art showing round the new where the new was smaller (T103).
BASE_COLUMNS = 4
# The front sheets draw the two turns first — down and to the left, then down and to the right —
# and the straight-on poses after them, which the office has no seat for.
FRONT_COLUMNS = (0, 1)


def sheet_cells(path):
    """The existing sheet's cells, trimmed, row by row."""
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()
    rows, cols = h // CELL_H, w // CELL_W
    out = []
    for r in range(rows):
        line = []
        for c in range(cols):
            cell = im.crop((c * CELL_W, r * CELL_H, (c + 1) * CELL_W, (r + 1) * CELL_H))
            cp = cell.load()
            for y in range(CELL_H):
                for x in range(CELL_W):
                    p = cp[x, y]
                    if p[1] > 120 and p[1] > p[0] * 1.5 and p[1] > p[2] * 1.5:
                        cp[x, y] = (0, 0, 0, 0)
            box = cell.getbbox()
            line.append(cell.crop(box) if box else None)
        out.append(line)
    return out


def sheet_rows(paths, grid=None):
    """Every row of every sheet in order, cut into cells."""
    return [row for path in paths for row in cells(path, grid=grid)]


def build(base, front_sheets, out, walk_sheets=(), read_sheets=(), grid=None):
    rows = sheet_cells(base)
    front = sheet_rows(front_sheets)
    walk = sheet_rows(walk_sheets, grid)
    read = sheet_rows(read_sheets, grid)
    columns = 14 if read else 10 if walk else 6
    sheet = Image.new("RGBA", (CELL_W * columns, CELL_H * len(rows)), CHROMA)
    for r, row in enumerate(rows):
        seated = row[1]
        for c, cell in enumerate(row[:BASE_COLUMNS]):
            if cell:
                sheet.paste(cell, (c * CELL_W + (CELL_W - cell.width) // 2, r * CELL_H + CELL_H - FOOT - cell.height), cell)
        if r >= len(front) or seated is None:
            continue
        turns = [front[r][c] for c in FRONT_COLUMNS]
        if any(art is None for art in turns):
            continue
        for i, art in enumerate(turns):
            scale = seated.height / art.height
            w = max(1, round(art.width * scale))
            h = max(1, round(art.height * scale))
            art = art.resize((w, h), Image.NEAREST)
            # Scaling can leave a transparent row under the feet, which would stand the drawing off
            # the baseline its neighbours are on: trim it again before it is placed.
            art = art.crop(art.getbbox() or (0, 0, w, h))
            w, h = art.size
            x = (4 + i) * CELL_W + (CELL_W - w) // 2
            sheet.paste(art, (x, r * CELL_H + CELL_H - FOOT - h), art)
    for r, row in enumerate(rows):
        stand = row[0]
        if r >= len(walk) or stand is None:
            continue
        for i, art in enumerate(walk[r][:4]):
            if art is None:
                continue
            scale = stand.height / art.height
            w = max(1, round(art.width * scale))
            h = max(1, round(art.height * scale))
            art = art.resize((w, h), Image.NEAREST)
            # Scaling can leave a transparent row under the feet, which would stand the drawing off
            # the baseline its neighbours are on: trim it again before it is placed.
            art = art.crop(art.getbbox() or (0, 0, w, h))
            w, h = art.size
            x = (6 + i) * CELL_W + (CELL_W - w) // 2
            sheet.paste(art, (x, r * CELL_H + CELL_H - FOOT - h), art)

    for r, row in enumerate(rows):
        seated = row[1]
        if r >= len(read) or seated is None:
            continue
        for i, art in enumerate(read[r][:4]):
            if art is None:
                continue
            scale = seated.height / art.height
            w = max(1, round(art.width * scale))
            h = max(1, round(art.height * scale))
            art = art.resize((w, h), Image.NEAREST)
            # Scaling can leave a transparent row under the feet, which would stand the drawing off
            # the baseline its neighbours are on: trim it again before it is placed.
            art = art.crop(art.getbbox() or (0, 0, w, h))
            w, h = art.size
            x = (10 + i) * CELL_W + (CELL_W - w) // 2
            sheet.paste(art, (x, r * CELL_H + CELL_H - FOOT - h), art)

    draw = sheet.load()
    for r in range(1, len(rows)):
        for x in range(sheet.width):
            draw[x, r * CELL_H] = GUTTER
            draw[x, r * CELL_H - 1] = GUTTER
    for c in range(1, columns):
        for y in range(sheet.height):
            draw[c * CELL_W, y] = GUTTER
            draw[c * CELL_W - 1, y] = GUTTER
    sheet.convert("RGB").save(out)
    print(f"{out}: {len(rows)} rows x {columns} columns, front art for {min(len(front), len(rows))} of them")


def parse(argv):
    """`<sheet> <out> [--front a b ...] [--walk a b ...]`, with bare paths meaning `--front`."""
    groups = {"--front": [], "--walk": [], "--read": []}
    current = "--front"
    for arg in argv:
        if arg in groups:
            current = arg
        else:
            groups[current].append(arg)
    return groups["--front"], groups["--walk"], groups["--read"]


if __name__ == "__main__":
    front, walk, read = parse(sys.argv[3:])
    # The walk and reading sheets are drawn on green, so their grid cannot be found by looking for
    # green lines: they are six rows of four, and are cut evenly.
    build(sys.argv[1], front, sys.argv[2], walk, read, grid=(6, 4))
