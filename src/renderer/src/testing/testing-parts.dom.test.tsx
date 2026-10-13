// @vitest-environment jsdom
// The three things the Testing screen's parts have to get right when they are pressed: a step
// records the verdict the boss pressed, `Pass testing` is dead while anything is failed or
// untested, and `Run it` starts and stops the app rather than only drawing its state.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RunnableRepo, TestRun, TestStep } from '../../../shared/testing'
import { RunIt, StepCard, TestingActions } from './TestingParts'

function step(overrides: Partial<TestStep> = {}): TestStep {
  return {
    id: 1,
    runId: 1,
    title: 'Pick 90d: one daily total per day',
    detail: 'Count the bars.',
    criterion: 2,
    addedBy: null,
    result: 'pending',
    note: '',
    testedBy: null,
    testedAt: null,
    attachments: [],
    ...overrides,
  }
}

function run(steps: TestStep[], overrides: Partial<TestRun> = {}): TestRun {
  return {
    id: 1,
    ticketId: 142,
    attempt: 1,
    mode: 'both',
    state: 'you',
    agentId: 'e-iris',
    agentVerdict: 'pass',
    agentSummary: '',
    checks: [],
    startedAt: '2026-09-22T10:31:00',
    finishedAt: null,
    steps,
    ...overrides,
  }
}

const repo: RunnableRepo = {
  repoId: 'r-web',
  repoName: 'web-app',
  command: 'pnpm dev',
  cwd: '/work/tiny/worktrees/web-app/wt-TC-142',
  port: 5173,
  url: 'http://localhost:5173',
  run: null,
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const button = (label: string) =>
  [...host.querySelectorAll('button')].find((element) => element.textContent?.includes(label))!

describe('a step', () => {
  it('records the verdict the boss pressed, and its note when they leave the field', () => {
    const results: string[] = []
    const notes: string[] = []
    act(() => {
      root.render(
        <StepCard
          step={step()}
          number={3}
          canTest
          nameOf={(id) => id}
          thumbnails={{}}
          canCapture={false}
          onResult={(result) => results.push(result)}
          onNote={(note) => notes.push(note)}
          onAttach={() => {}}
          onPaste={() => {}}
          onCapture={() => {}}
        />,
      )
    })

    act(() => button('Fail').click())
    const note = host.querySelector('textarea')!
    act(() => {
      // React listens for the native setter, not an assignment, so this is how typing is typed.
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(note, '90d shows 89 days')
      note.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => note.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))

    expect(results).toEqual(['fail'])
    expect(notes).toEqual(['90d shows 89 days'])
  })

  it('offers no verdict at all on an attempt that is not the boss’s', () => {
    act(() => {
      root.render(
        <StepCard
          step={step({ result: 'pass' })}
          number={1}
          canTest={false}
          nameOf={(id) => id}
          thumbnails={{}}
          canCapture={false}
          onResult={() => {}}
          onNote={() => {}}
          onAttach={() => {}}
          onPaste={() => {}}
          onCapture={() => {}}
        />,
      )
    })

    expect(button('Pass').disabled).toBe(true)
    expect(button('Fail').disabled).toBe(true)
    expect(host.querySelector('textarea')).toBeNull()
  })

  it('offers the capture only while something is running', () => {
    act(() => {
      root.render(
        <StepCard
          step={step()}
          number={1}
          canTest
          nameOf={(id) => id}
          thumbnails={{}}
          canCapture={false}
          onResult={() => {}}
          onNote={() => {}}
          onAttach={() => {}}
          onPaste={() => {}}
          onCapture={() => {}}
        />,
      )
    })

    expect(button('Capture the running app').disabled).toBe(true)
    expect(button('Capture the running app').title).toMatch(/start the app first/i)
  })
})

describe('the actions', () => {
  it('keeps the merge shut while a step is failed or untested', () => {
    act(() => {
      root.render(
        <TestingActions
          run={run([step({ result: 'pass' }), step({ id: 2, result: 'fail' })])}
          busy={false}
          onReportBug={() => {}}
          onPass={() => {}}
        />,
      )
    })

    expect(button('Pass testing').disabled).toBe(true)
    expect(button('Pass testing').title).toBe('1 failed')
    expect(host.textContent).toContain('Merge waits for Testing to pass')
  })

  it('opens the merge once every step passed, and then refuses the bug report', () => {
    const passed: number[] = []
    act(() => {
      root.render(
        <TestingActions
          run={run([step({ result: 'pass' })])}
          busy={false}
          onReportBug={() => {}}
          onPass={() => passed.push(1)}
        />,
      )
    })

    expect(button('Report bug').disabled).toBe(true)
    act(() => button('Pass testing').click())
    expect(passed).toEqual([1])
  })
})

describe('Run it', () => {
  it('starts what is not running, and stops what is', () => {
    const calls: string[] = []
    const render = (entry: RunnableRepo) =>
      act(() => {
        root.render(
          <RunIt
            repo={entry}
            log={[]}
            logOpen={false}
            busy={false}
            onStart={() => calls.push('start')}
            onStop={() => calls.push('stop')}
            onToggleLog={() => calls.push('log')}
          />,
        )
      })

    render(repo)
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Run web-app"]')?.click())
    render({
      ...repo,
      run: {
        ticketId: 142,
        repoId: 'r-web',
        repoName: 'web-app',
        command: 'pnpm dev',
        cwd: repo.cwd,
        port: 5173,
        url: 'http://localhost:5173',
        state: 'running',
        startedAt: '2026-09-22T10:34:00',
        startedBy: 'boss',
        exitCode: null,
        lastLine: 'VITE v5.4 ready',
        lines: 24,
      },
    })
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Stop web-app"]')?.click())

    expect(calls).toEqual(['start', 'stop'])
    expect(host.textContent).toContain('Running')
    expect(host.textContent).toContain('Show log · 24 lines')
    // Open goes through the window's own open handler, which sends it to the system browser.
    expect(host.querySelector<HTMLAnchorElement>('a[rel="noreferrer"]')?.href).toBe('http://localhost:5173/')
  })

  it('will not open an app that is not running', () => {
    act(() => {
      root.render(
        <RunIt
          repo={repo}
          log={[]}
          logOpen={false}
          busy={false}
          onStart={() => {}}
          onStop={() => {}}
          onToggleLog={() => {}}
        />,
      )
    })

    // Not a class any more: what the test is about is that the link refuses the click and says so.
    expect(host.querySelector('a[rel="noreferrer"]')?.getAttribute('aria-disabled')).toBe('true')
  })
})
