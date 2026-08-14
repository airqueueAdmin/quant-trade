import { DailyRoutineCard } from './DailyRoutineCard'
import { HomeRankingCard } from './HomeRankingCard'
import { HomeMarketMoversCard } from './HomeMarketMoversCard'
import { WatchlistCard } from './WatchlistCard'

export function HomePage() {
  return (
    <main className="page-shell home-page">
      <HomeMarketMoversCard />
      <DailyRoutineCard />
      <HomeRankingCard />
      <WatchlistCard />
    </main>
  )
}
