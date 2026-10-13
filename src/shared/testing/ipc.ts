/**
 * Testing's slice of the IPC contract (T186). `src/shared/ipc/index.ts` composes the slices into
 * `TinyCorpApi`, so preload and the renderer keep importing one contract.
 */

import type { OpenedAttachment } from '../attachments'
import type { Result } from '../domain/result'
import type { AppRun, RepoTestChanges, RunnableRepo, TestMode, TestResult, TestRun, TestSettings } from './index'

/**
 * The Testing stage (T174): the attempt a ticket in Testing is on, the boss's own pass and fail,
 * the apps `Run it` starts in its worktree, and who tests. Exposed as `window.tinyCorp.tests`.
 */
export interface TestApi {
  /** A ticket's latest attempt, or null when it has never been in Testing. */
  of(ticketId: number): Promise<Result<TestRun | null>>
  /** The latest attempt of every ticket that has one. */
  list(): Promise<Result<TestRun[]>>
  /** Appends a step to the script, as the boss. */
  addStep(ticketId: number, title: string, detail?: string): Promise<Result<TestRun>>
  /** Records a step as passed or failed, with the note the boss wrote. */
  setStep(stepId: number, result: TestResult, note?: string): Promise<Result<TestRun>>
  /** Attach screenshot: the files the boss picked or pasted, kept beside the step. */
  attach(stepId: number, files: { name: string; data: Uint8Array }[]): Promise<Result<TestRun>>
  /** Capture the running app: loads the run's URL in a hidden window and keeps the shot. */
  capture(stepId: number, ticketId: number, repoId: string): Promise<Result<TestRun>>
  /** One screenshot for the viewer: an image comes back as a data URL. */
  openAttachment(id: number): Promise<Result<OpenedAttachment>>
  /** Pass testing → ready to merge. */
  pass(ticketId: number): Promise<Result<TestRun>>
  /** Report bug → back to Doing. */
  reportBug(ticketId: number, note?: string): Promise<Result<TestRun>>
  /** Every repo of the ticket that can be run, with its run when one is up. */
  runnable(ticketId: number): Promise<Result<RunnableRepo[]>>
  /** Run it: starts the repo's run command in the ticket's worktree. */
  startApp(ticketId: number, repoId: string): Promise<Result<AppRun>>
  stopApp(ticketId: number, repoId: string): Promise<Result<AppRun>>
  /** A run's output, oldest line first. */
  appLog(ticketId: number, repoId: string): Promise<Result<string[]>>
  /** Who tests, and the per-repo run command and port. */
  settings(): Promise<Result<TestSettings>>
  setMode(mode: TestMode): Promise<Result<TestSettings>>
  setRepo(repoId: string, changes: RepoTestChanges): Promise<Result<TestSettings>>
  /** Fires after any attempt, step, screenshot or run changes, and on Company switch. */
  onChanged(listener: () => void): () => void
}
