/** Types for `tools/design-shooter.mjs`, the vite server and the offscreen Electron both tools shoot with. */
import type { ChildProcess } from 'node:child_process'

/** One capture harness: the vite config that serves it, and the port that config pins. */
export interface Harness {
  config: string
  port: number
}

/** One shot: a page, a window and where the PNG lands. */
export interface Job {
  url: string
  out: string
  width: number
  height: number
  settleMs: number
  /** Grow the window to the page before shooting, for the contact sheet. */
  fit?: boolean
  /** Report the stylesheets the page had loaded, under this key. */
  collect?: string
}

/** Starts one harness's vite server and resolves once it answers. */
export function serve(harness: Harness, log?: (line: string) => void): Promise<ChildProcess>

/** Kills a harness's vite and waits until its port has stopped answering. */
export function stop(child: ChildProcess, harness: Harness): Promise<void>

/** The Electron script that takes every shot. */
export function shooterSource(): string

/**
 * The command line the shooter's Electron is started with: the jobs last, and on macOS
 * `-AppleShowScrollBars Always`, which pins the scrollbar style for that process alone.
 */
export function shooterArgs(script: string, profile: string, payload: unknown, platform?: NodeJS.Platform): string[]

/**
 * Runs Electron over the jobs; answers what each `collect` job drew.
 *
 * A rejection carries `drawn`: what the shots taken before the failure reported, for a caller that
 * means to take the rest again.
 */
export function shoot(
  jobs: Job[],
  scratch: string,
  log: (line: string) => void,
  options?: { preload?: string | null; css?: string | null; env?: Record<string, string> | null },
): Promise<Record<string, string[]>>
