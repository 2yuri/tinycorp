# Chat capture (dev only)

Renders the Chat view against the design's own fixture so the approval cards can be compared with
`design/screens/rPfPD.png` (the PR approval and its thread) and the approval-cards frame `ItWn6`
(the generic card). Nothing here ships: `capture.html` is not the app's entry, and no app module
imports this folder.

```sh
npx vite --config src/renderer/src/chat/capture/vite.config.mts
# then, in a browser or through Electron's capturePage at 1512x944:
#   http://localhost:5183/capture.html?capture=chat    the pending merge approval, its thread open
#   http://localhost:5183/capture.html?capture=hire    the pending hire approval, its thread open
#   http://localhost:5183/capture.html?capture=inbox   the boss's Inbox in place of the channel
#   http://localhost:5183/capture.html?capture=inbox-conversation  the Inbox with its DM row opened (JRSDX, T251)
#   http://localhost:5183/capture.html?capture=header  the shell's header above it: topic, members, pin, search (T44)
#   http://localhost:5183/capture.html?capture=panels  the three panels the header drops (T44)
#   http://localhost:5183/capture.html?capture=palette the composer with `/` typed, palette open (T39)
#   http://localhost:5183/capture.html?capture=attachments  a message carrying a screenshot and a log (T38)
#   http://localhost:5183/capture.html?capture=lightbox     the same message with its lightbox open (dzQXx, T236)
#   http://localhost:5183/capture.html?capture=planning     the planning thread of TC-142 (T171)
#   http://localhost:5183/capture.html?capture=prs     the three states of the #prs card while agents review (T170)
#   http://localhost:5183/capture.html?capture=targets the target card, the design's and one titled by a sentence (T271)
#   http://localhost:5183/capture.html?capture=digest  the app's own daily digest in #general (T172)
#   http://localhost:5183/capture.html?capture=env     the env_run approval prod raises (aD50i a, T176)
```

`?capture=inbox-conversation` is frame `JRSDX` (T251): the Inbox with the DM row clicked, so the
panel beside it draws the whole conversation — the day dividers, the red `New` line at the mark the
boss left, the opened message on its own fill, and a composer that posts *into the DM*. A headless
capture cannot click, so the frame clicks for it and stops once the opened message is on the page.
It passes the view no `channelId`, because the shell's Inbox route carries none and the view is
meant to follow whichever row the boss opens.

Two things it draws that the frame does not, both because the fixture is dated:

- the day dividers read `Wednesday, Sep 16` and `Thursday, Sep 17` rather than `Yesterday` and
  `Today`, which is what they say about a conversation that happened this week;
- the opened message's fill is `--secondary` at 60%, not the frame's `--muted`. In the Dark theme
  `--muted` is `#1e293b`, the very value `--card` takes, so the frame's own highlight draws nothing
  at all — measured off the export, both are `#1e293b`.

`?capture=planning` opens the epic channel `#ep-usage-invoices` on the planning thread of
`design/screens/D1E2lt.png` (T171): the system line that opens it, Nova's three numbered questions
with two answered inline, and the Plan card waiting on the boss. The capture lives in
`docs/design-audit/t171-chat-planning.png`.

Deliberate differences from `D1E2lt`, each one a thing the frame could not know:

- **The composer is the channel's own**, `Set a goal for the team…` with `Mention someone to wake
  them` at its right, where the frame writes `Answer Nova, or ask for changes…` and `Replies go to
  the planning thread`. The composer's hint is one rule for every channel (`composerHint`), and a
  planning thread does not yet change it.
- **There is no `Edit` beside Approve and Ask for changes.** The plan is written by the planner
  with `plan_draft`; the drawer's PLAN section offers `Edit`, which opens the planning thread, and
  the card would need a plan editor the app does not have.
- **The header badge reads `Boss + 6 Employees`**, not the frame's `Epic · Usage & invoices`: the
  channel header names its members the same way in every channel.

The captures live in `docs/design-audit/chat-approval-pr.png` and `chat-approval-hire.png`; the
attachments pass (T38) added `t38-chat-attachments.png`, against the composer row of `rPfPD`; the
avatar pass (T70) added `t70-chat.png` and `t70-chat-inbox.png`, against `rPfPD` and `c4qHR`; the
audit fixes (T151) added `t151-chat.png`, with Atlas's target card and the thread panel's two-button
row, and `t151-compare.png`, the frame beside it. The review conversation (T170) added
`t170-prs-cards.png`, against `F2HxCz`: one card per PR that updates in place, with no Approve
while the agents are still talking; the daily digest (T172) added `t172-chat-digest.png` and
`t172-chat-digest-vs-frame.png`, against `N47ud`. The left
344px stand in for the shell's rail and sidebar, so the conversation sits where the window puts it;
compare against the window region of the design frame (offset `(72, 54)`, 1512x944). Chromium writes
captures with a Display-P3 profile, so colours read 2-3 low per channel against the untagged-sRGB
design exports — convert before measuring, as the design audit notes says.

## The daily digest (T172, frame `N47ud`)

`?capture=digest` puts the digest fixture at the end of `#general`. Its times are written without a
zone, so the card reads `Tue 22 Sep · 18:00` wherever the capture is taken, and the evening has
nothing pinned, as the frame's channel does not.

Two deliberate differences from the frame:

- The frame's In review row reads `Iris testing · web-app #89`. The app writes `Iris reviewing`:
  it knows who the round is routed to, not what that person is doing with it.
- The frame's channel also carries a `You merged billing-api #128 …` line above the digest. That is
  a merge event in `#general`, which this app does not post; it is not part of the digest.

`?capture=env` is part `a` of frame `aD50i` (T176): Orion asks to run `pnpm db:migrate` with prod,
and the card names the command, the worktree, the repo and the variables it would receive — never
a value. The capture is `docs/design-audit/t176-chat-approval-env-run.png`.

Two differences from the frame. The card's title reads `Run a command · pnpm db:migrate with prod`
rather than `Orion wants to run pnpm db:migrate with prod`: every approval card in the app titles
itself `<kind> · <subject>`, and the requester is the message above it. And the second button is
`Send back` rather than `Deny`, which is what every approval card's reject is called here — it
takes the boss to the thread to say why, which is the frame's "Deny tells Orion why in the thread".

## `?capture=paths` and `?capture=delete` (T209)

- `?capture=paths` ends `#general` with a message that names two files, drawn as links (T114).
  The design's own thread names none, so `paths.css` was drawn by no capture before this.
- `?capture=delete` opens the planning channel — the only one in the fixture the boss may delete —
  and presses `Delete #…`, so the confirmation of `delete-channel.css` is on screen.

```sh
#   http://localhost:5183/capture.html?capture=paths
#   http://localhost:5183/capture.html?capture=delete
```
