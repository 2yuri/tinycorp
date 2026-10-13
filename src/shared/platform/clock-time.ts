/** "14:00" in local time, with the date in front when it is not today: "Sep 18, 14:00". */
export function clockTime(at: Date, now: Date): string {
  const two = (n: number) => String(n).padStart(2, '0')
  const time = `${two(at.getHours())}:${two(at.getMinutes())}`
  if (at.toDateString() === now.toDateString()) return time
  return `${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`
}
