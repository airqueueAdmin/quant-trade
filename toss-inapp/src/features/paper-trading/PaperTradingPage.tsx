import { useEffect, useMemo, useRef, useState } from 'react'

import { apiClient } from '../../shared/api/client'
import { ApiError } from '../../shared/api/http'
import type { KrxExchange, KRXSearchResult, PaperTradingState, QuoteSnapshot } from '../../shared/api/types'
import { clearStoredSession, readStoredSession, writeStoredSession, type AppSession } from '../../shared/session/appSession'

const KST_TIME_ZONE = 'Asia/Seoul'

const COMMON_KRX_COMPANIES: KRXSearchResult[] = [
  { name: '삼성전자', ticker: '005930', krx_exchange: 'kospi', display_name: '삼성전자 (005930, KOSPI)' },
  { name: 'SK하이닉스', ticker: '000660', krx_exchange: 'kospi', display_name: 'SK하이닉스 (000660, KOSPI)' },
  { name: '현대차', ticker: '005380', krx_exchange: 'kospi', display_name: '현대차 (005380, KOSPI)' },
  { name: 'NAVER', ticker: '035420', krx_exchange: 'kospi', display_name: 'NAVER (035420, KOSPI)' },
  { name: '카카오', ticker: '035720', krx_exchange: 'kospi', display_name: '카카오 (035720, KOSPI)' },
  { name: '알테오젠', ticker: '196170', krx_exchange: 'kosdaq', display_name: '알테오젠 (196170, KOSDAQ)' },
]

function searchLocalCompanies(query: string, companies: KRXSearchResult[]) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return []
  }

  return companies.filter((company) =>
    [company.name, company.ticker, company.display_name ?? ''].some((value) =>
      value.toLowerCase().includes(normalizedQuery),
    ),
  )
}

function mergeSearchResults(primary: KRXSearchResult[], secondary: KRXSearchResult[]) {
  const merged = new Map<string, KRXSearchResult>()
  for (const company of [...primary, ...secondary]) {
    merged.set(`${company.ticker}-${company.krx_exchange}`, company)
  }
  return [...merged.values()].slice(0, 20)
}

type EnrichedHolding = {
  ticker: string
  companyName: string
  krxExchange: KrxExchange
  shares: number
  avgPrice: number
  currentPrice: number | null
  marketValue: number | null
  pnlAmount: number | null
  pnlPct: number | null
  asOf?: string
}

function formatKrw(value?: number | null) {
  if (value === undefined || value === null) {
    return '-'
  }
  return `${Math.round(value).toLocaleString('ko-KR')}원`
}

function formatPct(value?: number | null) {
  if (value === undefined || value === null) {
    return '-'
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function formatDate(value?: string | null) {
  if (!value) {
    return '-'
  }
  return value.split('T', 1)[0]
}

function formatTradeTime(value?: string | null) {
  if (!value) {
    return '-'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value.replace('T', ' ').replace('+00:00', '')
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: KST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(parsed)

  const formatted = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `${formatted.year}-${formatted.month}-${formatted.day} ${formatted.hour}:${formatted.minute}:${formatted.second} KST`
}

export function PaperTradingPage() {
  const [session, setSession] = useState<AppSession | null>(() => readStoredSession())
  const [allowSessionBootstrap, setAllowSessionBootstrap] = useState(() => readStoredSession() === null)
  const [selectedCompany, setSelectedCompany] = useState<KRXSearchResult>(COMMON_KRX_COMPANIES[0])
  const [paperState, setPaperState] = useState<PaperTradingState | null>(null)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [stateLoading, setStateLoading] = useState(true)
  const [stateError, setStateError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<KRXSearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [isCompanySearchOpen, setIsCompanySearchOpen] = useState(false)
  const [quote, setQuote] = useState<QuoteSnapshot | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [holdings, setHoldings] = useState<EnrichedHolding[]>([])
  const [orderSide, setOrderSide] = useState<'buy' | 'sell'>('buy')
  const [orderShares, setOrderShares] = useState('1')
  const [submittingOrder, setSubmittingOrder] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const companySearchInputRef = useRef<HTMLInputElement>(null)

  const commonKrxCompanies = useMemo(() => COMMON_KRX_COMPANIES, [])

  function handleSelectCompany(company: KRXSearchResult) {
    setSelectedCompany(company)
    setIsCompanySearchOpen(false)
    setSearchQuery('')
    setSearchResults([])
    setSearchError(null)
  }

  function handleOpenCompanySearch() {
    setIsCompanySearchOpen(true)
    setSearchQuery('')
    setSearchResults([])
    setSearchError(null)
  }

  function handleSearchQueryChange(value: string) {
    setSearchQuery(value)
    setSearchError(null)
    setSearchResults(searchLocalCompanies(value, commonKrxCompanies))
  }

  useEffect(() => {
    if (isCompanySearchOpen) {
      companySearchInputRef.current?.focus()
    }
  }, [isCompanySearchOpen])

  useEffect(() => {
    const abortController = new AbortController()

    async function ensureSession() {
      if (session || !allowSessionBootstrap) {
        return
      }

      setSessionLoading(true)
      setStateError(null)

      try {
        const response = await apiClient.bootstrapSession()
        if (abortController.signal.aborted) {
          return
        }

        const nextSession = {
          accountId: response.account_id,
          sessionToken: response.session_token,
        }
        writeStoredSession(nextSession)
        setSession(nextSession)
        setAllowSessionBootstrap(false)
      } catch (caughtError) {
        if (abortController.signal.aborted) {
          return
        }
        if (caughtError instanceof ApiError) {
          setStateError(caughtError.detail)
        } else if (caughtError instanceof Error) {
          setStateError(caughtError.message)
        } else {
          setStateError('내 투자 연습 공간을 준비하지 못했습니다.')
        }
      } finally {
        if (!abortController.signal.aborted) {
          setSessionLoading(false)
        }
      }
    }

    void ensureSession()
    return () => abortController.abort()
  }, [allowSessionBootstrap, session])

  useEffect(() => {
    const abortController = new AbortController()

    async function loadPaperState() {
      if (!session) {
        setStateLoading(false)
        setPaperState(null)
        return
      }

      setStateLoading(paperState === null)
      setStateError(null)

      try {
        const response = await apiClient.paperTradingState(session.sessionToken, abortController.signal)
        setPaperState(response)
      } catch (caughtError) {
        if (abortController.signal.aborted) {
          return
        }
        if (caughtError instanceof ApiError && caughtError.status === 401) {
          clearStoredSession()
          setAllowSessionBootstrap(false)
          setSession(null)
          setStateError('연결이 끊겼습니다. 다시 연결해 주세요.')
          setPaperState(null)
          return
        }
        if (caughtError instanceof ApiError) {
          setStateError(caughtError.detail)
        } else if (caughtError instanceof Error) {
          setStateError(caughtError.message)
        } else {
          setStateError('모의투자 상태를 불러오지 못했습니다.')
        }
        setPaperState(null)
      } finally {
        if (!abortController.signal.aborted) {
          setStateLoading(false)
        }
      }
    }

    void loadPaperState()
    return () => abortController.abort()
  }, [refreshToken, session])

  useEffect(() => {
    const abortController = new AbortController()

    async function loadSelectedQuote() {
      setQuoteLoading(true)
      setQuoteError(null)
      try {
        const response = await apiClient.quote(
          selectedCompany.ticker,
          'krx',
          selectedCompany.krx_exchange,
          abortController.signal,
        )
        setQuote(response)
      } catch (caughtError) {
        if (abortController.signal.aborted) {
          return
        }
        if (caughtError instanceof ApiError) {
          setQuoteError(caughtError.detail)
        } else if (caughtError instanceof Error) {
          setQuoteError(caughtError.message)
        } else {
          setQuoteError('현재가를 불러오지 못했습니다.')
        }
        setQuote(null)
      } finally {
        if (!abortController.signal.aborted) {
          setQuoteLoading(false)
        }
      }
    }

    void loadSelectedQuote()
    return () => abortController.abort()
  }, [selectedCompany, refreshToken])

  useEffect(() => {
    let disposed = false

    async function loadHoldings() {
      if (!paperState) {
        setHoldings([])
        return
      }

      const source = paperState.holdings ?? []
      if (source.length === 0) {
        setHoldings([])
        return
      }

      const entries = await Promise.all(
        source.map(async (holding) => {
          try {
            const holdingQuote = await apiClient.quote(
              holding.ticker,
              'krx',
              holding.krx_exchange ?? 'auto',
            )
            const shares = Number(holding.shares)
            const avgPrice = Number(holding.avg_price)
            const currentPrice = Number(holdingQuote.close)
            const marketValue = currentPrice * shares
            const pnlAmount = marketValue - avgPrice * shares
            const pnlPct = avgPrice > 0 ? ((currentPrice / avgPrice) - 1) * 100 : 0

            const result: EnrichedHolding = {
              ticker: holding.ticker,
              companyName: holding.company_name || holding.ticker,
              krxExchange: holding.krx_exchange,
              shares,
              avgPrice,
              currentPrice,
              marketValue,
              pnlAmount,
              pnlPct,
              asOf: holdingQuote.as_of,
            }
            return result
          } catch {
            const result: EnrichedHolding = {
              ticker: holding.ticker,
              companyName: holding.company_name || holding.ticker,
              krxExchange: holding.krx_exchange,
              shares: Number(holding.shares),
              avgPrice: Number(holding.avg_price),
              currentPrice: null,
              marketValue: null,
              pnlAmount: null,
              pnlPct: null,
            }
            return result
          }
        }),
      )

      if (!disposed) {
        setHoldings(entries)
      }
    }

    void loadHoldings()
    return () => {
      disposed = true
    }
  }, [paperState, refreshToken])

  async function handleReconnectSession() {
    clearStoredSession()
    setSession(null)
    setPaperState(null)
    setStateError(null)
    setActionMessage(null)
    setAllowSessionBootstrap(true)
  }

  async function handleSearch() {
    if (!isCompanySearchOpen) {
      return
    }

    const normalizedQuery = searchQuery.trim()
    if (!normalizedQuery) {
      setSearchResults([])
      setSearchError('검색어를 입력하세요.')
      return
    }

    setSearchLoading(true)
    setSearchError(null)
    const localResults = searchLocalCompanies(normalizedQuery, commonKrxCompanies)
    setSearchResults(localResults)

    try {
      const response = await apiClient.searchKrxStocks(normalizedQuery, 20)
      const mergedResults = mergeSearchResults(response.results, localResults)
      setSearchResults(mergedResults)
      if (mergedResults.length === 0) {
        setSearchError('검색 결과가 없습니다.')
      }
    } catch (caughtError) {
      if (localResults.length > 0) {
        setSearchResults(localResults)
        setSearchError(null)
      } else if (caughtError instanceof ApiError) {
        setSearchError(caughtError.detail)
      } else if (caughtError instanceof Error) {
        setSearchError(caughtError.message)
      } else {
        setSearchError('국내 종목 검색에 실패했습니다.')
      }
    } finally {
      setSearchLoading(false)
    }
  }

  async function handleResetAccount() {
    if (!session) {
      setStateError('내 투자 연습 공간이 준비된 뒤 다시 시도하세요.')
      return
    }
    setResetting(true)
    setActionMessage(null)
    try {
      await apiClient.paperTradingReset(session.sessionToken)
      setActionMessage('모의 계좌를 초기화했습니다.')
      setRefreshToken((value) => value + 1)
    } catch (caughtError) {
      if (caughtError instanceof ApiError) {
        setStateError(caughtError.detail)
      } else if (caughtError instanceof Error) {
        setStateError(caughtError.message)
      } else {
        setStateError('모의 계좌 초기화에 실패했습니다.')
      }
    } finally {
      setResetting(false)
    }
  }

  async function handleRotateAccount() {
    setActionMessage(null)
    setStateError(null)

    try {
      const response = await apiClient.rotateSession()
      const nextSession = {
        accountId: response.account_id,
        sessionToken: response.session_token,
      }
      writeStoredSession(nextSession)
      setSession(nextSession)
      setPaperState(null)
      setStateError(null)
      setSearchError(null)
      setActionMessage('이 기기에서 새 투자 연습 계정을 시작했습니다.')
      setRefreshToken((value) => value + 1)
    } catch (caughtError) {
      if (caughtError instanceof ApiError) {
        setStateError(caughtError.detail)
      } else if (caughtError instanceof Error) {
        setStateError(caughtError.message)
      } else {
        setStateError('새 투자 연습 계정을 시작하지 못했습니다.')
      }
    }
  }

  async function handleSubmitOrder() {
    if (!session) {
      setActionMessage('내 투자 연습 공간이 준비된 뒤 다시 시도하세요.')
      return
    }
    const shares = Number(orderShares)
    if (!quote) {
      setActionMessage('현재가가 준비된 뒤 다시 시도하세요.')
      return
    }
    if (!Number.isInteger(shares) || shares <= 0) {
      setActionMessage('주문 수량은 1주 이상 정수여야 합니다.')
      return
    }

    setSubmittingOrder(true)
    setActionMessage(null)

    try {
      await apiClient.paperTradingOrder(session.sessionToken, {
        ticker: quote.ticker,
        company_name: quote.company_name || quote.ticker,
        krx_exchange: quote.krx_exchange,
        side: orderSide,
        shares,
      })
      setActionMessage(`${orderSide === 'buy' ? '매수' : '매도'} 주문을 모의 반영했습니다.`)
      setRefreshToken((value) => value + 1)
    } catch (caughtError) {
      if (caughtError instanceof ApiError) {
        setActionMessage(caughtError.detail)
      } else if (caughtError instanceof Error) {
        setActionMessage(caughtError.message)
      } else {
        setActionMessage('주문 반영에 실패했습니다.')
      }
    } finally {
      setSubmittingOrder(false)
    }
  }

  const cashKrw = Number(paperState?.cash_krw ?? 0)
  const seedCashKrw = Number(paperState?.seed_cash_krw ?? 0)
  const holdingsValue = holdings.reduce((sum, item) => sum + Number(item.marketValue ?? 0), 0)
  const totalAssets = cashKrw + holdingsValue
  const totalPnl = totalAssets - seedCashKrw
  const totalReturnPct = seedCashKrw > 0 ? (totalPnl / seedCashKrw) * 100 : 0
  const ownedShares = paperState?.holdings.find((item) => item.ticker === selectedCompany.ticker)?.shares ?? 0
  const maxBuyableShares =
    quote && quote.close > 0 ? Math.floor(cashKrw / Number(quote.close)) : 0
  const normalizedShares = Number(orderShares || '0')
  const orderValue = quote ? normalizedShares * Number(quote.close) : 0
  const hasInsufficientCash =
    orderSide === 'buy' && normalizedShares > 0 && normalizedShares > maxBuyableShares
  const hasInsufficientShares =
    orderSide === 'sell' && normalizedShares > 0 && normalizedShares > Number(ownedShares)
  const isOrderShareInvalid = !Number.isInteger(normalizedShares) || normalizedShares <= 0
  const orderBlockedReason = isOrderShareInvalid
    ? '주문 수량은 1주 이상 정수여야 합니다.'
    : hasInsufficientCash
      ? '예수금이 부족합니다. 주문 수량을 줄이거나 계좌를 초기화하세요.'
      : hasInsufficientShares
        ? '보유 수량이 부족합니다. 현재 보유 주식을 확인하세요.'
        : null

  return (
    <main className="page-shell">
      <section className="content-panel">
        <p className="content-panel__eyebrow">종가베팅 4단계</p>
        <h2 className="content-panel__title">모의투자</h2>
        <p className="content-panel__description">
          선택한 종목의 매매 대응을 연습합니다.
        </p>
      </section>

      <section className="content-panel">
        <div className="account-strip">
          <div>
            <p className="account-strip__label">투자 연습 공간</p>
            <strong className="account-strip__value">이 기기에서 이어서 사용 중</strong>
            <p className="account-strip__description">
              기록과 자산 상태가 이 기기에 저장됩니다.
            </p>
          </div>
          <div className="paper-actions">
            <button
              type="button"
              className="secondary-action"
              onClick={() => setRefreshToken((value) => value + 1)}
              disabled={!session}
            >
              상태 새로고침
            </button>
            <button
              type="button"
              className="secondary-action"
              onClick={() => void handleReconnectSession()}
            >
              다시 연결
            </button>
            <button
              type="button"
              className="secondary-action"
              onClick={() => void handleRotateAccount()}
            >
              새 계정 시작
            </button>
            <button
              type="button"
              className="secondary-action secondary-action--danger"
              onClick={() => void handleResetAccount()}
              disabled={resetting}
            >
              {resetting ? '초기화 중...' : '모의 계좌 초기화'}
            </button>
          </div>
        </div>

        {sessionLoading ? <div className="state-box">투자 연습 공간을 준비하는 중입니다...</div> : null}
        {stateLoading && !paperState ? <div className="state-box">모의투자 상태를 불러오는 중입니다...</div> : null}
        {stateError ? <div className="state-box state-box--error">{stateError}</div> : null}
        {actionMessage ? <div className="state-box">{actionMessage}</div> : null}

        {paperState && !stateError ? (
          <div className="paper-summary-grid">
            <article className="summary-mini-card">
              <span className="summary-mini-card__label">예수금</span>
              <strong className="summary-mini-card__value">{formatKrw(cashKrw)}</strong>
            </article>
            <article className="summary-mini-card">
              <span className="summary-mini-card__label">보유 평가금액</span>
              <strong className="summary-mini-card__value">{formatKrw(holdingsValue)}</strong>
            </article>
            <article className="summary-mini-card">
              <span className="summary-mini-card__label">총 자산</span>
              <strong className="summary-mini-card__value">{formatKrw(totalAssets)}</strong>
            </article>
            <article className="summary-mini-card">
              <span className="summary-mini-card__label">누적 수익률</span>
              <strong className="summary-mini-card__value">{formatPct(totalReturnPct)}</strong>
            </article>
          </div>
        ) : null}
      </section>

      <section className="content-panel">
        <div className="section-block__header">
          <h3>종목 선택</h3>
        </div>

        <div className="chip-row">
          {commonKrxCompanies.map((company) => (
            <button
              key={company.ticker}
              type="button"
              className={
                selectedCompany.ticker === company.ticker ? 'chip chip--active' : 'chip'
              }
              onClick={() => handleSelectCompany(company)}
            >
              {company.name}
            </button>
          ))}
        </div>

        <p id="paper-company-search-help" className="helper-text helper-text--tight">
          {isCompanySearchOpen
            ? '검색 결과에서 종목을 선택하세요.'
            : `${selectedCompany.name} 선택됨`}
        </p>

        <div className="paper-company-search">
          <div className="input-action-row input-action-row--wide">
            <input
              ref={companySearchInputRef}
              className="text-field"
              value={searchQuery}
              onChange={(event) => handleSearchQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && searchQuery.trim()) {
                  void handleSearch()
                }
              }}
              placeholder="회사명이나 6자리 종목코드"
              disabled={!isCompanySearchOpen}
              aria-describedby="paper-company-search-help"
              aria-controls="paper-company-search-results"
              aria-expanded={isCompanySearchOpen && searchResults.length > 0}
              role="combobox"
            />
            <button
              type="button"
              className="secondary-action"
              onClick={() => void handleSearch()}
              disabled={!isCompanySearchOpen || searchLoading || !searchQuery.trim()}
            >
              {searchLoading ? '검색 중...' : '검색'}
            </button>
          </div>

          {isCompanySearchOpen && searchResults.length > 0 ? (
            <div
              id="paper-company-search-results"
              className="paper-company-search__list"
              role="listbox"
              aria-label="종목 검색 결과"
            >
              {searchResults.map((item) => (
                <button
                  key={`${item.ticker}-${item.krx_exchange}`}
                  type="button"
                  className="paper-company-search__option"
                  role="option"
                  aria-selected={selectedCompany.ticker === item.ticker}
                  onClick={() => handleSelectCompany(item)}
                >
                  <strong>{item.name}</strong>
                  <span>{item.display_name ?? `${item.ticker} (${item.krx_exchange.toUpperCase()})`}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {!isCompanySearchOpen ? (
          <button type="button" className="secondary-action" onClick={handleOpenCompanySearch}>
            다른 종목 찾기
          </button>
        ) : null}

        {searchError ? <div className="state-box state-box--error">{searchError}</div> : null}

        {quoteLoading ? <div className="state-box">현재가를 불러오는 중입니다...</div> : null}
        {!quoteLoading && quoteError ? <div className="state-box state-box--error">{quoteError}</div> : null}

        {quote ? (
          <div className="paper-quote-card">
            <div>
              <p className="summary-card__label">현재 선택 종목</p>
              <strong className="paper-quote-card__title">
                {quote.company_name ? `${quote.company_name} (${quote.ticker})` : quote.ticker}
              </strong>
              <p className="paper-quote-card__meta">
                거래소 {quote.krx_exchange.toUpperCase()} / 기준일 {formatDate(quote.as_of)}
              </p>
            </div>
            <div className="paper-quote-card__price">
              <strong>{formatKrw(quote.close)}</strong>
              <span>
                전일 대비 {formatKrw(quote.change_amount)} / {formatPct(quote.change_pct)}
              </span>
            </div>
          </div>
        ) : null}
      </section>

      <section className="content-panel">
        <div className="section-block__header">
          <h3>모의 주문</h3>
        </div>

        <div className="field-grid">
          <div>
            <label className="field-label">주문 구분</label>
            <div className="segmented-control" role="tablist" aria-label="주문 구분">
              <button
                type="button"
                className={
                  orderSide === 'buy'
                    ? 'segmented-control__button segmented-control__button--active'
                    : 'segmented-control__button'
                }
                onClick={() => setOrderSide('buy')}
              >
                매수
              </button>
              <button
                type="button"
                className={
                  orderSide === 'sell'
                    ? 'segmented-control__button segmented-control__button--active'
                    : 'segmented-control__button'
                }
                onClick={() => setOrderSide('sell')}
              >
                매도
              </button>
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="paper-order-shares">
              주문 수량
            </label>
            <input
              id="paper-order-shares"
              className="text-field"
              inputMode="numeric"
              value={orderShares}
              onChange={(event) => setOrderShares(event.target.value.replace(/[^0-9]/g, ''))}
              placeholder="1"
            />
          </div>
        </div>

        <div className="paper-order-hint">
          <span>매수 가능 최대 {maxBuyableShares}주</span>
          <span>현재 보유 {ownedShares}주</span>
          <span>
            예상 주문금액 {quote ? formatKrw(orderValue) : '-'}
          </span>
        </div>

        {orderBlockedReason ? <div className="state-box state-box--warning">{orderBlockedReason}</div> : null}

        <button
          type="button"
          className="primary-action"
          onClick={() => void handleSubmitOrder()}
          disabled={submittingOrder || !quote || Boolean(orderBlockedReason)}
        >
          {submittingOrder ? '주문 반영 중...' : '주문 반영'}
        </button>

        <div className="content-panel content-panel--nested">
          <p className="content-panel__eyebrow">사용 안내</p>
          <ul className="bullet-list">
            <li>국내주식의 최근 종가를 사용합니다.</li>
            <li>수수료·세금·슬리피지는 제외됩니다.</li>
            <li>연습 계정은 기기별로 관리됩니다.</li>
          </ul>
        </div>
      </section>

      <section className="content-panel">
        <div className="section-block__header">
          <h3>보유 종목</h3>
        </div>

        {holdings.length === 0 ? (
          <div className="state-box">아직 보유 중인 종목이 없습니다.</div>
        ) : (
          <div className="portfolio-list">
            {holdings
              .slice()
              .sort((left, right) => Number(right.marketValue ?? 0) - Number(left.marketValue ?? 0))
              .map((holding) => (
                <article key={`${holding.ticker}-${holding.krxExchange}`} className="portfolio-item">
                  <div className="portfolio-item__top">
                    <div>
                      <h4 className="portfolio-item__title">{holding.companyName}</h4>
                      <p className="portfolio-item__meta">
                        {holding.ticker} / {holding.krxExchange.toUpperCase()} / {holding.shares}주
                      </p>
                    </div>
                    <strong className="portfolio-item__value">{formatKrw(holding.marketValue)}</strong>
                  </div>
                  <div className="portfolio-item__stats">
                    <span>평균단가 {formatKrw(holding.avgPrice)}</span>
                    <span>현재가 {formatKrw(holding.currentPrice)}</span>
                    <span>손익 {formatKrw(holding.pnlAmount)}</span>
                    <span>수익률 {formatPct(holding.pnlPct)}</span>
                    <span>기준일 {formatDate(holding.asOf)}</span>
                  </div>
                </article>
              ))}
          </div>
        )}
      </section>

      <section className="content-panel">
        <div className="section-block__header">
          <h3>거래 내역</h3>
        </div>

        {!paperState || paperState.trades.length === 0 ? (
          <div className="state-box">아직 반영된 모의 주문이 없습니다.</div>
        ) : (
          <div className="trade-list">
            {paperState.trades.map((trade) => (
              <article key={String(trade.id)} className="trade-item">
                <div className="trade-item__top">
                  <strong>{trade.company_name || trade.ticker}</strong>
                  <span className={trade.side === 'buy' ? 'badge badge--buy' : 'badge badge--sell'}>
                    {trade.side === 'buy' ? '매수' : '매도'}
                  </span>
                </div>
                <p className="trade-item__meta">
                  {trade.ticker} / {trade.krx_exchange.toUpperCase()} / {trade.shares}주
                </p>
                <p className="trade-item__meta">
                  단가 {formatKrw(trade.price)} / 거래금액 {formatKrw(trade.amount_krw)}
                </p>
                <p className="trade-item__meta">{formatTradeTime(trade.traded_at)}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
