import { Eye } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PinnedMessage } from '../../../shared/channel-extras'
import { canDeleteChannel } from '../../../shared/channel-removal'
import { BOSS, type Channel, dmMembers, type Message } from '../../../shared/domain/chat'
import type { Result } from '../../../shared/domain/result'
import { draftKeys } from '../../../shared/drafts'
import type { BossInboxItem } from '../../../shared/inbox/boss-inbox'
import { navigate } from '../chrome'
import { resources, useIpcResource } from '../ipc'
import { onNotificationFocus, requestNotificationFocus } from '../notifications'
import { ChannelHeader } from './ChannelHeader'
import { AboutPanel, type ChannelPanel, PinnedPanel, SearchPanel } from './ChannelPanels'
import { Composer } from './Composer'
import { ConversationPanel } from './ConversationPanel'
import {
  channelHeader,
  companyKeyOf,
  composerHint,
  nameOf,
  readLimitFor,
  readOnlyNote,
  visibleChannel,
} from './chat-view'
import { type Conversation, conversationOf } from './conversation'
import { useChannelDelete } from './DeleteChannel'
import { InboxHeader, InboxList } from './InboxList'
import { type InboxFilter, inboxHeader } from './inbox-view'
import { MessageList, type Refs } from './Messages'
import { ThreadPanel } from './ThreadPanel'
import { useChatData } from './use-chat-data'
import { useSlashComposer } from './use-slash'

const api = window.tinyCorp.chat

/**
 * The current Company's chat: the channel header (in the shell's content header), messages with rich
 * cards, the composer and the thread panel. The shell's sidebar picks the channel.
 */
export function Chat(props: {
  companyId: string
  /** The channel the shell's sidebar picked; the view follows it. */
  channelId?: string | undefined
  /** True when the sidebar picked the Inbox, which replaces the message list (decision 43). */
  inbox?: boolean | undefined
  /** Called when the view switches channel itself, so the sidebar can follow. */
  onChannelChange?: (channelId: string) => void
}) {
  const [ownChannel, setOwnChannel] = useState(props.channelId ?? 'general')
  const [channels, setChannels] = useState<Channel[]>([])
  const picked = props.channelId ?? ownChannel
  // A channel the boss deleted takes the view with it: it lands on #general (T112).
  const selected = visibleChannel(picked, channels)
  const [messages, setMessages] = useState<Message[]>([])
  const [threadId, setThreadId] = useState<number | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [thread, setThread] = useState<Message[]>([])
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<BossInboxItem[]>([])
  // The Inbox row the panel is open on, and the channel's read mark as it stood before it was
  // opened: opening a row marks its channel read, so the New divider has to be placed from the
  // mark the boss actually left behind (T251).
  const [openRowItem, setOpenRowItem] = useState<BossInboxItem | null>(null)
  const [openRowMark, setOpenRowMark] = useState(0)
  const [filter, setFilter] = useState<InboxFilter>('all')
  const [pins, setPins] = useState<PinnedMessage[]>([])
  const [channelPanel, setChannelPanel] = useState<ChannelPanel | null>(null)
  const [searchText, setSearchText] = useState('')
  const [results, setResults] = useState<Message[]>([])
  // The message a pin or a search result jumped to, until the boss moves on (T44).
  const [focusId, setFocusId] = useState<number | null>(null)
  const data = useChatData()
  const read = useIpcResource(resources.unreadByChannel)
  const showInbox = props.inbox === true
  const section = useRef<HTMLElement>(null)
  const channelDelete = useChannelDelete()

  const onChannelChange = props.onChannelChange
  const select = useCallback(
    (channelId: string) => {
      setOwnChannel(channelId)
      onChannelChange?.(channelId)
    },
    [onChannelChange],
  )

  // The picked channel is gone: tell the sidebar the view moved on.
  useEffect(() => {
    if (selected !== picked) select(selected)
  }, [selected, picked, select])

  // Opened without a channel: tell the sidebar which one the view shows.
  const wanted = props.channelId
  // biome-ignore lint/correctness/useExhaustiveDependencies: the sidebar is told once per shell channel; re-running on a new callback would fight the boss.
  useEffect(() => {
    if (!wanted && !showInbox) onChannelChange?.(ownChannel)
    // Only when the shell's channel changes.
  }, [wanted, showInbox])

  const openThread = useCallback((id: number | null) => {
    setThreadId(id)
    setPanelOpen(id !== null)
    if (id === null) setOpenRowItem(null)
  }, [])

  useEffect(
    () =>
      onNotificationFocus(props.companyId, 'thread', (focus) => {
        select(focus.channelId)
        openThread(focus.threadId)
        // Straight to the message the notification is about, in the channel or in its thread (T287).
        setFocusId(focus.messageId ?? null)
        setError(null)
        section.current?.scrollIntoView({ block: 'start' })
      }),
    [props.companyId, select, openThread],
  )

  // The digest has no thread: the click lands on the message itself, in its channel (T172).
  useEffect(
    () =>
      onNotificationFocus(props.companyId, 'digest', (focus) => {
        select(focus.channelId)
        openThread(null)
        setFocusId(focus.messageId)
        setError(null)
        section.current?.scrollIntoView({ block: 'start' })
      }),
    [props.companyId, select, openThread],
  )

  // The boss has read what the view shows; marking read only broadcasts when something changed.
  // The Inbox shows no channel, so it reads one only when a row is opened.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a message arriving is what makes the channel unread again, so it is the trigger.
  useEffect(() => {
    if (!showInbox && channels.some((c) => c.id === selected)) void api.markRead(selected)
  }, [showInbox, channels, selected, messages])

  // A jump reads the whole page the engine allows: the message may be older than one page (T44).
  const limit = readLimitFor(focusId)

  const refresh = useCallback(async () => {
    const [nextChannels, nextMessages, nextThread, nextItems, nextPins] = await Promise.all([
      api.channels(),
      api.read({ channelId: selected, limit }),
      threadId === null ? null : api.read({ channelId: selected, threadId }),
      api.bossInbox(),
      api.pins(selected),
    ])
    if (nextChannels.ok) setChannels(nextChannels.value)
    if (nextMessages.ok) setMessages(nextMessages.value)
    setThread(nextThread?.ok ? nextThread.value : [])
    if (nextItems.ok) setItems(nextItems.value)
    setPins(nextPins.ok ? nextPins.value : [])
  }, [selected, threadId, limit])

  useEffect(() => {
    void refresh()
    const offChat = api.onChanged(() => void refresh())
    const offStaff = window.tinyCorp.staff.onChanged(() => void refresh())
    return () => {
      offChat()
      offStaff()
    }
  }, [refresh])

  // Searching runs as the boss types, over the channel the view shows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a message arriving can change what the search finds, so the results are read again with it.
  useEffect(() => {
    if (channelPanel !== 'search' || !searchText.trim()) {
      setResults([])
      return
    }
    let live = true
    void api.search({ channelId: selected, text: searchText }).then((result) => {
      if (live) setResults(result.ok ? result.value : [])
    })
    return () => {
      live = false
    }
  }, [channelPanel, searchText, selected, messages])

  const people = useMemo(() => data.employees.map(({ id, name }) => ({ id, name })), [data.employees])
  const named = channels.filter((c) => c.kind === 'channel')
  const refs: Refs = {
    tickets: data.board?.tickets ?? [],
    channelIds: named.map((c) => c.id),
    companyKey: companyKeyOf(data),
    onChannel: (id) => open(id),
  }
  const members = dmMembers(selected)
  const canPost = !members || members.includes(BOSS)
  const header = showInbox ? inboxHeader(items) : channelHeader(selected, channels, data)
  // Delete channel… is offered only where it is allowed: never on a DM or a Company channel (T112).
  const shown = channels.find((c) => c.id === selected)
  const deletable = shown !== undefined && canDeleteChannel(shown)
  const pinnedIds = useMemo(() => new Set(pins.map((p) => p.id)), [pins])

  // The composer's slash commands, in the channel and thread the boss is looking at (decision 37).
  const slash = useSlashComposer({
    channelId: selected,
    threadId: panelOpen ? threadId : null,
    data,
    people,
    openChannel: open,
  })

  // The conversation the opened Inbox row lives in — its thread, or the channel's own history
  // (T251). Both are already on hand: `messages` is the channel the row put under the panel and
  // `thread` is its thread, and the Inbox draws neither of them itself.
  const conversation =
    showInbox && panelOpen && openRowItem
      ? conversationOf(
          openRowItem,
          {
            history: messages,
            thread: thread[0]?.id === threadId ? thread : [],
            channels,
            readMark: openRowMark,
          },
          data,
        )
      : null

  /** A pin or a search result: a reply opens its thread, a top-level message is marked in the list. */
  function jump(message: Message) {
    setChannelPanel(null)
    setFocusId(message.id)
    if (message.threadId !== null) openThread(message.threadId)
  }

  async function pin(messageId: number, pinned: boolean) {
    const result = await api.pin(messageId, pinned)
    setError(result.ok ? null : result.error)
    if (result.ok) void refresh()
  }

  async function settle(action: Promise<Result<unknown>>) {
    const result = await action
    setError(result.ok ? null : result.error)
    if (result.ok) void refresh()
  }

  /**
   * An Inbox row: the conversation it lives in comes under the panel and its channel is read, and
   * the route stays on the Inbox. The read mark is kept as it stood a moment ago, because what is
   * about to be marked read is exactly what the New divider is drawn from (T251).
   */
  function openRow(target: { channelId: string; threadId: number }, item: BossInboxItem) {
    setOwnChannel(target.channelId)
    openThread(target.threadId)
    setOpenRowItem(item)
    setOpenRowMark(read.readMarks[target.channelId] ?? 0)
    setError(null)
    void api.markRead(target.channelId)
  }

  /**
   * An `asking` row (T165): the boss answers in the terminal, so the row leaves Chat for the
   * office, where the Employee's drawer opens on its Terminal tab — the route a clicked
   * notification about that Employee already takes.
   */
  function openTerminal(employeeId: string) {
    navigate({ view: 'office' })
    requestNotificationFocus({ companyId: props.companyId, focus: { kind: 'employee', employeeId } })
  }

  /** Open in Chat: the Inbox is left for the conversation itself, thread and all (T251). */
  function openInChat(target: Conversation) {
    navigate({ view: 'chat', channelId: target.channelId })
    openThread(target.rootId)
    setError(null)
  }

  function open(channelId: string) {
    select(channelId)
    setThreadId(null)
    setError(null)
    setChannelPanel(null)
    setFocusId(null)
    setSearchText('')
  }

  async function send(action: Promise<Result<Message>>): Promise<boolean> {
    const result = await action
    setError(result.ok ? null : result.error)
    // The list scrolls to what the boss just wrote, so a mark further up is stale.
    if (result.ok) setFocusId(null)
    if (result.ok) void refresh()
    return result.ok
  }

  return (
    <section
      className="flex min-h-0 w-full shrink grow basis-0 overflow-hidden bg-background font-sans text-foreground leading-[normal]"
      ref={section}
    >
      <div className="flex min-w-0 shrink grow basis-0 flex-col bg-background">
        {showInbox ? (
          <InboxHeader header={header} panelOpen={panelOpen} onTogglePanel={() => setPanelOpen(!panelOpen)} />
        ) : (
          <ChannelHeader
            header={header}
            employees={data.employees}
            nameOf={(id) => nameOf(id, data.employees)}
            bossName={data.bossName}
            bossInitials={data.bossInitials}
            bossSprite={data.bossSprite}
            panelOpen={panelOpen}
            onTogglePanel={() => setPanelOpen(!panelOpen)}
            channelPanel={channelPanel}
            onChannelPanel={setChannelPanel}
            editable={shown?.kind === 'channel'}
            pinCount={pins.length}
            onDelete={deletable ? () => channelDelete.ask(selected) : undefined}
          />
        )}
        <div className="flex min-h-0 shrink grow basis-0">
          <div className="relative flex min-w-0 shrink grow basis-0 flex-col">
            {showInbox ? (
              <InboxList
                items={items}
                data={data}
                filter={filter}
                onFilter={setFilter}
                openThread={panelOpen ? threadId : null}
                onOpen={openRow}
                onOpenTerminal={openTerminal}
                onMarkAllRead={() => void api.markAllRead()}
              />
            ) : (
              <MessageList
                messages={messages}
                data={data}
                people={people}
                refs={refs}
                activeThread={panelOpen ? threadId : null}
                onOpenThread={(id) => openThread(id)}
                pinnedIds={pinnedIds}
                onPin={(messageId, pinned) => void pin(messageId, pinned)}
                focusId={focusId}
              />
            )}
            {!showInbox && channelPanel === 'pins' && (
              <PinnedPanel
                pins={pins}
                data={data}
                onJump={jump}
                onUnpin={(messageId) => void pin(messageId, false)}
                onClose={() => setChannelPanel(null)}
              />
            )}
            {!showInbox && channelPanel === 'search' && (
              <SearchPanel
                text={searchText}
                results={results}
                data={data}
                onText={setSearchText}
                onJump={jump}
                onClose={() => setChannelPanel(null)}
              />
            )}
            {!showInbox && channelPanel === 'about' && shown && (
              <AboutPanel
                key={shown.id}
                title={header.title}
                topic={shown.topic}
                memberIds={shown.members}
                employees={data.employees}
                onTopic={(topic) => void settle(api.setTopic(shown.id, topic))}
                onMembers={(memberIds) => void settle(api.setMembers(shown.id, memberIds))}
                onClose={() => setChannelPanel(null)}
              />
            )}
            {error && (
              <p className="mx-24 my-0 text-12/[normal] text-status-error-foreground" role="alert">
                {error}
              </p>
            )}
            {!showInbox &&
              (canPost ? (
                <div className="flex shrink-0 px-24 pt-8 pb-20">
                  <Composer
                    key={selected}
                    variant="main"
                    draftKey={draftKeys.channel(selected)}
                    placeholder={members ? `Message ${header.title}…` : 'Set a goal for the team…'}
                    hint={composerHint(selected, data)}
                    people={people}
                    refs={refs}
                    slash={slash}
                    onSend={(text, attachments) => send(api.post(selected, text, attachments))}
                  />
                </div>
              ) : (
                // A pair from the sidebar's Between agents section: the boss reads along (T77).
                <p className="mx-24 mt-0 mb-20 flex shrink-0 items-center gap-9 rounded-sm bg-secondary px-12 py-10 text-11-5/[normal] text-muted-foreground">
                  <Eye className="shrink-0" size={14} aria-hidden />
                  {readOnlyNote(members.map((id) => nameOf(id, data.employees)))}
                </p>
              ))}
          </div>
          {panelOpen &&
            (conversation ? (
              <ConversationPanel
                key={conversation.draftKey}
                conversation={conversation}
                data={data}
                people={people}
                refs={refs}
                slash={slash}
                approval={data.approvals.get(openRowItem?.messageId ?? 0) ?? null}
                onSend={(text, attachments) =>
                  send(
                    conversation.rootId === null
                      ? api.post(conversation.channelId, text, attachments)
                      : api.reply(conversation.rootId, text, attachments),
                  )
                }
                onOpenInChat={() => openInChat(conversation)}
                onClose={() => openThread(null)}
              />
            ) : (
              <ThreadPanel
                thread={thread[0]?.id === threadId ? thread : []}
                data={data}
                people={people}
                refs={refs}
                slash={slash}
                onReply={(rootId, text, attachments) => send(api.reply(rootId, text, attachments))}
                onClose={() => openThread(null)}
                focusId={focusId}
              />
            ))}
        </div>
      </div>
      {channelDelete.overlay}
    </section>
  )
}
