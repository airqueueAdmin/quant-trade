import { useMemo, useState, type FormEvent } from 'react'

import { apiClient } from '../../shared/api/client'
import { ApiError } from '../../shared/api/http'
import type { KRXSearchResult } from '../../shared/api/types'
import { searchLocalUsStocks, usStockToCompany } from '../../shared/stocks/usStocks'
import { useWatchlist } from '../../shared/watchlist/useWatchlist'

const HOME_KRX_SUGGESTIONS: KRXSearchResult[] = [
  { name: '삼성전자', ticker: '005930', krx_exchange: 'kospi' },
  { name: 'SK하이닉스', ticker: '000660', krx_exchange: 'kospi' },
  { name: '현대차', ticker: '005380', krx_exchange: 'kospi' },
  { name: 'NAVER', ticker: '035420', krx_exchange: 'kospi' },
  { name: '카카오', ticker: '035720', krx_exchange: 'kospi' },
  { name: '알테오젠', ticker: '196170', krx_exchange: 'kosdaq' },
]

function localKrxResults(query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) {
    return []
  }
  return HOME_KRX_SUGGESTIONS.filter((item) =>
    item.name.toLowerCase().includes(normalized) || item.ticker.includes(normalized),
  )
}

function mergeResults(primary: KRXSearchResult[], secondary: KRXSearchResult[]) {
  const merged = new Map<string, KRXSearchResult>()
  for (const item of [...primary, ...secondary]) {
    merged.set(`${item.ticker}-${item.krx_exchange}`, item)
  }
  return [...merged.values()].slice(0, 10)
}

export function WatchlistCard() {
  const { items, addItem, removeItem, limit } = useWatchlist()
  const [market, setMarket] = useState<'krx' | 'us'>('krx')
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<KRXSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const itemIds = useMemo(() => new Set(items.map((item) => item.id)), [items])

  function changeMarket(nextMarket: 'krx' | 'us') {
    setMarket(nextMarket)
    setQuery('')
    setSearchResults([])
    setMessage(null)
    setError(null)
  }

  async function searchStocks() {
    const normalized = query.trim()
    if (!normalized) {
      setError('회사명이나 종목코드를 입력해주세요.')
      return
    }
    const localResults = market === 'krx' ? localKrxResults(normalized) : searchLocalUsStocks(normalized)
    setLoading(true)
    setError(null)
    setMessage(null)
    setSearchResults(localResults)
    try {
      const remoteResults = market === 'krx'
        ? (await apiClient.searchKrxStocks(normalized, 10)).results
        : (await apiClient.searchUsStocks(normalized, 10)).results.map(usStockToCompany)
      const merged = mergeResults(remoteResults, localResults)
      setSearchResults(merged)
      if (merged.length === 0) {
        setError('검색 결과가 없습니다.')
      }
    } catch (caughtError) {
      if (localResults.length === 0) {
        setSearchResults([])
        setError(caughtError instanceof ApiError ? caughtError.detail : `${market === 'krx' ? '국내' : '미국'} 종목 검색에 실패했습니다.`)
      }
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void searchStocks()
  }

  function registerStock(item: KRXSearchResult) {
    const added = addItem({
      market,
      ticker: item.ticker,
      name: item.name,
      krxExchange: market === 'krx' ? item.krx_exchange : 'auto',
    })
    setMessage(added ? `${item.name}을 관심종목에 등록했습니다.` : '이미 등록된 관심종목입니다.')
    setError(null)
  }

  return (
    <section className="content-panel home-watchlist" aria-labelledby="home-watchlist-title">
      <div className="home-watchlist__header">
        <div>
          <p className="content-panel__eyebrow">내 관심종목</p>
          <h2 id="home-watchlist-title" className="content-panel__title">자주 보는 종목을 모아두세요</h2>
          <p className="content-panel__description">등록한 종목은 AI 분석과 종가베팅에서 바로 불러올 수 있습니다.</p>
        </div>
        <span>{items.length}/{limit}</span>
      </div>

      <div className="segmented-control segmented-control--full home-watchlist__market" role="tablist" aria-label="관심종목 시장 선택">
        <button
          type="button"
          className={market === 'krx' ? 'segmented-control__button segmented-control__button--active' : 'segmented-control__button'}
          onClick={() => changeMarket('krx')}
        >
          국내주식
        </button>
        <button
          type="button"
          className={market === 'us' ? 'segmented-control__button segmented-control__button--active' : 'segmented-control__button'}
          onClick={() => changeMarket('us')}
        >
          미국주식
        </button>
      </div>

      <form className="input-action-row home-watchlist__form" onSubmit={handleSubmit}>
        <input
          className="text-field"
          value={query}
          onChange={(event) => {
            const value = event.target.value
            setQuery(value)
            setError(null)
            setMessage(null)
            setSearchResults(market === 'krx' ? localKrxResults(value) : searchLocalUsStocks(value))
          }}
          placeholder={market === 'krx' ? '회사명 또는 6자리 종목코드' : '회사명 또는 티커 · 예: NVIDIA'}
          aria-label={market === 'krx' ? '국내 관심종목 검색' : '미국 관심종목 검색'}
        />
        <button type="submit" className="secondary-action" disabled={loading || !query.trim()}>
          {loading ? '검색 중...' : '검색'}
        </button>
      </form>

      {error ? <div className="state-box state-box--error">{error}</div> : null}
      {message ? <div className="state-box">{message}</div> : null}

      {searchResults.length > 0 ? (
        <div className="home-watchlist__search-results" aria-label={`${market === 'krx' ? '국내' : '미국'} 종목 검색 결과`}>
          {searchResults.map((item) => {
            const id = `${market}:${item.ticker}`
            const registered = itemIds.has(id)
            return (
              <button
                key={`${item.ticker}-${item.krx_exchange}`}
                type="button"
                onClick={() => registerStock(item)}
                disabled={registered}
              >
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.ticker} · {market === 'krx' ? item.krx_exchange.toUpperCase() : '미국주식'}</small>
                </span>
                <b>{registered ? '등록됨' : '등록'}</b>
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="home-watchlist__items">
        {items.length === 0 ? (
          <div className="state-box">아직 등록한 관심종목이 없습니다.</div>
        ) : (
          items.map((item) => (
            <article key={item.id} className="home-watchlist__item">
              <div>
                <strong>{item.name}</strong>
                <span>{item.ticker} · {item.market === 'krx' ? item.krxExchange.toUpperCase() : '미국주식'}</span>
              </div>
              <button type="button" onClick={() => removeItem(item.id)} aria-label={`${item.name} 관심종목 삭제`}>
                삭제
              </button>
            </article>
          ))
        )}
      </div>
    </section>
  )
}
