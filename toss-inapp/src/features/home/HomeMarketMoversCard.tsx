import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { MarketMoverLists } from '../market-movers/MarketMoverLists'
import { apiClient } from '../../shared/api/client'
import type { Market, MarketMoversSnapshot } from '../../shared/api/types'

const MARKETS: Array<{ market: Market; label: string }> = [
  { market: 'us', label: '미국 증시' },
  { market: 'krx', label: '국내 증시' },
]

export function HomeMarketMoversCard() {
  const [snapshots, setSnapshots] = useState<Partial<Record<Market, MarketMoversSnapshot>>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    const abortController = new AbortController()

    async function loadMovers() {
      setLoading(true)
      setError(false)
      const results = await Promise.allSettled(
        MARKETS.map(({ market }) => apiClient.marketMovers(market, 3, abortController.signal)),
      )
      if (abortController.signal.aborted) return

      const nextSnapshots: Partial<Record<Market, MarketMoversSnapshot>> = {}
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          nextSnapshots[MARKETS[index].market] = result.value
        }
      })
      setSnapshots(nextSnapshots)
      setError(results.some((result) => result.status === 'rejected'))
      setLoading(false)
    }

    void loadMovers()
    return () => abortController.abort()
  }, [refreshToken])

  return (
    <section className="home-movers" aria-labelledby="home-movers-title">
      <div className="home-movers__header">
        <div>
          <p>전일 대비 시장 급등락</p>
          <h2 id="home-movers-title">최근 거래일 강했던 종목과 약했던 종목</h2>
        </div>
        <Link to="/market-movers">전체보기 <span aria-hidden="true">›</span></Link>
      </div>

      {loading ? <div className="home-movers__state">미국·국내 증시를 확인하고 있어요...</div> : null}
      {!loading && error ? (
        <div className="home-movers__state home-movers__state--error">
          <span>{Object.keys(snapshots).length > 0 ? '일부 시장 데이터를 불러오지 못했어요.' : '급등락 데이터를 불러오지 못했어요.'}</span>
          <button type="button" onClick={() => setRefreshToken((value) => value + 1)}>다시 시도</button>
        </div>
      ) : null}

      {!loading ? MARKETS.map(({ market, label }) => {
        const snapshot = snapshots[market]
        if (!snapshot) return null
        return (
          <section key={market} className="home-movers__market" aria-label={label}>
            <div className="home-movers__market-title">
              <strong>{label}</strong>
              <span>{snapshot.as_of.slice(0, 10)}{snapshot.is_stale ? ' · 이전 데이터' : ''}</span>
            </div>
            <MarketMoverLists gainers={snapshot.gainers} losers={snapshot.losers} limit={3} />
          </section>
        )
      }) : null}
    </section>
  )
}
