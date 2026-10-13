import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROVIDER_CATALOGUE } from './domain/providers'

/**
 * The files a repo needs before it is public, held to the same standard as the rest of the docs
 * (T182).
 *
 * None of this is behaviour, and all of it is the kind of thing that goes missing in a rename, a
 * restructure or a merge that took "theirs" — and nobody notices, because nothing fails. A repo
 * with no LICENSE is a repo nobody may legally fork; a SECURITY.md with no reporting route sends a
 * researcher to a public issue; a `license` field that says something else than the LICENSE file is
 * what an automated scan believes.
 *
 * The Provider check is the one that will actually fire one day: the bug form asks which Provider,
 * and a Provider added to the catalogue with no row in that dropdown is a report we cannot
 * reproduce. Nothing else in the repo names a Provider outside the catalogue (`no-provider-names`),
 * and this is the exception that has to be kept honest by a test.
 */

const ROOT = join(import.meta.dirname, '..', '..')
const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8')

describe('the licence', () => {
  const license = read('LICENSE')

  it('is the Apache License 2.0, in full', () => {
    expect(license).toContain('Apache License')
    expect(license).toContain('Version 2.0, January 2004')
    // The last section, so a truncated copy is caught rather than a file that starts convincingly.
    expect(license).toContain('END OF TERMS AND CONDITIONS')
  })

  it('is held by the authors, and says which year from', () => {
    expect(license).toContain('Copyright 2026 The TinyCorp authors')
  })

  it('is what package.json says it is', () => {
    const manifest = JSON.parse(read('package.json')) as { license?: string }

    expect(manifest.license).toBe('Apache-2.0')
  })

  it('credits the ideas it borrowed, in NOTICE', () => {
    const notice = read('NOTICE')

    expect(notice).toContain('Copyright 2026 The TinyCorp authors')
    expect(notice).toContain('akitaonrails/ai-memory')
    expect(notice).toContain('MIT')
  })
})

describe('SECURITY.md', () => {
  const security = read('SECURITY.md')

  it('sends a report through GitHub private vulnerability reporting, and nowhere public', () => {
    expect(security).toContain('security/advisories/new')
    expect(security.toLowerCase()).toContain('private vulnerability reporting')
  })

  it('promises when we answer', () => {
    expect(security).toContain('within 7 days')
  })

  it('says which versions are supported', () => {
    expect(security).toContain('## Supported versions')
    expect(security).toContain('the latest release')
  })

  /**
   * A researcher can only be specific about a surface they were told exists. Each of these is a
   * place where a bug costs the boss something real, so each is named on the page by the file that
   * implements it — and a rename that leaves this list behind fails here.
   */
  it('names every part of the attack surface', () => {
    for (const surface of [
      'src/main/core/engine/company-mcp-server.ts',
      'src/main/providers/hooks/hook-receiver.ts',
      'src/main/platform/net/listen-on.ts',
      'src/main/features/environments/environments.ts',
      'src/main/features/environments/env-run.ts',
      'src/main/platform/safe-storage-secrets.ts',
      '127.0.0.1',
      'per-Session token',
      'libsecret',
      'subscription',
    ]) {
      expect(security, `SECURITY.md no longer names ${surface}`).toContain(surface)
    }
  })
})

describe('CODE_OF_CONDUCT.md', () => {
  it('is the Contributor Covenant 2.1, with somewhere to send a report', () => {
    const conduct = read('CODE_OF_CONDUCT.md')

    expect(conduct).toContain('Contributor Covenant')
    expect(conduct).toContain('version 2.1')
    expect(conduct).toContain('hello@tinycorp.club')
    expect(conduct).not.toContain('[INSERT CONTACT METHOD]')
  })
})

describe('the GitHub files', () => {
  it('review every path through the maintainer', () => {
    expect(read('.github', 'CODEOWNERS')).toContain('* @2yuri')
  })

  it('offer a form for a bug, a feature and a new Provider or forge, and send a question to Discussions', () => {
    expect(read('.github', 'ISSUE_TEMPLATE', 'bug_report.yml')).toContain('name: Bug report')
    expect(read('.github', 'ISSUE_TEMPLATE', 'feature_request.yml')).toContain('name: Feature request')
    const providerForm = read('.github', 'ISSUE_TEMPLATE', 'provider_or_forge.yml')
    expect(providerForm).toContain('docs/providers.md')
    expect(providerForm).toContain('docs/forges.md')

    const config = read('.github', 'ISSUE_TEMPLATE', 'config.yml')
    expect(config).toContain('blank_issues_enabled: false')
    expect(config).toContain('/discussions')
    expect(config).toContain('security/advisories/new')
  })

  it('ask the bug reporter which platform and which Provider', () => {
    const form = read('.github', 'ISSUE_TEMPLATE', 'bug_report.yml')

    for (const platform of ['macOS', 'Windows', 'WSL', 'Linux']) {
      expect(form, `the bug form offers no ${platform}`).toContain(platform)
    }
    for (const provider of PROVIDER_CATALOGUE) {
      expect(form, `${provider.name} is in the catalogue and not in the bug form's Provider list`).toContain(
        provider.name,
      )
    }
  })

  it('give a pull request the checklist CONTRIBUTING.md holds it to', () => {
    const template = read('.github', 'pull_request_template.md')

    expect(template).toContain('pnpm typecheck')
    expect(template).toContain('git commit -s')
    expect(template).toContain('macOS · Windows · Linux')
    expect(template).toContain('before and after')
  })
})

describe('the workflows', () => {
  const prTitle = read('.github', 'workflows', 'pr-title.yml')

  /** release-please reads these, and CONTRIBUTING and AGENTS both promise the same list. */
  const TYPES = ['feat', 'fix', 'refactor', 'chore', 'docs', 'test', 'perf', 'build']

  it('check the pull request title against the types the docs promise', () => {
    expect(prTitle).toContain('amannn/action-semantic-pull-request')
    const listed = prTitle.slice(prTitle.indexOf('types: |'), prTitle.indexOf('requireScope'))
    for (const type of TYPES) {
      expect(listed, `pr-title.yml does not allow ${type}`).toContain(type)
    }

    const contributing = read('CONTRIBUTING.md')
    const agents = read('AGENTS.md')
    for (const doc of [contributing, agents]) {
      for (const type of TYPES) {
        expect(doc, `a doc lists the types and leaves out ${type}`).toContain(`\`${type}\``)
      }
    }
  })

  it('check that every commit is signed off', () => {
    const dco = read('.github', 'workflows', 'dco.yml')

    expect(dco).toContain('Signed-off-by')
    expect(dco).toContain('git rev-list')
    expect(read('CONTRIBUTING.md')).toContain('git commit -s')
  })
})

describe('renovate.json', () => {
  const renovate = JSON.parse(read('renovate.json')) as {
    extends?: string[]
    schedule?: string[]
    dependencyDashboard?: boolean
    minimumReleaseAge?: string
    packageRules?: { groupName?: string; matchPackageNames?: string[]; allowedVersions?: string }[]
  }

  it('waits three days, runs weekly, and keeps a dashboard', () => {
    expect(renovate.extends).toContain('config:recommended')
    expect(renovate.minimumReleaseAge).toBe('3 days')
    expect(renovate.schedule?.join(' ')).toContain('monday')
    expect(renovate.dependencyDashboard).toBe(true)
  })

  it('moves Electron and the two tools built against it together', () => {
    const group = renovate.packageRules?.find((rule) => rule.groupName === 'electron')

    expect(group?.matchPackageNames).toEqual(['electron', 'electron-builder', 'electron-vite'])
  })

  it('holds TypeScript below its next major', () => {
    const rule = renovate.packageRules?.find((each) => each.matchPackageNames?.includes('typescript'))

    expect(rule?.allowedVersions).toBe('<8')
  })
})
