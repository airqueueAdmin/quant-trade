import { useEffect, useState } from 'react'

import { apiClient } from '../../shared/api/client'
import { ApiError } from '../../shared/api/http'
import type { Market, MarketMoversSnapshot } from '../../shared/api/types'
import { readStoredMarketMovers, storeMarketMovers } from '../../shared/market/marketMoversCache'
import { MarketMoverLists } from './MarketMoverLists'

const MARKET_OPTIONS: Array<{ value: Market; label: string }> = [
  { value: 'us', label: '미국 증시' },
  { value: 'krx', label: '국내 증시' },
]
const STALE_REFRESH_INTERVAL_MS = 10_000

export function MarketMoversPage() {
  const [market, setMarket] = useState<Market>('us')
  const [snapshot, setSnapshot] = useState<MarketMoversSnapshot | null>(() => readStoredMarketMovers('us'))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    const abortController = new AbortController()
    let refreshTimer: number | undefined

    async function loadMovers() {
      setLoading(snapshot === null)
      setError(null)
      try {
        const response = await apiClient.marketMovers(market, 10, abortController.signal)
        if (!abortController.signal.aborted) {
          setSnapshot(response)
          storeMarketMovers(response)
          if (response.is_stale) {
            refreshTimer = window.setTimeout(
              () => setRefreshToken((value) => value + 1),
              STALE_REFRESH_INTERVAL_MS,
            )
          }
        }
      } catch (caughtError) {
        if (abortController.signal.aborted) return
        setError(caughtError instanceof ApiError ? caughtError.detail : '급등락 데이터를 불러오지 못했습니다.')
        refreshTimer = window.setTimeout(
          () => setRefreshToken((value) => value + 1),
          STALE_REFRESH_INTERVAL_MS,
        )
      } finally {
        if (!abortController.signal.aborted) setLoading(false)
      }
    }

    void loadMovers()
    return () => {
      abortController.abort()
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
    }
  }, [market, refreshToken])

  return (
    <main className="page-shell market-movers-page">
      <section className="market-movers-hero">
        <p>DAILY MARKET MOVERS</p>
        <h1>전일 대비<br /><em>급등·급락 종목</em></h1>
        <span>최근 거래일 종가를 전일 종가와 비교해 시장의 강한 움직임을 모았어요.</span>
      </section>

      <section className="content-panel market-movers-panel">
        <div className="market-movers-panel__toolbar">
          <div className="segmented-control" role="tablist" aria-label="시장 선택">
            {MARKET_OPTIONS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={item.value === market ? 'segmented-control__button segmented-control__button--active' : 'segmented-control__button'}
                onClick={() => {
                  setMarket(item.value)
                  setSnapshot(readStoredMarketMovers(item.value))
                  setError(null)
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button className="secondary-action" type="button" disabled={loading} onClick={() => setRefreshToken((value) => value + 1)}>
            새로고침
          </button>
        </div>

        {loading ? <div className="state-box">급등·급락 순위를 계산하고 있습니다...</div> : null}
        {!loading && error ? <div className="state-box state-box--error">{error}</div> : null}
        {!loading && snapshot ? (
          <>
            <div className="market-movers-panel__meta">
              <span>{snapshot.as_of.slice(0, 10)} · {snapshot.snapshot_status}</span>
              <small>{snapshot.is_stale ? '최신 데이터로 자동 갱신 중 · ' : ''}{snapshot.universe_note}</small>
            </div>
            <MarketMoverLists gainers={snapshot.gainers} losers={snapshot.losers} />
            <p className="market-movers-panel__hint">종목을 누르면 해당 종목이 선택된 AI 분석으로 이동해요.</p>
          </>
        ) : null}
      </section>
    </main>
  )
}
