import { useMemo, useState } from 'react'

import { StepFlow } from '../../components/StepFlow'
import { apiClient } from '../../shared/api/client'
import { ApiError } from '../../shared/api/http'
import type { KrxExchange, KRXSearchResult, Market, SentimentResult } from '../../shared/api/types'
import { useFullScreenAd } from '../../shared/ads/useFullScreenAd'
import { env } from '../../shared/config/env'
import { useWatchlist } from '../../shared/watchlist/useWatchlist'

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

const ANALYSIS_STEPS = [
  {
    label: '시장',
    title: '어느 시장의 종목인가요?',
    description: '미국주식과 국내주식 중 하나를 선택하세요.',
  },
  {
    label: '종목',
    title: '분석할 종목을 선택하세요',
    description: '종목 하나만 고르면 AI가 뉴스와 심리를 정리합니다.',
  },
  {
    label: '결과',
    title: '핵심 결과를 확인하세요',
    description: '감성 점수를 먼저 보고 필요할 때 관련 뉴스를 펼쳐보세요.',
  },
] as const

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

function formatNewsDate(value?: string) {
  if (!value) {
    return '날짜 미상'
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value.slice(0, 16).replace('T', ' ')
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(parsed)
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`
}

export function AnalysisPage() {
  const analysisAd = useFullScreenAd(env.ads.interstitialAdGroupId)
  const { items: watchlist } = useWatchlist()
  const [market, setMarket] = useState<Market>('us')
  const [krxExchange, setKrxExchange] = useState<KrxExchange>('auto')
  const [ticker, setTicker] = useState(defaultTicker('us'))
  const [selectedQuickTicker, setSelectedQuickTicker] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchResults, setSearchResults] = useState<KRXSearchResult[]>([])
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [result, setResult] = useState<SentimentResult | null>(null)
  const [currentStep, setCurrentStep] = useState(0)

  const commonKrxCompanies = useMemo(() => COMMON_KRX_COMPANIES, [])

  function handleMarketChange(nextMarket: Market) {
    setMarket(nextMarket)
    setTicker(defaultTicker(nextMarket))
    setSelectedQuickTicker(nextMarket === 'krx' ? defaultTicker(nextMarket) : null)
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

  function handlePickCompany(company: KRXSearchResult, isQuickPick = false) {
    setTicker(company.ticker)
    setKrxExchange(company.krx_exchange)
    setSelectedQuickTicker(isQuickPick ? company.ticker : null)
    setSearchQuery('')
    setSearchResults([])
    setSearchError(null)
    setAnalysisError(null)
    setResult(null)
  }

  function handleEnableCompanySearch() {
    setSelectedQuickTicker(null)
    setSearchQuery('')
    setSearchResults([])
    setSearchError(null)
  }

  function handlePickWatchlist(itemId: string) {
    const item = watchlist.find((candidate) => candidate.id === itemId)
    if (!item) {
      return
    }
    setMarket(item.market)
    setTicker(item.ticker)
    setKrxExchange(item.krxExchange)
    setSelectedQuickTicker(null)
    setSearchQuery('')
    setSearchResults([])
    setSearchError(null)
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
      analysisAd.showAd()
      setCurrentStep(2)
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
      <StepFlow
        pageTitle="AI 분석"
        steps={ANALYSIS_STEPS}
        currentStep={currentStep}
        onStepChange={setCurrentStep}
        nextDisabled={currentStep === 1 && !ticker.trim()}
      >
        <section className="content-panel">
          <div className="segmented-control segmented-control--full" role="tablist" aria-label="시장 선택">
            {MARKET_OPTIONS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={item.value === market
                  ? 'segmented-control__button segmented-control__button--active'
                  : 'segmented-control__button'}
                onClick={() => handleMarketChange(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="helper-text">
            {market === 'krx' ? '국내 종목과 관련 뉴스를 분석합니다.' : '미국 종목과 영문 뉴스를 분석합니다.'}
          </p>
        </section>

        <section className="content-panel">
          <div className="form-stack">
            {watchlist.length > 0 ? (
              <div className="watchlist-loader">
                <label className="field-label" htmlFor="analysis-watchlist">관심종목에서 불러오기</label>
                <select
                  id="analysis-watchlist"
                  className="text-field"
                  value=""
                  onChange={(event) => handlePickWatchlist(event.target.value)}
                >
                  <option value="">등록한 관심종목 선택</option>
                  {watchlist.map((item) => (
                    <option key={item.id} value={item.id}>
                      [{item.market === 'krx' ? '국내' : '미국'}] {item.name} ({item.ticker})
                    </option>
                  ))}
                </select>
                <p className="helper-text helper-text--tight">홈에서 등록한 시장과 종목 정보를 그대로 적용합니다.</p>
              </div>
            ) : null}

            {market === 'krx' ? (
              <>
                <div>
                  <label className="field-label">대표 종목 빠른 선택</label>
                  <div className="chip-row">
                    {commonKrxCompanies.map((company) => (
                      <button
                        key={company.ticker}
                        type="button"
                        className={selectedQuickTicker === company.ticker ? 'chip chip--active' : 'chip'}
                        onClick={() => handlePickCompany(company, true)}
                      >
                        {company.name}
                      </button>
                    ))}
                  </div>
                  {selectedQuickTicker ? (
                    <button
                      type="button"
                      className="secondary-action quick-pick-search-action"
                      onClick={handleEnableCompanySearch}
                    >
                      다른 종목 검색
                    </button>
                  ) : null}
                </div>

                <div className="field-grid">
                  <div>
                    <label className="field-label" htmlFor="krx-exchange">국내 거래소</label>
                    <select
                      id="krx-exchange"
                      className="text-field"
                      value={krxExchange}
                      onChange={(event) => setKrxExchange(event.target.value as KrxExchange)}
                    >
                      {KRX_EXCHANGE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="krx-search">국내 종목명 검색</label>
                    <div className="input-action-row">
                      <input
                        id="krx-search"
                        className="text-field"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="회사명이나 6자리 종목코드"
                        disabled={Boolean(selectedQuickTicker)}
                      />
                      <button
                        type="button"
                        className="secondary-action"
                        onClick={() => void handleSearch()}
                        disabled={Boolean(selectedQuickTicker) || searchLoading}
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
                onChange={(event) => {
                  setTicker(event.target.value.toUpperCase())
                  setSelectedQuickTicker(null)
                }}
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
            {analysisAd.enabled ? (
              <p className="helper-text helper-text--tight">
                분석이 끝나면 결과 확인 전에 전면 광고가 표시될 수 있습니다.
              </p>
            ) : null}
          </div>
          {analysisError ? <div className="state-box state-box--error">{analysisError}</div> : null}
        </section>

        <section className="content-panel">
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
                {!result.news_api_enabled ? <div className="state-box">현재 일부 최신 뉴스만 반영됩니다.</div> : null}
              </div>

              <details className="disclosure-panel">
                <summary>관련 뉴스 {result.articles.length}건 보기</summary>
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
                        <span className="article-list__meta">
                          <span>{article.source ?? '뉴스'}</span>
                          <time dateTime={article.published_at}>{formatNewsDate(article.published_at)}</time>
                          <b>원문 보기</b>
                        </span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="state-box">표시할 뉴스가 없습니다.</div>
                )}
              </details>
            </>
          ) : (
            <div className="state-box">이전 단계에서 AI 분석을 실행하면 결과가 표시됩니다.</div>
          )}
        </section>
      </StepFlow>
    </main>
  )
}
