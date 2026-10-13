/**
 * What every call across the process boundary answers with.
 *
 * An expected failure — a folder that is gone, a name that is taken, a CLI that is not signed in —
 * is a value the screen can say out loud, not a rejected promise with a stack in it. A bug still
 * throws, and `attempt` in `src/main/ipc/ipc-kit.ts` is where it becomes one of these
 * (`docs/engineering.md`).
 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
