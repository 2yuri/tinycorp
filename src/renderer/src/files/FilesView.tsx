import { FolderTree } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Defined } from '../../../shared/files/language'
import { ViewHeader } from '../chrome'
import { useEditors } from '../editors'
import { EmptyState } from '../ui'
import { ChangeDiff } from './ChangeDiff'
import type { SidebarTab } from './changes-model'
import { ConflictDialog, DiscardDialog, NewFileDialog, UnsavedDialog } from './FileDialogs'
import { FilesActions, FilesPanel, Places } from './FilesPanel'
import { type Jump, popJump, pushJump } from './language-model'
import type { TabView } from './tabs-model'
import { useEditing } from './use-editing'
import { useFileChanges } from './use-file-changes'
import { useFilePlaces } from './use-file-places'
import { useFileTabs } from './use-file-tabs'
import { useFileTree } from './use-file-tree'
import { useLanguage } from './use-language'
import '../ui/tailwind.css'

const api = window.tinyCorp.files

/** What the viewer falls back to with nothing open: no toggle, no zoom, nothing to remember. */
const NO_VIEW: TabView = { source: false, zoom: 1, pixels: false }

export interface FilesViewProps {
  /** The Company the tabs belong to; another Company's are never shown, and closing one drops them. */
  companyId?: string
  /** The place to open; the first one the Company has when it names none. */
  placeId?: string | undefined
  /** The file to open; the one the Employee is in when it names none. */
  path?: string | undefined
  /** The line a path written elsewhere named (T114): the viewer scrolls to it and marks it. */
  line?: number | undefined
  /** The whole path of a file nowhere the Company owns, which opens as a tab of its own (T121). */
  outside?: string | undefined
  onOpen?(placeId: string, path: string | null): void
}

/**
 * The Files view (frame `ZNpqJ`): the tree on the left, the viewer on the right, the read-only
 * promise at the foot.
 *
 * `--files-indent` is declared here rather than inlined, because `CodeIntel.tsx` reads it inside an
 * inline `calc()` for an outline row's depth — one of the few things in this migration that is a
 * real custom property rather than a utility, and `CodeIntel.test.tsx` asserts on the name.
 */
const VIEW = 'flex min-h-0 flex-1 flex-col overflow-hidden [--files-indent:14px]'

/**
 * The Files view (frames `ZNpqJ` and `LFdty`): one place at a time — a repo, or an Employee's
 * worktree for a ticket — with, on the left, either the folder or what git says changed across
 * every place, and on the right the files the boss has open as tabs (T121), the active one drawn
 * by its kind, or the picked change's diff.
 *
 * The Changes tab is where the boss commits (T160, decision 60): stage, unstage, discard, commit
 * and push, each inside the group of the place it belongs to. TinyCorp still never commits on its
 * own — every one of those is a click of the boss's.
 *
 * The view itself holds four things (T214): the line for whatever last failed, which editor the
 * header hands a file to, where the boss was before they followed a symbol, and which half of the
 * sidebar is showing. Everything else is one of the five hooks beside it — the places, the tabs,
 * the tree, the file and the work in it, and the changes.
 */
export function FilesView({ companyId, placeId, path, line, outside, onOpen }: FilesViewProps) {
  // One line for whatever last failed, wherever it failed: reading the places, reading the tree,
  // opening a tab, saving it, or handing the file to the boss's own editor.
  const [error, setError] = useState<string | null>(null)
  // Which editor `Open in …` names, and its list. One choice, every Company (T123).
  const { editors, choose } = useEditors()
  const [choosing, setChoosing] = useState(false)
  // Where the boss was before they followed a symbol to where it is declared (T115).
  const [trail, setTrail] = useState<readonly Jump[]>([])
  // Which half of the sidebar is showing: the tree, or what git says changed (T160).
  const [tab, setTab] = useState<SidebarTab>('files')

  const places = useFilePlaces({ placeId, companyId: companyId ?? null, setError })
  const place = places.place
  const id = place?.id
  const tabs = useFileTabs({ companyId: companyId ?? null, placeId: id, onPlace: places.choose })
  const tree = useFileTree({ placeId: id, route: { placeId, path, line, outside }, tabs, setError, onOpen })
  const editing = useEditing(tabs, setError)
  const changes = useFileChanges(places.places)

  const shown = tabs.shown
  const here = shown?.placeId === id ? shown : null
  // What the place's own language server knows about the file the viewer is showing (T115). It is
  // given the text the boss is looking at, so a diagnostic follows their typing and not the disk.
  const language = useLanguage({
    placeId: shown?.placeId ?? null,
    path: shown?.path ?? null,
    text: editing.file === null ? null : editing.text,
    truncated: editing.file?.truncated === true,
  })

  const reloadPlaces = places.reload
  const reloadChanges = changes.reload
  useEffect(() => {
    void reloadPlaces()
    void reloadChanges()
    return api.onChanged(() => {
      void reloadPlaces()
      void reloadChanges()
    })
  }, [reloadPlaces, reloadChanges])

  /** Clicking a tab: the tree follows it back to the place the file is in. */
  function pickTab(wanted: string): void {
    const found = tabs.state.tabs.find((one) => one.key === wanted)
    if (found?.placeId != null) places.choose(found.placeId)
    tabs.activate(wanted)
  }

  /** A line of the file the viewer is on: the outline and the problems list both land here. */
  function goToLine(line: number): void {
    // Opening the file already open is how a tab is told a new line: it never makes a second one.
    if (shown) tabs.open({ placeId: shown.placeId, path: shown.path, line })
  }

  /**
   * A symbol followed to where it is declared (T115). Monaco asks its definition provider, and for
   * a declaration in another file it hands the answer here rather than replacing what the boss is
   * reading: a declaration in a place of the Company opens as a tab of that place, and one nowhere
   * it owns by its whole path, as a file from outside does (T121). Where the boss was goes on the
   * trail, so Back brings them straight home.
   *
   * Inside one file Monaco never asks: it moves its own caret, and its own ⌘U takes it back.
   */
  function openDefinition(found: Defined): void {
    const from = shown
    if (!from) return
    setTrail((was) => pushJump(was, { placeId: from.placeId, path: from.path, line: from.line ?? found.line }))
    if (found.placeId !== null) places.choose(found.placeId)
    tabs.open({ placeId: found.placeId, path: found.path, line: found.line })
  }

  /** Back: the last jump comes off the trail and the viewer goes where it came from. */
  function goBack(): void {
    const { trail: left, back } = popJump(trail)
    if (back === null) return
    setTrail(left)
    if (back.placeId !== null) places.choose(back.placeId)
    tabs.open({ placeId: back.placeId, path: back.path, line: back.line })
  }

  async function hand(action: 'edit' | 'reveal'): Promise<void> {
    if (id === undefined) return
    const where = here?.path
    const result = action === 'edit' ? await api.openInEditor(id, where) : await api.reveal(id, where)
    setError(result.ok ? null : result.error)
  }

  /** A file from outside the Company is handed over from its own header, not the place's. */
  async function handOutside(action: 'edit' | 'reveal'): Promise<void> {
    if (shown === null || shown.placeId !== null) return
    const paths = window.tinyCorp.paths
    const result = action === 'edit' ? await paths.openInEditor(shown.path) : await paths.reveal(shown.path)
    setError(result.ok ? null : result.error)
  }

  return (
    <div className={VIEW} data-ui="Files">
      <ViewHeader
        title="Files"
        subtitle={
          place ? (
            <Places
              places={places.places}
              place={place}
              open={places.picking}
              onToggle={places.setPicking}
              onPick={(next) => {
                places.setPicking(false)
                places.choose(next)
                onOpen?.(next, null)
              }}
            />
          ) : (
            'Nothing to read yet'
          )
        }
      >
        <FilesActions
          disabled={place === null}
          editors={editors}
          path={here?.path ?? null}
          picking={choosing}
          onNew={tree.onNew}
          onPicking={setChoosing}
          onEdit={() => void hand('edit')}
          onChoose={choose}
          onReveal={() => void hand('reveal')}
        />
      </ViewHeader>
      {/* With no repo of its own, the view is still where a file opened from a message lands: the
          empty state is for a Company that has nothing open at all (T125). */}
      {place === null && tabs.state.tabs.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-32">
          <EmptyState
            icon={FolderTree}
            title="No repo to read yet"
            body={
              error ?? 'Connect a repository, and every Employee worktree opened for a ticket shows up here beside it.'
            }
          />
        </div>
      ) : (
        <FilesPanel
          place={place}
          sidebar={{
            rows: tree.rows,
            activePath: here?.path ?? null,
            query: tree.query,
            truncated: tree.truncated,
            onQuery: tree.onQuery,
            onPick: tree.onPick,
            tab,
            changedCount: changes.changedCount,
            onTab: setTab,
            changes: changes.panel,
          }}
          viewer={{
            tabs: tabs.state.tabs,
            activeKey: tabs.state.activeKey,
            outsidePath: shown && shown.placeId === null ? shown.path : null,
            file: editing.file,
            view: shown ?? NO_VIEW,
            markedLine: shown?.line ?? null,
            error,
            editors,
            dirtyKeys: editing.dirtyKeys,
            onView: (change) => shown && tabs.update(shown.key, change),
            onPickTab: pickTab,
            onCloseTab: editing.closeTab,
            onReveal: () => void handOutside('reveal'),
            onEditOutside: () => void handOutside('edit'),
          }}
          editing={{
            editable: editing.editable,
            text: editing.text,
            dirty: editing.dirty,
            saving: editing.saving,
            onEdit: editing.onEdit,
            onSave: editing.onSave,
            onDiscard: editing.onDiscard,
          }}
          code={{
            language,
            back: trail.length === 0 ? null : trail[trail.length - 1]!.path,
            onBack: goBack,
            onGoToLine: goToLine,
            onOpenDefinition: openDefinition,
          }}
          diff={<ChangeDiff {...changes.diff} />}
        />
      )}
      {tree.creating && place && <NewFileDialog place={place} {...tree.creating} />}
      {editing.unsaved && <UnsavedDialog busy={editing.saving} {...editing.unsaved} />}
      {changes.discarding && (
        <DiscardDialog
          paths={changes.discarding.paths}
          restorable={changes.discarding.restorable}
          busy={changes.acting}
          onCancel={changes.onCancelDiscard}
          onDiscard={changes.onDiscard}
        />
      )}
      {editing.conflict && (
        <ConflictDialog holderName={place?.holderName ?? null} busy={editing.saving} {...editing.conflict} />
      )}
    </div>
  )
}
