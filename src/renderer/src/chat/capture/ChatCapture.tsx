// A dev-only capture of the Chat view against the design's own fixture (`?capture=chat`).
// It stands in for the engine so the approval cards can be compared with `design/screens/rPfPD.png`.
import { type ReactNode, useEffect } from 'react'
import type { Message } from '../../../../shared/domain/chat'
import { pathMentions } from '../../../../shared/files/path-links'
import type { TinyCorpApi } from '../../../../shared/ipc'
import { ContentHeader } from '../../chrome/ContentHeader'
import { requestNotificationFocus } from '../../notifications/focus'
// `?capture=header` puts the shell's own header above the conversation, so it needs its styles.
import { AboutPanel, PinnedPanel, SearchPanel } from '../ChannelPanels'
import type { MessageCard as MessageCardModel } from '../chat-view'
import * as fixture from './fixture'
import '../../ui/tailwind.css'

/**
 * The capture has no Company folder, so the screenshot an Employee would have sent is drawn here:
 * a plausible usage chart, as a real PNG, rather than a binary carried into the repo.
 */
function captureImage(): string {
  const canvas = document.createElement('canvas')
  canvas.width = 480
  canvas.height = 300
  const paint = canvas.getContext('2d')!
  paint.fillStyle = '#0F172A'
  paint.fillRect(0, 0, 480, 300)
  paint.fillStyle = '#CBD5E1'
  paint.font = '600 16px Inter, system-ui, sans-serif'
  paint.fillText('Usage this month', 24, 40)
  paint.strokeStyle = '#334155'
  for (let y = 80; y <= 260; y += 45) {
    paint.beginPath()
    paint.moveTo(24, y)
    paint.lineTo(456, y)
    paint.stroke()
  }
  const bars = [110, 160, 95, 205, 140, 175, 230]
  paint.fillStyle = '#6366F1'
  bars.forEach((height, i) => {
    paint.fillRect(40 + i * 60, 260 - height, 32, height)
  })
  return canvas.toDataURL('image/png')
}

/** A subscription that never fires: the fixture does not change while capturing. */
const never = () => () => {}
const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })

/** Everything the Chat view reads, answered from the fixture; nothing changes while capturing. */
function stub(
  messages: Message[],
  plans = fixture.plans,
  pins = fixture.pins,
  employees = fixture.employees,
): TinyCorpApi {
  return {
    chat: {
      channels: () => ok(fixture.channels),
      // A DM reads as itself: the Inbox's DM row opens the whole conversation, not one message
      // of it (T251), so the harness answers for that channel as the engine would.
      read: ({ channelId, threadId }: { channelId: string; threadId?: number }) =>
        ok(
          threadId !== undefined
            ? (fixture.threads[threadId] ?? [])
            : channelId === fixture.VEGA_DM
              ? fixture.vegaDm
              : messages,
        ),
      // Where the boss stopped reading, which is where the New divider goes.
      unread: () => ok({ counts: { [fixture.VEGA_DM]: 2 }, readMarks: { [fixture.VEGA_DM]: fixture.dmReadMark } }),
      attachment: (id: number) =>
        ok(
          id === 1
            ? {
                id,
                name: 'usage-totals.png',
                size: 184320,
                dataUrl: captureImage(),
                path: '/c/attachments/9/usage-totals.png',
              }
            : { id, name: 'vitest-run.log', size: 5120, dataUrl: null, path: '/c/attachments/9/vitest-run.log' },
        ),
      post: () => ok(fixture.messages[0]),
      reply: () => ok(fixture.messages[0]),
      markRead: () => ok(true),
      markAllRead: () => ok(true),
      bossInbox: () => ok(fixture.bossInbox),
      pins: () => ok(pins),
      search: ({ text }: { text: string }) =>
        ok(fixture.messages.filter((m) => m.text.toLowerCase().includes(text.trim().toLowerCase()))),
      pin: () => ok(pins[0] ?? null),
      setTopic: () => ok(fixture.channels[0]),
      // `Delete #…` is offered on a channel of the boss's own making (T112); the confirmation is
      // the only state `delete-channel.css` is drawn in, so the capture can open it (T209).
      channelRemoval: (channelId: string) =>
        ok({ channelId, name: channelId, messages: fixture.planningMessages.length, epicId: 4 }),
      deleteChannel: () => ok(true),
      setMembers: () => ok(fixture.channels[0]),
      onChanged: never,
    },
    staff: { employees: () => ok(employees), roles: () => ok(fixture.roles), onChanged: never },
    // Orion's skills, with what each says it does, for the palette in his DM (T264).
    skills: { described: () => ok(fixture.orionSkills), onChanged: never },
    board: { snapshot: () => Promise.resolve(fixture.board), onChanged: never },
    code: { list: () => ok(fixture.code), details: () => ok(fixture.details), onChanged: never },
    repos: { list: () => ok(fixture.repos), onChanged: never },
    reviews: { list: () => ok(fixture.reviews), securityPasses: () => ok([]), onChanged: never },
    tests: { list: () => ok([]), onChanged: never },
    planning: {
      list: () => ok(plans),
      answer: () => ok(plans[0]),
      delegate: () => ok(plans[0]),
      approve: () => ok(plans[0]),
      requestChanges: () => ok(plans[0]),
      keep: () => ok(plans[0]),
      replan: () => ok(plans[0]),
      onChanged: never,
    },
    approvals: {
      list: () => ok(fixture.approvals),
      level: () => ok('managed'),
      setLevel: () => ok('managed'),
      decide: () => ok(fixture.approvals[0]),
      onChanged: never,
    },
    answerer: { get: () => ok({ answererId: null, waitingForId: null }), onChanged: never },
    // Every path written in a message is really there, as far as this capture is concerned: the
    // link is what `paths.css` draws, and a capture has no worktree to look in (T209).
    paths: {
      links: (text: string) =>
        ok(
          pathMentions(text).map((mention) => ({
            ...mention,
            target: {
              kind: 'place' as const,
              placeId: 'p-web',
              path: mention.path,
              line: mention.line,
              column: mention.column,
            },
            full: `/Users/boss/code/web-app/${mention.path}`,
          })),
        ),
      open: () => ok(undefined),
      reveal: () => ok(undefined),
      openInEditor: () => ok(undefined),
    },
    company: { current: () => Promise.resolve(fixture.company), onChanged: never },
    digest: {
      schedule: () => ok(fixture.digestSchedule),
      setSchedule: () => ok(fixture.digestSchedule),
      onChanged: never,
    },
  } as unknown as TinyCorpApi
}

/**
 * Mounts the Chat view with the fixture behind it. `?capture=chat` opens the merge approval's
 * thread (`rPfPD`); `?capture=hire` opens the hire approval's, which the generic card was drawn for;
 * `?capture=inbox` shows the boss's Inbox in place of the channel (`c4qHR`);
 * `?capture=inbox-conversation` is that Inbox with its DM row opened, so the right-hand panel draws
 * the whole DM with its day dividers and its New line (`JRSDX`, T251); `?capture=header`
 * adds the shell's own 64px header, where the channel extras live (T44); `?capture=attachments`
 * puts a message carrying a screenshot and a log at the end of the channel (T38);
 * `?capture=planning` opens the planning thread of `D1E2lt` (T171); `?capture=answered` is that
 * thread with every question answered and the plan still to come (`dvg9E`, T233); `?capture=prs` draws the three
 * states of the `#prs` card while two agents review (`F2HxCz`, T170); `?capture=digest` puts the
 * app's own daily digest at the end of `#general` (T172); `?capture=env` opens the `env_run`
 * approval of `aD50i` (a), which prod raises before a migration runs (T176); `?capture=paths` ends
 * the channel with a message that names two files, drawn as links (T114); `?capture=lightbox` is
 * the attachments channel with the screenshot's lightbox open over it (`dzQXx`, T236).
 */
export async function chatCapture(which: string): Promise<ReactNode> {
  // `?capture=delete` is the planning channel with its confirmation open: the only channel in the
  // fixture the boss is allowed to delete, and the only state `delete-channel.css` is drawn in.
  const planning = which === 'planning' || which === 'delete' || which === 'answered'
  // The stub goes in before the view modules load: they read the preload API at import time.
  window.tinyCorp = stub(
    which === 'answered'
      ? fixture.answeredMessages
      : planning
        ? fixture.planningMessages
        : which === 'attachments' || which === 'lightbox'
          ? fixture.withAttachments
          : which === 'digest'
            ? fixture.withDigest
            : which === 'paths'
              ? fixture.withPaths
              : fixture.messages,
    which === 'answered' ? [fixture.answeredPlan] : fixture.plans,
    // The digest evening has nothing pinned: the frame's channel carries only the goal and the card.
    which === 'digest' ? [] : fixture.pins,
    which === 'palette-skills' ? fixture.employeesWithSkills : fixture.employees,
  )
  const { Chat } = await import('../Chat')
  const threadId = which === 'hire' ? 5 : which === 'env' ? 8 : 4
  const channelId = planning ? fixture.PLANNING_CHANNEL : which === 'palette-skills' ? fixture.ORION_DM : 'general'
  const inbox = which === 'inbox' || which === 'inbox-conversation'
  const chat = <Chat companyId={fixture.company.id} channelId={channelId} inbox={inbox || undefined} />
  // The Inbox with a row opened: a headless capture cannot click one, so the frame does it (T251).
  // No `channelId`, because the shell's Inbox route carries none and the view follows the row the
  // boss opened — hand it one and the panel draws that channel however the row is clicked.
  if (which === 'inbox-conversation') {
    return <HeaderFrame chat={<Chat companyId={fixture.company.id} inbox />} onReady={openDmRow} />
  }
  if (which === 'delete') return <HeaderFrame chat={chat} onReady={pressDelete} />
  if (planning) return <HeaderFrame chat={chat} />
  if (which === 'header') return <HeaderFrame chat={chat} />
  // No thread opened: the files sit in the channel, where the design puts a message's chips.
  // The screenshot's own thumbnail decodes after the view has scrolled to the end and grows the
  // conversation under it, so the capture keeps putting it back: without that the shot lands at
  // whichever scroll the decode happened to leave, and no two are the same (T209).
  if (which === 'attachments') return <HeaderFrame chat={chat} onReady={scrollToEnd} />
  // The same channel with the lightbox open over it, which a headless capture cannot click open.
  if (which === 'lightbox') return <HeaderFrame chat={chat} onReady={openLightbox} />
  // The digest has no thread either: it is the whole message (T172, `N47ud`).
  if (which === 'digest') return <HeaderFrame chat={chat} />
  // The paths a message names, drawn as links (T114): in the channel, not in a thread.
  if (which === 'paths') return <HeaderFrame chat={chat} />
  if (which === 'panels') return <PanelsFrame />
  if (which === 'prs') {
    // `Cards` reaches the preload API at module scope, so it loads after the stub is in, like `Chat`.
    const { MessageCard } = await import('../Cards')
    return <PullRequestCardsFrame Card={MessageCard} />
  }
  // A target named by a whole sentence beside the design's short one, both at a message's width (T271).
  if (which === 'targets') {
    const { MessageCard } = await import('../Cards')
    return <TargetCardsFrame Card={MessageCard} />
  }
  // The palette in a DM with an Employee who holds skills: SKILLS · ORION over the commands (`DhY2y`).
  if (which === 'palette' || which === 'palette-skills') return <PaletteFrame chat={chat} />
  return <Frame threadId={threadId} chat={chat} />
}

/**
 * The same window with the shell's content header above the conversation, so the channel header's
 * topic, member stack, pin and search can be compared with `rPfPD` (T44). No thread is opened.
 */
function HeaderFrame({ chat, onReady }: { chat: ReactNode; onReady?: () => void }) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the press runs once, when the frame mounts.
  useEffect(() => {
    if (!onReady) return
    const tick = setInterval(() => onReady(), 100)
    return () => clearInterval(tick)
  }, [])
  return (
    <div style={{ display: 'flex', width: 1512, height: 944, overflow: 'hidden' }}>
      <div style={{ width: SHELL_WIDTH, flexShrink: 0, background: 'var(--sidebar, #0F172A)' }} />
      <div style={{ display: 'flex', flex: '1 1 0', flexDirection: 'column', minWidth: 0 }}>
        <ContentHeader title={fixture.company.name}>
          <div style={{ display: 'flex', flex: '1 1 0', minHeight: 0 }}>{chat}</div>
        </ContentHeader>
      </div>
    </div>
  )
}

/**
 * Keeps the conversation at its end, whatever an image that decodes late does to its height.
 *
 * By what scrolls, not by a class name: the class this used to name was gone the next time the
 * chat screen was migrated (T210a), and a harness that holds on to styling breaks silently every
 * time the thing it is a harness for is restyled — which is the one thing a baseline must not do.
 * The attachments state has one scroller, and it belongs at its end.
 */
function scrollToEnd() {
  for (const box of document.querySelectorAll('div')) {
    if (box.scrollHeight > box.clientHeight + 8) box.scrollTop = box.scrollHeight
  }
}

/**
 * Clicks the screenshot's thumbnail, which a headless capture cannot, and stops once the lightbox
 * is up. The conversation is put at its end first, for the reason {@link scrollToEnd} gives.
 */
function openLightbox() {
  // The conversation behind the scrim shows through it, so it is kept at its end on every tick,
  // not only on the one that opened the lightbox: the thumbnail decodes late and grows the page.
  scrollToEnd()
  if (document.querySelector('[data-ui="Lightbox"]')) return
  document.querySelector<HTMLButtonElement>('[data-ui="Image thumbnail"]')?.click()
}

/**
 * Clicks the Inbox's DM row, so the panel beside it draws the whole DM (T251). By the row's own
 * text rather than a class, for the reason {@link scrollToEnd} gives; it stops once the panel has
 * the opened message in it.
 */
function openDmRow() {
  if (document.querySelector('[data-ui="Opened Message"]')) return
  const rows = document.querySelectorAll<HTMLButtonElement>('[aria-label="Inbox"] button')
  for (const row of rows) if (row.textContent?.includes('Direct message')) return row.click()
}

/**
 * Presses `Delete #…` in the channel header, which a headless capture cannot click for itself, and
 * stops once the confirmation is up.
 */
function pressDelete() {
  // By the title and the dialog's own id, for the same reason `scrollToEnd` reads the scroll: the
  // classes both of these used to carry went with T210a.
  if (document.getElementById('delete-channel-title')) return
  document.querySelector<HTMLButtonElement>('button[title="Delete this channel"]')?.click()
}

/** The shell's rail (68) and sidebar (276), so the conversation sits where the window puts it. */
const SHELL_WIDTH = 344

/** The 1512x944 window the audit captures, with one approval thread opened as a click would. */
function Frame({ threadId, chat }: { threadId: number; chat: ReactNode }) {
  useEffect(() => {
    requestNotificationFocus({
      companyId: fixture.company.id,
      focus: { kind: 'thread', channelId: 'general', threadId },
    })
  }, [threadId])
  return (
    <div style={{ display: 'flex', width: 1512, height: 944, overflow: 'hidden' }}>
      <div style={{ width: SHELL_WIDTH, flexShrink: 0, background: 'var(--sidebar, #0F172A)' }} />
      <div style={{ display: 'flex', flex: '1 1 0', minWidth: 0 }}>{chat}</div>
    </div>
  )
}

/**
 * The same window with a `/` typed into the composer, so the slash palette is open for the capture
 * (T39). It types as a boss would, because what the box holds is the composer's own state.
 */
function PaletteFrame({ chat }: { chat: ReactNode }) {
  useEffect(() => {
    const box = document.querySelector<HTMLTextAreaElement>('[data-composer="main"] textarea')
    if (!box) return
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(box, '/')
    box.setSelectionRange(1, 1)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  }, [])
  return (
    <div style={{ display: 'flex', width: 1512, height: 944, overflow: 'hidden' }}>
      <div style={{ width: SHELL_WIDTH, flexShrink: 0, background: 'var(--sidebar, #0F172A)' }} />
      <div style={{ display: 'flex', flex: '1 1 0', minWidth: 0 }}>{chat}</div>
    </div>
  )
}

/**
 * The `#prs` card in each of the three states a review passes through (frame `F2HxCz`, T170): the
 * agents still talking and nothing asked of the boss, the reviewer's approval handed over, and the
 * round limit reached with the two of them still apart.
 *
 * One card per PR that updates in place — this draws the same card three times, not three messages.
 */
function PullRequestCardsFrame({ Card }: { Card: (props: { card: MessageCardModel }) => ReactNode }) {
  const base = {
    kind: 'pr' as const,
    ticketId: 128,
    pullRequests: [
      {
        repo: 'web-app',
        number: 88,
        url: 'https://github.com/acme/web-app/pull/88',
        title: 'Currency + locale formatting helper',
      },
    ],
  }
  const states: { caption: string; card: MessageCardModel }[] = [
    {
      caption: 'a · While the agents review — not asking you yet',
      card: {
        ...base,
        waiting: false,
        reviewer: 'Waiting for Iris',
        replies: 3,
        handoff: 'agents',
        round: 'Round 2 · 1 open thread',
      },
    },
    {
      caption: 'b · Ready for you — the reviewer approved',
      card: {
        ...base,
        waiting: true,
        reviewer: 'Iris · QA approved',
        replies: 5,
        handoff: 'ready',
        round: 'Round 2 · 5 of 6 threads resolved',
      },
    },
    {
      caption: 'c · Round limit hit — the agents disagree',
      card: {
        ...base,
        waiting: true,
        reviewer: 'Iris · QA requested changes',
        replies: 7,
        handoff: 'your_call',
        round: 'Round 3 of 3 · 1 open thread',
      },
    },
  ]
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 28,
        width: 1512,
        height: 944,
        padding: 32,
        overflow: 'auto',
        background: 'var(--background)',
      }}
    >
      {states.map(({ caption, card }) => (
        <div key={caption} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 620 }}>
          <strong style={{ color: 'var(--foreground)', fontSize: 13 }}>{caption}</strong>
          <Card card={card} />
        </div>
      ))}
    </div>
  )
}

/**
 * The target card at a message's width (T271): the design's own, and one whose title and epics are
 * sentences, the way a PM names them when the boss hands it a whole product. They wrap under
 * themselves; they used to run straight out of the card.
 */
function TargetCardsFrame({ Card }: { Card: (props: { card: MessageCardModel }) => ReactNode }) {
  const states: { caption: string; card: MessageCardModel }[] = [
    {
      caption: 'a · The design’s target',
      card: {
        kind: 'target',
        targetId: 1,
        title: 'Billing Dashboard',
        due: 'Fri',
        epics: [
          { id: 10, title: 'Usage & invoices', who: ['Nova', 'Vega'], tickets: 4 },
          { id: 11, title: 'Plan switching', who: ['Sol'], tickets: 2 },
        ],
        foot: '4 tickets in Todo · WIP limit 3 on Doing',
      },
    },
    {
      caption: 'b · A target named by a sentence',
      card: {
        kind: 'target',
        targetId: 2,
        title:
          'Ship the OpenCat MVP: a cross-platform Electron app that schedules X posts on a calendar, driven by a chat agent',
        due: 'Oct 9',
        epics: [
          {
            id: 20,
            title: 'Calendar that schedules and publishes X posts from every platform',
            who: ['Milo'],
            tickets: 5,
          },
          { id: 21, title: 'Chat agent', who: ['Hera', 'Oscar'], tickets: 3 },
        ],
        foot: '8 tickets in Todo · WIP limit 3 on Doing',
      },
    },
  ]
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 28,
        width: 1512,
        height: 944,
        padding: 32,
        overflow: 'auto',
        background: 'var(--background)',
      }}
    >
      {states.map(({ caption, card }) => (
        <div key={caption} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 620 }}>
          <strong style={{ color: 'var(--foreground)', fontSize: 13 }}>{caption}</strong>
          <Card card={card} />
        </div>
      ))}
    </div>
  )
}

/** The three panels the channel header drops, side by side, so each can be looked at (T44). */
function PanelsFrame() {
  const data = {
    employees: fixture.employees,
    companyKey: fixture.company.key,
    board: fixture.board,
    code: fixture.code,
    repos: fixture.repos,
    approvals: new Map(),
    reviews: fixture.reviews,
    bossName: fixture.company.boss.name,
    bossInitials: fixture.company.boss.initials,
  }
  const noop = () => {}
  return (
    <div style={{ display: 'flex', gap: 24, width: 1512, height: 944, padding: 24, background: 'var(--background)' }}>
      {[
        <PinnedPanel key="pins" pins={fixture.pins} data={data} onJump={noop} onUnpin={noop} onClose={noop} />,
        <SearchPanel
          key="search"
          text="invoice"
          results={fixture.messages.filter((m) => m.text.toLowerCase().includes('invoice'))}
          data={data}
          onText={noop}
          onJump={noop}
          onClose={noop}
        />,
        <AboutPanel
          key="about"
          title="# general"
          topic={fixture.channels[0]!.topic}
          memberIds={[]}
          employees={fixture.employees}
          onTopic={noop}
          onMembers={noop}
          onClose={noop}
        />,
      ].map((panel, i) => (
        <div key={i} style={{ position: 'relative', flex: '1 1 0', height: 560 }}>
          {panel}
        </div>
      ))}
    </div>
  )
}
