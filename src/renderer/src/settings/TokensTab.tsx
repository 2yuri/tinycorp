import { ColleagueVoiceCard } from './ColleagueVoiceCard'
import { CompressCard } from './CompressCard'
import { RememberCard } from './RememberCard'
import '../ui/tailwind.css'
import { COLUMN } from './settings-classes'

/**
 * Tokens (frame `Cg3a8`): two columns, what Employees read on the left and what they write on the
 * right. Compress what Employees read (T179) and What Employees remember (T193) are the left one;
 * How Employees talk is the right one (T180). Every card saves control by control rather than into
 * the form's Save changes, and none of them is part of another.
 */
export function TokensTab({ companyName }: { companyName: string }) {
  return (
    <>
      <div className={COLUMN}>
        <CompressCard companyName={companyName} />
        <RememberCard />
      </div>
      <div className={COLUMN}>
        <ColleagueVoiceCard />
      </div>
    </>
  )
}

export function tokensTabSubtitle(companyName: string): string {
  return `What ${companyName}'s Employees read and how they talk to each other, so your subscription goes further.`
}
