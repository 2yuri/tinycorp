import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
  NOTE_MAX_BYTES,
  NOTES_LEAF,
  type Note,
  type NoteRange,
  type NotesNode,
  parseRange,
  rangeLabel,
} from '../../../shared/memory/notes'
import type { McpCaller } from '../../core/engine'

/**
 * An Employee's own notes, as the five tools it works them with (T193).
 *
 * They replace `notes_write`, which handed back one file with a 32,000 character cap on it and so
 * made *remembering one more thing* mean *deciding what to forget*. Here nothing is ever deleted:
 * `note` appends a line, and the history stays readable inside a fixed wake because the Employee
 * summarises its own past — `nap` writes a summary, `zoom` opens one back up, `forget` throws a
 * bad one away so it gets written again, and `recall` searches every note word for word.
 *
 * A sub-session reaches none of this: it gets `registerSubSessionTools` and nothing else, the same
 * rule that keeps a model out of the Company memory.
 */
export function registerNotesTools(server: McpServer, { notes }: McpCaller): void {
  server.registerTool(
    'note',
    {
      description:
        'Write one line to your own notes. They are given back to you every time your Session starts, ' +
        'across restarts and provider switches. Nobody else reads them: what the whole Company should ' +
        `know goes to the Company memory with \`memory_write\`. At most ${NOTE_MAX_BYTES} bytes — one ` +
        'fact, said plainly. Nothing you write here is ever deleted or rewritten, so write a second note ' +
        'when you change your mind rather than trying to fix the first. Write one whenever you learn ' +
        'something that would have saved you time: a convention, a gotcha, a habit of the team, a name ' +
        'for something. The answer tells you when a summary is due.',
      inputSchema: { text: z.string().describe('The note, one line.') },
    },
    ({ text }) =>
      run(() => {
        const note = notes.add(text, 'employee')
        return { status: 'noted', id: note.id, ...dueLine(notes.due()) }
      }),
  )

  server.registerTool(
    'recall',
    {
      description:
        'Search every note you have ever written, word for word. Not the summaries, the notes ' +
        'themselves. Takes a regular expression, so `vitest|--pool` finds either. Use it whenever you ' +
        'are about to guess at something you might have met before; the wake you start with is the ' +
        'shape of your history, and this is how you get the detail back out of it.',
      inputSchema: {
        pattern: z.string().describe('A regular expression, case-insensitive, e.g. `migration name`.'),
      },
    },
    ({ pattern }) =>
      run(() => {
        const found = notes.search(compile(pattern))
        return {
          matches: found.matches.map(line),
          total: found.total,
          ...(found.truncated && { truncated: true }),
          ...(found.partial && { partial: 'The search stopped early; narrow the pattern to reach older notes.' }),
        }
      }),
  )

  server.registerTool(
    'zoom',
    {
      description:
        'Open one range of your notes. A range you were given as a summary comes back as its two ' +
        `halves, and a range of ${NOTES_LEAF} notes or fewer comes back as the notes themselves — so ` +
        'anything the wake showed you as a summary is two or three calls away from being word for word. ' +
        'Ranges are written `#96-111`, as your wake writes them.',
      inputSchema: { range: z.string().describe('A range of notes, e.g. `#96-111`.') },
    },
    ({ range }) =>
      run(() => {
        const opened = notes.zoom(rangeOf(range))
        return {
          range: rangeLabel(opened.range),
          ...(opened.notes.length > 0 && { notes: opened.notes.map(line) }),
          ...(opened.nodes.length > 0 && { halves: opened.nodes.map(half) }),
        }
      }),
  )

  server.registerTool(
    'nap',
    {
      description:
        'Write the summary of a range of your own notes. It is how your history stays readable ' +
        'without growing. Your wake and every `note` answer name the range that is due; write that one ' +
        'at your next turn boundary, in a sentence or two, keeping the names, numbers and decisions and ' +
        'dropping everything you would not want read back to you in a month. A range whose two halves ' +
        'are already summarised is summarised from them, not from the notes again.',
      inputSchema: {
        range: z.string().describe('The range that is due, e.g. `#96-111`.'),
        summary: z.string().describe('What those notes came to.'),
      },
    },
    ({ range, summary }) =>
      run(() => {
        const written = notes.nap(rangeOf(range), summary)
        return { status: 'summarised', range: rangeLabel(written.range), ...dueLine(notes.due()) }
      }),
  )

  server.registerTool(
    'forget',
    {
      description:
        'Throw away one summary so it gets written again. It forgets a summary and never a note: ' +
        'the notes under it are exactly where they were, and `zoom` still reads every one of them. Use ' +
        'it when a summary of yours turns out to have been wrong or to have dropped something that ' +
        'mattered.',
      inputSchema: { range: z.string().describe('The summary’s range, e.g. `#96-111`.') },
    },
    ({ range }) =>
      run(() => {
        const asked = rangeOf(range)
        return notes.forget(asked)
          ? { status: 'forgotten', range: rangeLabel(asked) }
          : { status: 'nothing to forget', range: rangeLabel(asked) }
      }),
  )
}

function dueLine(due: NoteRange | null): { due?: string } {
  if (!due) return {}
  return {
    due:
      `${rangeLabel(due)} has no summary yet. Write it with \`nap\` at your next turn boundary — ` +
      'one or two sentences, names and numbers kept.',
  }
}

function line(note: Note): { id: number; at: string; text: string; from?: string } {
  return { id: note.id, at: note.at, text: note.text, ...(note.by === 'boss' && { from: 'the boss' }) }
}

function half(node: NotesNode): { range: string; summary: string | null } {
  return { range: rangeLabel(node.range), summary: node.text }
}

/** A range as an Employee wrote it, or a refusal that says how one is written. */
function rangeOf(text: string): NoteRange {
  const range = parseRange(text)
  if (!range) throw new Error(`A range is written like \`#96-111\`; "${text}" is not one.`)
  return range
}

/** The Employee's pattern, or a refusal carrying what the regular expression engine said. */
function compile(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'i')
  } catch (error) {
    throw new Error(`That is not a regular expression: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function run(action: () => unknown): CallToolResult {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(action()) }] }
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
    }
  }
}
