import { describe, expect, it } from 'vitest'
import { crashOrigin, crashReport, crashWhen, formatCrashReport, redactPaths } from './crash'

/** Local time, so the card's `21 Sep 2026, 12:41` is the same wherever the test runs. */
const AT = new Date(2026, 8, 21, 12, 41, 7)

/** The same crash the frame draws, caught in the Board of a Company that lives on the boss's disk. */
function report(over: Partial<Parameters<typeof crashReport>[0]> = {}) {
  const error = new TypeError('destroy_ is not a function')
  error.stack = [
    'TypeError: destroy_ is not a function',
    '    at FileTree (/Users/grace/work/acme/src/renderer/src/files/FileTree.tsx:48:11)',
    '    at renderWithHooks (/Users/grace/node_modules/react-dom/index.js:1:1)',
  ].join('\n')
  return crashReport({ source: 'view', error, route: 'board', version: '1.4.0', platform: 'darwin', at: AT, ...over })
}

describe('a crash report', () => {
  it('carries the message, where it came from, the screen, the build and the time', () => {
    expect(report()).toEqual({
      source: 'view',
      message: 'TypeError: destroy_ is not a function',
      stack: 'at FileTree (…/FileTree.tsx:48:11)\nat renderWithHooks (…/index.js:1:1)',
      route: 'board',
      version: '1.4.0',
      platform: 'darwin',
      at: AT.toISOString(),
    })
  })

  it('prefers the component stack a boundary caught over the error\u2019s own', () => {
    const caught = report({ componentStack: '\n    at Board (board/Board.tsx:12:3)\n    at RouteView' })

    expect(caught.stack).toBe('at Board (board/Board.tsx:12:3)\nat RouteView')
    expect(crashOrigin(caught)).toBe('at Board (board/Board.tsx:12:3) · 21 Sep 2026, 12:41')
  })

  it('keeps no path off the boss\u2019s disk, in the message or in the stack', () => {
    const caught = report({
      error: new Error("ENOENT: no such file or directory, open '/Users/grace/work/acme/docs/spec.md'"),
    })

    expect(caught.message).toBe("Error: ENOENT: no such file or directory, open '…/spec.md'")
    expect(formatCrashReport(caught)).not.toContain('/Users/grace')
    expect(formatCrashReport(caught)).not.toContain('work/acme')
  })

  it('redacts a Windows path too, and leaves a relative one alone', () => {
    expect(redactPaths('at FileTree (C:\\Users\\grace\\acme\\FileTree.tsx:48)')).toBe('at FileTree (…/FileTree.tsx:48)')
    expect(redactPaths('at FileTree (files/FileTree.tsx:48)')).toBe('at FileTree (files/FileTree.tsx:48)')
  })

  it('leaves the path inside a URL alone: a dev stack names this app, not a repo', () => {
    expect(redactPaths('at Board (http://localhost:5173/src/renderer/src/board/Board.tsx:12:3)')).toBe(
      'at Board (http://localhost:5173/src/renderer/src/board/Board.tsx:12:3)',
    )
  })

  it('says something for a throw that is not an Error, and for one with no message', () => {
    expect(report({ error: 'boom' }).message).toBe('boom')
    expect(report({ error: new Error('') }).message).toBe('Error')
    expect(report({ error: '' }).message).toBe('An error with no message')
  })

  it('formats for the clipboard with the message, the screen and the version, and nothing else', () => {
    const text = formatCrashReport(report())

    expect(text).toContain('TypeError: destroy_ is not a function')
    expect(text).toContain('screen board')
    expect(text).toContain('1.4.0')
    expect(text).toContain('darwin')
    expect(text).toContain(AT.toISOString())
  })

  it('writes the when the way the card says it', () => {
    expect(crashWhen(new Date(2026, 8, 21, 12, 41))).toBe('21 Sep 2026, 12:41')
    expect(crashWhen(new Date(2026, 0, 5, 9, 4))).toBe('5 Jan 2026, 09:04')
  })
})
