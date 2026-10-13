# `tools/bench`

`pnpm bench:tokens`: what RTK, the terse voice and the ponytail ladder cost or save, measured on
real Claude Code sessions against a real repo before anything claims either (T190), in the shape
each of them is actually about — a cold ticket, a long session running commands, or two Employees
DMing each other (T197).

**The guide is [`docs/bench-tokens.md`](../../docs/bench-tokens.md).** This file is the map.

| file | |
|---|---|
| `bench-tokens.mjs` | the command: the plan, the pool, the three runners, the report |
| `plan.mjs` | the command line, the shapes a run can take, the cells, the estimate and the cost guards |
| `arms.mjs` | the arms: what each prepends, the hooks and MCP servers it declares, the modes it is in |
| `fixture.mjs` | the pinned repo, prepared once and copied per cell |
| `session.mjs` | one `claude -p`, its result JSON, adding a cell's legs up, and the isolation checks |
| `long.mjs` | `--mode long`: three tickets in one resumed session, the suite and git between them |
| `duo.mjs` | `--mode duo`: two Employees, one ticket, and the DM thread that wakes each of them |
| `dm.mjs` | what the two halves of a `duo` cell agree about: the tool descriptions, one message, the traffic |
| `dm-mcp.mjs` | the stand-in chat server, started per Employee by Claude Code itself |
| `report.mjs` | medians, interquartile ranges and the markdown |
| `tasks/*.md` | the eight tickets |
| `arms/terse-voice.md` | the Between Employees section, kept word for word with the app's |
| `arms/plain-voice.md` | the How you write section, kept word for word with the app's |
| `vendor/ponytail/` | ponytail's `SKILL.md` and its MIT licence, copied, never edited |
| `results/` | what runs produced: a markdown report and the raw JSONL |

Nothing here is imported by the app, and the app imports nothing from here.
