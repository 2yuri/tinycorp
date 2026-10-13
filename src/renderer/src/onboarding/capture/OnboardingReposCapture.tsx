// A dev-only capture of the setup wizard's Repositories step with the Found repositories picker in
// it (`onboarding-repos-capture.html`, T168), so it can be compared with `design/screens/DxNcO.png`.
// The wizard chrome, the step and the picker are the app's own; only the folder is the frame's.
//
// `?step=team` and `?step=first-ticket` draw the wizard's other two steps in the same chrome. They
// have no frame of their own here; they are in the baseline's table (T209) so that the two steps
// nothing else shoots have a picture to be held to.
import { type ReactNode, useState } from 'react'
import type { Company } from '../../../../shared/company'
import type { RoleTemplate } from '../../../../shared/domain/staff'
import { officePlan, rosterFromPreset } from '../../../../shared/staff/roster-draft'
import { teamPreset } from '../../../../shared/staff/team-presets'
import { CONNECTED, FOLDER, FOUND, INSPECTIONS, SELECTED } from '../../repositories/capture/found-repos-fixture'
import { knownFoundRepos } from '../../repositories/found-repos-model'
import { FirstTicketStepView } from '../FirstTicketStep'
import { RepositoriesStepView } from '../RepositoriesStep'
import { connectedCards, connectedLabel, repoCounts } from '../repositories-step-model'
import { SetupWizardView } from '../SetupWizard'
import { TeamStepView } from '../TeamStep'
import '../../ui/tailwind.css'

const noop = () => {}

const COMPANY: Company = {
  id: 'c-tiny',
  name: 'Tiny Corp',
  key: 'TC',
  boss: { name: 'Yuri Miguel', initials: 'YM' },
  folder: FOLDER,
  createdAt: '2026-09-22T08:00:00.000Z',
}

/** The Company's seeded roles, as the wizard's catalog holds them. */
const ROLE = (id: string, name: string, capabilities: RoleTemplate['capabilities'] = []): RoleTemplate => ({
  id,
  name,
  persona: `${name} persona.`,
  capabilities,
  repoFilter: ['*'],
  areas: [],
  mcpServers: [],
  skills: [],
  seeded: true,
})

const CATALOG = [
  ROLE('pm', 'PM', ['intake', 'plan']),
  ROLE('tech-lead', 'Tech Lead'),
  ROLE('frontend', 'Frontend'),
  ROLE('backend', 'Backend'),
  ROLE('po', 'PO'),
  ROLE('devops', 'DevOps'),
  ROLE('qa', 'QA'),
  ROLE('hr', 'HR'),
]

export function onboardingReposCapture(step = 'repositories'): ReactNode {
  if (step === 'team') return <TeamCapture />
  if (step === 'first-ticket') return <FirstTicketCapture />
  return <Capture />
}

/** Step 3, Your team: the product-squad preset, which is the roster a new Company starts on. */
function TeamCapture() {
  const [roster, setRoster] = useState(() => rosterFromPreset(teamPreset('product-squad'), 'claude'))
  return (
    <Wizard step="team">
      <TeamStepView
        roster={roster}
        catalog={CATALOG}
        plan={officePlan({ draft: roster, headcount: { current: 0, max: 12 }, catalog: CATALOG, repos: ['web-app'] })}
        onRename={noop}
        onModel={noop}
        onRemove={noop}
        onAddRole={() => setRoster(roster)}
        suggestName={() => Promise.resolve(null)}
      />
    </Wizard>
  )
}

/** Step 5, First ticket: the goal the wizard ends on, with the intake holder under it. */
function FirstTicketCapture() {
  return (
    <Wizard step="first-ticket">
      <FirstTicketStepView
        goal="Invoices should show the usage totals the customer was charged for."
        onGoal={noop}
        repo={{ name: 'billing-api', more: 2 }}
        planner="Nova"
        onEmptyBoard={noop}
      />
    </Wizard>
  )
}

/** The wizard's own chrome around a step, at the window the other captures use. */
function Wizard(props: { step: 'team' | 'first-ticket'; children: ReactNode }) {
  return (
    <div style={{ width: 1512, height: 944, overflow: 'hidden' }}>
      <SetupWizardView
        company={COMPANY}
        state={{ step: props.step, preset: 'product-squad', roster: [], goal: '' }}
        autonomy="managed"
        provider="claude"
        onPreset={noop}
        onBack={noop}
        onContinue={noop}
        onSkip={noop}
      >
        {props.children}
      </SetupWizardView>
    </div>
  )
}

function Capture() {
  const [selected, setSelected] = useState<ReadonlySet<string>>(SELECTED)
  const found = knownFoundRepos(FOLDER, FOUND, CONNECTED, {
    selected,
    inspections: INSPECTIONS,
    walk: { folder: FOLDER, found: FOUND, stopped: 'done', emptyFolders: 1 },
    toggle: (rows, on) =>
      setSelected((before) => {
        const next = new Set(before)
        for (const row of rows) {
          if (!row.offered) continue
          if (on) next.add(row.path)
          else next.delete(row.path)
        }
        return next
      }),
  })

  return (
    <div style={{ width: 1512, height: 944, overflow: 'hidden' }}>
      <SetupWizardView
        company={COMPANY}
        state={{ step: 'repositories', preset: 'product-squad', roster: [], goal: '' }}
        autonomy="managed"
        provider="claude"
        onPreset={noop}
        onBack={noop}
        onContinue={noop}
        onSkip={noop}
      >
        <RepositoriesStepView
          cards={connectedCards(COMPANY, CONNECTED, {}, [], [])}
          found={found}
          counts={repoCounts(CONNECTED, found.counts.offered, found.chosen.length)}
          connectedLabel={connectedLabel(CONNECTED)}
          access={null}
          error={null}
          onAddAnywhere={noop}
          onStartHere={noop}
          onEditRepo={noop}
          onBrief={noop}
          onDisconnect={noop}
          onChangeAccess={noop}
          onToggleRole={noop}
          onDoneAccess={noop}
        />
      </SetupWizardView>
    </div>
  )
}
