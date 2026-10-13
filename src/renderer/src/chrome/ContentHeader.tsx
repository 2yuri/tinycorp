import { createContext, type ReactNode, useCallback, useContext, useLayoutEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  HEADER_ACTIONS,
  HEADER_INFO,
  HEADER_SPACER,
  HEADER_SUBTITLE,
  HEADER_TITLE,
  HEADER_TITLE_ROW,
  SHELL_HEADER,
} from './chrome-style'
import '../ui/tailwind.css'

interface HeaderSlots {
  info: HTMLElement | null
  actions: HTMLElement | null
  /** How many mounted views replace the default title and subtitle. */
  claim(): () => void
}

const Slots = createContext<HeaderSlots | null>(null)

/**
 * The 64px header above every view: title and subtitle on the left, the view's actions on the right.
 * `title` and `subtitle` are the defaults; a view replaces them with `<ViewHeader>`.
 */
export function ContentHeader(props: { title: string; subtitle?: string; children: ReactNode }) {
  const [info, setInfo] = useState<HTMLElement | null>(null)
  const [actions, setActions] = useState<HTMLElement | null>(null)
  const [claims, setClaims] = useState(0)
  const claim = useCallback(() => {
    setClaims((n) => n + 1)
    return () => setClaims((n) => n - 1)
  }, [])
  // The header re-renders whenever its title moves, which is on every engine change event. A fresh
  // object here would re-render every `<ViewHeader>` in the open view with it (T211).
  const slots = useMemo<HeaderSlots>(() => ({ info, actions, claim }), [info, actions, claim])

  return (
    <Slots.Provider value={slots}>
      <header className={SHELL_HEADER} data-ui="Content Header">
        <div className={HEADER_INFO} ref={setInfo}>
          {claims === 0 && <HeaderInfo title={props.title} subtitle={props.subtitle} />}
        </div>
        <div className={HEADER_SPACER} />
        <div data-ui="View Actions" className={HEADER_ACTIONS} ref={setActions} />
      </header>
      {props.children}
    </Slots.Provider>
  )
}

function HeaderInfo(props: { title: ReactNode; badge?: ReactNode; subtitle?: ReactNode }) {
  return (
    <>
      <div className={HEADER_TITLE_ROW}>
        <h1 data-ui="View Title" className={HEADER_TITLE}>
          {props.title}
        </h1>
        {props.badge}
      </div>
      {props.subtitle !== undefined && (
        <div data-ui="View Subtitle" className={HEADER_SUBTITLE}>
          {props.subtitle}
        </div>
      )}
    </>
  )
}

/**
 * Rendered anywhere inside a view: fills the content header.
 * With `title`, replaces the default title (and subtitle); `children` go to the right-side action slot.
 */
export function ViewHeader(props: {
  title?: ReactNode
  badge?: ReactNode
  subtitle?: ReactNode
  children?: ReactNode
}) {
  const slots = useContext(Slots)
  const replaces = props.title !== undefined
  const claim = slots?.claim
  useLayoutEffect(() => (replaces && claim ? claim() : undefined), [replaces, claim])
  if (!slots) return null
  return (
    <>
      {replaces &&
        slots.info &&
        createPortal(<HeaderInfo title={props.title} badge={props.badge} subtitle={props.subtitle} />, slots.info)}
      {props.children !== undefined && slots.actions && createPortal(props.children, slots.actions)}
    </>
  )
}
