# Office art

- `room.png`: the painted office, `design/office/empty-room.png` scaled to cover the 1040×660 `Office Map`
  layer of `design/html/office.html` (generated for this project).
- `characters.png`: `design/office/characters.png` (generated for this project in pen.dev), 23 characters
  × 14 poses on a green chroma background, keyed out at load. Eighteen come from the sheets that draw
  six characters apiece; the last five from `design/office/character-sheet-extra-*.png`, which draw one
  character in every pose and are cut by `tools/character_rows.py`. Columns 15 to 18 are that pose
  set's own: seated with a hand up, for an Employee waiting on the boss who did not get the one spot
  at the boss desk. A look drawn before that pose existed leaves them empty and sits instead. The last two poses are the sitter seen
  from the front, for the chairs the room art tucks in on the far side of a desk; rows whose front art
  is not drawn yet leave those cells empty and fall back to the idle pose.
- `LICENSE-pixel-agents`: the office pathfinding (`src/shared/office/layout.ts` `findPath`) is ported from
  [Pixel Agents](https://github.com/pablodelucca/pixel-agents) (MIT).
- `office-marker-sheet.png`: `design/office/office-marker-sheet.png`, the emerald and the speech
  bubbles on one green-chroma sheet, keyed at load.
- `plaques/night-shift.png`, `plaques/greenhouse.png`: the two plaques the Night Shift and Greenhouse
  rooms hang the Company's logo on (T280), generated for this project in pen.dev (frame `dUiiY`,
  `design/screens/dUiiY.png`), their magenta background keyed out and scaled to twice the size they
  are drawn at.
- `rooms/night-city.png`: the Night City room (T282), generated for this project in pen.dev (frame
  `Night City · Pen A3`, source `design/office/rooms/night-city.png`), scaled to cover 1040×660 and
  centre-cropped.
