import { Component, type ErrorInfo, Fragment, type ReactNode } from 'react'
import type { CrashReport, CrashSource } from '../../../../shared/app/crash'
import { CrashCard } from './CrashCard'
import { caught, recordCrash } from './report'

export interface ScreenBoundaryProps {
  children: ReactNode
  /** `Board · Tiny Corp`, the card's second line; the app's name when there is no view to blame. */
  where: string
  /** The view the boss was on, for the report: `board`, `files`. Null outside a view. */
  route?: string | null
  /** `view` around one screen, `window` for the last resort around the whole shell. */
  source?: CrashSource
  /** Overridden in tests, which have no main process to write a log line to. */
  onCrash?(report: CrashReport): void
}

interface ScreenBoundaryState {
  /** What was thrown, from the render React threw it out of. */
  error: unknown
  /** The same crash with its component stack, which only `componentDidCatch` is given. */
  report: CrashReport | null
  /** Bumped by `Reload this screen`, which remounts the view below rather than the window. */
  attempt: number
}

const NOTHING_THROWN = Symbol('nothing thrown')

/**
 * The one thing between a thrown render and a white window (T128). A view that throws draws the
 * `Something Broke` card in its own place, so the title bar, the Company rail and the sidebar stay
 * and the boss can leave for another screen. Key this by route: a new key is a new boundary, which
 * is how moving to another view clears a crash without anything having to reset it.
 */
export class ScreenBoundary extends Component<ScreenBoundaryProps, ScreenBoundaryState> {
  override state: ScreenBoundaryState = { error: NOTHING_THROWN, report: null, attempt: 0 }

  static getDerivedStateFromError(error: unknown): Partial<ScreenBoundaryState> {
    return { error }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    const report = this.crashOf(error, info.componentStack)
    // The log first: a tester who reloads without copying the report is then not the only record.
    if (this.props.onCrash) this.props.onCrash(report)
    else recordCrash(report)
    this.setState({ report })
  }

  private crashOf(error: unknown, componentStack?: string | null): CrashReport {
    return caught({
      source: this.props.source ?? 'view',
      componentStack: componentStack ?? null,
      error,
      route: this.props.route ?? null,
    })
  }

  override render(): ReactNode {
    const { error, report, attempt } = this.state
    const source = this.props.source ?? 'view'
    // `Reload this screen` remounts the view, not the window: a new key throws the broken tree away.
    if (error === NOTHING_THROWN) return <Fragment key={attempt}>{this.props.children}</Fragment>
    return (
      <CrashCard
        // Between the throw and `componentDidCatch` there is one render with no component stack yet.
        report={report ?? this.crashOf(error)}
        where={this.props.where}
        alone={source !== 'view'}
        onReload={() => this.setState({ error: NOTHING_THROWN, report: null, attempt: attempt + 1 })}
      />
    )
  }
}
