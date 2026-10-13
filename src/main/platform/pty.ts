/**
 * A process in a pseudo-terminal, as this machine starts one.
 *
 * A PTY is the machine's, not a Provider's: `node-pty` is a native module, WSL puts the same
 * process inside a distro (T167), and a terminal on Windows is not a terminal on macOS. A Provider
 * adapter is *handed* one of these — it never builds one — so a test spawns nothing and the three
 * platforms have one place to differ (T186a).
 */

/** A running CLI process in a pseudo-terminal. */
export interface PtySession {
  write(data: string): void
  onData(listener: (data: string) => void): () => void
  onExit(listener: (exit: { exitCode: number }) => void): () => void
  kill(): void
  /** Sets the terminal size in character cells. */
  resize(cols: number, rows: number): void
}

export interface PtySpawnOptions {
  cwd: string
  env: Record<string, string>
  cols: number
  rows: number
}

/** Starts a process in a PTY. Every adapter takes one, so tests never need the native module. */
export type SpawnPty = (file: string, args: string[], options: PtySpawnOptions) => PtySession
