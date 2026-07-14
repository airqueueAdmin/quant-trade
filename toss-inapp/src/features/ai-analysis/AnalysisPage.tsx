import { useMemo, useState } from 'react'

import { apiClient } from '../../shared/api/client'
import { ApiError } from '../../shared/api/http'
import type { KrxExchange, KRXSearchResult, Market, SentimentResult } from '../../shared/api/types'

const MARKET_OPTIONS: Array<{ value: Market; label: string }> = [
  { value: 'us', label: '미국주식' },
  { value: 'krx', label: '국내주식' },
] as const

const KRX_EXCHANGE_OPTIONS: Array<{ value: KrxExchange; label: string }> = [
  { value: 'auto', label: '자동 판별' },
  { value: 'kospi', label: 'KOSPI' },
  { value: 'kosdaq', label: 'KOSDAQ' },
] as const

const COMMON_KRX_COMPANIES: KRXSearchResult[] = [
  { name: '삼성전자', ticker: '005930', krx_exchange: 'kospi', display_name: '삼성전자 (005930, KOSPI)' },
  { name: 'SK하이닉스', ticker: '000660', krx_exchange: 'kospi', display_name: 'SK하이닉스 (000660, KOSPI)' },
  { name: '현대차', ticker: '005380', krx_exchange: 'kospi', display_name: '현대차 (005380, KOSPI)' },
  { name: 'NAVER', ticker: '035420', krx_exchange: 'kospi', display_name: 'NAVER (035420, KOSPI)' },
  { name: '카카오', ticker: '035720', krx_exchange: 'kospi', display_name: '카카오 (035720, KOSPI)' },
  { name: '알테오젠', ticker: '196170', krx_exchange: 'kosdaq', display_name: '알테오젠 (196170, KOSDAQ)' },
]

function defaultTicker(market: Market) {
  return market === 'krx' ? '005930' : 'AAPL'
}

function marketHelpText(market: Market) {
  return market === 'krx'
    ? '국내주식은 6자리 종목코드를 입력하세요. 예: 005930'
    : '미국주식 티커를 입력하세요. 예: AAPL, NVDA, MSFT'
}

function scoreTone(score: number) {
  if (score >= 60) {
    return 'positive'
  }
  if (score >= 40) {
    return 'neutral'
  }
  return 'negative'
}

function scoreLabel(score: number) {
  if (score >= 70) {
    return '긍정 우세'
  }
  if (score >= 55) {
    return '약한 긍정'
  }
  if (score >= 45) {
    return '중립'
  }
  if (score >= 30) {
    return '약한 부정'
  }
  return '부정 우세'
}

export function AnalysisPage() {
  const [market, setMarket] = useState<Market>('us')
  const [krxExchange, setKrxExchange] = useState<KrxExchange>('auto')
  const [ticker, setTicker] = useState(defaultTicker('us'))
  const [searchQuery, setSearchQuery] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchResults, setSearchResults] = useState<KRXSearchResult[]>([])
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [result, setResult] = useState<SentimentResult | null>(null)

  const commonKrxCompanies = useMemo(() => COMMON_KRX_COMPANIES, [])

  function handleMarketChange(nextMarket: Market) {
    setMarket(nextMarket)
    setTicker(defaultTicker(nextMarket))
    setKrxExchange('auto')
    setSearchQuery('')
    setSearchError(null)
    setSearchResults([])
    setAnalysisError(null)
    setResult(null)
  }

  async function handleSearch() {
    const normalizedQuery = searchQuery.trim()
    if (!normalizedQuery) {
      setSearchResults([])
      setSearchError('검색어를 입력하세요.')
      return
    }

    setSearchLoading(true)
    setSearchError(null)

    try {
      const response = await apiClient.searchKrxStocks(normalizedQuery, 20)
      setSearchResults(response.results)
      if (response.results.length === 0) {
        setSearchError('검색 결과가 없습니다.')
      }
    } catch (caughtError) {
      if (caughtError instanceof ApiError) {
        setSearchError(caughtError.detail)
      } else if (caughtError instanceof Error) {
        setSearchError(caughtError.message)
      } else {
        setSearchError('국내 종목 검색에 실패했습니다.')
      }
      setSearchResults([])
    } finally {
      setSearchLoading(false)
    }
  }

  function handlePickCompany(company: KRXSearchResult) {
    setTicker(company.ticker)
    setKrxExchange(company.krx_exchange)
    setAnalysisError(null)
    setResult(null)
  }

  async function handleAnalyze() {
    const normalizedTicker = ticker.trim()
    if (!normalizedTicker) {
      setAnalysisError('분석할 종목을 입력하세요.')
      return
    }

    setAnalysisLoading(true)
    setAnalysisError(null)

    try {
      const response = await apiClient.sentiment(normalizedTicker, market, krxExchange)
      setResult(response)
    } catch (caughtError) {
      if (caughtError instanceof ApiError) {
        setAnalysisError(caughtError.detail)
      } else if (caughtError instanceof Error) {
        setAnalysisError(caughtError.message)
      } else {
        setAnalysisError('AI 분석을 불러오지 못했습니다.')
      }
      setResult(null)
    } finally {
      setAnalysisLoading(false)
    }
  }

  const tone = scoreTone(result?.sentiment_score ?? 50)

  return (
    <main className="page-shell">
      <section className="content-panel">
        <p className="content-panel__eyebrow">종가베팅 2단계</p>
        <h2 className="content-panel__title">AI 시장 분석</h2>
        <p className="content-panel__description">
          종목 뉴스와 시장 심리를 요약합니다.
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
                onClick={() => handleMarketChange(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="form-stack">
          {market === 'krx' ? (
            <>
              <div>
                <label className="field-label">대표 종목 빠른 선택</label>
                <div className="chip-row">
                  {commonKrxCompanies.map((company) => (
                    <button
                      key={company.ticker}
                      type="button"
                      className={
                        ticker === company.ticker ? 'chip chip--active' : 'chip'
                      }
                      onClick={() => handlePickCompany(company)}
                    >
                      {company.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field-grid">
                <div>
                  <label className="field-label" htmlFor="krx-exchange">
                    국내 거래소
                  </label>
                  <select
                    id="krx-exchange"
                    className="text-field"
                    value={krxExchange}
                    onChange={(event) => setKrxExchange(event.target.value as KrxExchange)}
                  >
                    {KRX_EXCHANGE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="field-label" htmlFor="krx-search">
                    국내 종목명 검색
                  </label>
                  <div className="input-action-row">
                    <input
                      id="krx-search"
                      className="text-field"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="회사명이나 6자리 종목코드"
                    />
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={() => void handleSearch()}
                      disabled={searchLoading}
                    >
                      {searchLoading ? '검색 중...' : '검색'}
                    </button>
                  </div>
                </div>
              </div>

              {searchError ? <div className="state-box state-box--error">{searchError}</div> : null}

              {searchResults.length > 0 ? (
                <div className="search-result-list">
                  {searchResults.map((item) => (
                    <button
                      key={`${item.ticker}-${item.krx_exchange}`}
                      type="button"
                      className="search-result-item"
                      onClick={() => handlePickCompany(item)}
                    >
                      <strong>{item.name}</strong>
                      <span>{item.display_name ?? `${item.ticker} (${item.krx_exchange.toUpperCase()})`}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}

          <div>
            <label className="field-label" htmlFor="ticker-input">
              {market === 'krx' ? '종목 코드' : '주식 티커'}
            </label>
            <input
              id="ticker-input"
              className="text-field"
              value={ticker}
              onChange={(event) => setTicker(event.target.value.toUpperCase())}
              placeholder={market === 'krx' ? '005930' : 'AAPL'}
            />
            <p className="helper-text helper-text--tight">{marketHelpText(market)}</p>
          </div>

          <button
            type="button"
            className="primary-action"
            onClick={() => void handleAnalyze()}
            disabled={analysisLoading}
          >
            {analysisLoading ? 'AI 분석 중...' : 'AI 분석 실행'}
          </button>
        </div>

        {analysisError ? <div className="state-box state-box--error">{analysisError}</div> : null}

        {result ? (
          <>
            <div className={`sentiment-card sentiment-card--${tone}`}>
              <div className="sentiment-card__top">
                <div>
                  <p className="sentiment-card__eyebrow">분석 대상</p>
                  <h3 className="sentiment-card__title">
                    {result.company_name ? `${result.company_name} (${result.resolved_ticker})` : result.resolved_ticker}
                  </h3>
                </div>
                <div className="sentiment-score-box">
                  <span className="sentiment-score-box__label">감성 점수</span>
                  <strong className="sentiment-score-box__value">{result.sentiment_score}</strong>
                </div>
              </div>

              <div className="sentiment-meter" aria-hidden="true">
                <div
                  className="sentiment-meter__fill"
                  style={{ width: `${Math.max(0, Math.min(100, result.sentiment_score))}%` }}
                />
              </div>

              <p className="sentiment-card__summary-label">{scoreLabel(result.sentiment_score)}</p>
              <p className="sentiment-card__summary-text">{result.summary}</p>

              {!result.news_api_enabled ? (
                <div className="state-box">
                  현재 일부 최신 뉴스만 반영됩니다.
                </div>
              ) : null}
            </div>

            <div className="section-block">
              <div className="section-block__header">
                <h3>관련 뉴스</h3>
              </div>

              {result.articles.length > 0 ? (
                <div className="article-list">
                  {result.articles.map((article, index) => (
                    <a
                      key={`${article.url}-${index}`}
                      className="article-list__item"
                      href={article.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <strong>{article.title}</strong>
                      <span>{article.source ?? '원문 보기'}</span>
                    </a>
                  ))}
                </div>
              ) : (
                <div className="state-box">표시할 뉴스가 없습니다.</div>
              )}
            </div>
          </>
        ) : null}
      </section>
    </main>
  )
}
