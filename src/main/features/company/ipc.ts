import type { Company, CompanyUpdate } from '../../../shared/company'
import { companyChannels } from '../../../shared/domain/channels'
import type { CompanyFolderHints } from '../../../shared/platform/company-folder'
import { attempt, type IpcHandlerRegistry, isRecord, requireString } from '../../core'
import type { CompanyLogos } from './company-logo'
import type { CompanyFacade } from './facade'

export interface CompanyIpcOptions {
  ipc: IpcHandlerRegistry
  engine: CompanyFacade
  pickFolder(): Promise<string | null>
  /**
   * The home folder a new Company is suggested under. Asked each time rather than held, because
   * the answer moves with the team default: a team inside a distro is suggested the distro's own
   * home, not `C:\Users\b` (T256, `platform/teamHomeFolder`).
   */
  homeFolder(): string
  /** This process's environment, which is where OneDrive says what it syncs. Defaults to it. */
  env?: NodeJS.ProcessEnv
  broadcastChanged(company: Company | null): void
  /** Tells every window the Company rail's marks may have moved (T145). */
  broadcastAttention(): void
  /** Each Company's logo, in its folder (T280). Without it, no Company has one. */
  logos?: CompanyLogos
  /** Asks the boss for an image file, as the native picker does; null when they cancel. */
  pickImage?(): Promise<string | null>
}

/** Exposes the Company engine to the renderer. Holds no state of its own. */
export function registerCompanyIpc({
  ipc,
  engine,
  pickFolder,
  homeFolder,
  env = process.env,
  broadcastChanged,
  broadcastAttention,
  logos,
  pickImage,
}: CompanyIpcOptions): void {
  /** A Company as the engine keeps it, with its logo read from its folder (T280). */
  const withLogo = <T extends Company | null>(company: T): T =>
    company && logos ? { ...company, logo: logos.of(company.folder) } : company
  const changedNow = () => broadcastChanged(withLogo(engine.currentCompany()))
  engine.onChange(changedNow)
  engine.onAttentionChange(broadcastAttention)

  ipc.handle(companyChannels.current, () => withLogo(engine.currentCompany()))
  ipc.handle(companyChannels.list, () => engine.listCompanies().map(withLogo))

  // The boss picks an image and it becomes the current Company's logo; every screen is told.
  ipc.handle(companyChannels.chooseLogo, async () => {
    try {
      const company = engine.currentCompany()
      if (!company) throw new Error('No Company is open')
      if (!logos || !pickImage) throw new Error('This app cannot keep a logo')
      const source = await pickImage()
      if (!source) return { ok: true, value: null }
      const logo = logos.set(company.folder, source)
      changedNow()
      return { ok: true, value: logo }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipc.handle(companyChannels.removeLogo, () =>
    attempt(() => {
      const company = engine.currentCompany()
      if (!company) throw new Error('No Company is open')
      logos?.remove(company.folder)
      changedNow()
      return null
    }),
  )
  ipc.handle(companyChannels.attention, () => engine.companyAttention())
  ipc.handle(companyChannels.pickFolder, () => pickFolder())
  ipc.handle(
    companyChannels.folderHints,
    (): CompanyFolderHints => ({ home: homeFolder(), syncedRoots: syncedRoots(env) }),
  )

  ipc.handle(companyChannels.create, (_event, input) =>
    attempt(() => {
      if (!isRecord(input)) throw new Error('Missing Company details')
      if (input['name'] !== undefined && typeof input['name'] !== 'string') {
        throw new Error('A Company name must be text')
      }
      const name = input['name']
      return withLogo(
        engine.createCompany({
          folder: requireString(input['folder'], 'folder'),
          ...(name !== undefined && { name }),
        }),
      )
    }),
  )

  ipc.handle(companyChannels.open, (_event, folder) =>
    attempt(() => withLogo(engine.openCompany(requireString(folder, 'folder')))),
  )

  ipc.handle(companyChannels.switchTo, (_event, id) =>
    attempt(() => withLogo(engine.switchCompany(requireString(id, 'Company id')))),
  )

  ipc.handle(companyChannels.update, (_event, input) =>
    attempt(() => withLogo(engine.updateCompany(companyUpdate(input)))),
  )

  // Removing a Company that is not current changes no current Company, but every list still shows it.
  for (const [channel, remove] of [
    [companyChannels.forget, engine.forgetCompany],
    [companyChannels.delete, engine.deleteCompany],
  ] as const) {
    ipc.handle(channel, (_event, id) =>
      attempt(() => {
        const wasCurrent = engine.currentCompany()?.id === id
        remove(requireString(id, 'Company id'))
        if (!wasCurrent) changedNow()
        return null
      }),
    )
  }
}

/**
 * The variables OneDrive sets for the folders it syncs, and nothing else (T252).
 *
 * `OneDrive` is the folder in use; the other two are the personal and work accounts, which are two
 * different folders when the boss is signed into both. A folder's *name* is never read for this:
 * OneDrive can be anywhere, and a folder somebody called `OneDrive` is not synced by it.
 */
const ONEDRIVE_VARIABLES = ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial'] as const

/** The folders OneDrive syncs on this machine. Empty everywhere it is not running. */
export function syncedRoots(env: NodeJS.ProcessEnv): string[] {
  const roots = ONEDRIVE_VARIABLES.map((name) => (env[name] ?? '').trim()).filter(Boolean)
  return [...new Set(roots)]
}

const UPDATE_FIELDS = ['name', 'key', 'bossName', 'bossInitials'] as const

function companyUpdate(input: unknown): CompanyUpdate {
  if (!isRecord(input)) throw new Error('Missing Company settings')
  const update: CompanyUpdate = {}
  for (const field of UPDATE_FIELDS) {
    const value = input[field]
    if (value === undefined) continue
    if (typeof value !== 'string') throw new Error(`${field} must be text`)
    update[field] = value
  }
  return update
}
