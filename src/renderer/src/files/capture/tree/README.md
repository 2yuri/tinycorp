# Payments web

The storefront's own repo. Nothing here is real: this folder is the tree the Files capture reads
when it is asked for a fixture rather than for this checkout (`?fixture`, T209).

A capture over a live worktree is a capture that changes whenever anybody edits a file, which is
fine for `pnpm design:compare` — a person reads the sheet — and useless for `pnpm design:compare`,
which has to say that nothing moved.

## Layout

- The code folder holds the three files the viewer opens.
- The docs folder holds one longer page, for the Markdown reader.
