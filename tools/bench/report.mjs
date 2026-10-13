/**
 * What a `pnpm bench:tokens` run is allowed to say about itself (T190).
 *
 * Two rules, and both of them are about the same failure — a benchmark written by the people who
 * want the answer:
 *
 * - **A median and an IQR, never a mean alone.** Three agent sessions on one ticket can differ by a
 *   factor of two, and a mean of three hides which of them the number came from.
 * - **A loss is never rounded into a win.** {@link percentOf} returns the ratio and the report
 *   prints the sign; nothing in this file has a branch that treats "more than baseline" specially.
 *
 * The ponytail benchmark this one copies the rigor of found that a terse-prose skill made whole
 * sessions spend 7% *more*. That is the result this file has to be able to print.
 */

/** Sorted, because everything below reads the order. */
function sorted(values) {
  return [...values].sort((a, b) => a - b)
}

/** The middle value, or the mean of the middle two. Null for nothing at all. */
export function median(values) {
  if (values.length === 0) return null
  const all = sorted(values)
  const middle = Math.floor(all.length / 2)
  return all.length % 2 === 1 ? all[middle] : (all[middle - 1] + all[middle]) / 2
}

/**
 * The first and third quartiles, by the same linear interpolation `numpy.percentile` uses, so a
 * number here can be checked against any other tool without a footnote about which of the nine
 * quartile definitions was meant.
 */
export function quartiles(values) {
  if (values.length === 0) return { q1: null, q3: null }
  const all = sorted(values)
  return { q1: percentile(all, 0.25), q3: percentile(all, 0.75) }
}

function percentile(all, fraction) {
  const position = (all.length - 1) * fraction
  const low = Math.floor(position)
  const high = Math.ceil(position)
  if (low === high) return all[low]
  return all[low] + (all[high] - all[low]) * (position - low)
}

/** The spread of the middle half. Null when there is nothing to spread. */
export function iqr(values) {
  const { q1, q3 } = quartiles(values)
  return q1 === null || q3 === null ? null : q3 - q1
}

/**
 * `value` as a percentage of `baseline`. Above 100 means this arm spent more, and the report says
 * so in those words.
 */
export function percentOf(value, baseline) {
  if (baseline === null || baseline === 0 || value === null) return null
  return Math.round((value / baseline) * 1000) / 10
}

/** `+4%`, `-12%`, `0%` — the change against baseline, with its sign kept. */
export function deltaLabel(percent) {
  if (percent === null) return '—'
  const delta = Math.round((percent - 100) * 10) / 10
  if (delta === 0) return '0%'
  return `${delta > 0 ? '+' : ''}${delta}%`
}

/** `1.2M`, `420K`, `980`. Never invents a digit it does not have. */
export function tokens(value) {
  if (value === null) return '—'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 10_000) return `${Math.round(value / 1000)}K`
  return Math.round(value).toLocaleString('en-US')
}

export function usd(value) {
  return value === null ? '—' : `$${value.toFixed(3)}`
}

function num(value, digits = 1) {
  return value === null ? '—' : String(Math.round(value * 10 ** digits) / 10 ** digits)
}

/** Every number one group of cells produced, summarised the one way this report is allowed to. */
export function summarise(cells) {
  const ran = cells.filter((cell) => cell.result)
  const pick = (read) => ran.map(read).filter((value) => typeof value === 'number')
  const total = pick((cell) => cell.tokensTotal)
  const cost = pick((cell) => cell.result.costUsd)
  const time = pick((cell) => cell.ms / 1000)
  const added = pick((cell) => cell.diff?.added)
  return {
    n: cells.length,
    ran: ran.length,
    failed: cells.length - ran.length,
    totalTokens: { median: median(total), iqr: iqr(total) },
    outputTokens: (() => {
      const values = pick((cell) => cell.result.outputTokens)
      return { median: median(values), iqr: iqr(values) }
    })(),
    cacheReadTokens: (() => {
      const values = pick((cell) => cell.result.cacheReadTokens)
      return { median: median(values), iqr: iqr(values) }
    })(),
    costUsd: { median: median(cost), iqr: iqr(cost) },
    seconds: { median: median(time), iqr: iqr(time) },
    linesAdded: { median: median(added), iqr: iqr(added) },
    linesRemoved: (() => {
      const values = pick((cell) => cell.diff?.removed)
      return { median: median(values), iqr: iqr(values) }
    })(),
    testsPassed: ran.filter((cell) => cell.tests?.passed).length,
    testsRun: ran.filter((cell) => cell.tests).length,
    turns: (() => {
      const values = pick((cell) => cell.result.turns)
      return { median: median(values), iqr: iqr(values) }
    })(),
    rtkSaved: (() => {
      const values = pick((cell) => cell.rtk?.savedTokens)
      return values.length ? { median: median(values), commands: median(pick((cell) => cell.rtk?.commands)) } : null
    })(),
    rtkCutPercent: (() => {
      const values = pick((cell) => cell.rtk?.cutPercent)
      return values.length ? median(values) : null
    })(),
  }
}

/**
 * Whether the ticket landed, which is the question a `duo` cell exists to answer besides its tokens
 * (T197): the suite is green, the lead left code behind, and the colleague answered at least once.
 *
 * All three, because two of them pass on their own for a cell that did nothing — an untouched
 * workspace has a green suite, and a lead that never DMed anybody can still write the feature. A
 * voice that saves tokens by not coordinating has not saved anything.
 */
export function landed(cell) {
  const replies = Object.entries(cell.dm?.byAuthor ?? {}).filter(([, one]) => one.messages > 0)
  return Boolean(cell.tests?.passed) && (cell.diff?.added ?? 0) > 0 && replies.length >= 2
}

/** The cells of one arm, whichever tasks they belong to. */
function forArm(cells, armId) {
  return cells.filter((cell) => cell.arm === armId)
}

function cell(value, spread) {
  return spread === null || spread === 0 ? num(value) : `${num(value)} ±${num(spread / 2)}`
}

/**
 * The legs of a `long` cell, arm by arm (T197): where in a session that runs three tickets in a row
 * the tokens actually go, and what an arm changed about each leg.
 *
 * It is the table the first round could not have: a checkpoint leg is the workload RTK is for — a
 * suite and a whole `git diff` through Bash — and a ticket leg is the workload it was measured on.
 * Reading them apart is the difference between "RTK cost 26%" and knowing where it did.
 */
function renderLegs(lines, { cells, arms, baseArm }) {
  const ids = []
  for (const cell of cells) for (const part of cell.parts ?? []) if (!ids.includes(part.id)) ids.push(part.id)
  if (ids.length === 0) return
  const kindOf = new Map()
  for (const cell of cells) for (const part of cell.parts ?? []) kindOf.set(part.id, part.kind)
  const legs = (armId, id) =>
    cells.filter((cell) => cell.arm === armId).flatMap((cell) => (cell.parts ?? []).filter((part) => part.id === id))
  const tok = (armId, id) =>
    median(
      legs(armId, id)
        .map((part) => part.tokensTotal)
        .filter((one) => one !== null),
    )

  lines.push('## Per leg')
  lines.push('')
  lines.push('One `long` cell is six legs of one resumed session: three tickets, and a checkpoint after each')
  lines.push('that runs the whole suite, the whole `git diff` and `git log`. Median tokens of that leg, and the')
  lines.push(`percentage of \`${baseArm}\`'s.`)
  lines.push('')
  lines.push(`| leg | | ${arms.map((arm) => `\`${arm}\` | % `).join('| ')}|`)
  lines.push(`|---|---|${arms.map(() => '--:|--:|').join('')}`)
  for (const id of ids) {
    const cellsOf = arms
      .map((arm) => {
        const value = tok(arm, id)
        const pct = arm === baseArm ? '\u2014' : num(percentOf(value, tok(baseArm, id)))
        return `${tokens(value)} | ${pct}`
      })
      .join(' | ')
    lines.push(`| \`${id}\` | ${kindOf.get(id) ?? ''} | ${cellsOf} |`)
  }
  lines.push('')
}

/**
 * The two Employees of a `duo` cell and the thread between them (T197).
 *
 * Three questions, in this order: what the pair spent, what the DMs themselves came to, and whether
 * the ticket landed. The middle one is what the terse voice is a claim about, and it is deliberately
 * printed in characters and words as well as an estimate in tokens, because RTK's own conversion —
 * bytes ÷ 4 — is the only tokenizer anything here has and it should not be the only column.
 *
 * Every DM is paid twice, once by the Employee that wrote it and once by the one woken with it, so
 * the doubled estimate is printed beside the single one rather than instead of it.
 */
function renderDuo(lines, { cells, arms, baseArm }) {
  const of = (armId) => cells.filter((cell) => cell.arm === armId)
  const roleTokens = (armId, role) =>
    median(
      of(armId).map((cell) =>
        (cell.parts ?? [])
          .filter((part) => part.role === role)
          .reduce((total, part) => total + (part.tokensTotal ?? 0), 0),
      ),
    )
  const dm = (armId, read) =>
    median(
      of(armId)
        .map((cell) => read(cell.dm ?? {}))
        .filter((one) => typeof one === 'number'),
    )

  lines.push('## The two Employees')
  lines.push('')
  lines.push('Median over the cells of the arm. `lead` holds the ticket and writes the code; `helper` answers')
  lines.push('its questions and reviews the diff. `wakes` is how many DMs were delivered, out of the five a cell')
  lines.push('is allowed; `landed` is a green suite, code in the diff, and both Employees having written.')
  lines.push('')
  lines.push('| arm | lead tokens | helper tokens | both | % | wakes | landed |')
  lines.push('|---|--:|--:|--:|--:|--:|--:|')
  for (const arm of arms) {
    const one = summarise(of(arm))
    const pct =
      arm === baseArm ? '\u2014' : num(percentOf(one.totalTokens.median, summarise(of(baseArm)).totalTokens.median))
    lines.push(
      `| \`${arm}\` | ${tokens(roleTokens(arm, 'lead'))} | ${tokens(roleTokens(arm, 'helper'))} ` +
        `| ${tokens(one.totalTokens.median)} | ${pct} | ${num(
          dm(arm, (one) => one.deliveries),
          0,
        )} ` +
        `| ${of(arm).filter(landed).length}/${of(arm).length} |`,
    )
  }
  lines.push('')

  lines.push('## The DM thread')
  lines.push('')
  lines.push('What the Employees actually wrote to each other: the median cell of each arm, over the whole')
  lines.push('thread. `est tokens` is characters ÷ 4, and `paid twice` is that doubled, because a DM is written')
  lines.push('by one Employee and read by the other.')
  lines.push('')
  lines.push('| arm | messages | characters | words | est tokens | % | paid twice |')
  lines.push('|---|--:|--:|--:|--:|--:|--:|')
  for (const arm of arms) {
    const chars = dm(arm, (one) => one.chars)
    const estimated = dm(arm, (one) => one.estTokens)
    const pct =
      arm === baseArm
        ? '\u2014'
        : num(
            percentOf(
              estimated,
              dm(baseArm, (one) => one.estTokens),
            ),
          )
    lines.push(
      `| \`${arm}\` | ${num(
        dm(arm, (one) => one.messages),
        0,
      )} | ${num(chars, 0)} ` +
        `| ${num(
          dm(arm, (one) => one.words),
          0,
        )} | ${num(estimated, 0)} | ${pct} ` +
        `| ${num(estimated === null ? null : estimated * 2, 0)} |`,
    )
  }
  lines.push('')
  const elsewhere = cells.reduce((total, cell) => total + (cell.dm?.elsewhere ?? 0), 0)
  if (elsewhere > 0) {
    lines.push(`${elsewhere} message(s) went to a channel rather than the DM, and are counted above.`)
    lines.push('')
  }
}

/**
 * The boss's side of the conversation, arm by arm (T261): what the Employee actually sent the boss,
 * and whether those messages still carried what the boss asked for.
 *
 * Two questions, and the second is the one that stops the first from being a trick. An arm that
 * halves the prose and drops the file path has not made the boss's side cheaper, it has made it
 * useless, and `answers right` is the only column in the run that would notice. It is a keyword
 * check over the reply \u2014 a path-shaped token, a digit, a yes or a no \u2014 and never a judge, which
 * is said here as well as in the limitations because this is where somebody will read it.
 */
function renderBoss(lines, { cells, arms, baseArm }) {
  const of = (armId) => cells.filter((cell) => cell.arm === armId)
  const dm = (armId, read) =>
    median(
      of(armId)
        .map((cell) => read(cell.dm ?? {}))
        .filter((one) => typeof one === 'number'),
    )

  lines.push('## What the boss was sent')
  lines.push('')
  lines.push('Median over the cells of the arm, counting only the messages the Employee wrote to the boss.')
  lines.push('`est tokens` is characters \u00f7 4. The boss\u2019s own lines are a fixed script and identical in')
  lines.push('every arm, so nothing of them is in these columns.')
  lines.push('')
  lines.push('| arm | messages | characters | words | est tokens | % | session tokens | % |')
  lines.push('|---|--:|--:|--:|--:|--:|--:|--:|')
  for (const arm of arms) {
    const one = summarise(of(arm))
    const estimated = dm(arm, (one) => one.estTokens)
    const pct = (value, base) => (arm === baseArm ? '\u2014' : num(percentOf(value, base)))
    lines.push(
      `| \`${arm}\` | ${num(
        dm(arm, (one) => one.messages),
        0,
      )} | ${num(
        dm(arm, (one) => one.chars),
        0,
      )} | ${num(
        dm(arm, (one) => one.words),
        0,
      )} | ${num(estimated, 0)} ` +
        `| ${pct(
          estimated,
          dm(baseArm, (one) => one.estTokens),
        )} | ${tokens(one.totalTokens.median)} ` +
        `| ${pct(one.totalTokens.median, summarise(of(baseArm)).totalTokens.median)} |`,
    )
  }
  lines.push('')

  lines.push('## Whether the answers still said it')
  lines.push('')
  lines.push('Every question the boss put, and whether the reply it drew carried the fact asked for: a file')
  lines.push('path, a number of tests, a yes or a no. A question that drew no reply counts as wrong, so an arm')
  lines.push('cannot score better by answering less. It is a keyword check, not a review of the answer.')
  lines.push('')
  lines.push('| arm | questions asked | facts held | % | missing |')
  lines.push('|---|--:|--:|--:|---|')
  for (const arm of arms) {
    const rows = of(arm)
    const asked = rows.reduce((total, cell) => total + (cell.answers?.asked ?? 0), 0)
    const checks = rows.reduce((total, cell) => total + (cell.answers?.checks ?? 0), 0)
    const held = rows.reduce((total, cell) => total + (cell.answers?.held ?? 0), 0)
    const missing = [...new Set(rows.flatMap((cell) => cell.answers?.missing ?? []))]
    lines.push(
      `| \`${arm}\` | ${asked} | ${held}/${checks} | ${checks ? num((held / checks) * 100, 0) : '\u2014'} ` +
        `| ${missing.length ? missing.join(', ') : '\u2014'} |`,
    )
  }
  lines.push('')
}

/**
 * The whole results file. One markdown string: the headline table, a per-unit table, whatever the
 * shape of the run adds, the RTK numbers, every limitation the run has, and the exact command that
 * produced it.
 *
 * Nothing here decides what is a win. It prints both columns — the absolute number and the
 * percentage of the arm everything is compared against — and lets the reader see a 107 for what it is.
 */
export function renderReport({ run, cells, arms, tasks }) {
  const baseArm = run.baseArm ?? 'baseline'
  const byArm = new Map(arms.map((arm) => [arm, summarise(forArm(cells, arm))]))
  // A run started with `--arms rtk` has no baseline to be a percentage of, and the honest answer
  // to "what percentage of nothing" is a dash in every one of those columns.
  const base = byArm.get(baseArm) ?? null
  const lines = []

  lines.push(`# bench:tokens — ${run.mode ?? 'solo'}, ${run.model}, n=${run.n}, ${run.date}`)
  lines.push('')
  lines.push(
    `${cells.length} cells: ${tasks.length} ${run.unit ?? 'ticket'}${tasks.length === 1 ? '' : 's'} × ` +
      `${arms.length} arms × n=${run.n}, each in its own fresh copy of ${run.fixture}, pinned at ` +
      `\`${run.commit.slice(0, 12)}\`. One cell is ${run.shape ?? 'one real Claude Code session'}.`,
  )
  lines.push('')
  lines.push(`\`\`\`\n${run.command}\n\`\`\``)
  lines.push('')

  lines.push('## Per arm')
  lines.push('')
  lines.push('Median over every cell of the arm, `±` half the interquartile range. `%` is the median as a')
  lines.push(`percentage of \`${baseArm}\`: **above 100 means the arm spent more.**`)
  lines.push('')
  lines.push('| arm | total tokens | % | output tokens | % | cost | % | seconds | lines + | tests green |')
  lines.push('|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|')
  for (const arm of arms) {
    const one = byArm.get(arm)
    const pct = (read) => (arm === baseArm || !base ? '\u2014' : `${num(percentOf(read(one), read(base)))}`)
    lines.push(
      `| \`${arm}\` | ${tokens(one.totalTokens.median)} | ${pct((s) => s.totalTokens.median)} ` +
        `| ${tokens(one.outputTokens.median)} | ${pct((s) => s.outputTokens.median)} ` +
        `| ${usd(one.costUsd.median)} | ${pct((s) => s.costUsd.median)} ` +
        `| ${cell(one.seconds.median, one.seconds.iqr)} | ${cell(one.linesAdded.median, one.linesAdded.iqr)} ` +
        `| ${one.testsPassed}/${one.testsRun} |`,
    )
  }
  lines.push('')
  lines.push('| arm | cells | measured | cache read | turns | lines − |')
  lines.push('|---|--:|--:|--:|--:|--:|')
  for (const arm of arms) {
    const one = byArm.get(arm)
    lines.push(
      `| \`${arm}\` | ${one.n} | ${one.ran} | ${tokens(one.cacheReadTokens.median)} ` +
        `| ${num(one.turns.median)} | ${num(one.linesRemoved.median)} |`,
    )
  }
  lines.push('')

  lines.push(`## Per ${run.unit ?? 'task'}`)
  lines.push('')
  for (const task of tasks) {
    const here = cells.filter((one) => one.task === task.id)
    const baseHere = arms.includes(baseArm) ? summarise(here.filter((one) => one.arm === baseArm)) : null
    lines.push(`### \`${task.id}\` — ${task.size}${task.trap === 'none' ? '' : `, over-build trap: ${task.trap}`}`)
    lines.push('')
    lines.push('| arm | total tokens | % | cost | % | lines + | % | tests green |')
    lines.push('|---|--:|--:|--:|--:|--:|--:|--:|')
    for (const arm of arms) {
      const one = summarise(here.filter((cell) => cell.arm === arm))
      const pct = (read) => (arm === baseArm || !baseHere ? '\u2014' : `${num(percentOf(read(one), read(baseHere)))}`)
      lines.push(
        `| \`${arm}\` | ${tokens(one.totalTokens.median)} | ${pct((s) => s.totalTokens.median)} ` +
          `| ${usd(one.costUsd.median)} | ${pct((s) => s.costUsd.median)} ` +
          `| ${num(one.linesAdded.median)} | ${pct((s) => s.linesAdded.median)} | ${one.testsPassed}/${one.testsRun} |`,
      )
    }
    lines.push('')
  }

  if (run.mode === 'long') renderLegs(lines, { cells, arms, baseArm })
  if (run.mode === 'duo') renderDuo(lines, { cells, arms, baseArm })
  if (run.mode === 'boss') renderBoss(lines, { cells, arms, baseArm })

  lines.push('## What RTK filtered')
  lines.push('')
  lines.push("RTK's own count, from `rtk gain` against each cell's own `RTK_DB_PATH`. It is an estimate:")
  lines.push('RTK ships no tokenizer and counts bytes ÷ 4, and command output is only part of a session.')
  lines.push('')
  lines.push('| arm | commands filtered | tokens not read | cut of command output |')
  lines.push('|---|--:|--:|--:|')
  for (const arm of arms) {
    const one = byArm.get(arm)
    if (!one.rtkSaved) continue
    lines.push(
      `| \`${arm}\` | ${num(one.rtkSaved.commands, 0)} | ${tokens(one.rtkSaved.median)} | ${num(one.rtkCutPercent)}% |`,
    )
  }
  lines.push('')

  lines.push('## Isolation')
  lines.push('')
  const dirty = cells.filter((one) => (one.breaches ?? []).length > 0)
  const sessions = cells.reduce((total, one) => total + (one.sessionIds?.length ?? 1), 0)
  lines.push(
    dirty.length === 0
      ? `All ${cells.length} cells were checked against the ${sessions} transcripts their sessions wrote: no hook ` +
          'fired that its arm does not declare, no MCP server was called that it does not declare, no plugin ' +
          'skill was offered, and each system prompt held its own arm’s text and no other arm’s.'
      : `**${dirty.length} of ${cells.length} cells were contaminated** and are listed in the JSONL:`,
  )
  for (const one of dirty.slice(0, 10)) lines.push(`- \`${one.id}\`: ${one.breaches.join('; ')}`)
  lines.push('')

  const failed = cells.filter((one) => !one.result)
  if (failed.length > 0) {
    lines.push('## Cells with no measurement')
    lines.push('')
    lines.push(`${failed.length} of ${cells.length} produced no result JSON and are in no median above.`)
    for (const one of failed.slice(0, 20)) lines.push(`- \`${one.id}\`: ${one.error ?? 'no result'}`)
    lines.push('')
  }

  lines.push('## Limitations')
  lines.push('')
  for (const line of run.limitations) lines.push(`- ${line}`)
  lines.push('')
  lines.push(`Raw JSONL: \`${run.jsonl}\`. Claude Code ${run.claudeVersion}; RTK ${run.rtkVersion ?? 'not used'}.`)
  lines.push('')
  return lines.join('\n')
}
