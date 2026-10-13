import { Check, ImagePlus, Pencil, RotateCcw, ShieldCheck, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AUTONOMY_LABEL, AUTONOMY_LEVELS, isAutonomyLevel } from '../../../shared/approvals'
import type { CapacityInfo } from '../../../shared/capacity'
import type { Company } from '../../../shared/company'
import { PERMISSION_DEFAULT_HELP } from '../../../shared/domain/staff'
import type { RoomSlug } from '../../../shared/office/rooms'
import { SETTINGS_TAB_LABEL, SETTINGS_TABS, type SettingsTab, ViewHeader } from '../chrome'
import { type CompanyMove, TemporaryFolderWarning, useCompanyMove } from '../company-move'
import { DangerZone, useCompanyRemoval } from '../company-removal'
import { HeadcountSetting, PermissionField } from '../hiring'
import { resources, useIpcResource } from '../ipc'
import { NotificationCheck } from '../notifications'
import { RoundLimitSetting, SecurityScopeSetting } from '../review'
import { Alert, Button, cx, InputGroup, Select, SettingsCard, SettingsRow, SHELL_BUTTON, Toggle } from '../ui'
import { AddonsTab, addonsTabSubtitle } from './AddonsTab'
import { AnswererSetting } from './AnswererSetting'
import { DailyDigestSetting } from './DailyDigestSetting'
import { EnvironmentsTab, environmentsSubtitle } from './EnvironmentsTab'
import { IntegrationsTab } from './IntegrationsTab'
import { OfficeTab, officeTabSubtitle } from './OfficeTab'
import { routingSubtitle } from './routing-model'
import {
  AUTONOMY_DESCRIPTION,
  hasChanges,
  keyInput,
  type SavedSettings,
  type SettingsDraft,
  type SettingsField,
  sampleTicketId,
  settingsChanges,
  settingsDraft,
  settingsProblems,
} from './settings-model'
import { TestingSetting } from './TestingSetting'
import { TokensTab, tokensTabSubtitle } from './TokensTab'
import { UsageRoutingTab } from './UsageRoutingTab'
import '../ui/tailwind.css'
import {
  COLUMN,
  CONTENT,
  CONTENT_OFFICE,
  ERRORS,
  FIELD,
  FIELD_HINTED,
  FIELD_MONO,
  FIELD_TEXT,
  IDENTITY,
  LOGO,
  ROW,
  TAB,
  TAB_CURRENT,
  TAB_REST,
  TABS,
  VIEW,
} from './settings-classes'

const api = window.tinyCorp

/**
 * Company settings (frames `QgXdU`, `V0brJM`, `bB6VX`, `zpvHQ`, `uApL8`).
 *
 * General is the frame's two columns: the Company's name and key, Chat & notifications and the
 * daily digest on the left; the Team, Testing before merge and the Danger zone on the right. The
 * app's own version is **not** here — it is the Company's settings, and the build is the app's, so
 * `About` moved to Your profile's version row (T181). Decisions 3, 18, 31 and 38 drop the tabs the
 * frames used to draw.
 */
export function CompanySettings({
  company,
  tab = 'general',
  onTabChange,
}: {
  company: Company
  tab?: SettingsTab | undefined
  onTabChange?(tab: SettingsTab): void
}) {
  const loaded = useSavedSettings(company)
  const removal = useCompanyRemoval()
  const move = useCompanyMove()
  return (
    <div className={VIEW} data-ui="Company Settings">
      <div className={TABS} role="tablist" aria-label="Company settings">
        {SETTINGS_TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === tab}
            className={cx(TAB, id === tab ? TAB_CURRENT : TAB_REST)}
            onClick={() => onTabChange?.(id)}
          >
            {SETTINGS_TAB_LABEL[id]}
          </button>
        ))}
      </div>
      {loaded ? (
        <SettingsForm
          saved={loaded.saved}
          capacity={loaded.capacity}
          tab={tab}
          removal={{ onForget: () => removal.forget(company), onDelete: () => removal.askDelete(company) }}
          move={move}
        />
      ) : (
        <ViewHeader title="Company settings" subtitle={subtitle(company, tab)} />
      )}
      {removal.overlay}
    </div>
  )
}

function subtitle(company: Company, tab: SettingsTab): string {
  if (tab === 'office') return officeTabSubtitle(company.name)
  if (tab === 'routing') return routingSubtitle(company.name)
  if (tab === 'environments') return environmentsSubtitle()
  if (tab === 'tokens') return tokensTabSubtitle(company.name)
  if (tab === 'addons') return addonsTabSubtitle(company.name)
  return `These apply to ${company.name} and every Employee working inside it.`
}

/** The saved settings, kept fresh from the engine's change events; null until all have loaded. */
function useSavedSettings(company: Company): { saved: SavedSettings; capacity: CapacityInfo } | null {
  const capacity = useIpcResource(resources.capacity)
  const autonomy = useIpcResource(resources.autonomy)
  const permissionMode = useIpcResource(resources.permissionDefault)
  const [notifications, setNotifications] = useState<boolean | null>(null)
  const [room, setRoom] = useState<RoomSlug | null>(null)

  useEffect(() => {
    const readNotifications = async () => {
      const result = await api.notifications.enabled()
      if (result.ok) setNotifications(result.value)
    }
    const readRoom = async () => {
      const result = await api.office.room()
      if (result.ok) setRoom(result.value)
    }
    void readNotifications()
    void readRoom()
    const offs = [
      api.notifications.onChanged(() => void readNotifications()),
      api.office.onChanged(() => void readRoom()),
    ]
    return () => {
      for (const off of offs) off()
    }
  }, [])

  if (!capacity || autonomy === null || notifications === null || room === null || permissionMode === null) {
    return null
  }
  return {
    saved: { company, concurrencyCap: capacity.concurrencyCap, autonomy, notifications, room, permissionMode },
    capacity,
  }
}

export function SettingsForm({
  saved,
  capacity,
  tab = 'general',
  removal,
  move,
}: {
  saved: SavedSettings
  capacity: CapacityInfo
  /** Which tab's fields the form shows; one Save changes covers both. */
  tab?: SettingsTab | undefined
  /** Remove from launcher and Delete company… for this Company; the Danger zone shows with them. */
  removal?: { onForget(): void; onDelete(): void } | undefined
  /** Move… when the Company lives in a temporary folder (decision 45); no warning without it. */
  move?: Pick<CompanyMove, 'isTemporary' | 'moving' | 'error' | 'move'> | undefined
}) {
  const [draft, setDraft] = useState(() => settingsDraft(saved))
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  // A change saved elsewhere replaces only the fields it changed; the rest keep what the boss typed.
  const base = useRef(settingsDraft(saved))
  const next = settingsDraft(saved)
  const nextKey = JSON.stringify(next)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `nextKey` stands for `next`, which is rebuilt on every render, per the comment below.
  useEffect(() => {
    const changed = (Object.keys(next) as SettingsField[]).filter((f) => next[f] !== base.current[f])
    base.current = next
    if (changed.length) setDraft((d) => ({ ...d, ...Object.fromEntries(changed.map((f) => [f, next[f]])) }))
    // `nextKey` stands for `next`, which is rebuilt on every render.
  }, [nextKey])

  const problems = settingsProblems(draft)
  const dirty = hasChanges(saved, draft)
  const valid = Object.keys(problems).length === 0

  function set<F extends SettingsField>(name: F, value: SettingsDraft[F]) {
    setDraft((d) => ({ ...d, [name]: value }))
  }

  async function save() {
    if (!dirty || !valid || saving) return
    const changes = settingsChanges(saved, draft)
    setSaving(true)
    const results = await Promise.all([
      Object.keys(changes.company).length ? api.company.update(changes.company) : null,
      changes.concurrencyCap !== undefined ? api.capacity.setConcurrencyCap(changes.concurrencyCap) : null,
      changes.autonomy !== undefined ? api.approvals.setLevel(changes.autonomy) : null,
      changes.notifications !== undefined ? api.notifications.setEnabled(changes.notifications) : null,
      changes.room !== undefined ? api.office.setRoom(changes.room) : null,
      changes.permissionMode !== undefined ? api.staff.setPermissionDefault(changes.permissionMode) : null,
    ])
    setSaving(false)
    setErrors(results.flatMap((r) => (r && !r.ok ? [r.error] : [])))
  }

  function discard() {
    setDraft(settingsDraft(saved))
    setErrors([])
  }

  const field = (name: 'name' | 'key' | 'concurrencyCap') => ({
    value: draft[name],
    error: problems[name] !== undefined,
    helper: problems[name],
  })

  return (
    <>
      <ViewHeader title="Company settings" subtitle={subtitle(saved.company, tab)}>
        <Button variant="ghost" size="toolbar" icon={RotateCcw} disabled={!dirty || saving} onClick={discard}>
          Discard changes
        </Button>
        <Button icon={Check} disabled={!dirty || !valid || saving} onClick={() => void save()}>
          Save changes
        </Button>
      </ViewHeader>
      <form
        className={tab === 'office' ? CONTENT_OFFICE : CONTENT}
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <button type="submit" hidden />
        {errors.length > 0 && (
          <div className={ERRORS}>
            {errors.map((error) => (
              <Alert key={error} variant="error" title={error} onClose={() => setErrors([])} />
            ))}
          </div>
        )}
        {/* The folder is a General fact: the Office tab is about the room, so it stays out of it. */}
        {tab !== 'office' && move?.isTemporary(saved.company) && (
          <TemporaryFolderWarning
            busy={move.moving === saved.company.id}
            error={move.error?.companyId === saved.company.id ? move.error.message : null}
            onMove={() => move.move(saved.company)}
          />
        )}
        {tab === 'office' ? (
          <OfficeTab
            companyName={saved.company.name}
            slug={draft.room}
            savedSlug={saved.room}
            onPick={(room) => set('room', room)}
          />
        ) : tab === 'routing' ? (
          /* Usage & routing saves control by control, like Integrations: a rule the boss set and a
             Save they forgot is a team that waited all night for nothing (T173). */
          <UsageRoutingTab outages={capacity.outages} companyName={saved.company.name} />
        ) : tab === 'environments' ? (
          /* Environments saves control by control too: a value in the keychain is not a draft, and
             a Save the boss forgot would be a team locked out of the database (T176). */
          <EnvironmentsTab />
        ) : tab === 'tokens' ? (
          /* How Employees talk saves as it changes too: picking a voice is not a draft, and a Save
             the boss forgot would leave the team writing the other one all night (T180). */
          <TokensTab companyName={saved.company.name} />
        ) : tab === 'addons' ? (
          /* An add-on saves as it changes too: flipping one is not a draft, and it only takes at
             the next Session start anyway (T194). */
          <AddonsTab />
        ) : tab === 'integrations' ? (
          /* The MCP catalogue saves itself, server by server: it is not part of the form's
             Save changes, because a token in the keychain is not a draft (T136). */
          <IntegrationsTab />
        ) : (
          <GeneralTab draft={draft} saved={saved} capacity={capacity} set={set} field={field} removal={removal} />
        )}
      </form>
    </>
  )
}

/** General, in the order and the columns frame `QgXdU` draws them (T181). */
function GeneralTab({
  draft,
  saved,
  capacity,
  set,
  field,
  removal,
}: {
  draft: SettingsDraft
  saved: SavedSettings
  capacity: CapacityInfo
  set<F extends SettingsField>(name: F, value: SettingsDraft[F]): void
  field(name: 'name' | 'key' | 'concurrencyCap'): {
    value: string
    error: boolean
    helper?: string | undefined
  }
  removal?: { onForget(): void; onDelete(): void } | undefined
}) {
  return (
    <>
      <div className={COLUMN}>
        <SettingsCard
          title="Company profile"
          sub={`The name Employees use for this Company and the key its tickets carry, as in ${sampleTicketId(draft.key)}.`}
        >
          <div className={IDENTITY}>
            <CompanyLogoField logo={saved.company.logo ?? null} fallback={draft.key || saved.company.key} />
            <InputGroup
              className={cx(FIELD, FIELD_TEXT)}
              label="Company name"
              {...field('name')}
              onChange={(e) => set('name', e.target.value)}
            />
            <InputGroup
              className={cx(FIELD, FIELD_MONO)}
              label="Key"
              maxLength={4}
              {...field('key')}
              onChange={(e) => set('key', keyInput(e.target.value))}
            />
          </div>
        </SettingsCard>
        {/* One card, as frame `QgXdU` draws it: who answers, and what the app tells you. */}
        <SettingsCard
          tight
          title="Chat & notifications"
          sub="Who speaks for the team when you say something, and what TinyCorp tells you while you are elsewhere."
        >
          <AnswererSetting className={cx(FIELD, FIELD_TEXT, FIELD_HINTED)} />
          <SettingsRow
            title="Desktop notifications"
            sub="Ping me for approvals, mentions, PRs opened and an exhausted budget."
          >
            <Toggle
              label={null}
              aria-label="Desktop notifications"
              checked={draft.notifications}
              onChange={(e) => set('notifications', e.target.checked)}
            />
          </SettingsRow>
          {/* A toggle that looks on proves nothing: the system may be dropping every banner (T126). */}
          <NotificationCheck />
        </SettingsCard>
        {/* The digest saves as it changes, so it is its own card rather than part of Save changes. */}
        <DailyDigestSetting />
      </div>
      <div className={COLUMN}>
        <SettingsCard
          title="Team"
          sub={`Applied to every Employee in ${saved.company.name}. Each Employee can still be tuned from its drawer.`}
        >
          <div className={ROW}>
            <Select
              className={cx(FIELD, FIELD_TEXT)}
              label="Autonomy"
              icon={ShieldCheck}
              value={draft.autonomy}
              title={AUTONOMY_DESCRIPTION[draft.autonomy]}
              options={AUTONOMY_LEVELS.map((level) => ({ value: level, label: AUTONOMY_LABEL[level] }))}
              onChange={(e) => {
                if (isAutonomyLevel(e.target.value)) set('autonomy', e.target.value)
              }}
            />
            <InputGroup
              className={cx(FIELD, FIELD_MONO)}
              label="Concurrency cap"
              type="number"
              min={1}
              step={1}
              {...field('concurrencyCap')}
              onChange={(e) => set('concurrencyCap', e.target.value)}
            />
          </div>
          {/* The frame pairs these two the way it pairs the two above them. */}
          <div className={ROW}>
            <HeadcountSetting className={cx(FIELD, FIELD_MONO)} />
            <RoundLimitSetting className={cx(FIELD, FIELD_MONO)} />
          </div>
          {/* PERMISSIONS, under the Defaults for new employees card of frame `QgXdU` (`V0AWNP`). */}
          <PermissionField
            id="settings-permissions"
            value={draft.permissionMode}
            help={PERMISSION_DEFAULT_HELP}
            onChange={(permissionMode) => set('permissionMode', permissionMode)}
          />
          {/* Nothing running and nothing parked reads as the frame's line rather than a cap rule
              about Sessions there are none of (`hGQxG`). The frame's own second clause is
              `Hire someone and their Session starts here`, which this screen cannot say: it reads
              capacity, not the payroll, and a Company can have eight Employees and none awake. */}
          <SettingsRow
            title="Sessions"
            sub={
              capacity.running === 0 && capacity.parked.length === 0
                ? 'Nobody is working yet · 0 parked. A Session starts here when someone picks up a ticket.'
                : `${capacity.running} running · ${capacity.parked.length} parked. Raising the cap starts parked Employees; lowering it stops no one.`
            }
          />
          {capacity.budget && (
            <Alert variant="warning" title="Out of budget">
              The usage limit was hit and the team is paused
              {capacity.budget.resetsAt
                ? ` until ${new Date(capacity.budget.resetsAt).toLocaleString()}.`
                : '. The reset time is unknown.'}
            </Alert>
          )}
        </SettingsCard>
        {/* Who tests before a merge, and each repo's run command (T174). Saves as it changes too. */}
        <TestingSetting />
        {/* Which PRs the Security Employee reads, if the Company hired one (T241). */}
        <SecurityScopeSetting />
        {removal && <DangerZone onForget={removal.onForget} onDelete={removal.onDelete} />}
      </div>
    </>
  )
}

/**
 * The Company's logo (T280, frame `EKgMA`): the tile is the button that picks one, a badge says so,
 * and a logo that is there can be taken away. The engine keeps it in the Company's folder and tells
 * every screen; the rail, the Launcher and the office's walls follow on their own.
 */
function CompanyLogoField(props: { logo: string | null; fallback: string }) {
  const [error, setError] = useState<string | null>(null)
  const run = (action: () => Promise<{ ok: boolean; error?: string }>) =>
    void action().then((result) => setError(result.ok ? null : (result.error ?? null)))
  return (
    <div className="relative size-60 shrink-0" data-ui="Company Logo">
      <button
        type="button"
        className={cx(SHELL_BUTTON, LOGO, 'cursor-pointer overflow-hidden p-0', props.logo && 'bg-transparent')}
        aria-label={props.logo ? 'Change the Company logo' : 'Upload a Company logo'}
        title={error ?? (props.logo ? 'Change the logo' : 'Upload a logo (PNG or JPEG)')}
        onClick={() => run(() => api.company.chooseLogo())}
      >
        {props.logo ? (
          <img src={props.logo} alt="" className="size-full object-cover" draggable={false} />
        ) : (
          props.fallback
        )}
      </button>
      <span className={LOGO_BADGE} aria-hidden>
        {props.logo ? <Pencil size={12} /> : <ImagePlus size={12} />}
      </span>
      {props.logo && (
        <button
          type="button"
          className={cx(SHELL_BUTTON, LOGO_REMOVE)}
          aria-label="Remove the Company logo"
          title="Remove the logo"
          onClick={() => run(() => api.company.removeLogo())}
        >
          <X size={10} aria-hidden />
        </button>
      )}
      {error && (
        <span className="absolute top-62 left-0 w-200 text-11/[normal] text-status-error-foreground" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

/** The badge on the logo tile's corner: pick one, or change it (frame `EKgMA`). */
const LOGO_BADGE =
  'pointer-events-none absolute top-38 left-38 flex size-22 items-center justify-center rounded-full border-2 border-card bg-secondary text-foreground'

/** The `×` that takes a logo away, over the tile's top corner. */
const LOGO_REMOVE =
  'absolute -top-4 left-42 flex size-18 cursor-pointer items-center justify-center rounded-full border-2 border-card bg-secondary p-0 text-muted-foreground hover:text-foreground'
