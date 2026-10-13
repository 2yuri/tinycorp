# Edit Employee capture (dev only)

Draws Edit Employee, frame `FbR2n`, on the frame's own Employee — Ada Lorne, Frontend, hired
12 Sep, desk 4, with `linear` from her role and `playwright` her own, and `review-checklist` from
her role beside `deploy-runbook` — so it can be compared with `design/screens/FbR2n.png`. Nothing
here ships: `edit-employee-capture.html` is not the app's entry, and no app module imports this
folder.

The same page draws **Hire Employee**, frame `zf2Ks`, with `?modal=hire`: the same roles, servers
and skills, with Lyra on seat 7 of 12 and the PERMISSIONS field opened on the Company's default.
`?permissions=interactive` opens it on the other chip.

```sh
npx vite --config src/renderer/src/employees/capture/vite.config.mts
# then screenshot at 760x940, `--force-device-scale-factor=2` so it lines up with the frame's export:
#   http://localhost:5194/edit-employee-capture.html
#   http://localhost:5194/edit-employee-capture.html?role=Backend&scroll=end
#   http://localhost:5194/edit-employee-capture.html?modal=hire
```

The modal is live, not a still: pressing a role chip moves the fields Ada does not override onto
that role and leaves her persona and her `playwright` grant alone, which is the part of the ticket
a still cannot show. The captures live in `docs/design-audit/t138-edit-employee.png` (the frame's own
state) and `docs/design-audit/t138-edit-employee-role-change.png` (the same Employee moved to
Backend: her persona and her `playwright` grant stayed hers and stayed marked; the repo access and
the capabilities she was following took Backend's).

**SKILLS** landed in T137 (#273): the frame's third chip row, between INTEGRATIONS and
CAPABILITIES, is drawn with `GrantChips` over the Company's skill catalogue — the INTEGRATIONS row
again over other data, down to the override marker and the generated sentence under it.

**T155** (#312) closed the audit's four findings on this screen; `docs/design-audit/t155-edit-employee-compare.png`
puts the frame, the capture before and the capture after side by side. The rule under REPOSITORY
ACCESS is drawn again (it had shrunk to zero height in the scrolling body); the modal opens with
nothing focused; the sentences under the rows and the footer say `Ada`, the given name, as the
frame does; and every grant row draws what the Employee held when the modal opened first, with
CAPABILITIES otherwise in the frame's `code, review, plan, intake, hire`.

**PERMISSIONS** landed in T164 (#355). The frame gained the field (`XJxrZ` on `FbR2n`, `PGtFO` on
`zf2Ks`), so the off-frame `PERMISSION MODE` control this modal used to carry at the bottom is gone
and the field now sits where the frame puts it, between MODEL and PERSONA, with the frame's own
chips and help line. The captures are `docs/design-audit/t164-edit-employee-vs-frame.png` and
`docs/design-audit/t164-hire-employee-vs-frame.png`.

**T224** (#549) unbroke the layout both modals share. `LookField` wrote its column as
`` `${FIELD} ${LOOK}` `` — `w-full` from the shared field and `w-132` from the tile — and Tailwind's
emission order gave it to `w-full`, so the LOOK column took the whole row and NAME and MODEL were
pushed past the modal's right edge. On Hire, focusing NAME as the modal opened dragged the body
149px sideways to reach them; on Edit nothing was focused, so the fields were simply not there.
`cx` unties the pair. The four baselines in `design/baseline/employees` recorded the break and were
re-shot; `docs/design-audit/t224-hire-employee-before-after.png` puts the two modals before and
after side by side.

One thing is deliberately not the frame's:

- **EFFORT.** The frame predates T139, which split the model field into MODEL and EFFORT. The modal
  draws the control as it stands, not as the frame froze it. The frame's model chip reads
  `Opus 5 · balanced`; the ticket says to keep the picker as the code has it.

## The Team screen (`team-capture.html`, T209)

`team-capture.html` renders the whole **Team** view — the header, the grid of Employee cards and
the side panel — over the chat fixture's Company, so `employees.css` has a baseline. It had none
before: the two modals above are the only part of this folder anything had ever shot.

```sh
npx vite --config src/renderer/src/employees/capture/vite.config.mts
# then screenshot at 1512x944:
#   http://localhost:5194/team-capture.html
```

The lists that carry their own screen — the team load, the standing hire requests, the former
Employees — answer empty, which is the state a Company is in most of the time. There is no Pen
frame for it, so it is a row in `tools/design-baseline.mjs` and not in the audit's table.

## Roles (`team-capture.html?panel=…`, T240)

The same page draws the three states T240 designed, because they are all the Employees screen with
a different side panel:

```sh
npx vite --config src/renderer/src/employees/capture/vite.config.mts
# then screenshot at 1512x944:
#   http://localhost:5194/team-capture.html?panel=roles        — the Roles list, frame `ffZp1`
#   http://localhost:5194/team-capture.html?panel=new-role     — the New role dialog, frame `s1iawl`
#   http://localhost:5194/team-capture.html?panel=role-editor  — the role editor, frame `g0D3Ua`
```

The fixture's Company holds eight roles and has Employees on seven of them, so the list draws both
states the ticket is about: a role with people on it, and `PO`, which came with the Company and
nobody was ever hired into — the one `Remove unused roles` would take. The New role dialog lists
the nine built-in templates, `PO` and `Security` (T241) first because this Company has taken
neither, and `Start blank` last.

The editor is `JobFields` — the same fields Edit Employee and Hire Employee draw — so the repo
filter and the **Areas** T239 added are read from there rather than restated: a role names its
areas in the editor, and every Employee hired into it follows them like any other job field.

They are not rows in `tools/design-baseline.mjs` yet: T240 scoped the pixel tools out, and a
baseline row without its committed PNG fails `design:compare` for everyone. Adding them is one
line each plus a `pnpm design:baseline employees` run.
