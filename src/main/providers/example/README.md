# The Provider template

This folder is not a Provider. It is what `pnpm provider:new <id>` copies, and it is failing the
conformance suite on purpose.

Do not edit it to add your own Provider. Run:

```sh
pnpm provider:new goose --name Goose --command goose
```

and fill in the folder it makes. [`docs/providers.md`](../../../../../docs/providers.md) is the
guide; this file is only a map of what is here.

| File | What it is | Copied? |
| --- | --- | --- |
| `cli.ts` | The ten questions a Provider answers, as an interface, plus the `todo()` that marks a hole | Yes |
| `cli-todo.ts` | The holes. **The only file a contributor has to fill in.** Each member's comment shows what Claude Code and Codex answer | Yes |
| `adapter.ts` | The finished half: the command line, the hook file, the per-Session MCP config, the environment, the kill | Yes |
| `conformance.test.template` | The conformance test a new Provider gets, as `adapter.test.ts` | Yes, renamed |
| `filled.ts` | One complete set of answers, for a CLI that does not exist | No |
| `adapter.test.ts` | Drives the template both ways: red with its holes open, green once `filled.ts` answers them | No |

`filled.ts` and `adapter.test.ts` stay behind because they are the *test of the template*, not part
of a Provider. Their job is to keep two promises honest: that a stranger who copies this folder and
sends it unchanged is stopped by a test rather than by a reviewer, and that the failures they see
first say what is missing and which part of the contract it belongs to — in words, not as a diff of
two objects.

If either promise stops being true, `adapter.test.ts` goes red here, in this repo, rather than in
somebody else's afternoon.
