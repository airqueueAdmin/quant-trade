import { Link } from 'react-router-dom'

import type { MarketMover } from '../../shared/api/types'

function formatPct(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function formatPrice(item: MarketMover) {
  if (item.currency === 'KRW') {
    return `${Math.round(item.price).toLocaleString('ko-KR')}원`
  }
  return `$${item.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function analysisPath(item: MarketMover) {
  const params = new URLSearchParams({ market: item.market, ticker: item.ticker })
  if (item.market === 'krx') {
    params.set('krx_exchange', item.krx_exchange)
  }
  return `/ai-analysis?${params.toString()}`
}

function MoverList({ items, tone }: { items: MarketMover[]; tone: 'up' | 'down' }) {
  if (items.length === 0) {
    return <p className="market-movers__empty">조건에 맞는 종목이 없어요.</p>
  }

  return (
    <div className="market-movers__rows">
      {items.map((item, index) => (
        <Link key={item.resolved_ticker} className="market-movers__row" to={analysisPath(item)}>
          <span className="market-movers__rank">{index + 1}</span>
          <span className="market-movers__stock">
            <strong>{item.name}</strong>
            <small>{item.ticker} · {formatPrice(item)}</small>
          </span>
          <b className={`market-movers__change market-movers__change--${tone}`}>
            {formatPct(item.change_pct)}
          </b>
        </Link>
      ))}
    </div>
  )
}

export function MarketMoverLists({
  gainers,
  losers,
  limit,
}: {
  gainers: MarketMover[]
  losers: MarketMover[]
  limit?: number
}) {
  const visibleGainers = limit ? gainers.slice(0, limit) : gainers
  const visibleLosers = limit ? losers.slice(0, limit) : losers

  return (
    <div className="market-movers__columns">
      <section className="market-movers__column market-movers__column--up" aria-label="급등 종목">
        <div className="market-movers__column-title">
          <span aria-hidden="true">↗</span>
          <strong>급등</strong>
        </div>
        <MoverList items={visibleGainers} tone="up" />
      </section>
      <section className="market-movers__column market-movers__column--down" aria-label="급락 종목">
        <div className="market-movers__column-title">
          <span aria-hidden="true">↘</span>
          <strong>급락</strong>
        </div>
        <MoverList items={visibleLosers} tone="down" />
      </section>
    </div>
  )
}
