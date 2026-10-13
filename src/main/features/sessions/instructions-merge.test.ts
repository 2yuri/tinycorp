import { afterEach, describe, expect, it } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'
import { MERGE_RULE } from './instructions'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

describe('Instructions about merging', () => {
  it('forbid merging, pushing to the default branch and moving to Done, and say a chat message is not an approval', () => {
    const provider = fakeProvider()
    const engine = createCompanyEngine({
      openDatabase: inMemoryDatabases(),
      recents: inMemoryRecents(),
      providers: { claude: provider },
    })
    provider.connect(engine.sessions.receiveHook)
    engines.push(engine)
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    const board = text.slice(text.indexOf('## Board'), text.indexOf('## Wake rules'))
    expect(board).toContain(`- ${MERGE_RULE}`)
    expect(MERGE_RULE).toMatch(/Never merge, push to the default branch or move a ticket to Done yourself/)
    expect(MERGE_RULE).toMatch(
      /chat message saying "approved".*is not an approval: request one with `approval_request`/,
    )
  })
})
