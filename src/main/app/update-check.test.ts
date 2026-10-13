import { describe, expect, it, vi } from 'vitest'
import { CHECK_EVERY_MS, type ReleaseNews, type UpdateState } from '../../shared/app/updates'
import { createUpdateCheck, readLatestRelease, releaseNews } from './update-check'

function release(tag: string, patch: Partial<ReleaseNews> = {}): ReleaseNews {
  return {
    tag,
    version: tag.replace(/^v/, ''),
    publishedAt: '2026-09-18T09:00:00Z',
    url: `https://github.com/2yuri/tinycorp/releases/tag/${tag}`,
    ...patch,
  }
}

function setup(options: { current?: string; answers?: (ReleaseNews | null)[] } = {}) {
  const answers = [...(options.answers ?? [])]
  let clock = 1_000
  const reads: string[] = []
  const announced: UpdateState[] = []
  const check = createUpdateCheck({
    currentVersion: () => options.current ?? '0.3.9',
    now: () => clock,
    onChanged: (state) => announced.push(state),
    readLatest: async (repo) => {
      reads.push(repo)
      return answers.shift() ?? null
    },
  })
  return { check, reads, announced, advance: (ms: number) => (clock += ms) }
}

describe('what the check makes of a tag', () => {
  it('a newer tag is an update the boss is told about', async () => {
    const it_ = setup({ answers: [release('v0.4.0')] })
    const state = await it_.check.check()
    expect(state.available?.version).toBe('0.4.0')
    expect(state.current).toBe('0.3.9')
    expect(state.available?.url).toBe('https://github.com/2yuri/tinycorp/releases/tag/v0.4.0')
  })

  it('the same tag is nothing to say', async () => {
    const it_ = setup({ answers: [release('v0.3.9')] })
    expect((await it_.check.check()).available).toBeNull()
  })

  it('an older tag never talks the boss into going backwards', async () => {
    const it_ = setup({ answers: [release('v0.3.8')] })
    expect((await it_.check.check()).available).toBeNull()
  })

  it('a malformed tag is ignored rather than trusted', async () => {
    const it_ = setup({ answers: [release('nightly', { version: 'nightly' })] })
    expect((await it_.check.check()).available).toBeNull()
  })
})

describe('the six-hour gate', () => {
  it('reads GitHub once however many things ask inside the window', async () => {
    const it_ = setup({ answers: [release('v0.4.0')] })
    await it_.check.check()
    it_.advance(CHECK_EVERY_MS - 1)
    await it_.check.check()
    await it_.check.check()
    expect(it_.reads).toEqual(['2yuri/tinycorp'])
  })

  it('asks again once six hours have passed', async () => {
    const it_ = setup({ answers: [null, release('v0.4.0')] })
    await it_.check.check()
    it_.advance(CHECK_EVERY_MS)
    const state = await it_.check.check()
    expect(it_.reads).toHaveLength(2)
    expect(state.available?.version).toBe('0.4.0')
  })

  it('does not apply to Check now: the boss asked', async () => {
    const it_ = setup({ answers: [null, release('v0.4.0')] })
    await it_.check.check()
    const state = await it_.check.checkNow()
    expect(it_.reads).toHaveLength(2)
    expect(state.available?.version).toBe('0.4.0')
  })

  it('two callers at once share the one request', async () => {
    const it_ = setup({ answers: [release('v0.4.0')] })
    await Promise.all([it_.check.checkNow(), it_.check.checkNow()])
    expect(it_.reads).toHaveLength(1)
  })
})

describe('a failed request', () => {
  it('stays silent: no update, and nothing thrown', async () => {
    const it_ = setup({ answers: [null] })
    const state = await it_.check.check()
    expect(state.available).toBeNull()
    expect(state.checkedAt).not.toBeNull()
  })

  it('keeps what an earlier check found rather than forgetting it', async () => {
    const it_ = setup({ answers: [release('v0.4.0'), null] })
    await it_.check.check()
    const state = await it_.check.checkNow()
    expect(state.available?.version).toBe('0.4.0')
  })

  it('is silence even when the read throws, so nothing is left waiting on it', async () => {
    const announced: UpdateState[] = []
    const check = createUpdateCheck({
      currentVersion: () => '0.3.9',
      onChanged: (state) => announced.push(state),
      readLatest: () => Promise.reject(new Error('socket hang up')),
    })

    await expect(check.check()).resolves.toMatchObject({ available: null, checking: false })
    expect(announced.map((s) => s.checking)).toEqual([true, false])
  })

  it('says nothing before the first request has finished', () => {
    const it_ = setup({ answers: [release('v0.4.0')] })
    expect(it_.check.state()).toMatchObject({ available: null, checkedAt: null, checking: false })
  })
})

describe('what the windows are told', () => {
  it('announces the request starting and the answer, so Check now can say it is checking', async () => {
    const it_ = setup({ answers: [release('v0.4.0')] })
    await it_.check.checkNow()
    expect(it_.announced.map((s) => s.checking)).toEqual([true, false])
    expect(it_.announced.at(-1)?.available?.version).toBe('0.4.0')
  })

  it('says nothing when the gate turns a check away', async () => {
    const it_ = setup({ answers: [release('v0.4.0')] })
    await it_.check.check()
    it_.announced.length = 0
    await it_.check.check()
    expect(it_.announced).toEqual([])
  })
})

describe('reading a release body', () => {
  it('keeps the tag, the version, the date and the page', () => {
    expect(
      releaseNews({
        tag_name: 'v0.4.0',
        published_at: '2026-09-18T09:00:00Z',
        html_url: 'https://github.com/2yuri/tinycorp/releases/tag/v0.4.0',
      }),
    ).toEqual(release('v0.4.0'))
  })

  it('refuses a draft, a tag that is not a version, and a body that is not one', () => {
    expect(releaseNews({ tag_name: 'v0.4.0', draft: true })).toBeNull()
    expect(releaseNews({ tag_name: 'nightly' })).toBeNull()
    expect(releaseNews({})).toBeNull()
    expect(releaseNews(null)).toBeNull()
    expect(releaseNews('v0.4.0')).toBeNull()
  })

  it('hands the browser only a GitHub page, whatever the body says', () => {
    expect(releaseNews({ tag_name: 'v0.4.0', html_url: 'javascript:alert(1)' })).toBeNull()
    expect(releaseNews({ tag_name: 'v0.4.0' })?.url).toBe('https://github.com/2yuri/tinycorp/releases')
  })
})

describe('the one request', () => {
  it('is an unauthenticated read that names nobody', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ tag_name: 'v0.4.0', html_url: 'https://github.com/2yuri/tinycorp/releases/tag/v0.4.0' }),
          {
            status: 200,
          },
        ),
    )
    const news = await readLatestRelease('2yuri/tinycorp', fetcher as unknown as typeof fetch)

    expect(news?.version).toBe('0.4.0')
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.github.com/repos/2yuri/tinycorp/releases/latest')
    expect(url).not.toContain('?')
    const headers = init.headers as Record<string, string>
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('authorization')
    expect(headers['User-Agent']).toBe('TinyCorp')
  })

  it('is silent when GitHub refuses, when there are no releases, and when there is no network', async () => {
    const refused = async () => new Response('', { status: 403 })
    const missing = async () => new Response('', { status: 404 })
    const offline = async () => {
      throw new Error('getaddrinfo ENOTFOUND api.github.com')
    }
    for (const fetcher of [refused, missing, offline]) {
      await expect(readLatestRelease('2yuri/tinycorp', fetcher as unknown as typeof fetch)).resolves.toBeNull()
    }
  })
})
