import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APPROVAL_SUBJECT_RULE } from '../../../shared/approvals/approval-subject'
import { LEAN_LADDER, LEAN_RULES } from '../../../shared/build-style'
import { CAVEMAN_PER_LEVEL } from '../../../shared/caveman'
import { PROVIDER_CATALOGUE } from '../../../shared/domain/providers'
import { modelLabel } from '../../../shared/staff/models'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { type FakeProvider, fakeProvider } from '../../providers/testing'
import { THREAD_RULE } from './instructions'

const engines: CompanyEngine[] = []
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  vi.useRealTimers()
})

const stack = {
  language: 'TypeScript',
  framework: 'Fastify',
  packageManager: 'pnpm',
  packageManagerVersion: '9',
  install: 'pnpm install',
  build: 'pnpm build',
  test: 'pnpm test',
  lint: 'eslint .',
}

function setup(): { engine: CompanyEngine; provider: FakeProvider } {
  const provider = fakeProvider()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    isGitRepo: () => true,
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  return { engine, provider }
}

/** A sample Company: two repos, a WIP limit, Supervised autonomy and a backend engineer. */
function sampleCompany(engine: CompanyEngine) {
  engine.repos.add({ path: '/src/api', name: 'api', stack, brief: 'Billing API.\nKeep routes under src/routes.' })
  engine.repos.add({
    path: '/src/web',
    name: 'web',
    stack: { language: 'TypeScript', framework: 'React', packageManager: 'pnpm' },
  })
  engine.board().setWipLimit('doing', 3)
  engine.approvals.setLevel('supervised')
  return engine.employees.create({
    name: 'Ada',
    roleId: 'backend',
    persona: 'You build careful APIs and write tests first.',
    capabilities: ['code', 'review'],
    repoFilter: ['api'],
  })
}

describe('Injected instructions', () => {
  it('are written into the Session’s cwd before the process starts', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)

    engine.sessions.start(ada.id)

    const spawn = provider.spawnOf(ada.id)
    expect(spawn.instructions).toMatchObject({ employee: { id: ada.id }, cwd: onDisk('/work/acme') })
    expect(provider.instructions).toHaveLength(1)
  })

  it('are written again, from fresh state, every time a Session starts', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)
    engine.sessions.start(ada.id)
    engine.sessions.stop(ada.id)
    engine.approvals.setLevel('autonomous')

    engine.sessions.start(ada.id)

    expect(provider.instructions).toHaveLength(2)
    expect(provider.spawnOf(ada.id).instructions!.text).toContain('Autonomous')
    expect(provider.spawnOf(ada.id).instructions!.text).not.toContain('Supervised')
    expect(provider.spawnOf(ada.id).instructions!.text).toMatch(/hire when hiring would go above the maximum headcount/)
  })

  it('render the same text for the same state', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)
    engine.sessions.start(ada.id)
    engine.sessions.stop(ada.id)

    engine.sessions.start(ada.id)

    const [first, second] = provider.instructions
    expect(second!.text).toBe(first!.text)
  })

  it('say who the Employee is: name, role, persona and capabilities', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)

    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    expect(text).toContain('# You are Ada, Backend at Acme')
    expect(text).toContain('You build careful APIs and write tests first.')
    expect(text).toMatch(/Capabilities: `code`, `review`/)
  })

  it('tell hirers which models a hire can run on, and nobody else', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)
    const hera = engine.employees.create({ name: 'Hera', roleId: 'hr' })

    engine.sessions.start(ada.id)
    engine.sessions.start(hera.id)

    const text = provider.spawnOf(hera.id).instructions!.text
    expect(text).toContain('## Hiring')
    // Every Provider's models, not one product's (T169): `hire_request` accepts any of them, and
    // the model is what puts the hire on a product. Counted off the catalogue, never written down.
    for (const entry of PROVIDER_CATALOGUE) {
      expect(text).toContain(`${entry.name}:`)
      for (const option of entry.models) expect(text).toContain(`\`${option.id}\`: ${modelLabel(entry.id, option.id)}`)
    }
    expect(text).toMatch(/leave `model` out for this machine's own\ndefault/i)
    expect(provider.spawnOf(ada.id).instructions!.text).not.toContain('## Hiring')
  })

  it('list the Company’s repos with their briefs, checks and which are the Employee’s', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)

    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    expect(text).toContain('## Repos')
    expect(text).toContain('**api** (yours): TypeScript, Fastify, pnpm')
    expect(text).toContain('**web**: TypeScript, React, pnpm')
    expect(text).toContain(
      'Checks, run inside the worktree before opening a PR: install `pnpm install`, build `pnpm build`, test `pnpm test`, lint `eslint .`',
    )
    expect(text).toContain(
      '**web**: TypeScript, React, pnpm. No checks yet: if you set this project up, record its commands with `repo_set_checks`.',
    )
    expect(text).toContain('  About this repo:\n  > Billing API.\n  > Keep routes under src/routes.')
    expect(text).toMatch(/choose for yourself where it leaves the stack open/i)
    expect(text).not.toMatch(/nobody can claim/i)
  })

  it('list only the checks a repo has, and follow a changed brief on the next start', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)
    const web = engine.repos.list().find((repo) => repo.name === 'web')!
    engine.repos.update(web.id, { brief: 'You pick the stack.', stack: { test: 'pnpm vitest run' } })

    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    expect(text).toContain(
      '**web**: TypeScript, React, pnpm. Checks, run inside the worktree before opening a PR: test `pnpm vitest run`.\n  About this repo:\n  > You pick the stack.',
    )
  })

  it('give the board rules: columns with WIP limits and the subtask rule', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)

    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    expect(text).toContain('## Board')
    expect(text).toContain('Planning → Ready → Doing → Review → Testing → Done')
    expect(text).toContain('Doing: WIP limit 3')
    expect(text).toMatch(/another person or another repo.*is a ticket/i)
  })

  // Decision 33: an Employee has to know the id form before it writes one in chat or a PR title.
  it('explain the ticket id: the Company key, the short form and the branch', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)

    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    expect(text).toContain('`AC-<number>`')
    expect(text).toContain('`AC-142`')
    expect(text).toContain('`#142` is the same ticket, short')
    expect(text).toContain('`ticket-ac-142-<slug>`')
  })

  it('give the wake rules and the [company] prompt shape', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)

    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    expect(text).toContain('## Wake rules')
    expect(text).toContain('[company] <kind> from <who> in <where>: "<text>"')
    expect(text).toMatch(/a boss message that names nobody/i)
    expect(text).toMatch(/read it, and reply when it concerns you/i)
    expect(text).toContain('@channel')
  })

  it('give the one-voice etiquette and say who answers the boss', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)
    const pam = engine.employees.create({ name: 'Pam', roleId: 'pm' })

    engine.sessions.start(ada.id)
    engine.sessions.start(pam.id)

    const adaText = provider.spawnOf(ada.id).instructions!.text
    expect(adaText).toContain('## One voice: Pam answers the boss')
    expect(adaText).toMatch(/do not repeat to the boss what a colleague already said/i)
    expect(adaText).toMatch(/`@channel` is the boss asking everyone/i)
    // One voice is about not answering the boss twice, not about a silent team.
    expect(adaText).toMatch(/welcome them, answer them, join in when it concerns you/i)
    expect(adaText).not.toMatch(/do not post in #general/i)
    expect(adaText).toMatch(/correct it once, as a reply in the same thread/i)
    expect(provider.spawnOf(pam.id).instructions!.text).toContain('## One voice: you answer the boss')
  })

  it('give the autonomy level, what it gates, and that gated actions go through approval_request', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)

    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    expect(text).toContain('## Autonomy: Supervised')
    expect(text).toMatch(/Ask first.*assign a ticket.*merge/)
    expect(text).toMatch(/Free.*create a ticket/)
    expect(text).toContain('`approval_request`')
  })

  it('say how to name what a merge approval is about, as approval_request does', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)

    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    expect(text).toContain(APPROVAL_SUBJECT_RULE)
    expect(text).not.toContain('PR 7 on api')
  })

  it('say to always reply through chat_post or thread_reply, never plain text', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)

    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    expect(text).toContain('## How to reply')
    expect(text).toMatch(/`chat_post`.*`thread_reply`/)
    expect(text).toMatch(/never.*plain text/i)
  })

  it('say a channel’s topic and pins come with chat_read, and how to pin (T44)', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)

    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    expect(text).toMatch(/topic .*pins are what it decided; `chat_read` returns/)
    expect(text).toMatch(/Pin with `chat_pin`/)
    expect(text).toMatch(/unpin it with `pinned: false`/)
  })

  it('say to @mention the boss when speaking to them in a channel (TI-5)', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)

    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    expect(text).toMatch(/Speaking to the boss in a channel\? Pass `to: "boss"` and the app @mentions them/)
    expect(text).toMatch(/Without the mention nothing you say in a channel reaches them/)
  })

  it('say how to attach a file and where it may come from (T38)', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)

    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    expect(text).toMatch(/`chat_post` and `thread_reply` take `attachments`/)
    expect(text).toMatch(/inside the Company folder or one of your worktrees/)
    expect(text).toMatch(/`chat_read` gives the path to read each file a message carries/)
  })

  it('say that thread replies wake the Employee and are answered with thread_reply', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)

    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    expect(text).toContain(THREAD_RULE)
    expect(THREAD_RULE).toMatch(/answers something you said in a thread.*`thread_reply`/)
  })

  it('name the Employee’s note log and say that nothing in it is ever deleted', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)

    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    expect(text).toContain('## Your own notes')
    expect(text).toContain(join(onDisk('/work/acme/memory'), ada.id, 'log'))
    expect(text).toMatch(/at most 280 bytes/)
    expect(text).toMatch(/nothing here is ever deleted, so write a second note rather than fixing the first/)
    expect(text).toContain('You have written none yet.')
  })

  it('say how to use the Company server, and never list what is on it (T195)', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)

    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    expect(text).toContain('## Company tools')
    expect(text).toMatch(/through the `company` MCP server/)
    // The families, which a tool's own description cannot say.
    expect(text).toMatch(/`plan_` to plan, `review_` to review, `test_` to test/)
    // And not one tool line: name, description and schema come over MCP, and are not paid twice.
    expect(text).not.toMatch(/^- `\w+`: /m)
    expect(text).not.toContain('gives you these tools')
  })

  it('render every section for a sample Company', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)

    engine.sessions.start(ada.id)

    const headings = provider
      .spawnOf(ada.id)
      .instructions!.text.split('\n')
      .filter((line) => line.startsWith('#'))
    expect(headings).toEqual([
      '# You are Ada, Backend at Acme',
      '## How to reply',
      '## How you write',
      '## Between Employees',
      '## Channels',
      '## Repos',
      '## Board',
      '## Wake rules',
      '## One voice: you answer the boss',
      '## Autonomy: Supervised',
      '## Sessions of your own',
      '## Your own notes',
      '## The Company memory',
      '## Company tools',
    ])
  })
})

describe('Injected ticket extras rules', () => {
  it('tell Employees about priority, labels and the base branch', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)

    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    expect(text).toContain('a priority (low, normal, high, urgent) and labels')
    expect(text).toMatch(/pick up urgent and high first/)
    expect(text).toMatch(/base branch.*where its worktrees start and its PRs go/)
  })
})

describe('Injected review rules', () => {
  it('tell Employees both halves of the conversation, and the round limit it ends at', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)

    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    expect(text).toMatch(/read-only[\s\S]*`review_comment`[\s\S]*`review_submit`/)
    expect(text).toMatch(/`review_reply`[\s\S]*`review_ready`/)
    expect(text).toContain('3 rounds')
    expect(text).toContain('a review asked of you')
  })

  it('name the Company’s own round limit once the boss has changed it', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)
    engine.reviews.setRoundLimit(5)

    engine.sessions.start(ada.id)

    expect(provider.spawnOf(ada.id).instructions!.text).toContain('5 rounds')
  })
})

describe('the channels an Employee is told about', () => {
  it('says what each one is for, and that #prs is pull requests only', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)
    engine.sessions.start(ada.id)
    const text = provider.spawnOf(ada.id).instructions!.text

    expect(text).toContain('## Channels')
    expect(text).toMatch(/`#general` is the boss’s channel/)
    expect(text).toMatch(/`#tech` is where two of you work something out/)
    expect(text).toMatch(/`#prs` is pull requests and nothing else/)
    // The app posts the PR itself, so an Employee repeating it is noise.
    expect(text).toContain('do not repeat it')
    expect(text).toMatch(/epic channel/)
  })
})

describe('how an Employee is told to write', () => {
  it('asks for a colleague in a chat, not a report', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)
    engine.sessions.start(ada.id)
    const text = provider.spawnOf(ada.id).instructions!.text

    expect(text).toContain('## How you write')
    expect(text).toMatch(/two or three sentences/i)
    expect(text).toMatch(/no bullet lists, headings, bold labels or decorative emoji in chat/i)
    // The tells the boss reads as machine writing.
    expect(text).toMatch(/it’s not X, it’s Y/i)
    expect(text).toMatch(/numbers and names instead of adjectives/i)
  })
})

describe('what an Employee is told about the Company’s secrets (T176)', () => {
  it('names the environments and their variables, the switch and the default repos', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)
    const api = engine.repos.list().find((repo) => repo.name === 'api')!
    engine.environments.add({
      environment: 'prod',
      name: 'DATABASE_URL',
      value: 'postgres://app:h7fs8@db/billing',
      repoIds: [api.id],
    })
    engine.environments.add({ environment: 'dev', name: 'REDIS_URL', value: 'redis://cache:6379' })
    engine.environments.setRepoDefault(api.id, 'prod')
    engine.sessions.start(ada.id)
    const text = provider.spawnOf(ada.id).instructions!.text

    expect(text).toContain('## Environments')
    expect(text).toContain('`prod` — asks the boss before every use · default for `api`: DATABASE_URL')
    expect(text).toContain('`dev`: REDIS_URL')
    expect(text).toMatch(/never ask the boss or a colleague to tell you a value/i)
    expect(text).toMatch(/env_run/)
    // The one thing that must not be there, whatever else is.
    expect(text).not.toContain('h7fs8')
  })

  it('says nothing at all when the Company keeps no secrets', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)
    engine.sessions.start(ada.id)

    expect(provider.spawnOf(ada.id).instructions!.text).not.toContain('## Environments')
  })
})

/**
 * The full Employee the byte budget is measured on: every capability, so it carries Intake,
 * Planning, Hiring and the Testing bullet as well as everything everybody gets. A real Employee is
 * smaller than this; nobody's instructions are bigger.
 */
function fullEmployee(engine: CompanyEngine) {
  engine.repos.add({ path: '/src/api', name: 'api', stack, brief: 'Billing API.' })
  return engine.employees.create({
    name: 'Ada',
    roleId: 'backend',
    persona: 'You build careful APIs and write tests first.',
    capabilities: ['code', 'review', 'plan', 'intake', 'hire', 'test'],
    repoFilter: ['api'],
  })
}

describe('the voice an Employee writes in (T180)', () => {
  it('adds the Between Employees section while the Company is on Terse', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)
    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    expect(text).toContain('## Between Employees')
    expect(text).toMatch(/A DM to a colleague is terse: fragments, not sentences/)
    expect(text).toMatch(/Arrows, symbols and shorthand are fine/)
  })

  it('leaves it out entirely once the Company is on Plain', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)
    engine.voice.setColleague('plain')

    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    expect(text).not.toContain('## Between Employees')
    expect(text).not.toMatch(/fragments, not sentences/)
  })

  it('keeps the plain rules and the full-sentence exceptions on either setting', () => {
    for (const voice of ['terse', 'plain'] as const) {
      const { engine, provider } = setup()
      const ada = sampleCompany(engine)
      engine.voice.setColleague(voice)

      engine.sessions.start(ada.id)

      const text = provider.spawnOf(ada.id).instructions!.text
      expect(text).toContain('## How you write')
      // The checks the humanizer was missing before T180.
      expect(text).toMatch(/No sign-off/)
      expect(text).toMatch(/I hope this helps/)
      expect(text).toMatch(/Nothing is critical, major or a milestone unless you can say why in numbers/)
      expect(text).toMatch(/Never "some say" or "best practice"/)
      expect(text).toMatch(/decorative emoji/)
      // And the one that keeps terse from leaking into something the boss reads.
      expect(text).toMatch(/No fragments here, whatever you write to colleagues/)
      // A warning, a destructive step and a question are full sentences wherever they are written.
      expect(text).toMatch(
        voice === 'terse'
          ? /a security warning, a destructive or irreversible step, and a question someone must answer/
          : /Full sentences for anyone the boss might be/,
      )
    }
  })
})

describe('how Employees build (T194)', () => {
  it('leaves the How you build section out until the boss turns Lean builder on', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)
    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    expect(text).not.toContain('## How you build')
    expect(text).not.toContain(LEAN_LADDER[0])
  })

  it('adds the ladder and what it never cuts once the Company is on Lean', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)
    engine.buildStyle.set('lean')

    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    expect(text).toContain('## How you build')
    expect(text).toContain('1. Does it need to exist?')
    expect(text).toContain('7. Only then: the minimum that works.')
    expect(text).toMatch(/Never cut: validation at a trust boundary/)
    // The rung that keeps a small diff from being a confident wrong one.
    expect(text).toMatch(/shortens the solution, never the reading/)
  })

  it('takes it away again when the boss turns it off, at the next Session and not mid-turn', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)
    engine.buildStyle.set('lean')
    engine.sessions.start(ada.id)
    expect(provider.spawnOf(ada.id).instructions!.text).toContain('## How you build')

    engine.buildStyle.set('standard')
    engine.sessions.stop(ada.id)
    engine.sessions.start(ada.id)

    expect(provider.spawnOf(ada.id).instructions!.text).not.toContain('## How you build')
  })
})

describe('how Employees answer the boss (T261)', () => {
  it('leaves the section out until the boss turns Caveman on', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)
    engine.sessions.start(ada.id)

    expect(provider.spawnOf(ada.id).instructions!.text).not.toContain('## How you answer the boss')
  })

  it('adds the section at every intensity, each with its own first line', () => {
    for (const level of ['lite', 'full', 'ultra'] as const) {
      const { engine, provider } = setup()
      const ada = sampleCompany(engine)
      engine.caveman.set(level)

      engine.sessions.start(ada.id)

      const text = provider.spawnOf(ada.id).instructions!.text
      expect(text).toContain('## How you answer the boss')
      expect(text).toContain(CAVEMAN_PER_LEVEL[level])
    }
  })

  /**
   * The failure this add-on can have is an Employee that shortens the thing the boss needed whole.
   * These are the four the ticket names, checked in the text an Employee is really handed rather
   * than in the array the card reads, because the card and the section are two different strings.
   */
  it('keeps the payload and the written record out of it, in the text an Employee is handed', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)
    engine.caveman.set('full')

    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    expect(text).toMatch(/Never code, a command, a file path, an error message, an id, a number or a security warning/)
    expect(text).toMatch(/go through word for word/)
    expect(text).toMatch(/Never a commit message, a pull request, a plan or ticket text/)
    expect(text).toMatch(/they stay in full sentences/)
    expect(text).toMatch(/Never to a colleague/)
    expect(text).toMatch(/When you cannot tell, write full sentences/)
  })

  /**
   * The colleague voice governs a DM between Employees and this one governs a message to the boss.
   * A Company on both must not end up with the caveman rules inside Between Employees, or the two
   * sections would each claim the other's place.
   */
  it('never lands inside the Between Employees section, which is the other voice\u2019s place', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)
    engine.caveman.set('ultra')

    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    const between = text.indexOf('## Between Employees')
    const boss = text.indexOf('## How you answer the boss')
    expect(between).toBeGreaterThan(-1)
    expect(boss).toBeGreaterThan(between)
    // Its own heading opens before any caveman line: nothing of this section is inside that one.
    expect(text.slice(between, boss)).not.toContain(CAVEMAN_PER_LEVEL.ultra)
  })

  it('takes it away again when the boss turns it off, at the next Session and not mid-turn', () => {
    const { engine, provider } = setup()
    const ada = sampleCompany(engine)
    engine.caveman.set('full')
    engine.sessions.start(ada.id)
    expect(provider.spawnOf(ada.id).instructions!.text).toContain('## How you answer the boss')

    engine.caveman.set('off')
    engine.sessions.stop(ada.id)
    engine.sessions.start(ada.id)

    expect(provider.spawnOf(ada.id).instructions!.text).not.toContain('## How you answer the boss')
  })
})

describe('what the instructions cost every Session (T180, T194, T195)', () => {
  /**
   * Every byte of this is paid on every start of every Session, so it is budgeted rather than
   * watched. The number is the T195 trim plus TI-5's one line about mentioning the boss, rounded up
   * to the next hundred: the fullest Employee a Company can have renders 19_239 bytes on Terse and
   * 18_481 on Plain, against 22_934 and 22_176 before T195 — the tool list the MCP client already
   * sends was 3_932 bytes of that, 17% of the prompt.
   *
   * TI-5's line cost 154 bytes and nothing paid for it: the two paragraphs left in this prompt that
   * still repeat a tool's own description — pins and attachments — are each pinned by a test of
   * their own ticket, so cutting them is that ticket's call and not this one's.
   *
   * T239 added 362 bytes: who a ticket is for is its area, said once in the Board section where
   * everybody reads it, plus one line in Planning about labelling it. The first draft said it three
   * times — Board, Planning and Intake — which is exactly what the paragraph below is about, and two
   * of the three were cut before the number moved.
   *
   * Over budget is not a bug in this test. It means a rule was written twice, or written long: find
   * the other copy and cut it, and only then move the number.
   */
  const BUDGET = 19_700

  /**
   * What Lean builder adds, counted off the section itself rather than written down (T194): every
   * line and the newline that joins it. The budget above is what every Company pays; a Company
   * that turned the add-on on pays this much more and not a byte else, which is what the second
   * test below proves.
   */
  const LEAN_BYTES = LEAN_RULES.reduce((total, line) => total + Buffer.byteLength(line, 'utf8') + 1, 0)

  it('fit the byte budget for the fullest Employee a Company can have', () => {
    const { engine, provider } = setup()
    const ada = fullEmployee(engine)

    engine.sessions.start(ada.id)

    const bytes = Buffer.byteLength(provider.spawnOf(ada.id).instructions!.text, 'utf8')
    expect(bytes).toBeLessThanOrEqual(BUDGET)
  })

  it('cost exactly the Lean builder section more with the add-on on, and nothing else', () => {
    const standard = setup()
    const standardAda = fullEmployee(standard.engine)
    standard.engine.sessions.start(standardAda.id)
    const lean = setup()
    const leanAda = fullEmployee(lean.engine)
    lean.engine.buildStyle.set('lean')

    lean.engine.sessions.start(leanAda.id)

    const before = Buffer.byteLength(standard.provider.spawnOf(standardAda.id).instructions!.text, 'utf8')
    const after = Buffer.byteLength(lean.provider.spawnOf(leanAda.id).instructions!.text, 'utf8')
    expect(after - before).toBe(LEAN_BYTES)
    expect(after).toBeLessThanOrEqual(BUDGET + LEAN_BYTES)
  })

  it('cost less again on Plain, because the terse section is not rendered at all', () => {
    const { engine, provider } = setup()
    const ada = fullEmployee(engine)
    engine.voice.setColleague('plain')

    engine.sessions.start(ada.id)

    const bytes = Buffer.byteLength(provider.spawnOf(ada.id).instructions!.text, 'utf8')
    expect(bytes).toBeLessThan(BUDGET - 500)
  })
})
