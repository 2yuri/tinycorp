import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Company } from '../../shared/company'
import type { RecentCompanies } from '../core'

/** Recent Companies kept as a JSON file, normally in Electron's userData folder. */
export function recentsFile(file: string): RecentCompanies {
  function read(): Company[] {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
      return Array.isArray(parsed) ? (parsed as Company[]) : []
    } catch {
      return []
    }
  }

  function write(companies: Company[]): void {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(companies, null, 2))
  }

  return {
    list: read,
    remember(company) {
      const companies = read()
      const index = companies.findIndex((c) => c.id === company.id)
      if (index === -1) companies.push(company)
      else companies[index] = company
      write(companies)
    },
    forget(id) {
      const companies = read()
      const kept = companies.filter((c) => c.id !== id)
      if (kept.length !== companies.length) write(kept)
    },
  }
}
