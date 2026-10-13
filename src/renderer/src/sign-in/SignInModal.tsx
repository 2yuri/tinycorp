import { Check, CircleCheck, LoaderCircle, X } from 'lucide-react'
import { type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { PROVIDER_CATALOGUE, type ProviderEntry, type SignInStep } from '../../../shared/domain/providers'
import {
  SIGN_IN_WAITING,
  type SignInRequest,
  type SignInState,
  type SignInView,
  signedInLine,
} from '../../../shared/usage/sign-in'
import { PtyScreen } from '../terminal'
import { Button, cx, IconButton, ProviderMark } from '../ui'
import { onOpenSignIn } from './open-sign-in'
import { type StepMark, stepMarks } from './sign-in-model'
import '../ui/tailwind.css'

const api = window.tinyCorp.signIn

/*
 * Frames `Tmldc` (in progress) and `iA8Wm` (signed in): a 780px modal over the window, the
 * Provider's head, the steps on the left and the product's own terminal on the right, and a footer
 * that says what TinyCorp is waiting for or who signed in.
 */
const BACKDROP =
  'fixed inset-x-0 top-44 bottom-0 z-40 flex items-center justify-center bg-scrim p-24 font-sans leading-[normal]'
/* Pen draws every stroke here inside its box, so each is an inset ring and costs no padding. */
const MODAL = 'flex max-h-full w-780 max-w-full flex-col rounded-md bg-card shadow-modal inset-ring-1 inset-ring-border'
const HEAD = 'flex items-center gap-12 border-border border-b px-20 py-16'
/* Every line box is the frame's own: `normal` is a fraction over it, and the rows below ride it. */
const TITLE = 'm-0 font-bold text-15/18 text-foreground'
const SUB = 'm-0 text-12/15 text-muted-foreground'
const BODY = 'flex min-h-0 gap-16 p-20'
const STEPS = 'flex w-250 shrink-0 flex-col gap-4'
const STEP = 'flex gap-10 rounded-sm px-10 py-8 inset-ring-1 inset-ring-transparent'
const STEP_CURRENT = 'bg-primary-subtle inset-ring-primary'
const MARK = 'flex h-20 w-20 shrink-0 items-center justify-center rounded-full font-bold text-11/13'
const MARK_TONE: Record<StepMark, string> = {
  done: 'bg-status-success text-status-success-foreground',
  current: 'bg-primary text-primary-foreground',
  todo: 'bg-secondary text-muted-foreground',
}
const STEP_TITLE = 'm-0 font-semibold text-12-5/15'
/* 11px at 1.4, which Pen rounds to a 15px line: two lines are the frame's 30, not 31. */
const STEP_TEXT = 'flex min-w-0 flex-col gap-2'
const STEP_DETAIL = 'm-0 text-11/15 text-muted-foreground'
const NOTE = 'm-0 text-11/15 text-muted-foreground'
/* The frame's own ground and ink for the terminal, a shade apart from the app's `--terminal`. */
const TERMINAL_INK = 'bg-[#0b1220] text-[#cbd5e1]'
const TERMINAL = cx(
  'flex h-300 min-w-0 flex-1 flex-col rounded-sm px-14 py-12 inset-ring-1 inset-ring-border',
  TERMINAL_INK,
)
const FOOT = 'flex items-center gap-10 border-border border-t px-20 py-14'
const STATUS = 'm-0 text-12-5/15'

export interface SignInModalBodyProps {
  entry: ProviderEntry
  /** `Personal · runs in WSL · archlinux`, or nothing until the terminal has started. */
  sub: string | null
  state: SignInState
  /** The step the terminal was on when it last said, for a sign-in that ended. */
  lastStep: number
  /** The terminal itself; a capture draws its own. */
  terminal: ReactNode
  onCancel(): void
  onDone(): void
}

/** The modal's card over its parts: pure, so both frames render without a PTY or a backdrop. */
export function SignInModalBody({ entry, sub, state, lastStep, terminal, onCancel, onDone }: SignInModalBodyProps) {
  const flow = entry.auth.signIn
  const marks = stepMarks(flow.steps, state, lastStep)
  const title = `Sign in to ${entry.name}`
  return (
    <section role="dialog" aria-modal="true" aria-label={title} className={MODAL} data-ui="Sign In">
      <header className={HEAD}>
        <ProviderMark provider={entry.id} size={22} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h2 className={TITLE}>{title}</h2>
          {sub && <p className={SUB}>{sub}</p>}
        </div>
        <IconButton icon={X} iconSize={17} size="sm" label="Close" className="-mr-7" onClick={onCancel} />
      </header>
      <div className={BODY}>
        <div className={STEPS}>
          <ol className="m-0 flex list-none flex-col gap-4 p-0">
            {flow.steps.map((step, index) => (
              <StepRow key={step.title} step={step} number={index + 1} mark={marks[index]!} />
            ))}
          </ol>
          {flow.trustNote && <p className={NOTE}>{flow.trustNote}</p>}
        </div>
        <div className={TERMINAL}>{terminal}</div>
      </div>
      <footer className={FOOT}>
        <Status state={state} />
        <span className="flex-1" aria-hidden />
        {state.phase === 'signed-in' ? (
          <Button icon={Check} onClick={onDone}>
            Done
          </Button>
        ) : (
          <Button variant="ghost" onClick={onCancel}>
            {state.phase === 'ended' ? 'Close' : 'Cancel'}
          </Button>
        )}
      </footer>
    </section>
  )
}

function StepRow({ step, number, mark }: { step: SignInStep; number: number; mark: StepMark }) {
  return (
    <li className={cx(STEP, mark === 'current' && STEP_CURRENT)} data-mark={mark} aria-current={mark === 'current'}>
      <span className={cx(MARK, MARK_TONE[mark])} aria-hidden>
        {mark === 'done' ? <Check size={12} /> : number}
      </span>
      <span className={STEP_TEXT}>
        <span className={cx(STEP_TITLE, mark === 'todo' ? 'text-muted-foreground' : 'text-foreground')}>
          {step.title}
        </span>
        {step.detail && <span className={STEP_DETAIL}>{step.detail}</span>}
      </span>
    </li>
  )
}

function Status({ state }: { state: SignInState }) {
  if (state.phase === 'signed-in') {
    return (
      <>
        <CircleCheck size={16} className="text-status-success-foreground" aria-hidden />
        <p className={cx(STATUS, 'font-semibold text-foreground')} role="status">
          {signedInLine(state.who)}
        </p>
      </>
    )
  }
  if (state.phase === 'ended') {
    return (
      <p className={cx(STATUS, 'text-muted-foreground')} role="status">
        {state.reason}
      </p>
    )
  }
  return (
    <>
      <LoaderCircle size={15} className="animate-spin text-muted-foreground" aria-hidden />
      <p className={cx(STATUS, 'text-muted-foreground')} role="status">
        {SIGN_IN_WAITING}
      </p>
    </>
  )
}

interface Open {
  request: SignInRequest
  view: SignInView | null
  state: SignInState
  lastStep: number
}

/**
 * The one sign-in modal of this window (T263): opened by {@link openSignIn} from any screen, it
 * starts the product's own login in the main process and draws its terminal. Closing it — Cancel,
 * the ×, or Done — kills the terminal; a login the product already wrote stays written.
 */
export function SignInHost() {
  const [open, setOpen] = useState<Open | null>(null)
  const current = useRef<Open | null>(null)
  current.current = open
  // The request the modal is open on, set the moment it opens or closes rather than at the next
  // render: the terminal's id can come back before React has drawn the modal at all.
  const wanted = useRef<SignInRequest | null>(null)
  // What each terminal printed, kept from its first byte so the screen can replay what came before it.
  const printed = useRef(new Map<string, string[]>())
  const writers = useRef(new Map<string, (data: string) => void>())

  useEffect(
    () =>
      api.onData((id, data) => {
        const chunks = printed.current.get(id) ?? []
        chunks.push(data)
        printed.current.set(id, chunks)
        writers.current.get(id)?.(data)
      }),
    [],
  )

  useEffect(
    () =>
      api.onState((id, state) =>
        setOpen((was) =>
          was?.view?.id === id
            ? { ...was, state, lastStep: state.phase === 'waiting' ? state.step : was.lastStep }
            : was,
        ),
      ),
    [],
  )

  useEffect(
    () =>
      onOpenSignIn((request) => {
        const was = current.current
        if (was?.view) void api.cancel(was.view.id)
        wanted.current = request
        setOpen({ request, view: null, state: { phase: 'waiting', step: 0 }, lastStep: 0 })
        void api.start(request).then((result) => {
          const still = wanted.current === request
          if (!result.ok) {
            if (still) setOpen((now) => now && { ...now, state: { phase: 'ended', reason: result.error } })
            return
          }
          // Closed while it was starting: the terminal nobody is looking at goes at once.
          if (!still) return void api.cancel(result.value.id)
          setOpen((now) => now && { ...now, view: result.value, state: result.value.state })
        })
      }),
    [],
  )

  const close = useCallback(() => {
    const view = current.current?.view
    if (view) {
      void api.cancel(view.id)
      printed.current.delete(view.id)
    }
    wanted.current = null
    setOpen(null)
  }, [])

  const id = open?.view?.id ?? null
  const subscribe = useCallback(
    (write: (data: string) => void) => {
      if (!id) return () => {}
      for (const chunk of printed.current.get(id) ?? []) write(chunk)
      writers.current.set(id, write)
      return () => writers.current.delete(id)
    },
    [id],
  )

  if (!open) return null
  const entry = PROVIDER_CATALOGUE.find((one) => one.id === open.request.provider)
  if (!entry) return null
  return (
    <div className={BACKDROP}>
      <SignInModalBody
        entry={entry}
        sub={open.view?.sub ?? null}
        state={open.state}
        lastStep={open.lastStep}
        terminal={
          id && (
            <Suspense fallback={null}>
              <PtyScreen
                subscribe={subscribe}
                className={TERMINAL_INK}
                onInput={(data) => void api.write(id, data)}
                onResize={(cols, rows) => void api.resize(id, cols, rows)}
              />
            </Suspense>
          )
        }
        onCancel={close}
        onDone={close}
      />
    </div>
  )
}
