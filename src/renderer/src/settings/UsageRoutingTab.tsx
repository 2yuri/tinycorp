import { ArrowLeftRight, Coffee, Pin, Shuffle, Undo2 } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import type { ProviderOutage } from '../../../shared/capacity'
import { PROVIDERS, type Provider } from '../../../shared/domain/providers'
import { clockTime } from '../../../shared/platform/clock-time'
import { accountPercent } from '../../../shared/usage/provider-accounts'
import { type UsageSnapshot, usageLevel } from '../../../shared/usage/provider-usage'
import { movesBack, ROTATION_WARNING } from '../../../shared/usage/usage-routing'
import { ModelPicker } from '../model-picker'
import { useEveryProvider } from '../preflight'
import { useRoutingSettings } from '../routing'
import {
  Alert,
  Avatar,
  Button,
  Checkbox,
  cx,
  Progress,
  SegmentedControl,
  SettingsCard,
  SettingsRow,
  Toggle,
} from '../ui'
import {
  accountMeter,
  accountName,
  accountRows,
  accountsLabel,
  accountsSub,
  moveBackLabel,
  overrideLines,
  pinTitle,
  rotationSub,
  ruleInForce,
  ruleOf,
  runsOutSub,
  shortName,
  whenOutLabel,
} from './routing-model'
import '../ui/tailwind.css'
import { COLUMN, DIVIDER, ERRORS, FULL_ROW, LABEL } from './settings-classes'

/*
 * Usage & routing (design frame `bB6VX`): two columns of cards, like the other settings tabs. The
 * padding is the settings container's and this tab adds none of its own (T181) — two paddings drew
 * the cards 46px in from the window where the frame has 22.
 */
const CONTENT =
  'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-16 [@media(max-width:1100px)]:grid-cols-[minmax(0,1fr)]'

/** One Provider's block. Its parts sit at the card's own 14px, as the frame stacks them. */
const PROVIDER = 'flex flex-col gap-14'

/** A label and what it labels, 6px apart — the frame's `WHEN … IS OUT`, `CONTINUE ON`, `PIN`. */
const FIELD = 'flex flex-col gap-6'

/** A Provider's sign-ins sit 10px under their heading, where every other label keeps 6 (`MmGYv`). */
const FIELD_ACCOUNTS = 'flex flex-col gap-10'

/** The two-way choice of the frame: 32px of track, one filled option, one quiet one. */
const CHOICE = 'grid grid-cols-2 gap-3 rounded-sm border border-border bg-muted p-3'

/** 32px of track: a 1px stroke, 3px of padding, the option, 3px, 1px — the frame's `pEeli`. */
const OPTION =
  'flex h-24 cursor-pointer items-center justify-center gap-6 rounded-sm border-0 p-0 px-10 text-12/[inherit]'
const OPTION_OFF = 'bg-transparent text-muted-foreground'
const OPTION_ON = 'bg-primary text-primary-foreground'

/** The kit's control on this frame's own track (T213). */
const CHOICE_CLASSES = { track: CHOICE, option: OPTION, on: OPTION_ON, off: OPTION_OFF }

/** The frame's 11.5px body line, the same one a card's sub is set on. */
const NOTE = 'm-0 text-11-5/17 text-muted-foreground'

/** An Employee that does not follow the Company rule: face, name, rule, undo. */
const OVERRIDE =
  'grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-10 [&_[data-slot=button]]:gap-6 [&_[data-slot=button]]:px-10 [&_[data-slot=button]]:py-5 [&_[data-slot=button]]:text-12/[inherit]'
const OVERRIDE_NAME = 'text-13/[inherit] font-semibold'
const OVERRIDE_SUMMARY = 'text-12/[inherit] text-muted-foreground'

/** The heading of one Provider's sign-ins, with the rule in force at the other end (`pNdrM`). */
const ACCOUNTS_HEAD = 'flex items-center justify-between gap-8'

/** 14, the box `bB6VX` draws the head in; on the font's own the whole block is a pixel taller. */
export const RULE = 'flex min-w-0 items-center gap-5 text-11-5/14 text-muted-foreground [&_svg]:shrink-0'
const RULE_TEXT = 'overflow-hidden text-ellipsis whitespace-nowrap'

const ACCOUNTS = 'flex flex-col gap-10'

/*
 * The last column is the pin's 28px square, kept even by a row that draws no pin: the frame gives
 * a Provider with one sign-in an empty slot rather than letting its meter slide to the card's edge.
 */
const ACCOUNT = 'grid grid-cols-[auto_minmax(0,1fr)_150px_28px] items-center gap-10'
const ACCOUNT_WHO = 'flex min-w-0 flex-col gap-2'
const ACCOUNT_LABEL = 'text-13/17 font-semibold'

/** 17 + 2 + 14 is the frame's 33px row; on the font's own line both are 2px short (T196). */
const ACCOUNT_EMAIL = 'overflow-hidden text-ellipsis whitespace-nowrap font-code text-11/14 text-muted-foreground'

/** Every account carries one: a 150x6 track and the line under it, warming as the window fills. */
const METER =
  'flex w-150 flex-col items-start gap-4 [&_[data-slot=progress]]:w-150 [&_[data-slot=progress-track]]:h-6 [&_[data-slot=progress-bar]]:bg-brand-primary data-[level=high]:[&_[data-slot=progress-bar]]:bg-brand-warning data-[level=full]:[&_[data-slot=progress-bar]]:bg-brand-danger'

/** A sign-in whose numbers TinyCorp never reads: the track is there and stays empty. */
const METER_UNREAD =
  'flex w-150 flex-col items-start gap-4 [&_[data-slot=progress]]:w-150 [&_[data-slot=progress-track]]:h-6 [&_[data-slot=progress-track]]:opacity-60 [&_[data-slot=progress-bar]]:bg-brand-primary data-[level=high]:[&_[data-slot=progress-bar]]:bg-brand-warning data-[level=full]:[&_[data-slot=progress-bar]]:bg-brand-danger'

const ACCOUNT_VALUE = 'text-11/[inherit] text-muted-foreground'

/** The pin at the end of a row: the frame's 28px square (`rVc9a`), quiet until it is on. */
const PIN =
  'flex size-28 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-muted-foreground hover:bg-muted hover:text-foreground'

/*
 * The account the whole Company is on. Lucide draws the pin as a stroke, so the pressed one is the
 * same outline filled in — the frame has no second pin glyph, and a colour alone would be a state
 * only someone who has seen the other rows can read.
 */
const PIN_ON =
  'flex size-28 cursor-pointer items-center justify-center rounded-sm border-0 bg-primary/18 p-0 text-primary [&_svg]:fill-current'

/** The warning the boss reads before rotation goes on: the frame's Alert at its own padding. */
const WARNING =
  'py-12 pr-12 pl-9 [&_[data-slot=alert-icon]]:size-16 [&_[data-slot=alert-title]]:text-13/[inherit] [&_[data-slot=alert-body]]:text-12/18'

const api = window.tinyCorp

/**
 * Usage & routing (frame `bB6VX`): what the Company does when a Provider runs out, which Employees
 * do not follow it, which accounts its Employees take, and whether it rotates between them.
 *
 * Every control here saves itself, like the Integrations tab: a rule the boss set and a Save they
 * forgot is a team that waited all night for nothing.
 */
export function UsageRoutingTab({
  outages,
  companyName,
}: {
  outages: readonly ProviderOutage[]
  /** Whose rules and pins these are: the frame writes the Company's own name in them. */
  companyName: string
}) {
  const settings = useRoutingSettings()
  const usage = useUsage()
  const preflight = useEveryProvider()
  const [error, setError] = useState<string | null>(null)

  if (!settings) return <div className={cx(CONTENT, FULL_ROW)} aria-busy="true" />

  const run = async (action: Promise<{ ok: boolean; error?: string }>) => {
    const result = await action
    setError(result.ok ? null : (result.error ?? 'That did not work'))
  }

  const accountsOf = (provider: Provider) =>
    accountRows(
      settings.accounts.filter((account) => account.provider === provider),
      usage,
      outages,
    )

  return (
    <div className={cx(CONTENT, FULL_ROW)} data-ui="Usage and routing">
      {error && (
        <div className={ERRORS}>
          <Alert variant="error" title={error} onClose={() => setError(null)} />
        </div>
      )}
      <div className={COLUMN}>
        <SettingsCard title="When a provider runs out" sub={runsOutSub(companyName)}>
          {PROVIDERS.map((provider, index) => {
            const rule = ruleOf(settings, provider)
            return (
              /* One rule to the next is a card row like any other, so the frame rules them apart. */
              <Fragment key={provider}>
                {index > 0 && <div className={DIVIDER} />}
                <div className={PROVIDER}>
                  <div className={FIELD}>
                    <span className={LABEL}>{whenOutLabel(provider)}</span>
                    <SegmentedControl
                      label={whenOutLabel(provider)}
                      value={rule.kind}
                      classes={CHOICE_CLASSES}
                      options={[
                        { value: 'wait', label: ' Wait for reset', icon: Coffee, iconSize: 12 },
                        {
                          value: 'continue',
                          label: ' Continue on another provider',
                          icon: ArrowLeftRight,
                          iconSize: 12,
                        },
                      ]}
                      onChange={(kind) =>
                        void run(
                          kind === 'wait'
                            ? api.routing.setRule(provider, { kind: 'wait' })
                            : api.routing.setRule(provider, {
                                kind: 'continue',
                                provider: fallbackFor(provider),
                                model: null,
                              }),
                        )
                      }
                    />
                  </div>
                  {rule.kind === 'continue' && (
                    <>
                      <div className={FIELD}>
                        <span className={LABEL}>CONTINUE ON</span>
                        <ModelPicker
                          inline
                          value={rule.model}
                          provider={rule.provider}
                          preflight={preflight}
                          onChange={(choice) =>
                            void run(
                              api.routing.setRule(provider, {
                                kind: 'continue',
                                provider: choice.provider,
                                model: choice.model,
                              }),
                            )
                          }
                        />
                        <p className={NOTE}>
                          The Employee keeps its ticket, worktree and branch, and picks up on {shortName(rule.provider)}{' '}
                          from where it stopped.
                        </p>
                      </div>
                      <SettingsRow
                        title={moveBackLabel(provider)}
                        sub="At the next turn boundary — never in the middle of an edit."
                      >
                        <Toggle
                          label={null}
                          aria-label={moveBackLabel(provider)}
                          checked={movesBack(settings.routing, provider)}
                          onChange={(event) => void run(api.routing.setMoveBack(provider, event.target.checked))}
                        />
                      </SettingsRow>
                    </>
                  )}
                </div>
              </Fragment>
            )
          })}
          <SettingsRow
            title="Resume automatically at reset"
            sub="An Employee waiting in the coffee area goes back to its desk at the reset time, without you."
          >
            <Toggle
              label={null}
              aria-label="Resume automatically at reset"
              checked={settings.routing.resumeAtReset}
              onChange={(event) => void run(api.routing.setResumeAtReset(event.target.checked))}
            />
          </SettingsRow>
        </SettingsCard>
        <SettingsCard title="Overrides" sub="Employees that do not follow the Company rule.">
          {settings.overrides.length === 0 ? (
            <p className={NOTE}>Everyone follows the Company rule.</p>
          ) : (
            overrideLines(settings).map((override) => (
              <div className={OVERRIDE} key={override.employeeId}>
                {/* The frame gives every override row the Employee's own face. */}
                <Avatar name={override.name} size={24} />
                <span className={OVERRIDE_NAME}>{override.name}</span>
                <span className={OVERRIDE_SUMMARY}>{override.summary}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Undo2}
                  onClick={() => void run(api.routing.setEmployeeRule(override.employeeId, null))}
                >
                  Use Company rule
                </Button>
              </div>
            ))
          )}
        </SettingsCard>
      </div>
      <div className={COLUMN}>
        <SettingsCard title="Accounts to use" sub={accountsSub(companyName)}>
          {PROVIDERS.map((provider) => {
            const rows = accountsOf(provider)
            const pinnedId = settings.routing.pinnedAccount[provider] ?? null
            const pinned = rows.find((row) => row.id === pinnedId) ?? null
            /*
             * A Provider that keeps one sign-in has nothing to choose between, so the frame draws
             * it neither a rule nor a pin — and the row keeps the empty 28px the others spend on
             * the button. A pin left behind by an account that has since been removed keeps both,
             * or it would be a rule in force with no way back to the first with room left.
             */
            const chooses = rows.length > 1 || pinned !== null
            return (
              <div className={PROVIDER} key={provider}>
                <div className={rows.length > 0 ? FIELD_ACCOUNTS : FIELD}>
                  <div className={ACCOUNTS_HEAD}>
                    {/* The name the frame writes over the sign-ins: the product's own, in capitals. */}
                    <span className={LABEL}>{accountsLabel(provider)}</span>
                    {/* And, on the right, what the Company actually does with them. */}
                    {chooses && (
                      <span className={RULE}>
                        {pinned ? <Pin size={12} aria-hidden /> : <Shuffle size={12} aria-hidden />}
                        <span className={RULE_TEXT}>{ruleInForce(pinned)}</span>
                      </span>
                    )}
                  </div>
                  {rows.length === 0 ? (
                    /*
                     * Two different nothings: a CLI that keeps a single sign-in has nothing to
                     * list and never will; a Company nobody has signed in for yet is one visit to
                     * Your profile away. Saying the first when it is the second is a lie the
                     * empty-Company capture caught (T181).
                     */
                    <p className={NOTE}>
                      {settings.oneAccountProviders.includes(provider)
                        ? `${shortName(provider)} keeps one sign-in.`
                        : `No sign-in yet — add one in Your profile.`}
                    </p>
                  ) : (
                    <div className={ACCOUNTS}>
                      {rows.map((row) => (
                        <div className={ACCOUNT} key={row.id}>
                          <Checkbox
                            label={null}
                            aria-label={`Use ${row.label}`}
                            checked
                            readOnly
                            title="Every sign-in TinyCorp knows about is available to this Company."
                          />
                          <span className={ACCOUNT_WHO}>
                            <span className={ACCOUNT_LABEL}>{accountName(row)}</span>
                            <span className={ACCOUNT_EMAIL}>{row.email ?? row.configDir}</span>
                          </span>
                          {/*
                           * Every account carries the frame's meter, not only the one TinyCorp
                           * reads with. The track is drawn empty and the line says why when the
                           * numbers would have to come from that sign-in's own credential, which
                           * TinyCorp never reads (decision 3) — an empty track is a fact, a
                           * percentage nobody measured would be a lie.
                           */}
                          <span
                            className={row.window === null ? METER_UNREAD : METER}
                            data-level={usageLevel(accountPercent(row) ?? 0)}
                            title={row.reason ?? undefined}
                          >
                            <Progress value={row.window?.percent ?? 0} />
                            <span className={ACCOUNT_VALUE}>
                              {accountMeter(row, (at) => clockTime(at, new Date()))}
                            </span>
                          </span>
                          {/* The pin the frame puts at the end of the row: press it and the whole
                              Company is on this sign-in, press it again and it is on none. */}
                          {chooses && (
                            <button
                              type="button"
                              className={row.id === pinnedId ? PIN_ON : PIN}
                              aria-pressed={row.id === pinnedId}
                              aria-label={`Pin ${accountName(row)}`}
                              title={pinTitle(companyName, row.id === pinnedId)}
                              onClick={() =>
                                void run(api.routing.setPinnedAccount(provider, row.id === pinnedId ? null : row.id))
                              }
                            >
                              <Pin size={14} aria-hidden />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </SettingsCard>
        <SettingsCard title="Rotation" sub="What happens when the account an Employee is on hits its limit.">
          {/* The frame rules this card's rows apart nowhere: head, the one switch, the warning. */}
          <SettingsRow
            ruled={false}
            title="Rotate between accounts of one provider"
            sub={rotationSub(settings.accounts)}
          >
            <Toggle
              label={null}
              aria-label="Rotate between accounts of one provider"
              checked={settings.routing.rotateAccounts}
              onChange={(event) => void run(api.routing.setRotateAccounts(event.target.checked))}
            />
          </SettingsRow>
          {/* The frame's own Alert, at the tighter padding and type its instance sets. */}
          <Alert className={WARNING} variant="warning" title={ROTATION_WARNING.title}>
            {ROTATION_WARNING.body}
          </Alert>
        </SettingsCard>
      </div>
    </div>
  )
}

/** The Provider a fresh `Continue on another provider` starts on: the next one in the catalogue. */
function fallbackFor(provider: Provider): Provider {
  return PROVIDERS.find((entry) => entry !== provider) ?? provider
}

/** The Providers' own numbers, for the bars. Null until the first read lands; never a zero. */
function useUsage(): UsageSnapshot | null {
  const [usage, setUsage] = useState<UsageSnapshot | null>(null)
  useEffect(() => {
    let live = true
    const read = async () => {
      const result = await api.usage.read()
      if (live && result.ok) setUsage(result.value)
    }
    void read()
    const stop = api.usage.onChanged(() => void read())
    return () => {
      live = false
      stop()
    }
  }, [])
  return usage
}
