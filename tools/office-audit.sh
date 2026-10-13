#!/usr/bin/env bash
# Shoots every measured room in every state worth looking at, and lays the shots out as one sheet.
#
#   tools/office-audit.sh [out-dir]
#
# Needs the capture harness running:
#   npx vite --config src/renderer/src/office/capture/vite.config.mts
set -euo pipefail

OUT="${1:-/tmp/office-audit}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
ROOMS=(night-studio warm-loft scandi-daylight night-shift greenhouse garage-startup night-city)
STATES=("boss=5&approval=1" "everyone=parked&boss=5" "everyone=idle&boss=5")
mkdir -p "$OUT"

for room in "${ROOMS[@]}"; do
  i=0
  for state in "${STATES[@]}"; do
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=9000 \
      --window-size=1040,660 --screenshot="$OUT/$room-$i.png" \
      "http://localhost:5184/office-capture.html?delay=0&room=$room&$state" >/dev/null 2>&1
    i=$((i + 1))
  done
done

python3 - "$OUT" <<'PY'
import sys, glob, os
from PIL import Image

out = sys.argv[1]
shots = sorted(glob.glob(os.path.join(out, "*-*.png")))
if not shots:
    raise SystemExit("no shots")
tiles = [Image.open(s).convert("RGB").resize((520, 330)) for s in shots]
cols = 3
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new("RGB", (520 * cols, 330 * rows), (18, 18, 22))
for i, tile in enumerate(tiles):
    sheet.paste(tile, ((i % cols) * 520, (i // cols) * 330))
sheet.save(os.path.join(out, "contact-sheet.png"))
print(f"{len(tiles)} shots -> {os.path.join(out, 'contact-sheet.png')}")
PY
