# Company settings capture (dev only)

Renders the whole window on Company settings against the design's own fixture, so the page can be
compared with `design/screens/QgXdU.png` (General), `design/screens/V0brJM.png` (Office, with
`?tab=office`), `design/screens/bB6VX.png` (Usage & routing, with `?tab=routing`),
`design/screens/L0glbm.png` (Tokens, with `?tab=tokens`),
`design/screens/zpvHQ.png` (Environments, with `?tab=environments`),
`design/screens/uApL8.png` (Integrations, with `?tab=integrations`) and
`design/screens/qSIIY.png` (Import from Claude Code, with `?tab=integrations&open=mcp-import`). Nothing
here ships: `settings-capture.html` is not the app's entry, and no app module imports this folder.

`pnpm design:compare` shoots all of these and lays them beside their frames; the commands below are
for one tab at a time.

The fixture draws the frames' own chrome: no newer build (a `Version 0.4.0 available` chip in the
title bar that no frame draws moves the whole bar), 15% on the Usage row, and 42 pages on the
Memory row. **`?data=`** is the other Company the stub answers for (T181). The fixture above is the frame's —
eight Employees, three repos, two sign-ins, seven variables — and every real Company starts as none
of that. `?data=empty` is a Company on its first day and `?data=long` is one whose name is as long
as a name gets. Both were drawn in Pen after the audit called them undesigned (#428), and the sheet pairs them.

```sh
# a Company with nothing in it, on any tab:
google-chrome --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --virtual-time-budget=9000 --window-size=1512,944 \
  --screenshot=docs/design-audit/t181-settings-routing-new-company.png \
  'http://localhost:5185/settings-capture.html?tab=routing&data=empty'
```

The stub answers every call the window makes on mount, not only the settings page's own: one
missing method throws while React renders and the whole page comes back blank, which reads as a
broken capture rather than a broken stub. That is not a thing to remember — `SettingsCapture.test.tsx`
mounts every tab and fails `pnpm test` the moment one of them stops drawing its page.

```sh
npx vite --config src/renderer/src/settings/capture/vite.config.mts
# then screenshot http://localhost:5185/settings-capture.html at exactly 1512x944, 1x:
google-chrome --headless --force-device-scale-factor=1 --window-size=1512,944 \
  --screenshot=docs/design-audit/t76-company-settings.png \
  http://localhost:5185/settings-capture.html
# the Tokens tab (T180), against design/screens/L0glbm.png:
google-chrome --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --virtual-time-budget=9000 --window-size=1512,944 \
  --screenshot=docs/design-audit/t180-company-settings-tokens.png \
  'http://localhost:5185/settings-capture.html?tab=tokens'
# the Office tab (T83), against design/screens/V0brJM.png:
google-chrome --headless --force-device-scale-factor=1 --window-size=1512,944 \
  --screenshot=docs/design-audit/t83-company-settings-office.png \
  'http://localhost:5185/settings-capture.html?tab=office'
# the Usage & routing tab (T173), against design/screens/bB6VX.png:
google-chrome --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --virtual-time-budget=9000 --window-size=1512,944 \
  --screenshot=docs/design-audit/t173-company-settings-routing.png \
  'http://localhost:5185/settings-capture.html?tab=routing'
# the Environments tab (T176), against design/screens/zpvHQ.png:
google-chrome --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --virtual-time-budget=9000 --window-size=1512,944 \
  --screenshot=docs/design-audit/t176-company-settings-environments.png \
  'http://localhost:5185/settings-capture.html?tab=environments'
# the Import .env preview over it (frame aD50i, c). `&open=import` presses the button, because a
# headless capture cannot:
google-chrome --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --virtual-time-budget=9000 --window-size=1512,944 \
  --screenshot=docs/design-audit/t176-import-env-preview.png \
  'http://localhost:5185/settings-capture.html?tab=environments&open=import'
# the Integrations tab (T136 MCP servers, T137 Skills), against design/screens/uApL8.png:
google-chrome --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --virtual-time-budget=9000 --window-size=1512,944 \
  --screenshot=docs/design-audit/company-settings-integrations.png \
  'http://localhost:5185/settings-capture.html?tab=integrations'
# Import from Claude Code over it (T235, frame qSIIY). `&open=mcp-import` presses the button:
google-chrome --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --virtual-time-budget=9000 --window-size=1512,944 \
  --screenshot=docs/design-audit/t235-mcp-import.png \
  'http://localhost:5185/settings-capture.html?tab=integrations&open=mcp-import'
```

The window is 944 tall, as the frames are drawn. `?height=` makes it taller, for a card that sits
below the fold — the daily digest's does (T172):

```sh
# the whole Daily digest card (T172), against design/screens/b9EZF.png:
google-chrome --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --virtual-time-budget=9000 --window-size=1512,1300 \
  --screenshot=/tmp/settings-tall.png \
  'http://localhost:5185/settings-capture.html?height=1300'
```

Chrome's old `--headless` shoots before the page has drawn on this machine and writes a window of
flat background; `--headless=new` with a `--virtual-time-budget` waits for it.

The Office tab's preview shows the whole painting rather than the frame's `cover` crop: the current
room is narrower than the panel, and cropping it cuts off the desks the tab is about. Everything
else lines up with the frame within 2px — preview 173→652, detail bar 669, thumbnails 748, note 871.

The Integrations tab (T154) lines up with the frame's rows to the pixel: MCP rows 62px tall and
Skill rows 53px, 8px apart, in the card's own tone, with row borders at 259→320, 329→390 and
399→460. Every card below its head sits 1px lower than the frame's, because the shared card
subtitle sets its lines at 17px where the frame's 1.45 gives 16.7. The frame's Skills rows used to
say `Every reviewer` / `DevOps only` / `In this repo`. T154 changed them in Pen to the holder count
the app draws and the MCP rows already use.

Compare against the window region of the design frame (offset `(72, 54)` inside the 1656x1088
export). Headless Chrome writes untagged sRGB, so the Display-P3 conversion the design audit notes
asks for after an Electron `capturePage` does not apply here: the tokens compare byte for byte.
macOS draws the traffic lights over the title bar's 120px slot, so the harness stands in for them.

**T181** brought the tabs back to the frames: one container rule for every tab (full width at
`20px 22px`, which is `Content` in the frames — a tab that added its own padding on top drew its
cards 46px in from the window), General reordered into the frame's two columns with Chat and
Notifications merged into one card, and `About` moved out to Your profile's version row, because
the build is the app's and not the Company's. Three departures from the frames stay, each named in
the PR: the meters draw one colour where `bB6VX` paints the 68% bar amber (the app has no
threshold rule and this ticket did not settle one); a sign-in TinyCorp cannot read draws an empty
track and `usage not read` rather than the frame's invented percentage (decision 3); and the pins
are one group under the accounts with a row per Provider, because the engine pins per Provider and
the frame draws one Company on one.

**PERMISSIONS** landed in T164 (#355): the Company's default permission mode, in the Team card,
after MAXIMUM HEADCOUNT — which is where frame `QgXdU` puts `V0AWNP`, in the card it calls
*Defaults for new employees*. The capture beside the frame's card is
`docs/design-audit/t164-company-settings-vs-frame.png`. The frame's card also carries MODEL,
MONTHLY CAP and REPOSITORY ACCESS, none of which the app has here (decisions 3, 18, 31 and 38); the
Team card is where its defaults live.

**DAILY DIGEST** landed in T172: the card in the General column, under Notifications, against part
`a` of frame `b9EZF`. The captures are `docs/design-audit/t172-company-settings-digest.png` (the
944 window) and `t172-daily-digest-setting-vs-frame.png` (the frame's card beside the app's).
Part `b` of that frame is the native macOS banner, which no harness here can draw — what it says
is asserted in `src/main/features/planning/daily-digest.test.ts` instead.

The frame's card is off by default and this one is on, because the ticket settles the default the
other way: on, weekdays at 18:00. The chosen day chips also carry an indigo label in the frame and
a white one here, which is what the kit's chosen state uses everywhere else.
**Usage & routing** landed in T173. The fixture's first Provider carries two sign-ins and the
frame's `68%` bar; its reset is set to 21:00 *today*, because the meter writes the date in front of
any other day and the frame shows a clock time. Three differences from frame `bB6VX` are deliberate:
the frame draws one `WHEN … IS OUT` block, where the app draws one per Provider in the catalogue —
the rule is per Provider, and a Company on three of them would otherwise have no way to say
anything about the other two; an added sign-in has no bar, because its numbers would have to come
from its own credential and TinyCorp never reads one (decision 3); and a Provider whose CLI keeps a
single sign-in says so in place of a list.

The pin moved onto the account row in T205 (frame redrawn in #487). The fixture pins nothing, which
is the state the frame draws: `First with room left` beside the Provider with two sign-ins, no rule
and no button beside the one with a single sign-in — which keeps the empty 28px the others spend on
theirs, so all three meters stay in one column.

**ENVIRONMENTS** landed in T176, against frame `zpvHQ` and part `c` of `aD50i`. The captures are
`docs/design-audit/t176-company-settings-environments.png` and `t176-import-env-preview.png`.
The fixture is prod with the frame's seven variables and their scopes; it carries no value at all,
because nothing the renderer is ever handed does.

Three differences from `zpvHQ`, each one deliberate:

- **Every value is masked the same way**, twelve dots, where the frame leaves `sk_` in front of
  `STRIPE_SECRET_KEY`. The ticket asks for a fully masked value, and a prefix is a piece of a
  secret shown without Touch ID.
- **The repo the side panel ticks carries no caption**, where the frame writes `deploy checks`
  beside `billing-api`. The other two read `uses staging` and `uses dev`, which is a fact the app
  has; a per-repo caption is not.
- **A row with two repos ellipsizes the first chip** (`billing-a… +1`), because the window's
  content column is about 760px wide once the side panel takes its 300. The frame's table is drawn
  wider than the window it sits in.

**TOKENS** is both columns of frame `L0glbm`: *How Employees talk* landed in T180 and
*Compress what Employees read* in T179, in the same two-column container. The captures are
`docs/design-audit/t180-company-settings-tokens.png` and `t179-tokens.png`, and the tab is a row of
`tools/design-audit.mjs`'s table, so `pnpm design:compare` shoots the whole thing beside the frame.

**The states of `p4np9V`** are the left column's, and `?rtk=missing|old|wsl` makes the stub answer
with each: a headless capture cannot uninstall a binary, downgrade it, or be a Windows with a distro
that lacks it. The captures are `t179-tokens-not-installed.png`, `t179-tokens-too-old.png` and
`t179-tokens-in-wsl.png`. `p4np9V` is a sheet of cards rather than a window, so `pnpm design:compare`
has no frame to pair them with and lists all three as *undesigned*; the PR shows them beside it.

Two departures from `L0glbm` in that column, both deliberate: the Linux install row prints
`curl -fsSL …/install.sh | sh` as the frame does while Copy puts the whole 78-character line on the
clipboard; and *Saved this week* says *Nothing to read yet* rather than three zeroes where RTK has
filtered nothing for this Company, which is what a Company on its first day really has.

The fixture is on **Terse**, which is the frame's state and every Company's default, so the empty
Company reads the same here. *The same news, twice* is a fixed illustration with the frame's own
token counts: nothing in the app counts the tokens of a real message, and no message anywhere in the
app carries a count.

## `?data=temporary` (T209)

A Company whose folder can vanish on restart (decision 45): the General tab draws the warning and
its `Move…`. No frame draws it, and nothing else in the app draws `company-move.css`.

```sh
#   http://localhost:5185/settings-capture.html?tab=general&data=temporary&height=1400
```
