"""Cut the desk kit out of its chroma and into the app's assets.

`design/office/desks/*.png` is what pen.dev exported: one desk to an image, on a bright green screen,
and JPEG-compressed whatever the extension says, so the screen is not one flat colour and the edge of
every desk carries green spill. The app cannot key that at load the way it keys the character and
marker sheets: `greenhouse-pine` has a green plant standing on it, and a colour key would drain it.

So the screen is flooded away from the border inwards, as `front_cells.py` does for a cell's
background — an interior green is never reached and never touched — the one rim of pixels left
against it has its spill pulled back to the grey beside it, and the result is cropped to the drawing
and written as a real RGBA PNG.

Nothing ships the kit since T111 — a room seats the chairs its own painting draws — so this is kept
for the day Pen draws a desk with its own sitter on it; see `design/office/desks/README.md`.

    python3 tools/desk_kit.py design/office/desks <out dir>
"""
from collections import deque
import sys
from pathlib import Path
from PIL import Image

# The screen, as the exports draw it: bright green, and far more green than red or blue even where
# the JPEG has smeared it into the desk.
def screen(p, tol=90):
    r, g, b = p[0], p[1], p[2]
    return g > 120 and g - max(r, b) > tol


# How big a block of screen the flood could not reach has to be before it is taken for a hole through
# the desk rather than for part of the drawing: the greenhouse desk's plant is the only green the kit
# draws, and no leaf of it is anywhere near this many pixels of the screen's own hue.
ENCLOSED_SCREEN = 400

# How far into the desk the screen's spill reaches, in pixels: the JPEG smears it about this far.
SPILL = 2


def key(path):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()
    out = Image.new("RGBA", (w, h))
    op = out.load()
    for y in range(h):
        for x in range(w):
            op[x, y] = px[x, y]
    # Flood the screen away from every border pixel that is screen: an interior green stays.
    seen = [[False] * w for _ in range(h)]
    queue = deque()
    for x in range(w):
        for y in (0, h - 1):
            queue.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            queue.append((x, y))
    while queue:
        x, y = queue.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or seen[y][x]:
            continue
        seen[y][x] = True
        if not screen(px[x, y]):
            continue
        op[x, y] = (0, 0, 0, 0)
        queue.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    # The holes the trestle frames enclose are screen too, and the border never reaches them: clear
    # any block of screen the flood left behind that is far too big to be a leaf of the one plant the
    # kit draws.
    for y in range(h):
        for x in range(w):
            if seen[y][x] or not screen(px[x, y]):
                continue
            block, queue = [], deque([(x, y)])
            while queue:
                bx, by = queue.popleft()
                if bx < 0 or by < 0 or bx >= w or by >= h or seen[by][bx] or not screen(px[bx, by]):
                    continue
                seen[by][bx] = True
                block.append((bx, by))
                queue.extend(((bx + 1, by), (bx - 1, by), (bx, by + 1), (bx, by - 1)))
            if len(block) > ENCLOSED_SCREEN:
                for bx, by in block:
                    op[bx, by] = (0, 0, 0, 0)

    # The rim against the screen keeps the spill it caught: pull its green back to the grey beside it.
    # JPEG smears the screen two pixels into the desk, so the pull reaches that far in.
    cleared = [[op[x, y][3] == 0 for x in range(w)] for y in range(h)]
    for y in range(h):
        for x in range(w):
            if cleared[y][x]:
                continue
            rim = any(
                0 <= x + dx < w and 0 <= y + dy < h and cleared[y + dy][x + dx]
                for dx in range(-SPILL, SPILL + 1)
                for dy in range(-SPILL, SPILL + 1)
            )
            if not rim:
                continue
            r, g, b, a = op[x, y]
            other = max(r, b)
            if g > other:
                op[x, y] = (r, other, b, a)
    return out.crop(out.getbbox())


def main(source, target):
    Path(target).mkdir(parents=True, exist_ok=True)
    for path in sorted(Path(source).glob("*.png")):
        cut = key(path)
        cut.save(Path(target) / path.name, optimize=True)
        print(f"{path.name}: {cut.size[0]}x{cut.size[1]}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
