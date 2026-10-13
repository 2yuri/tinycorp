"""Cut the seated-front sheet into cells with the background removed.

The sheet has bright green gutters and a light background inside each cell. The background is the
region connected to the cell's border, so it is flood-filled away rather than colour-keyed: a white
shirt in the middle of a figure is never touched.
"""
from collections import deque
from PIL import Image


def green(p):
    r, g, b = p[0], p[1], p[2]
    return g > 110 and g > r * 1.5 and g > b * 1.5


def spans(n, line):
    out, start = [], 0
    for at in range(n + 1):
        hit = at == n or line(at)
        if hit and at > start:
            out.append((start, at))
        if hit:
            start = at + 1
    return [s for s in out if s[1] - s[0] > 20]


def keep_largest(cell):
    """Clears everything but the biggest drawing in the cell.

    The fill leaves specks behind — a pixel of gutter the inset did not reach, a fleck of shadow —
    and a speck below the feet becomes the cell's lowest pixel, which stands the whole drawing off
    the baseline when it is placed. The figure, its chair and whatever it holds are one connected
    thing; everything else is dust.
    """
    px = cell.load()
    w, h = cell.size
    seen = [[False] * h for _ in range(w)]
    best, best_size = None, 0
    for sx in range(w):
        for sy in range(h):
            if seen[sx][sy] or px[sx, sy][3] == 0:
                continue
            stack, blob = [(sx, sy)], []
            seen[sx][sy] = True
            while stack:
                x, y = stack.pop()
                blob.append((x, y))
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[nx][ny] and px[nx, ny][3] > 0:
                        seen[nx][ny] = True
                        stack.append((nx, ny))
            if len(blob) > best_size:
                best, best_size = blob, len(blob)
    if best is None:
        return
    keep = set(best)
    for x in range(w):
        for y in range(h):
            if px[x, y][3] > 0 and (x, y) not in keep:
                px[x, y] = (0, 0, 0, 0)


def cells(path, tol=70, inset=8, grid=None):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()
    if grid:
        # A sheet whose own background is green cannot be split by looking for green lines: the whole
        # image is green. When the grid is known, cut it evenly and let the flood fill do the rest.
        down, across = grid
        rows = [(round(i * h / down), round((i + 1) * h / down)) for i in range(down)]
        cols = [(round(i * w / across), round((i + 1) * w / across)) for i in range(across)]
    else:
        cols = spans(w, lambda x: sum(1 for y in range(h) if green(px[x, y])) > h * 0.7)
        rows = spans(h, lambda y: sum(1 for x in range(w) if green(px[x, y])) > w * 0.7)
    grid = []
    for top, bottom in rows:
        line = []
        for left, right in cols:
            cell = im.crop((left + inset, top + inset, right - inset, bottom - inset)).convert("RGBA")
            cw, chh = cell.size
            cp = cell.load()
            border = []
            for x in range(cw):
                for y in (0, chh - 1):
                    if not green(cp[x, y]):
                        border.append(cp[x, y][:3])
            for y in range(chh):
                for x in (0, cw - 1):
                    if not green(cp[x, y]):
                        border.append(cp[x, y][:3])
            if not border:
                # A sheet drawn on chroma green: the whole border is the background, which is exactly
                # what the fill wants as its seed.
                border = [cp[x, y][:3] for x in range(cw) for y in (0, chh - 1)]
            seed = max(set(border), key=border.count)
            seen = [[False] * chh for _ in range(cw)]
            q = deque()
            for x in range(cw):
                for y in (0, chh - 1):
                    q.append((x, y))
            for y in range(chh):
                for x in (0, cw - 1):
                    q.append((x, y))
            while q:
                x, y = q.popleft()
                if x < 0 or y < 0 or x >= cw or y >= chh or seen[x][y]:
                    continue
                p = cp[x, y]
                if abs(p[0] - seed[0]) + abs(p[1] - seed[1]) + abs(p[2] - seed[2]) > tol and not green(p):
                    continue
                seen[x][y] = True
                cp[x, y] = (0, 0, 0, 0)
                q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
            # A pixel too faint to see becomes chroma green when the sheet is flattened, but it still
            # counts as drawing to `getbbox`, which stands the cell off its baseline by the height of
            # a ghost. Drop them before anything is measured.
            faint = cell.load()
            for x in range(cell.width):
                for y in range(cell.height):
                    if 0 < faint[x, y][3] < 40:
                        faint[x, y] = (0, 0, 0, 0)
            keep_largest(cell)
            box = cell.getbbox()
            line.append(cell.crop(box) if box else None)
        grid.append(line)
    return grid


if __name__ == "__main__":
    import sys
    size = None
    if len(sys.argv) > 3:
        down, across = sys.argv[3].lower().split("x")
        size = (int(down), int(across))
    grid = cells(sys.argv[1], grid=size)
    sheet = Image.new("RGBA", (220 * len(grid[0]), 230 * len(grid)), (40, 244, 22, 255))
    for r, row in enumerate(grid):
        for c, cell in enumerate(row):
            if cell:
                sheet.paste(cell, (c * 220 + (220 - cell.width) // 2, r * 230 + 230 - 8 - cell.height), cell)
    sheet.convert("RGB").save(sys.argv[2])
    print("cells:", len(grid), "x", len(grid[0]), "->", sys.argv[2])
