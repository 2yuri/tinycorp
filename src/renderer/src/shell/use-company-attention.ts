import { useCallback, useEffect, useState } from 'react'
import type { CompanyAttention } from '../../../shared/company'

const api = window.tinyCorp.company

/**
 * The rail's marks for every open Company, by id (T145). The engine keeps the counts cached, so
 * reading them again on each change is one IPC call, not a query per Company.
 */
export function useCompanyAttention(): Map<string, CompanyAttention> {
  const [byId, setById] = useState<Map<string, CompanyAttention>>(new Map())

  const refresh = useCallback(async () => {
    const entries = await api.attention()
    setById(new Map(entries.map((entry) => [entry.companyId, entry])))
  }, [])

  useEffect(() => {
    void refresh()
    const again = () => void refresh()
    // Opening, closing or forgetting a Company changes which ones have marks at all.
    const offs = [api.onAttentionChanged(again), api.onChanged(again)]
    return () => {
      for (const off of offs) off()
    }
  }, [refresh])

  return byId
}
