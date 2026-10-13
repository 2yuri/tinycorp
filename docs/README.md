# Docs

Every document in `docs/`, plus the pages at the repo root, one line each.
[`README.md`](../README.md) is the front page;
[`AGENTS.md`](../AGENTS.md) is the short version of all of this, for an agent working in the repo.

- **New here?** [`product.md`](product.md), then [`decisions.md`](decisions.md), then
  [`spec-v1-thin-loop.md`](spec-v1-thin-loop.md).
- **About to change code?** [`../ARCHITECTURE.md`](../ARCHITECTURE.md), then
  [`engineering.md`](engineering.md).

## Product

| Document | What it is |
| --- | --- |
| [`product.md`](product.md) | What TinyCorp is and why: the Company, the Employees, the board and the office, and why another orchestrator. |
| [`decisions.md`](decisions.md) | Every product and technical decision, numbered, with what was rejected. Re-opening one is a conversation, not a patch. |
| [`spec-v1-thin-loop.md`](spec-v1-thin-loop.md) | The v1 spec: the problem, the loop, the user stories, and what was deliberately out of scope. |
| [`roadmap.md`](roadmap.md) | The milestones v0 to v3, ordered by risk rather than by size, with what shipped and what is not planned. |
| [`beta.md`](beta.md) | For a tester handed a private build: what to install first, how to open an unsigned app, what is rough. |
| [`company-memory.md`](company-memory.md) | The Company's git-backed markdown wiki: how it is written, aged, indexed and read, and why no model writes in it. |
| [`spikes/v0-loop.md`](spikes/v0-loop.md) | The throwaway spike that proved the Employee loop works at all, and what it left unknown. |

## Architecture and engineering

| Document | What it is |
| --- | --- |
| [`../ARCHITECTURE.md`](../ARCHITECTURE.md) | The map: the modules, which way they are allowed to point, and the invariants. `src/architecture.test.ts` enforces it. |
| [`architecture/modules.md`](architecture/modules.md) | Which file is in which module today, for every file under `src/` outside the renderer — whose module is read off its path. |
| [`engineering.md`](engineering.md) | How the TypeScript inside a module is written: errors, parsing at the boundaries, naming, fakes, and the checklist a PR ticks. |
| [`bench-tokens.md`](bench-tokens.md) | `pnpm bench:tokens`: how an arm's token cost is measured on real sessions, and why no saving is claimed without it. |

## Contributing

| Document | What it is |
| --- | --- |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Setting up per platform, your first pull request step by step, the four tiers of test, the sign-off and the title format. |
| [`../SECURITY.md`](../SECURITY.md) | The attack surface edge by edge, what is already known and not a finding, and how to report a vulnerability privately. |
| [`../CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) | Contributor Covenant 2.1, and who to write to. |
| [`windows.md`](windows.md) | The Windows build: finding a Provider natively or inside WSL, path translation, the virtual switch, git, and what CI covers. |
| [`linux.md`](linux.md) | The Linux build: the distro floors, the packages a desktop needs, the keyring, and packaging the AppImage and `.deb`. |

## Providers and forges

| Document | What it is |
| --- | --- |
| [`providers.md`](providers.md) | How to add a Provider — a coding CLI an Employee can run on: the contract, the conformance suite, and a walkthrough from an empty folder. |
| [`forges.md`](forges.md) | How to add a forge — where a repo's pull requests live: the same shape, from the catalogue entry to the registry line. |
| [`sandbox.md`](sandbox.md) | The Sandbox add-on: ai-jail around every Employee's Session, the line a Session is started with, and why the network is open. |
| [`mcp-presets.md`](mcp-presets.md) | Integrations' three sections: where each tool on this machine keeps its MCP servers per OS, the preset table and its bar, and the three candidates that did not meet it. |
| [`brand-logos.md`](brand-logos.md) | The logos drawn beside somebody else's product: the two icon sets, what may be done to one (nothing), the trademark position, and how to add one. |

`readme/` holds the screenshots on the front page; it has no prose in it.

## For agents

| Document | What it is |
| --- | --- |
| [`../AGENTS.md`](../AGENTS.md) | The commands, the layout and the conventions, for an agent about to change something here. `CLAUDE.md` is one line pointing at it. |
| [`agents/issue-tracker.md`](agents/issue-tracker.md) | Issues and specs live in GitHub Issues on `2yuri/tinycorp`; the `gh` command for each tracker operation. |
| [`agents/triage-labels.md`](agents/triage-labels.md) | This repo's label strings — the five triage ones, plus the issue-form, area and platform labels — mapped to the roles a skill knows. |
| [`agents/domain.md`](agents/domain.md) | Which domain documents to read before exploring the codebase, and where a decision record goes. |
