/** Types for `tools/smoke-packaged.mjs`, the check that the packaged app opens a window (T166). */

/** The variable the packaged app reads to know this is a smoke run, and the line it then prints. */
export const SMOKE_ENV: string
export const SMOKE_READY: string
export const SMOKE_READY_FILE: string

/** The line the node probe prints if — and only if — the packaged binary is still a Node interpreter. */
export const RAN_AS_NODE: string

/** Where each platform's electron-builder `dir` target leaves the app, relative to the repo root. */
export const BUILDS: Record<string, string>

/** The AppImage `pnpm package:linux` left in `release/`, or null when there is none. */
export function appImage(root?: string): string | null

/** The packaged app on this machine, or null when nothing has been packaged for it. */
export function packagedApp(platform?: NodeJS.Platform, root?: string): string | null

/** The arguments the smoke run starts the app with: its user-data folder, and Linux's sandbox flag. */
export function smokeArgs(userData: string, platform?: NodeJS.Platform): string[]

/** The environment the smoke run starts the app with: the smoke variable, and AppImage's own. */
export function smokeEnv(platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv

/** What one run of the packaged app did. */
export interface SmokeResult {
  /** Its exit code, or null when it never gave one. */
  code: number | null
  /** Everything it printed, both streams together. */
  output: string
}

/** Starts the packaged app in smoke mode, with its own user-data folder. */
export function smokeRun(app: string, userData: string): Promise<SmokeResult>

/** Starts the packaged app the way the H4 exploit would, with `home` standing in for the profile. */
export function nodeProbeRun(app: string, home: string): Promise<SmokeResult>

/** The arguments that make a plain Electron binary evaluate a script: the exploit of finding H4. */
export function nodeProbeArgs(): string[]

/** The environment the node probe runs in: `ELECTRON_RUN_AS_NODE`, and a home folder of its own. */
export function nodeProbeEnv(home: string, platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv

/** Whether the binary answered the probe as Node, which is the `runAsNode` fuse not being there. */
export function ranAsNode(output: string): boolean

/** Whatever the app wrote down about a crash during the run, or '' when it wrote nothing. */
export function crashes(userData: string): string

/** Whether the app said its window loaded, on stdout or in the file it also writes. */
export function saidItLoaded(userData: string, output: string): boolean

/** What went wrong, in one sentence, or null when the run is a pass. */
export function verdict(result: {
  code: number | null
  loaded: boolean
  crashLog: string
  ranAsNode?: boolean
}): string | null
