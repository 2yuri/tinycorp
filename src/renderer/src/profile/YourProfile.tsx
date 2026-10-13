import { ArrowRight, Check, ChevronRight, Circle, CircleCheck, Lock, Mail, Settings, Timer } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import {
  BOSS_STATUS_DESCRIPTION,
  BOSS_STATUS_LABEL,
  BOSS_STATUSES,
  type Boss,
  handleInput,
  isBossStatus,
  isStatusDuration,
  STATUS_DURATIONS,
} from '../../../shared/boss-profile'
import type { Company, CompanySummary } from '../../../shared/company'
import { nameList, PROVIDER_AUTH, PROVIDER_LABEL, PROVIDERS } from '../../../shared/domain/providers'
import { CHARACTER_SHEETS } from '../../../shared/office/characters'
import type { Route } from '../chrome'
import { machineWordsHere, SHELL_VIEW, ViewHeader } from '../chrome'
import { useDefaultProvider } from '../preflight'
import { CharacterPortrait } from '../sprites'
import { Alert, Button, CHOICE_INPUT, cx, InputGroup, initialsOf, Select, Toggle } from '../ui'
import { VersionRow } from '../updates'
import { OnThisPcCard, useWindowsMachine } from '../windows-setup'
import { ProvidersCard } from './ProvidersCard'
import {
  accountLine,
  companyMeta,
  handleNote,
  hasProfileChanges,
  type ProfileDraft,
  type ProfileField,
  previewHandle,
  profileChanges,
  profileDraft,
  profileProblems,
  runningSince,
  type SavedProfile,
} from './profile-model'
import {
  CARD,
  CARD_HEAD,
  CARD_HEAD_INLINE,
  CARD_SUB,
  CARD_TITLE,
  CARD_TITLE_SMALL,
  COMPANIES_CARD,
  IDENTITY,
  SIDE_CARD,
  SOFT_INK,
} from './profile-style'
import '../ui/tailwind.css'

const api = window.tinyCorp

/**
 * What the app can tell the boss about signing out: TinyCorp holds no login of its own, so there
 * is nothing here to press. Each CLI owns its own, and each one's command comes from its catalogue
 * entry — every Provider the boss might be signed into, not only the first.
 *
 * It says what the Providers card beside it does not: the card names the logins, this says who
 * they belong to and what ends them.
 */
export const SIGN_OUT_NOTE =
  'TinyCorp keeps no account of its own — each CLI holds its own login, and signing out is a ' +
  `command in a terminal: ${nameList(PROVIDERS.map((id) => `\`${PROVIDER_AUTH[id].signOut}\``))}.`

/**
 * Your profile (design/html/your-profile.html, Pen frame `Oykzs`): the boss's own page, the same in
 * every Company. Identity, the character they are drawn with, their status, and what this Mac does.
 */
export function YourProfile({ company, onNavigate }: { company: Company; onNavigate(route: Route): void }) {
  const saved = useSavedProfile()
  const summaries = useCompanySummaries()
  return (
    <div className={cx(SHELL_VIEW, VIEW)} data-ui="Your Profile">
      {saved ? (
        <ProfileForm
          saved={saved}
          company={company}
          companies={summaries}
          onNavigate={onNavigate}
          onOpenCompany={(id) => void api.company.switchTo(id)}
        />
      ) : (
        <ViewHeader title="Your profile" subtitle={PAGE_SUBTITLE} />
      )}
    </div>
  )
}

const PAGE_SUBTITLE = 'This is you — it follows you into every Company you run.'

/** The profile and the open Company's notification toggle, kept fresh; null until both have loaded. */
function useSavedProfile(): SavedProfile | null {
  const [boss, setBoss] = useState<Boss | null>(null)
  const [notifications, setNotifications] = useState<boolean | null>(null)

  useEffect(() => {
    const readBoss = async () => {
      const result = await api.profile.get()
      if (result.ok) setBoss(result.value)
    }
    const readNotifications = async () => {
      const result = await api.notifications.enabled()
      if (result.ok) setNotifications(result.value)
    }
    void readBoss()
    void readNotifications()
    const offs = [
      api.profile.onChanged(() => void readBoss()),
      api.notifications.onChanged(() => void readNotifications()),
    ]
    return () => {
      for (const off of offs) off()
    }
  }, [])

  return boss && notifications !== null ? { boss, notifications } : null
}

/** Every Company the boss runs, for Your Companies. Empty until the Launcher answers. */
function useCompanySummaries(): CompanySummary[] {
  const [summaries, setSummaries] = useState<CompanySummary[]>([])
  useEffect(() => {
    const read = async () => setSummaries(await api.launcher.summaries())
    void read()
    const offs = [api.company.onChanged(() => void read()), api.staff.onChanged(() => void read())]
    return () => {
      for (const off of offs) off()
    }
  }, [])
  return summaries
}

export interface ProfileFormProps {
  saved: SavedProfile
  company: Company
  companies: CompanySummary[]
  onNavigate(route: Route): void
  onOpenCompany(id: string): void
  /** The clock the status durations are measured from. Defaults to now, frozen for the page's life. */
  now?: number
}

/** The page over what the engine gave it: pure, so every card renders without the engine. */
export function ProfileForm({ saved, company, companies, onNavigate, onOpenCompany, now }: ProfileFormProps) {
  const [clock] = useState(() => now ?? Date.now())
  // Whose CLI owns the email: the Provider a new Employee would start on, which on a Mac with one
  // product installed is that product and never the catalogue's first by habit (T169).
  const primary = useDefaultProvider()
  const [draft, setDraft] = useState(() => profileDraft(saved, clock))
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  // A profile saved elsewhere (another window, Company settings) replaces the fields nobody is editing.
  const next = profileDraft(saved, clock)
  const nextKey = JSON.stringify(next)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `nextKey` stands for `next`, which is rebuilt on every render, per the comment below.
  useEffect(() => {
    setDraft((current) => {
      const changed = (Object.keys(next) as ProfileField[]).filter((field) => next[field] !== current[field])
      return changed.length ? { ...current, ...Object.fromEntries(changed.map((f) => [f, next[f]])) } : current
    })
    // `nextKey` stands for `next`, which is rebuilt on every render.
  }, [nextKey])

  const problems = profileProblems(draft)
  const dirty = hasProfileChanges(saved, draft, clock)
  const valid = Object.keys(problems).length === 0

  function set<F extends ProfileField>(field: F, value: ProfileDraft[F]) {
    setDraft((d) => ({ ...d, [field]: value }))
  }

  async function save() {
    if (!dirty || !valid || saving) return
    const changes = profileChanges(saved, draft, clock)
    setSaving(true)
    const results = await Promise.all([
      Object.keys(changes.profile).length ? api.profile.update(changes.profile) : null,
      changes.notifications !== undefined ? api.notifications.setEnabled(changes.notifications) : null,
    ])
    setSaving(false)
    setErrors(results.flatMap((result) => (result && !result.ok ? [result.error] : [])))
  }

  function discard() {
    setDraft(profileDraft(saved, clock))
    setErrors([])
  }

  const handle = previewHandle(draft)

  return (
    <>
      <ViewHeader title="Your profile" subtitle={PAGE_SUBTITLE}>
        <Button variant="ghost" size="toolbar" disabled={!dirty || saving} onClick={discard}>
          Discard
        </Button>
        <Button icon={Check} disabled={!dirty || !valid || saving} onClick={() => void save()}>
          Save changes
        </Button>
      </ViewHeader>
      <form
        className={CONTENT}
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <button type="submit" hidden />
        {errors.length > 0 && (
          <div className="flex flex-col gap-8">
            {errors.map((error) => (
              <Alert key={error} variant="error" title={error} onClose={() => setErrors([])} />
            ))}
          </div>
        )}
        <div className={cx(COLUMN, 'gap-20')}>
          <section className={cx(CARD, IDENTITY)} aria-label="Identity">
            <div className="flex items-start gap-18">
              <div className="flex h-196 w-104 shrink-0 items-center justify-center rounded-sm bg-muted">
                {/* The sprite fills its tile: the sheet's own cell carries the padding around it. */}
                <CharacterPortrait
                  sprite={draft.sprite}
                  className="h-196 [image-rendering:pixelated]"
                  fallback={
                    // 28px is no step of the scale: this stands in only while the sheet decodes.
                    <span className="font-bold text-[28px] text-muted-foreground">{saved.boss.initials}</span>
                  }
                />
              </div>
              <div className="flex min-w-0 flex-1 basis-0 flex-col gap-12">
                <div className="flex items-center gap-9">
                  <h2 className="m-0 font-bold text-20/normal text-foreground tracking-[-0.4px]">
                    {draft.name.trim() || saved.boss.name}
                  </h2>
                  <span className={CHIP}>
                    <span className="h-6 w-6 rounded-full bg-brand-text-muted" aria-hidden />
                    Boss · Owner
                  </span>
                  <span className="ml-auto whitespace-nowrap text-11/normal text-muted-foreground">
                    {runningSince(company, clock)}
                  </span>
                </div>
                <div className="flex gap-12">
                  <InputGroup
                    className={FIELD}
                    label="Display name"
                    value={draft.name}
                    error={problems.name !== undefined}
                    helper={problems.name}
                    onChange={(event) => set('name', event.target.value)}
                  />
                  <InputGroup
                    className={FIELD}
                    label="Handle"
                    value={`@${draft.handle}`}
                    error={problems.handle !== undefined}
                    helper={problems.handle}
                    onChange={(event) => set('handle', handleInput(event.target.value))}
                  />
                </div>
                <InputGroup
                  className={cx(FIELD, LOCKED)}
                  label="Account email"
                  icon={Mail}
                  value={accountLine(saved.boss.email)}
                  readOnly
                  helper={<Lock size={12} aria-label={`The ${PROVIDER_LABEL[primary]} CLI owns this`} />}
                  onChange={() => {}}
                />
                <p className="m-0 text-11-5 text-muted-foreground">{handleNote(handle)}</p>
              </div>
            </div>
            <div className="h-1 w-full bg-border" />
            <div className={CARD_HEAD_INLINE}>
              <h3 className={CARD_TITLE_SMALL}>Your sprite</h3>
              <p className={CARD_SUB}>This is you at your desk in the office.</p>
            </div>
            <SpritePicker
              value={draft.sprite}
              initials={saved.boss.initials}
              onPick={(sprite) => set('sprite', sprite)}
            />
          </section>

          <section className={CARD} aria-label="Status">
            <div className={CARD_HEAD}>
              <h3 className={CARD_TITLE}>Status</h3>
              <p className={CARD_SUB}>What the team can do when they need you.</p>
            </div>
            <div className="flex flex-col gap-8" role="radiogroup" aria-label="Status">
              {BOSS_STATUSES.map((status) => (
                <label
                  key={status}
                  className={cx(STATUS, draft.status === status ? STATUS_ON : 'border-border')}
                  data-status={status}
                >
                  <input
                    type="radio"
                    name="boss-status"
                    className={STATUS_INPUT}
                    value={status}
                    checked={draft.status === status}
                    onChange={(event) => isBossStatus(event.target.value) && set('status', event.target.value)}
                  />
                  {/* The frame marks the choice with a check in a ring, not the kit's filled radio. */}
                  {draft.status === status ? (
                    <CircleCheck className={cx(MARK, 'text-foreground')} size={16} aria-hidden />
                  ) : (
                    <Circle className={cx(MARK, 'text-muted-foreground')} size={16} aria-hidden />
                  )}
                  <span className="flex min-w-0 flex-1 basis-0 flex-col gap-2">
                    <span className="flex items-center gap-8 font-bold text-13/16 text-foreground">
                      <span className={cx(STATUS_DOT, STATUS_TONE[status])} aria-hidden />
                      {BOSS_STATUS_LABEL[status]}
                    </span>
                    <span className="text-11-5 text-muted-foreground">{BOSS_STATUS_DESCRIPTION[status]}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="flex items-center gap-10 text-muted-foreground">
              <Timer size={14} aria-hidden />
              <span className={cx(SOFT_INK, 'text-12-5/normal')}>Clear this status</span>
              <Select
                className={cx('ml-auto shrink-0 grow-0 basis-auto', BARE)}
                label={null}
                aria-label="Clear this status"
                value={draft.duration}
                options={STATUS_DURATIONS.map((duration) => ({ value: duration.value, label: duration.label }))}
                onChange={(event) => isStatusDuration(event.target.value) && set('duration', event.target.value)}
              />
            </div>
          </section>

          <div className="flex-auto" />
          {signingOut && (
            <Alert variant="info" title="Sign out" onClose={() => setSigningOut(false)}>
              {SIGN_OUT_NOTE}
            </Alert>
          )}
          <VersionRow onSignOut={() => setSigningOut(true)} />
        </div>

        {/* The right column is fixed at the design's 400px; the left takes the rest. */}
        <div className={cx(COLUMN, 'w-400 shrink-0 grow-0 basis-400 gap-12')}>
          <ProvidersCard />
          {/* Where the team runs on this PC, and what the right button does (T249, frame `t1VDYQ`).
              Windows only: a Mac has one place a CLI can be and no Git Bash question. */}
          <OnThisPc boss={saved.boss} />
          <section className={SIDE_CARD} aria-label={`Notifications on ${machineWordsHere().machine}`}>
            <div className={CARD_HEAD}>
              <h3 className={CARD_TITLE}>Notifications on {machineWordsHere().machine}</h3>
            </div>
            <div className={TOGGLE_ROW}>
              <span className={cx(SOFT_INK, 'text-12-5/normal')}>Show notifications</span>
              <Toggle
                label={null}
                aria-label="Show notifications"
                checked={draft.notifications}
                onChange={(event) => set('notifications', event.target.checked)}
              />
            </div>
            <div className={TOGGLE_ROW}>
              <span className={cx(SOFT_INK, 'text-12-5/normal')}>Play a sound</span>
              <Toggle
                label={null}
                aria-label="Play a sound"
                checked={draft.sound}
                onChange={(event) => set('sound', event.target.checked)}
              />
            </div>
            <button type="button" className={LINK} onClick={() => onNavigate({ view: 'settings' })}>
              <Settings size={14} aria-hidden />
              <span data-ui="Link Label" className={cx(SOFT_INK, 'flex-1 basis-0 text-11-5')}>
                Per-Company toggles live in Company settings
              </span>
              <ArrowRight size={14} aria-hidden />
            </button>
          </section>

          {/* The Companies sit closer than the column's other cards: a 36px row every 39px. */}
          <section className={COMPANIES_CARD} aria-label="Your Companies">
            <div className={CARD_HEAD}>
              <h3 className={CARD_TITLE}>Your Companies</h3>
            </div>
            {companies.map((summary) => (
              <button
                key={summary.id}
                type="button"
                className={cx(COMPANY, summary.current ? 'bg-muted' : 'bg-transparent')}
                aria-current={summary.current ? 'true' : undefined}
                onClick={() => summary.current || onOpenCompany(summary.id)}
              >
                <span className={COMPANY_MARK} aria-hidden>
                  {initialsOf(summary.name)}
                </span>
                <span className="flex min-w-0 flex-1 basis-0 flex-col gap-1">
                  <span data-ui="Company Name" className={COMPANY_NAME}>
                    {summary.name}
                  </span>
                  <span data-ui="Company Meta" className={COMPANY_META}>
                    {companyMeta(summary)}
                  </span>
                </span>
                {summary.current && <span className="font-bold text-10-5/normal text-muted-foreground">Open</span>}
                <ChevronRight size={15} aria-hidden />
              </button>
            ))}
          </section>
        </div>
      </form>
    </>
  )
}

/**
 * Your profile's On this PC card, over what the machine answered — everywhere, with the Windows
 * rows drawn on Windows and the right-click row drawn on every desktop. Never before the machine
 * has answered: a card saying *no distros* while the answer was still crossing the bridge would be
 * a card that lied for a frame.
 */
function OnThisPc({ boss }: { boss: Boss }) {
  const { machine } = useWindowsMachine()
  if (!machine) return null
  return <OnThisPcCard machine={machine} boss={boss} onSave={(update) => void api.profile.update(update)} />
}

/** The six characters as selectable tiles; the chosen one keeps the outline. */
export function SpritePicker(props: { value: number; initials: string; onPick(sprite: number): void }) {
  const name = useId()
  const picked = useRef<HTMLLabelElement>(null)
  // However many characters the sheet grows to, the strip scrolls and the chosen one is in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the picked character changing is what scrolls the strip; the effect reads the ref.
  useEffect(() => {
    picked.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [props.value])
  return (
    <div className={SPRITES} role="radiogroup" aria-label="Your sprite">
      {Array.from({ length: CHARACTER_SHEETS }, (_, sprite) => (
        <label
          key={sprite}
          className={cx(SPRITE, props.value === sprite ? SPRITE_ON : SPRITE_OFF)}
          ref={props.value === sprite ? picked : undefined}
        >
          <input
            type="radio"
            data-slot="choice-input"
            className={CHOICE_INPUT}
            name={name}
            aria-label={`Character ${sprite + 1}`}
            checked={props.value === sprite}
            onChange={() => props.onPick(sprite)}
          />
          <CharacterPortrait
            sprite={sprite}
            className="h-88 [image-rendering:pixelated]"
            fallback={
              <span className="self-center font-bold text-13/normal text-muted-foreground">{props.initials}</span>
            }
          />
        </label>
      ))}
    </div>
  )
}

/* The page's own frame (frame `Oykzs`), as utilities (T210f). */
const VIEW = 'flex flex-col bg-background font-sans leading-normal'

const CONTENT = 'm-0 flex items-start gap-20 p-24'

/*
 * A column of cards. The gap is the caller's, not the column's: two `gap-*` utilities on one
 * element are settled by the order Tailwind emitted them in, not by the order they are written.
 */
const COLUMN = 'flex min-w-0 flex-1 basis-0 flex-col'

const CHIP =
  'inline-flex items-center gap-6 whitespace-nowrap rounded-full bg-secondary px-9 py-3 font-semibold text-11/normal text-[#cbd5e1]'

const FIELD = 'min-w-0 flex-1 basis-0'

/**
 * The account email is the CLI's to change: it reads as text, with the lock in the helper slot —
 * sitting in the control's own right edge, over the helper line it would otherwise take.
 */
const LOCKED =
  'relative [&_[data-slot=field-input]]:text-muted-foreground [&_[data-slot=field-helper]]:pointer-events-none [&_[data-slot=field-helper]]:absolute [&_[data-slot=field-helper]]:right-12 [&_[data-slot=field-helper]]:bottom-0 [&_[data-slot=field-helper]]:flex [&_[data-slot=field-helper]]:h-34 [&_[data-slot=field-helper]]:items-center [&_[data-slot=field-helper]]:text-muted-foreground'

/** `Clear this status` is the frame's compact select: 27px tall, 12px text, a 13px chevron. */
const BARE =
  '[&_[data-slot=field-control]]:gap-8 [&_[data-slot=field-control]]:p-[5px_9px] [&_[data-slot=field-control]:focus-within]:p-[4px_8px] [&_[data-slot=field-input]]:text-12/normal [&_[data-slot=field-chevron]]:h-13 [&_[data-slot=field-chevron]]:w-13'

/** One status: the frame's 11px 12px padding, less the stroke it draws inside. */
const STATUS = 'flex cursor-pointer items-center gap-11 rounded-sm border px-11 py-10'

const STATUS_ON = 'border-[#475569] bg-card'

/**
 * The real radio, out of flow: `.choice-input` would do, but this one is read by the mark beside
 * it — `:focus-visible + …` is what draws the ring, and that needs the control to be its sibling.
 */
const STATUS_INPUT = 'absolute h-1 w-1 opacity-0'

/**
 * The frame marks the choice with a check in a ring, not the kit's filled radio — and the ring a
 * focused control would have worn is drawn on the mark, which is the control's own next sibling.
 */
const MARK = 'shrink-0 rounded-full [:focus-visible+&]:shadow-focus'

const STATUS_DOT = 'h-7 w-7 rounded-full'

/** Every status, so the dot never carries two fills in one layer. */
const STATUS_TONE: Record<(typeof BOSS_STATUSES)[number], string> = {
  available: 'bg-brand-success',
  focused: 'bg-brand-warning',
  away: 'bg-brand-text-muted',
}

const TOGGLE_ROW = 'flex items-center gap-10 [&_[data-slot=choice]]:ml-auto'

/**
 * A row that goes somewhere. A `button` inherits neither the face nor the size, so both are said
 * here: without them the rows are as tall as the platform's own font. The frame's 23px row is the
 * label's line box with 3px around it, not the kit's roomier one.
 */
const ROW =
  'flex w-full cursor-pointer items-center rounded-sm border-none text-left font-sans text-muted-foreground hover:bg-secondary focus-visible:shadow-focus focus-visible:outline-none'

const LINK = cx(ROW, 'gap-9 bg-muted px-11 py-3')

const COMPANY = cx(ROW, 'gap-10 px-9 py-2')

const COMPANY_MARK =
  'flex h-24 w-24 shrink-0 items-center justify-center rounded-sm bg-secondary font-bold text-10/normal text-[#cbd5e1]'

const COMPANY_NAME = 'truncate font-semibold text-12-5/16 text-foreground'

const COMPANY_META = 'text-11/15 text-muted-foreground'

/** The sheet can grow past what the card fits, so the strip scrolls instead of squeezing. */
const SPRITES = 'flex w-full gap-10 overflow-x-auto [scroll-snap-type:x_proximity] [scrollbar-width:thin]'

/** Six tiles fill the row, as in the frame; any past the sixth scroll in. */
const SPRITE =
  'flex h-88 shrink-0 grow-0 basis-[calc((100%-5*10px)/6)] cursor-pointer items-end justify-center rounded-sm border p-0 [scroll-snap-align:start] hover:border-[#475569] has-[>_[data-slot=choice-input]:focus-visible]:shadow-focus has-[>_[data-slot=choice-input]:focus-visible]:outline-none'

const SPRITE_ON = 'border-[#475569] bg-secondary'

const SPRITE_OFF = 'border-border bg-card'
