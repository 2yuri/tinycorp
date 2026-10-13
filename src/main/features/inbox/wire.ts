import type { Message } from '../../../shared/domain/chat'
import type { CompanyContext, OpenCompany } from '../../core'
import type { CompanyChanged } from '../company'
import { type AnswererOptions, type AnswererService, type Answerers, createAnswerers } from './answerer'
import { createInbox, type Inbox, type InboxOptions, type InboxService, type WakeContext } from './inbox'

/**
 * What the inbox reaches for, one Company at a time.
 *
 * The types are read off the two factories' own options, so this interface can never drift from
 * what they actually take.
 */
export interface InboxDeps {
  log(line: string): void
  /** Every Session's status: who is idle to push to, who is parked, who is out of budget. */
  sessions: InboxOptions['sessions']
  /** Who can be named in that Company, and the rooms a wake is read in. */
  chat(entry: OpenCompany): NonNullable<ReturnType<AnswererOptions['company']>>['chat'] & {
    people(): NonNullable<ReturnType<InboxOptions['company']>>['people']
  }
  /** That Company's staff, for the answerer chain. */
  staff(entry: OpenCompany): {
    employees: { list(): NonNullable<ReturnType<AnswererOptions['company']>>['employees'] }
  }
  /**
   * What the board says about a message: which of its ticket references are held, and whose reply
   * it is. Who *answers* it is the answerer's, and is folded in here rather than asked of anyone.
   */
  wakes(entry: OpenCompany): {
    context(message: Message): Omit<WakeContext, 'answererId' | 'threadAnswererId' | 'intakeId'>
  }
  /** Who holds intake in that Company, which is who an unaddressed message goes to first. */
  routing(entry: OpenCompany): { intake(): { id: string } | null }
  /** A boss message that opens with `/<skill>`, as the prompt that invokes it (T264). */
  invokeSkill(entry: OpenCompany, employeeId: string, name: string, prompt: string): string | null
  /**
   * The roster changed in the current Company: the first hire inherits the message that was
   * waiting, and a fired answerer hands its threads over.
   */
  onStaffChange(listener: () => void): () => void
}

/** The inbox feature, once it is wired. */
export interface InboxFeature {
  /** Filing and reading items, over every open Company. */
  inbox: InboxService
  /** Who answers the boss when a message addresses nobody (decision 41). */
  answerers: AnswererService
  /**
   * The head of that Company's chain, availability aside: what a brief names, so the text does not
   * change with whose Session happens to be running.
   */
  answerer(companyId: string): { id: string; name: string } | null
  /** The app is quitting: both let go of everything they were holding. */
  close(): void
}

/**
 * Wires what is waiting for an Employee, and who answers the boss, to the open Companies (T187).
 *
 * The two are one feature because they call each other: the inbox asks who answers an unaddressed
 * boss message before it files it, and the answerer files through the inbox when it has to say a
 * message is waiting for capacity. Neither is per Company — both are handed the Company with every
 * call — so there is no map here, only the knot tied once. The engine goes on telling the answerer
 * when the staff changed, which is a moment only it can see.
 */
export function register(ctx: CompanyContext, deps: InboxDeps): InboxFeature {
  const answerers = createAnswerers({
    sessions: deps.sessions,
    company(companyId) {
      const entry = ctx.entryOf(companyId)
      return entry
        ? {
            db: entry.db,
            employees: deps.staff(entry).employees.list(),
            people: deps.chat(entry).people(),
            chat: deps.chat(entry),
            deliver: (item) => inbox.deliver(companyId, item),
          }
        : null
    },
    currentId: () => ctx.currentEntry().company.id,
  })

  const inbox = createInbox({
    company(companyId) {
      const entry = ctx.entryOf(companyId)
      return entry
        ? {
            db: entry.db,
            people: deps.chat(entry).people(),
            context: (message) => ({
              ...deps.wakes(entry).context(message),
              intakeId: deps.routing(entry).intake()?.id ?? null,
              answererId: answerers.answererId(companyId),
              threadAnswererId:
                message.threadId === null ? null : answerers.threadAnswererId(companyId, message.threadId),
            }),
            answered: (message, answererId) => answerers.answered(companyId, message, answererId),
            invokeSkill: (employeeId, name, prompt) => deps.invokeSkill(entry, employeeId, name, prompt),
          }
        : null
    },
    current: () => ctx.currentEntry().db,
    sessions: deps.sessions,
    log: deps.log,
  })

  deps.onStaffChange(() => {
    const companyId = ctx.currentId()
    if (companyId === null) return
    try {
      answerers.staffChanged(companyId)
    } catch (error) {
      deps.log(`Answerer: could not follow a staff change: ${(error as Error).message}`)
    }
  })

  return {
    inbox,
    answerers,
    answerer(companyId) {
      const first = answerers.choice(companyId).first
      return first ? { id: first.id, name: first.name } : null
    },
    close() {
      inbox.close()
      answerers.close()
    },
  }
}

/** The Inbox's face. */
export interface InboxFacade extends CompanyChanged {
  /** Employees' inboxes in the current Company: what woke them and whether it was delivered. */
  inbox: Inbox
}

/** The "Who answers you" setting's face (decision 41). */
export interface AnswererFacade extends CompanyChanged {
  answerer: Answerers
}
