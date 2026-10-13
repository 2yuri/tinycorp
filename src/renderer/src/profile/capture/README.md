# Your profile capture (dev only)

Renders the whole window on Your profile against the design's own fixture, so the page can be
compared with `design/screens/Oykzs.png`. Nothing here ships: `profile-capture.html` is not the
app's entry, and no app module imports this folder.

```sh
npx vite --config src/renderer/src/profile/capture/vite.config.mts
# then screenshot http://localhost:5187/profile-capture.html at exactly 1512x944, 1x:
google-chrome --headless --force-device-scale-factor=1 --window-size=1512,944 \
  --screenshot=docs/design-audit/t79-your-profile.png \
  http://localhost:5187/profile-capture.html
```

Compare against the window region of the design frame (offset `(72, 54)` inside the 1656x1088
export). macOS draws the traffic lights over the title bar's 120px slot, so the harness stands in
for them.

The fixture's reset is measured from the moment the card reads it, so the line is there whenever the
capture is shot; a pinned instant passes and takes the line, and 24px of the card, with it (T148).

The stub answers every call the window makes on mount, not only Your profile's own: one missing
method throws while React renders and the whole window comes back blank, which reads as a broken
capture rather than a broken stub. `ProfileCapture.test.tsx` mounts the harness and fails
`pnpm test` the moment it stops drawing the screen.

Deliberate departures from the frame, all named in the ticket's PR:

- the drawer's boss row draws the character the boss picked, where the frame still shows `YM`
  (the ticket asks for the sprite everywhere; Pen cannot draw the sheet);
- the Providers card carries each Provider's own mark from the catalogue (`PROVIDER_ICON`, frame
  `TMviL`), where `Oykzs` drew a terminal for all three;
- the plans are what the CLIs really print — `Max`, not the frame's `Max 20×`; `ChatGPT`, not
  `ChatGPT Plus` — and the second Provider has no account line at all, because `codex login status`
  names the subscription it is logged in with and nothing else;
- a connected Provider that reports no numbers says why, one quiet line where the frame drew
  nothing: the rule is that a Provider TinyCorp cannot read reports its reason, never a zero
  (`shared/provider-usage.ts`);
- the reset line counts down (`Resets in 1h 23m`) where the frame names a clock time, which is
  what every other meter in the app does (T80).

**Accounts** landed in T173, against `design/screens/A2lOk0.png`. A row now carries both halves at
once: where the CLI runs (T167's `Runs in`, frame `Oykzs`) above its limit, and the sign-ins under
it. The capture is shot on a Mac, where the `Runs in` switch draws only for a Provider the fixture
puts in two places.

Each Provider lists its sign-ins under its row — label, plan, address, the `Default` mark — with
`Add another account` under them, and a Provider whose CLI keeps one sign-in says so instead. That
button makes the directory and opens the product's own login in a terminal; **TinyCorp never sees, types or stores
the credential**. Only the sign-in TinyCorp reads the usage with carries a bar; the others say why
they do not, and never a zero.

```sh
# Your profile with the Accounts list (T173), against design/screens/A2lOk0.png:
google-chrome --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --virtual-time-budget=9000 --window-size=1512,944 \
  --screenshot=docs/design-audit/t173-your-profile-accounts.png \
  http://localhost:5187/profile-capture.html
```
