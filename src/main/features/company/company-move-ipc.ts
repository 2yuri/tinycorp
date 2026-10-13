import { realpathSync } from 'node:fs'
import type { Company } from '../../../shared/company'
import { companyChannels } from '../../../shared/domain/channels'
import { TEMPORARY_ROOTS } from '../../../shared/platform/temporary-folder'
import { attempt, type IpcHandlerRegistry, requireString } from '../../core'
import type { CompanyMoveFacade } from './facade'

export interface CompanyMoveIpcOptions {
  ipc: IpcHandlerRegistry
  engine: CompanyMoveFacade
  /** Asks for the folder to move a Company to; null when cancelled. */
  pickFolder(company: Company): Promise<string | null>
  /** The OS temp dir, e.g. `os.tmpdir()`. */
  tempDir: string
  broadcastChanged(company: Company | null): void
}

/** Move… and the temporary folders the Launcher and Company settings warn about (decision 45). */
export function registerCompanyMoveIpc({
  ipc,
  engine,
  pickFolder,
  tempDir,
  broadcastChanged,
}: CompanyMoveIpcOptions): void {
  ipc.handle(companyChannels.temporaryRoots, () => temporaryRoots(tempDir))

  ipc.handle(companyChannels.move, async (_event, id) => {
    const known = attempt(() => {
      const wanted = requireString(id, 'Company id')
      const company = engine.listCompanies().find((c) => c.id === wanted)
      if (!company) throw new Error(`Unknown Company: ${wanted}`)
      return company
    })
    if (!known.ok) return known
    const folder = await pickFolder(known.value)
    if (!folder) return { ok: true, value: null }
    return attempt(() => {
      const moved = engine.moveCompany(known.value.id, folder)
      // A Company that is not current changes no current Company, but the Launcher lists its new folder.
      if (engine.currentCompany()?.id !== moved.id) broadcastChanged(engine.currentCompany())
      return moved
    })
  })
}

/** The fixed temporary roots and the OS temp dir, as given and with symlinks resolved. */
export function temporaryRoots(tempDir: string): string[] {
  const roots = new Set<string>([...TEMPORARY_ROOTS, tempDir])
  try {
    roots.add(realpathSync(tempDir))
  } catch {
    // A temp dir that does not exist resolves to nothing more.
  }
  return [...roots].filter(Boolean)
}
