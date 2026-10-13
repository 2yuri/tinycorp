import { beforeEach, describe, expect, it, vi } from 'vitest'
import { onDisk } from '../../core/testing'

const electron = vi.hoisted(() => ({
  openPath: vi.fn(async () => ''),
  showItemInFolder: vi.fn(),
}))

vi.mock('electron', () => ({ shell: electron }))

const { desktopFileTools, desktopPathTools } = await import('./file-tools')

beforeEach(() => {
  electron.openPath.mockClear()
  electron.showItemInFolder.mockClear()
})

/** The editor the boss picked, as the hand-over sees it: it either takes the file or it does not. */
function editor(takes: boolean) {
  const handed: string[] = []
  return {
    handed,
    open: async (path: string) => {
      handed.push(path)
      return takes
    },
  }
}

describe('Opening a file in the editor the boss picked', () => {
  it('hands the whole path to the chosen editor, spaces and all', async () => {
    const chosen = editor(true)

    await desktopFileTools(chosen).openInEditor(`${onDisk('/work/acme/src/a')} file.ts`)

    expect(chosen.handed).toEqual([`${onDisk('/work/acme/src/a')} file.ts`])
    expect(electron.openPath).not.toHaveBeenCalled()
  })

  it('falls back to whatever the system opens that file type with', async () => {
    const none = editor(false)

    await desktopFileTools(none).openInEditor(onDisk('/work/acme/sprite.png'))

    expect(electron.openPath).toHaveBeenCalledWith(onDisk('/work/acme/sprite.png'))
  })

  it('reports what the system said when it could not open the file either', async () => {
    electron.openPath.mockResolvedValueOnce('No application knows how to open this')

    await expect(desktopFileTools(editor(false)).openInEditor(onDisk('/nowhere/a.ts'))).rejects.toThrow(
      /No application/,
    )
  })
})

describe('A path from outside the Company', () => {
  it('goes to the same editor the boss picked for everything else', async () => {
    const chosen = editor(true)

    await desktopPathTools(chosen).openInEditor(onDisk('/Users/boss/Desktop/notes.md'))

    expect(chosen.handed).toEqual([onDisk('/Users/boss/Desktop/notes.md')])
    expect(electron.openPath).not.toHaveBeenCalled()
  })

  it('falls back to the system default, exactly as a Company’s own file does', async () => {
    await desktopPathTools(editor(false)).openInEditor(onDisk('/Users/boss/Desktop/shot.png'))

    expect(electron.openPath).toHaveBeenCalledWith(onDisk('/Users/boss/Desktop/shot.png'))
  })
})

describe('Reveal in Finder', () => {
  it('shows the path itself, selected', () => {
    desktopFileTools(editor(true)).reveal(onDisk('/work/acme/worktrees/ticket-142/src/counter.ts'))

    expect(electron.showItemInFolder).toHaveBeenCalledWith(onDisk('/work/acme/worktrees/ticket-142/src/counter.ts'))
  })
})
