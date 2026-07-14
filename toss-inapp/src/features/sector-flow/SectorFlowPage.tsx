import { useEffect, useState } from 'react'

import { apiClient } from '../../shared/api/client'
import { ApiError } from '../../shared/api/http'
import type { Market, SectorRow, SectorSnapshot } from '../../shared/api/types'

const MARKET_OPTIONS: Array<{ value: Market; label: string }> = [
  { value: 'us', label: '미국주식' },
  { value: 'krx', label: '국내주식' },
] as const

const METRIC_OPTIONS = [
  { key: 'return_1d_pct', label: '1일 수익률' },
  { key: 'return_5d_pct', label: '1주 수익률' },
  { key: 'return_21d_pct', label: '1개월 수익률' },
  { key: 'return_63d_pct', label: '3개월 수익률' },
  { key: 'trend_score', label: '추세 점수' },
] as const

type MetricKey = (typeof METRIC_OPTIONS)[number]['key']

function formatPct(value?: number | null) {
  if (value === undefined || value === null) {
    return '-'
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

function formatMetricValue(sector: SectorRow, metric: MetricKey) {
  if (metric === 'trend_score') {
    return `${sector.trend_score >= 0 ? '+' : ''}${sector.trend_score.toFixed(1)}`
  }
  return formatPct(sector[metric])
}

function formatAsOf(value?: string) {
  if (!value) {
    return '-'
  }
  return value.split('T', 1)[0]
}

function sortSectors(sectors: SectorRow[], metric: MetricKey) {
  return [...sectors].sort((left, right) => {
    const leftValue = metric === 'trend_score' ? left.trend_score : Number(left[metric] ?? -9999)
    const rightValue = metric === 'trend_score' ? right.trend_score : Number(right[metric] ?? -9999)
    return rightValue - leftValue
  })
}

function trendPositionLabel(flag: boolean) {
  return flag ? '위' : '아래'
}

function renderComponentNames(sector: SectorRow) {
  if (!sector.components || sector.components.length === 0) {
    return sector.proxy_label
  }
  return sector.components.map((item) => `${item.name}(${item.ticker})`).join(', ')
}

export function SectorFlowPage() {
  const [market, setMarket] = useState<Market>('us')
  const [metric, setMetric] = useState<MetricKey>('return_21d_pct')
  const [snapshot, setSnapshot] = useState<SectorSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshToken, setRefreshToken] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const abortController = new AbortController()

    async function loadSnapshot() {
      setLoading(true)
      setError(null)

      try {
        const result = await apiClient.marketSectors(market, abortController.signal)
        setSnapshot(result)
      } catch (caughtError) {
        if (abortController.signal.aborted) {
          return
        }
        if (caughtError instanceof ApiError) {
          setError(caughtError.detail)
        } else if (caughtError instanceof Error) {
          setError(caughtError.message)
        } else {
          setError('섹터 데이터를 불러오지 못했습니다.')
        }
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false)
        }
      }
    }

    void loadSnapshot()

    return () => abortController.abort()
  }, [market, refreshToken])

  const sectors = snapshot?.sectors ?? []
  const sortedSectors = sortSectors(sectors, metric)

  return (
    <main className="page-shell">
      <section className="content-panel">
        <p className="content-panel__eyebrow">종가베팅 1단계</p>
        <h2 className="content-panel__title">주요 섹터 흐름</h2>
        <p className="content-panel__description">
          오늘 강한 섹터와 추세를 비교합니다.
        </p>
      </section>

      <section className="content-panel">
        <div className="toolbar-row">
          <div className="segmented-control" role="tablist" aria-label="시장 선택">
            {MARKET_OPTIONS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={
                  item.value === market
                    ? 'segmented-control__button segmented-control__button--active'
                    : 'segmented-control__button'
                }
                onClick={() => setMarket(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="secondary-action"
            onClick={() => setRefreshToken((value) => value + 1)}
          >
            새로고침
          </button>
        </div>

        <p className="helper-text">
          미국은 섹터 ETF, 국내는 대표 종목 기준입니다.
        </p>

        {loading ? <div className="state-box">섹터 흐름을 불러오는 중입니다...</div> : null}
        {!loading && error ? <div className="state-box state-box--error">{error}</div> : null}

        {!loading && !error && snapshot ? (
          <>
            <div className="summary-card">
              <div>
                <p className="summary-card__label">기준 시점</p>
                <strong className="summary-card__value">{formatAsOf(snapshot.as_of)}</strong>
              </div>
              <p className="summary-card__text">{snapshot.summary}</p>
            </div>

            <div className="section-block">
              <div className="section-block__header">
                <h3>상대 강세 섹터</h3>
              </div>
              <div className="sector-card-grid">
                {snapshot.leaders.slice(0, 3).map((sector, index) => (
                  <article key={sector.key} className="sector-card">
                    <p className="sector-card__rank">강세 {index + 1}</p>
                    <h4 className="sector-card__title">{sector.name}</h4>
                    <p className="sector-card__subtitle">{sector.trend_label}</p>
                    <p className="sector-card__metric">
                      1개월 {formatPct(sector.return_21d_pct)} / 3개월 {formatPct(sector.return_63d_pct)}
                    </p>
                    <p className="sector-card__meta">
                      20일선 {trendPositionLabel(sector.above_20dma)} / 60일선{' '}
                      {trendPositionLabel(sector.above_60dma)}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            {snapshot.laggards.length > 0 ? (
              <div className="section-block">
                <div className="section-block__header">
                  <h3>약한 섹터</h3>
                </div>
                <div className="sector-card-grid sector-card-grid--compact">
                  {snapshot.laggards.slice(0, 2).map((sector, index) => (
                    <article key={sector.key} className="sector-card">
                      <p className="sector-card__rank">약세 {index + 1}</p>
                      <h4 className="sector-card__title">{sector.name}</h4>
                      <p className="sector-card__subtitle">{sector.trend_label}</p>
                      <p className="sector-card__metric">
                        1개월 {formatPct(sector.return_21d_pct)} / 3개월 {formatPct(sector.return_63d_pct)}
                      </p>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="section-block">
              <div className="section-block__header">
                <h3>메트릭 비교</h3>
              </div>

              <div className="chip-row" role="tablist" aria-label="메트릭 선택">
                {METRIC_OPTIONS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={
                      item.key === metric ? 'chip chip--active' : 'chip'
                    }
                    onClick={() => setMetric(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="sector-list">
                {sortedSectors.map((sector) => (
                  <article key={sector.key} className="sector-list__item">
                    <div className="sector-list__top">
                      <div>
                        <h4 className="sector-list__title">{sector.name}</h4>
                        <p className="sector-list__subtitle">{sector.trend_label}</p>
                      </div>
                      <strong className="sector-list__value">
                        {formatMetricValue(sector, metric)}
                      </strong>
                    </div>
                    <p className="sector-list__meta">
                      기준: {sector.proxy_label} / 구성: {renderComponentNames(sector)}
                    </p>
                    <p className="sector-list__meta">
                      20일선 {trendPositionLabel(sector.above_20dma)} / 60일선{' '}
                      {trendPositionLabel(sector.above_60dma)}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div className="content-panel content-panel--nested">
              <p className="content-panel__eyebrow">해석 기준</p>
              <ul className="bullet-list">
                <li>수익률과 20·60일선 위치로 강도를 판단합니다.</li>
                <li>국내 결과는 대표 종목 기준입니다.</li>
              </ul>
            </div>
          </>
        ) : null}
      </section>
    </main>
  )
}
