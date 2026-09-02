import { env } from '../../shared/config/env'
import { ContactsViralCard } from '../../shared/rewards/ContactsViralCard'
import { DailyRoutineCard } from './DailyRoutineCard'
import { HomeRankingCard } from './HomeRankingCard'
import { HomeMarketMoversCard } from './HomeMarketMoversCard'
import { WatchlistCard } from './WatchlistCard'

export function HomePage() {
  return (
    <main className="page-shell home-page">
      <DailyRoutineCard />
      <HomeRankingCard />
      <ContactsViralCard moduleId={env.rewards.contactsViralModuleId} />
      <HomeMarketMoversCard />
      <WatchlistCard />
    </main>
  )
}
