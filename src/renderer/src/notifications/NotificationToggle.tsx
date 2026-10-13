import { useEffect } from 'react'
import { requestNotificationFocus } from './focus'

const api = window.tinyCorp.notifications

/** Routes clicked notifications to the views that show them. Mount once. */
export function useNotificationClicks(): void {
  useEffect(() => api.onFocus(requestNotificationFocus), [])
}
