import { DailyRoutineCard } from './DailyRoutineCard'
import { HomeRankingCard } from './HomeRankingCard'
import { WatchlistCard } from './WatchlistCard'

export function HomePage() {
  return (
    <main className="page-shell home-page">
      <DailyRoutineCard />
      <HomeRankingCard />
      <WatchlistCard />
    </main>
  )
}
