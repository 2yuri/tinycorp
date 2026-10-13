import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CompanyActionsList, DangerZone, DeleteCompanyDialog } from './CompanyRemoval'

const acme = { id: 'c1', name: 'Acme', folder: '/work/acme' }
const noop = () => {}
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

function dialog(patch: Partial<Parameters<typeof DeleteCompanyDialog>[0]> = {}) {
  return renderToStaticMarkup(
    <DeleteCompanyDialog company={acme} busy={false} error={null} onCancel={noop} onConfirm={noop} {...patch} />,
  )
}

describe('Company actions menu', () => {
  it('offers Remove from launcher, then the destructive Delete company…', () => {
    const html = renderToStaticMarkup(<CompanyActionsList onForget={noop} onDelete={noop} />)

    expect(html).toMatch(/^<div data-ui="Dropdown Menu" data-slot="menu" role="menu"/)
    expect(text(html)).toBe('Remove from launcher Delete company…')
    expect(html).toMatch(/data-destructive="true"[^>]*>.*Delete company…/)
    expect(html.match(/data-destructive="true"/g)).toHaveLength(1)
  })
})

describe('Delete company confirmation', () => {
  it('is a modal alert dialog that names the Company and its folder', () => {
    const html = dialog()

    expect(html).toContain('role="alertdialog"')
    expect(html).toContain('aria-modal="true"')
    expect(text(html)).toMatch(/^Delete Acme\? This stops Acme’s Sessions and deletes its data in \/work\/acme: /)
    expect(html).toMatch(/<code[^>]*>\/work\/acme<\/code>/)
  })

  it('puts Cancel first and the destructive Delete company last', () => {
    const html = dialog()

    expect(text(html)).toMatch(/Cancel Delete company$/)
    expect(html).toMatch(/data-variant="outline"[^>]*>.*Cancel.*data-variant="destructive"[^>]*>.*Delete company/)
  })

  it('disables both buttons while deleting and shows a refusal', () => {
    const html = dialog({ busy: true, error: '/work/acme/worktrees holds a connected repo' })

    expect(html.match(/disabled=""/g)).toHaveLength(2)
    expect(html).toContain('role="alert"')
    expect(text(html)).toContain('/work/acme/worktrees holds a connected repo')
  })
})

describe('Danger zone', () => {
  it('shows both actions, the delete one destructive', () => {
    const html = renderToStaticMarkup(<DangerZone onForget={noop} onDelete={noop} />)

    expect(html).toContain('aria-label="Danger zone"')
    expect(text(html)).toMatch(/^Danger zone .* Remove from launcher Delete company…$/)
    expect(html).toMatch(
      /data-variant="outline"[^>]*>.*Remove from launcher.*data-variant="destructive"[^>]*>.*Delete company…/,
    )
  })
})
