# ponytail, vendored

`SKILL.md` and `LICENSE` are copied verbatim from
[DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) at commit
`e3ba2aa6f1e6f0bc4d69eb09c9f0d0a93af56156`, path `skills/ponytail/SKILL.md`. MIT, © 2026
DietrichGebert; the licence is beside it and nothing here is edited.

It is here so the `ponytail` arm of `pnpm bench:tokens` measures the real ruleset rather than a
paraphrase of it, and so the benchmark can be re-run from this repo alone with no network.

**It is not installed and nothing in TinyCorp reads it.** The bench prepends it with
`--append-system-prompt`, which is not how the skill ships — ponytail is a plugin activated by a
`SessionStart` hook, and its own README says pasting `SKILL.md` into a prompt is a rough
approximation of the `full` intensity level. The arm therefore measures *the ruleset's text*, not
*the plugin*, and the results file says so.

To refresh it, copy the two files again and move the commit above. Do not edit them.
