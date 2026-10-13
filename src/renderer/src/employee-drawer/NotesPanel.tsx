import { ChevronsDownUp, ChevronsUpDown, FileText, Hourglass, NotebookPen, Plus, Sunrise } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Note, NotesNode, NotesView } from '../../../shared/memory/notes'
import { rangeLabel } from '../../../shared/memory/notes'
import { Button, EmptyState, Search } from '../ui/kit'
import { dueLine, footerLine, meterLine, meterShare, noteWhen, rangeDays } from './notes-model'
import '../ui/tailwind.css'

const api = window.tinyCorp.notes

/** One Employee's note log as the drawer holds it, with the one write the boss can make. */
export interface NotesModel extends NotesView {
  /** Whose notes these are, as the due line and the empty state name them. */
  employeeName: string
  employeeId: string
  /** The last read or write that failed, or null. */
  error: string | null
  /** False until the first read comes back, so the panel draws nothing before it knows. */
  loaded: boolean
  addNote(text: string): void
}

const EMPTY: NotesView = {
  recent: [],
  earlier: [],
  tokens: 0,
  budget: 4_000,
  notes: 0,
  summaries: 0,
  due: null,
}

/** Reads the Employee's notes again whenever `version` changes, and appends the boss's own. */
export function useNotes(employeeId: string, employeeName: string, version: unknown): NotesModel {
  const [state, setState] = useState<{ view: NotesView; error: string | null; loaded: boolean }>({
    view: EMPTY,
    error: null,
    loaded: false,
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is how the caller says the log moved on; the effect reads only the id.
  useEffect(() => {
    let live = true
    setState({ view: EMPTY, error: null, loaded: false })
    void api.view(employeeId).then((result) => {
      if (!live) return
      setState({ view: result.ok ? result.value : EMPTY, error: result.ok ? null : result.error, loaded: true })
    })
    return () => {
      live = false
    }
  }, [employeeId, version])

  return {
    ...state.view,
    employeeName,
    employeeId,
    error: state.error,
    loaded: state.loaded,
    addNote(text) {
      void api
        .addNote(employeeId, text)
        .then((result) =>
          setState((previous) =>
            result.ok
              ? { view: result.value, error: null, loaded: true }
              : { ...previous, error: result.error, loaded: true },
          ),
        )
    },
  }
}

/**
 * The drawer's Memory tab (frame `x40RJd`, T193), as utilities.
 *
 * `drawer-notes__when`, `__text`, `__node-text` and `__meter-count` stay in their lists because
 * `NotesPanel.test.tsx` and the sub-session suites read the tab through them.
 *
 * Every box here was read off the frame and the comments are its arithmetic, so they are kept where
 * they were: the negative margins that give back four of the body's own gap are the frame's spacing,
 * not a nudge.
 */

/* The frame's own box: the bar is 53 tall, a 29 search field inside 12 of padding, and its rule sits
   inside that padding rather than under it. */
const BAR = 'flex shrink-0 items-center gap-8 border-b border-border px-14 pt-12 pb-11'

/* The frame's search is 29 tall: a 13px icon and a 13px text line inside 7px of padding. */
const SEARCH =
  'min-w-0 flex-1 [&_[data-slot=field-control]]:gap-8 [&_[data-slot=field-control]]:rounded-sm [&_[data-slot=field-control]]:px-10 [&_[data-slot=field-control]]:py-7 [&_[data-slot=field-control]]:focus-within:px-10 [&_[data-slot=field-control]]:focus-within:py-7 [&_[data-slot=field-icon]]:size-13 [&_[data-slot=field-input]]:text-12/13'

const ADD = 'shrink-0 gap-8 px-10 py-6 font-semibold text-12/15 text-muted-foreground'

/*
 * The frame's Entries box: 10 between the meter, each section, the due line and the footer, and 38
 * under the footer, which is the margin it leaves above the drawer's action row. A section sets its
 * own tighter spacing below itself; everything else takes this gap as it is.
 */
const BODY = 'flex min-h-0 flex-1 flex-col gap-10 overflow-auto px-14 pt-12 pb-38'

const NONE = 'm-0 shrink-0 text-12/17 text-muted-foreground'

const RAW =
  'm-0 shrink-0 rounded-md border border-border bg-card p-12 font-code text-11-5/17 whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]'

const COUNT = 'flex-1 text-11/13 text-muted-foreground'

const RAW_TOGGLE = 'shrink-0 gap-8 px-10 py-5 font-semibold text-12/15 text-muted-foreground'

const FIELD =
  'w-full resize-y rounded-sm border border-input bg-background px-10 py-8 font-sans text-12-5/19 text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-ring'

/* The meter: what the next Session will read, against the Company's budget. 12 in the frame, where
   the stroke sits inside the box; the border gives its own width back. */
const METER = 'flex shrink-0 flex-col gap-6 rounded-md border border-border bg-card p-11'

const METER_TITLE = 'font-semibold text-12/15 text-foreground'

/*
 * `≈ 3.1k of 4k tokens` is the frame's own sentence and the frame sets it in the primary face: the
 * mono one draws a wider line and no `≈` at all, which is what the audit was reading.
 */
const METER_COUNT = 'drawer-notes__meter-count whitespace-nowrap text-11-5/14 text-muted-foreground'

/* The track is the border's ink, not the muted one — `--muted` is the card, so it drew nothing. */
const METER_BAR =
  'h-6 overflow-hidden rounded-full bg-border [&>span]:block [&>span]:h-full [&>span]:rounded-full [&>span]:bg-primary'

const METER_NOTE = 'm-0 text-11/16 text-muted-foreground'

/*
 * `RECENT · WORD FOR WORD` and its twin: a label, not a card. The frame sets it 6 above what it
 * labels and 10 under what came before, so it gives back 4 of the body's own gap.
 */
const SECTION =
  'mt-0 mr-0 mb-[-4px] ml-0 shrink-0 font-bold text-10-5/13 uppercase tracking-[0.5px] text-muted-foreground'

/*
 * One note, word for word: when on the left, the note itself on the right. The frame pads the row
 * itself rather than spacing the rows, and starts both columns at the same top — the mono `when` sits
 * in a shorter line box than the note, so a baseline puts it a pixel and a half off where the frame
 * draws it. 6 between two notes, of which each row's own padding is already 12.
 */
const ROW = 'flex shrink-0 items-start gap-10 px-2 py-6 [&+&]:mt-[-4px]'

const WHEN = 'drawer-notes__when shrink-0 grow-0 basis-74 whitespace-nowrap font-code text-11/15 text-muted-foreground'

const TEXT = 'drawer-notes__text min-w-0 flex-1 text-12-5/18 text-foreground [overflow-wrap:anywhere]'

/*
 * `From you`, which the frame draws as the primary pill of `design/html/components.html` in a box of
 * its own: the subtle fill under the info ink, never the solid primary under white.
 */
const BADGE =
  'mt-3 mr-0 mb-0 ml-0 table rounded-full bg-primary-subtle px-7 py-2 font-semibold text-12/15 text-status-info-foreground'

/* One range: the summary, and the zoom that opens it. 10 in the frame, less the border, which the
   frame draws inside the box and CSS draws outside; 6 between two, as the notes above them take. */
const NODE = 'flex shrink-0 flex-col gap-5 rounded-sm border border-border bg-card p-9 [&+&]:mt-[-4px]'

/* The range and its days are the card's quiet line: the summary under them is the loud one. */
const NODE_RANGE = 'font-code text-11/15 text-muted-foreground'

const NODE_DAYS = 'whitespace-nowrap text-11/13 text-muted-foreground'

const ZOOM = 'flex items-center justify-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground'

/* A half point under the notes above it, which is how the frame fits a summary in two lines. */
const NODE_TEXT =
  'drawer-notes__node-text m-0 text-12/17 text-foreground [overflow-wrap:anywhere] data-[empty=true]:italic data-[empty=true]:text-muted-foreground'

/* `1 summary due · Nova writes it at its next turn boundary`. Padded like a note row, and spaced by
   the body's own gap. */
const DUE = 'm-0 flex shrink-0 items-center gap-8 px-2 py-6 text-11/13 text-muted-foreground [&_svg]:text-brand-warning'

/**
 * The Memory tab (frame `x40RJd`): an Employee's notes as the next Session will read them.
 *
 * The top of it is the meter — what the wake spends of the Company's budget — because that is the
 * one number the boss can act on. Under it the newest notes word for word, then the ranges behind
 * them as summaries the boss can open, and a footer that says the thing this whole feature is
 * for: nothing here was ever deleted.
 */
export function NotesPanel({ notes, now = Date.now() }: { notes: NotesModel; now?: number }) {
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [raw, setRaw] = useState<string | null>(null)
  const due = dueLine(notes.due, notes.employeeName)

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="drawer-notes">
      <div className={BAR}>
        <Search
          size="compact"
          className={SEARCH}
          placeholder="Search every note, word for word…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button
          variant="ghost"
          size="sm"
          icon={Plus}
          className={ADD}
          aria-expanded={adding}
          onClick={() => setAdding((open) => !open)}
        >
          Add note
        </Button>
      </div>

      <div className={BODY}>
        {notes.error && (
          <p className="m-0 shrink-0 text-destructive" role="alert">
            {notes.error}
          </p>
        )}

        {adding && (
          <NoteForm
            label={`A note for ${notes.employeeName}`}
            onSave={(text) => {
              notes.addNote(text)
              setAdding(false)
            }}
            onCancel={() => setAdding(false)}
          />
        )}

        {query.trim() !== '' ? (
          <Matches employeeId={notes.employeeId} query={query} now={now} />
        ) : notes.notes === 0 ? (
          notes.loaded && !adding && <Empty />
        ) : (
          <>
            <Meter tokens={notes.tokens} budget={notes.budget} />
            <Section label="Recent · word for word" />
            {notes.recent.map((note) => (
              <Row key={note.id} note={note} now={now} />
            ))}
            {notes.earlier.length > 0 && <Section label="Earlier · summarised" />}
            {notes.earlier.map((node) => (
              <NodeCard key={rangeLabel(node.range)} employeeId={notes.employeeId} node={node} now={now} />
            ))}
            {due && (
              <p className={DUE}>
                <Hourglass size={12} aria-hidden />
                {due}
              </p>
            )}
          </>
        )}

        {raw !== null && (
          <pre className={RAW} data-testid="drawer-notes-raw">
            {raw}
          </pre>
        )}

        {/*
          The tab is the Employee's own notes and nothing else. `s7DVnA` carried a line to the
          Company's shared pages here; `x40RJd` does not, and the sidebar's own Memory row is the
          way there (T175).
        */}
        <div className="mt-auto flex shrink-0 items-center gap-8">
          <span className={COUNT}>{footerLine(notes.notes, notes.summaries)}</span>
          <Button
            variant="ghost"
            size="sm"
            icon={FileText}
            className={RAW_TOGGLE}
            aria-pressed={raw !== null}
            onClick={() => {
              if (raw !== null) {
                setRaw(null)
                return
              }
              void api.raw(notes.employeeId).then((result) => setRaw(result.ok ? result.value.text : result.error))
            }}
          >
            Raw log
          </Button>
        </div>
      </div>
    </div>
  )
}

/** `Read at session start · ≈ 3.1k of 4k tokens`, and why the number does not grow. */
function Meter({ tokens, budget }: { tokens: number; budget: number }) {
  return (
    <section className={METER}>
      <header className="flex items-center gap-8 text-muted-foreground">
        <Sunrise size={13} aria-hidden />
        <span className={METER_TITLE}>Read at session start</span>
        <span className="flex-1" />
        <span className={METER_COUNT}>{meterLine(tokens, budget)}</span>
      </header>
      <div
        className={METER_BAR}
        role="progressbar"
        aria-valuenow={tokens}
        aria-valuemin={0}
        aria-valuemax={budget}
        aria-label="Tokens read at session start"
      >
        <span style={{ width: `${meterShare(tokens, budget) * 100}%` }} />
      </div>
      <p className={METER_NOTE}>
        The same size at 50 notes or 50,000: recent ones word for word, older ones summarised.
      </p>
    </section>
  )
}

function Section({ label }: { label: string }) {
  return <h3 className={SECTION}>{label}</h3>
}

/** One note, word for word: when it was written, and a badge when the boss wrote it. */
function Row({ note, now }: { note: Note; now: number }) {
  return (
    <article className={ROW} data-by={note.by}>
      <span className={WHEN}>{noteWhen(note.at, now)}</span>
      <div className={TEXT}>
        {note.text}
        {note.by === 'boss' && <span className={BADGE}>From you</span>}
      </div>
    </article>
  )
}

/**
 * One range: its summary, and the zoom that opens it into its two halves and eventually into the
 * notes themselves. Opening is a read of its own rather than part of the view, so a drawer that is
 * never opened costs nothing to draw.
 */
function NodeCard({ employeeId, node, now }: { employeeId: string; node: NotesNode; now: number }) {
  const [open, setOpen] = useState(false)
  const [inner, setInner] = useState<{ notes: Note[]; nodes: NotesNode[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const days = rangeDays(node.from, node.to)

  function toggle(): void {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    // Read once and keep it: a node the boss opens and closes twice is one call, not three.
    if (inner) return
    void api.zoom(employeeId, node.range).then((result) => {
      if (result.ok) setInner({ notes: result.value.notes, nodes: result.value.nodes })
      else setError(result.error)
    })
  }

  return (
    <article className={NODE}>
      <header className="flex h-15 items-center gap-8">
        <span className={NODE_RANGE}>{rangeLabel(node.range)}</span>
        {days && <span className={NODE_DAYS}>{days}</span>}
        <span className="flex-1" />
        <button
          type="button"
          className={ZOOM}
          aria-expanded={open}
          aria-label={`Open ${rangeLabel(node.range)}`}
          onClick={toggle}
        >
          {open ? <ChevronsDownUp size={13} aria-hidden /> : <ChevronsUpDown size={13} aria-hidden />}
        </button>
      </header>
      <p className={NODE_TEXT} data-empty={node.text === null}>
        {node.text ?? 'No summary yet. Open it to read the notes themselves.'}
      </p>
      {open && (
        <div className="flex flex-col gap-8 border-border border-t pt-3">
          {error && (
            <p className="text-destructive" role="alert">
              {error}
            </p>
          )}
          {inner?.notes.map((note) => (
            <Row key={note.id} note={note} now={now} />
          ))}
          {inner?.nodes.map((child) => (
            <NodeCard key={rangeLabel(child.range)} employeeId={employeeId} node={child} now={now} />
          ))}
        </div>
      )}
    </article>
  )
}

/** What the search box answers with: every note that holds the query, word for word. */
function Matches({ employeeId, query, now }: { employeeId: string; query: string; now: number }) {
  const [found, setFound] = useState<{ notes: Note[]; total: number; truncated: boolean } | null>(null)

  useEffect(() => {
    let live = true
    setFound(null)
    void api.search(employeeId, query).then((result) => {
      if (!live || !result.ok) return
      setFound({ notes: result.value.matches, total: result.value.total, truncated: result.value.truncated })
    })
    return () => {
      live = false
    }
  }, [employeeId, query])

  if (!found) return null
  if (found.total === 0) return <p className={NONE}>No note holds “{query}”.</p>
  return (
    <>
      <Section
        label={`${found.total} ${found.total === 1 ? 'note' : 'notes'}${found.truncated ? ' · newest shown' : ''}`}
      />
      {found.notes.map((note) => (
        <Row key={note.id} note={note} now={now} />
      ))}
    </>
  )
}

function Empty() {
  return (
    <EmptyState
      icon={NotebookPen}
      title="No notes yet"
      body="Every line the Employee writes with note lands here, and a note you add is read at its next Session start. Nothing here is ever deleted."
    />
  )
}

/** The boss writing a note. There is no edit and no delete: the log only grows. */
export function NoteForm({ label, onSave, onCancel }: { label: string; onSave(text: string): void; onCancel(): void }) {
  const [draft, setDraft] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    // A block body on purpose: what an effect returns is taken for its clean-up, and a DOM call
    // that answers with anything but a function brings the view down when it unmounts.
    field.current?.focus()
  }, [])

  return (
    <form
      className="flex shrink-0 flex-col gap-8"
      onSubmit={(event) => {
        event.preventDefault()
        if (draft.trim()) onSave(draft)
      }}
    >
      <textarea
        ref={field}
        className={FIELD}
        aria-label={label}
        rows={3}
        value={draft}
        placeholder="One line they should remember."
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
        }}
      />
      <div className="flex justify-end gap-8">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={draft.trim() === ''}>
          Save
        </Button>
      </div>
    </form>
  )
}
