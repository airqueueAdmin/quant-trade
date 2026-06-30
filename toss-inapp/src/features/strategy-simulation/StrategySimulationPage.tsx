import { useMemo, useState } from 'react'

import { apiClient } from '../../shared/api/client'
import { ApiError } from '../../shared/api/http'
import type {
  BacktestResult,
  BollingerBandsBacktestRequest,
  BollingerBandsOptimizationRequest,
  KrxExchange,
  KRXSearchResult,
  Market,
  MovingAverageBacktestRequest,
  MovingAverageOptimizationRequest,
  OptimizationResult,
  OrderType,
  RSIBacktestRequest,
  RSIOptimizationRequest,
  StrategyMetric,
} from '../../shared/api/types'

type StrategyKey = 'moving_average' | 'rsi' | 'bollinger_bands'
type SimulationMode = 'backtest' | 'optimize'
type CommonSimulationPayload = {
  ticker: string
  market: Market
  krx_exchange: KrxExchange
  start_date: string
  end_date: string
  initial_capital: number
  order_type: OrderType
  fixed_amount?: number
}

type CommonInputValidation =
  | { error: string }
  | {
      payload: CommonSimulationPayload
    }

const MARKET_OPTIONS: Array<{ value: Market; label: string }> = [
  { value: 'us', label: '미국주식' },
  { value: 'krx', label: '국내주식' },
] as const

const KRX_EXCHANGE_OPTIONS: Array<{ value: KrxExchange; label: string }> = [
  { value: 'auto', label: '자동 판별' },
  { value: 'kospi', label: 'KOSPI' },
  { value: 'kosdaq', label: 'KOSDAQ' },
] as const

const STRATEGY_OPTIONS: Array<{ value: StrategyKey; label: string; description: string }> = [
  {
    value: 'moving_average',
    label: '이동평균',
    description: '단기선이 장기선을 상향 돌파할 때 매수하고 하향 돌파할 때 매도합니다.',
  },
  {
    value: 'rsi',
    label: 'RSI',
    description: '과매도 구간 진입 시 매수하고 과매수 구간 진입 시 매도합니다.',
  },
  {
    value: 'bollinger_bands',
    label: '볼린저 밴드',
    description: '비정상적으로 낮거나 높은 가격대에서 평균 회귀를 기대하는 전략입니다.',
  },
] as const

const METRIC_OPTIONS: Array<{ value: StrategyMetric; label: string }> = [
  { value: 'sharpe_ratio', label: '샤프 지수' },
  { value: 'total_return_pct', label: '총수익률' },
  { value: 'cagr_pct', label: 'CAGR' },
  { value: 'sortino_ratio', label: '소르티노 지수' },
] as const

const COMMON_KRX_COMPANIES: KRXSearchResult[] = [
  { name: '삼성전자', ticker: '005930', krx_exchange: 'kospi', display_name: '삼성전자 (005930, KOSPI)' },
  { name: 'SK하이닉스', ticker: '000660', krx_exchange: 'kospi', display_name: 'SK하이닉스 (000660, KOSPI)' },
  { name: '현대차', ticker: '005380', krx_exchange: 'kospi', display_name: '현대차 (005380, KOSPI)' },
  { name: 'NAVER', ticker: '035420', krx_exchange: 'kospi', display_name: 'NAVER (035420, KOSPI)' },
  { name: '알테오젠', ticker: '196170', krx_exchange: 'kosdaq', display_name: '알테오젠 (196170, KOSDAQ)' },
]

function defaultTicker(market: Market) {
  return market === 'krx' ? '005930' : 'AAPL'
}

function defaultInitialCapital(market: Market) {
  return market === 'krx' ? '1000000' : '100000'
}

function defaultFixedAmount(market: Market) {
  return market === 'krx' ? '100000' : '1000'
}

function defaultDateRange() {
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(endDate.getDate() - 365)

  const format = (value: Date) => {
    const year = value.getFullYear()
    const month = `${value.getMonth() + 1}`.padStart(2, '0')
    const day = `${value.getDate()}`.padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  return { startDate: format(startDate), endDate: format(endDate) }
}

function tickerHelpText(market: Market) {
  return market === 'krx'
    ? '국내주식은 6자리 종목코드를 입력하세요. 예: 005930'
    : '미국주식 티커를 입력하세요. 예: AAPL, NVDA, MSFT'
}

function sanitizeIntegerInput(value: string) {
  return value.replace(/[^0-9]/g, '')
}

function sanitizeDecimalInput(value: string) {
  return value.replace(/[^0-9.]/g, '')
}

function formatPct(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return '-'
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function formatNumber(value?: number | null, digits = 2) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return '-'
  }
  return value.toFixed(digits)
}

function formatMoney(value: number | undefined, market: Market) {
  if (value === undefined || Number.isNaN(value)) {
    return '-'
  }
  if (market === 'krx') {
    return `${Math.round(value).toLocaleString('ko-KR')}원`
  }
  return `$${Math.round(value).toLocaleString('en-US')}`
}

function formatDateTime(value?: string) {
  if (!value) {
    return '-'
  }
  return value.replace('T', ' ').replace('.000000', '')
}

function strategyLabel(strategy: StrategyKey) {
  return STRATEGY_OPTIONS.find((item) => item.value === strategy)?.label ?? strategy
}

function strategyDescription(strategy: StrategyKey) {
  return STRATEGY_OPTIONS.find((item) => item.value === strategy)?.description ?? ''
}

function metricLabel(metric: StrategyMetric) {
  return METRIC_OPTIONS.find((item) => item.value === metric)?.label ?? metric
}

function parameterLabel(name: string) {
  const labels: Record<string, string> = {
    short_window: '단기 평균 기간',
    long_window: '장기 평균 기간',
    window: '계산 기간',
    oversold_threshold: '과매도 기준선',
    overbought_threshold: '과매수 기준선',
    num_std_dev: '표준편차 배수',
  }
  return labels[name] ?? name
}

function sortOptimizationResults(result: OptimizationResult) {
  const metric = result.metric_optimized
  return [...result.all_optimization_results].sort((left, right) => {
    const leftValue = Number(left.metrics[metric] ?? Number.NEGATIVE_INFINITY)
    const rightValue = Number(right.metrics[metric] ?? Number.NEGATIVE_INFINITY)
    return rightValue - leftValue
  })
}

export function StrategySimulationPage() {
  const commonKrxCompanies = useMemo(() => COMMON_KRX_COMPANIES, [])
  const dateRange = useMemo(() => defaultDateRange(), [])

  const [market, setMarket] = useState<Market>('us')
  const [mode, setMode] = useState<SimulationMode>('backtest')
  const [strategy, setStrategy] = useState<StrategyKey>('moving_average')
  const [ticker, setTicker] = useState(defaultTicker('us'))
  const [krxExchange, setKrxExchange] = useState<KrxExchange>('auto')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<KRXSearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [startDate, setStartDate] = useState(dateRange.startDate)
  const [endDate, setEndDate] = useState(dateRange.endDate)
  const [initialCapital, setInitialCapital] = useState(defaultInitialCapital('us'))
  const [orderType, setOrderType] = useState<OrderType>('all_in')
  const [fixedAmount, setFixedAmount] = useState(defaultFixedAmount('us'))
  const [metricToOptimize, setMetricToOptimize] = useState<StrategyMetric>('sharpe_ratio')
  const [shortWindow, setShortWindow] = useState('20')
  const [longWindow, setLongWindow] = useState('50')
  const [shortWindowRangeStart, setShortWindowRangeStart] = useState('10')
  const [shortWindowRangeEnd, setShortWindowRangeEnd] = useState('30')
  const [shortWindowRangeStep, setShortWindowRangeStep] = useState('5')
  const [longWindowRangeStart, setLongWindowRangeStart] = useState('40')
  const [longWindowRangeEnd, setLongWindowRangeEnd] = useState('80')
  const [longWindowRangeStep, setLongWindowRangeStep] = useState('5')
  const [rsiWindow, setRsiWindow] = useState('14')
  const [oversoldThreshold, setOversoldThreshold] = useState('30')
  const [overboughtThreshold, setOverboughtThreshold] = useState('70')
  const [rsiWindowRangeStart, setRsiWindowRangeStart] = useState('10')
  const [rsiWindowRangeEnd, setRsiWindowRangeEnd] = useState('20')
  const [rsiWindowRangeStep, setRsiWindowRangeStep] = useState('2')
  const [oversoldRangeStart, setOversoldRangeStart] = useState('20')
  const [oversoldRangeEnd, setOversoldRangeEnd] = useState('40')
  const [oversoldRangeStep, setOversoldRangeStep] = useState('5')
  const [overboughtRangeStart, setOverboughtRangeStart] = useState('60')
  const [overboughtRangeEnd, setOverboughtRangeEnd] = useState('80')
  const [overboughtRangeStep, setOverboughtRangeStep] = useState('5')
  const [bollingerWindow, setBollingerWindow] = useState('20')
  const [numStdDev, setNumStdDev] = useState('2')
  const [bollingerWindowRangeStart, setBollingerWindowRangeStart] = useState('15')
  const [bollingerWindowRangeEnd, setBollingerWindowRangeEnd] = useState('25')
  const [bollingerWindowRangeStep, setBollingerWindowRangeStep] = useState('5')
  const [numStdDevRangeStart, setNumStdDevRangeStart] = useState('1.5')
  const [numStdDevRangeEnd, setNumStdDevRangeEnd] = useState('2.5')
  const [numStdDevRangeStep, setNumStdDevRangeStep] = useState('0.5')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null)
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null)

  function resetResults() {
    setError(null)
    setBacktestResult(null)
    setOptimizationResult(null)
  }

  function handleMarketChange(nextMarket: Market) {
    setMarket(nextMarket)
    setTicker(defaultTicker(nextMarket))
    setInitialCapital(defaultInitialCapital(nextMarket))
    setFixedAmount(defaultFixedAmount(nextMarket))
    setKrxExchange('auto')
    setSearchQuery('')
    setSearchError(null)
    setSearchResults([])
    resetResults()
  }

  function handlePickCompany(company: KRXSearchResult) {
    setTicker(company.ticker)
    setKrxExchange(company.krx_exchange)
    resetResults()
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

  function validateCommonInputs(): CommonInputValidation {
    const normalizedTicker = ticker.trim()
    const normalizedInitialCapital = Number(initialCapital)
    const normalizedFixedAmount = Number(fixedAmount)

    if (!normalizedTicker) {
      return { error: '종목 코드를 입력하세요.' }
    }
    if (!normalizedInitialCapital || normalizedInitialCapital <= 0) {
      return { error: '초기 자산은 0보다 커야 합니다.' }
    }
    if (startDate >= endDate) {
      return { error: '시작일은 종료일보다 빨라야 합니다.' }
    }
    if (orderType === 'fixed_amount' && (!normalizedFixedAmount || normalizedFixedAmount <= 0)) {
      return { error: '분할 매수 금액은 0보다 커야 합니다.' }
    }

    return {
      payload: {
        ticker: normalizedTicker,
        market,
        krx_exchange: krxExchange,
        start_date: startDate,
        end_date: endDate,
        initial_capital: normalizedInitialCapital,
        order_type: orderType,
        fixed_amount: orderType === 'fixed_amount' ? normalizedFixedAmount : undefined,
      },
    }
  }

  async function handleRunBacktest() {
    const validated = validateCommonInputs()
    if ('error' in validated) {
      setError(validated.error)
      return
    }

    let request:
      | MovingAverageBacktestRequest
      | RSIBacktestRequest
      | BollingerBandsBacktestRequest

    if (strategy === 'moving_average') {
      request = {
        ...validated.payload,
        short_window: Number(shortWindow),
        long_window: Number(longWindow),
      }
      if (request.short_window >= request.long_window) {
        setError('단기 평균 기간은 장기 평균 기간보다 작아야 합니다.')
        return
      }
    } else if (strategy === 'rsi') {
      request = {
        ...validated.payload,
        window: Number(rsiWindow),
        oversold_threshold: Number(oversoldThreshold),
        overbought_threshold: Number(overboughtThreshold),
      }
      if (request.oversold_threshold >= request.overbought_threshold) {
        setError('과매도 기준선은 과매수 기준선보다 작아야 합니다.')
        return
      }
    } else {
      request = {
        ...validated.payload,
        window: Number(bollingerWindow),
        num_std_dev: Number(numStdDev),
      }
    }

    setLoading(true)
    setError(null)
    setOptimizationResult(null)

    try {
      const response =
        strategy === 'moving_average'
          ? await apiClient.movingAverageBacktest(request as MovingAverageBacktestRequest)
          : strategy === 'rsi'
            ? await apiClient.rsiBacktest(request as RSIBacktestRequest)
            : await apiClient.bollingerBandsBacktest(request as BollingerBandsBacktestRequest)

      setBacktestResult(response)
    } catch (caughtError) {
      if (caughtError instanceof ApiError) {
        setError(caughtError.detail)
      } else if (caughtError instanceof Error) {
        setError(caughtError.message)
      } else {
        setError('시뮬레이션 실행에 실패했습니다.')
      }
      setBacktestResult(null)
    } finally {
      setLoading(false)
    }
  }

  async function handleRunOptimization() {
    const validated = validateCommonInputs()
    if ('error' in validated) {
      setError(validated.error)
      return
    }

    let request:
      | MovingAverageOptimizationRequest
      | RSIOptimizationRequest
      | BollingerBandsOptimizationRequest

    if (strategy === 'moving_average') {
      request = {
        ...validated.payload,
        metric_to_optimize: metricToOptimize,
        short_window_range: [
          Number(shortWindowRangeStart),
          Number(shortWindowRangeEnd),
          Number(shortWindowRangeStep),
        ],
        long_window_range: [
          Number(longWindowRangeStart),
          Number(longWindowRangeEnd),
          Number(longWindowRangeStep),
        ],
      }
      if (request.short_window_range[0] > request.short_window_range[1]) {
        setError('단기 평균 기간 범위의 시작값은 끝값보다 작거나 같아야 합니다.')
        return
      }
      if (request.long_window_range[0] > request.long_window_range[1]) {
        setError('장기 평균 기간 범위의 시작값은 끝값보다 작거나 같아야 합니다.')
        return
      }
    } else if (strategy === 'rsi') {
      request = {
        ...validated.payload,
        metric_to_optimize: metricToOptimize,
        window_range: [Number(rsiWindowRangeStart), Number(rsiWindowRangeEnd), Number(rsiWindowRangeStep)],
        oversold_threshold_range: [
          Number(oversoldRangeStart),
          Number(oversoldRangeEnd),
          Number(oversoldRangeStep),
        ],
        overbought_threshold_range: [
          Number(overboughtRangeStart),
          Number(overboughtRangeEnd),
          Number(overboughtRangeStep),
        ],
      }
      if (request.oversold_threshold_range[0] >= request.overbought_threshold_range[1]) {
        setError('RSI 범위는 과매도 기준이 과매수 기준보다 낮게 잡히도록 설정하세요.')
        return
      }
    } else {
      request = {
        ...validated.payload,
        metric_to_optimize: metricToOptimize,
        window_range: [
          Number(bollingerWindowRangeStart),
          Number(bollingerWindowRangeEnd),
          Number(bollingerWindowRangeStep),
        ],
        num_std_dev_range: [
          Number(numStdDevRangeStart),
          Number(numStdDevRangeEnd),
          Number(numStdDevRangeStep),
        ],
      }
    }

    setLoading(true)
    setError(null)
    setBacktestResult(null)

    try {
      const response =
        strategy === 'moving_average'
          ? await apiClient.movingAverageOptimize(request as MovingAverageOptimizationRequest)
          : strategy === 'rsi'
            ? await apiClient.rsiOptimize(request as RSIOptimizationRequest)
            : await apiClient.bollingerBandsOptimize(request as BollingerBandsOptimizationRequest)

      setOptimizationResult(response)
    } catch (caughtError) {
      if (caughtError instanceof ApiError) {
        setError(caughtError.detail)
      } else if (caughtError instanceof Error) {
        setError(caughtError.message)
      } else {
        setError('전략 최적화 실행에 실패했습니다.')
      }
      setOptimizationResult(null)
    } finally {
      setLoading(false)
    }
  }

  const metrics = backtestResult?.performance_metrics ?? {}
  const benchmarkMetrics = backtestResult?.benchmark_metrics ?? {}
  const comparisonMetrics = backtestResult?.comparison_metrics ?? {}
  const sortedOptimizationResults = optimizationResult ? sortOptimizationResults(optimizationResult) : []

  return (
    <main className="page-shell">
      <section className="content-panel">
        <p className="content-panel__eyebrow">전략 연습</p>
        <h2 className="content-panel__title">전략 시뮬레이션</h2>
        <p className="content-panel__description">
          모바일 인앱 기준으로 백테스트와 전략 최적화를 한 화면 안에서 분리된 모드로
          재구성했습니다.
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

        <div className="segmented-control simulation-mode-toggle" role="tablist" aria-label="실행 모드">
          <button
            type="button"
            className={
              mode === 'backtest'
                ? 'segmented-control__button segmented-control__button--active'
                : 'segmented-control__button'
            }
            onClick={() => {
              setMode('backtest')
              resetResults()
            }}
          >
            일반 백테스트
          </button>
          <button
            type="button"
            className={
              mode === 'optimize'
                ? 'segmented-control__button segmented-control__button--active'
                : 'segmented-control__button'
            }
            onClick={() => {
              setMode('optimize')
              resetResults()
            }}
          >
            전략 최적화
          </button>
        </div>

        <div className="chip-row" role="tablist" aria-label="전략 선택">
          {STRATEGY_OPTIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={item.value === strategy ? 'chip chip--active' : 'chip'}
              onClick={() => {
                setStrategy(item.value)
                resetResults()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <p className="helper-text">{strategyDescription(strategy)}</p>

        <div className="simulation-action-bar">
          <div className="simulation-action-bar__meta">
            <span>{mode === 'backtest' ? '일반 백테스트' : '전략 최적화'}</span>
            <strong>{strategyLabel(strategy)}</strong>
          </div>
          <button
            type="button"
            className="primary-action simulation-action-bar__button"
            onClick={() => void (mode === 'backtest' ? handleRunBacktest() : handleRunOptimization())}
            disabled={loading}
          >
            {loading
              ? mode === 'backtest'
                ? '실행 중...'
                : '최적화 중...'
              : mode === 'backtest'
                ? '전략 실행'
                : '최적화 실행'}
          </button>
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
                      className={ticker === company.ticker ? 'chip chip--active' : 'chip'}
                      onClick={() => handlePickCompany(company)}
                    >
                      {company.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field-grid">
                <div>
                  <label className="field-label" htmlFor="simulation-krx-exchange">
                    국내 거래소
                  </label>
                  <select
                    id="simulation-krx-exchange"
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
                  <label className="field-label" htmlFor="simulation-krx-search">
                    국내 종목명 검색
                  </label>
                  <div className="input-action-row">
                    <input
                      id="simulation-krx-search"
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

          <div className="field-grid">
            <div>
              <label className="field-label" htmlFor="simulation-ticker">
                {market === 'krx' ? '종목 코드' : '주식 티커'}
              </label>
              <input
                id="simulation-ticker"
                className="text-field"
                value={ticker}
                onChange={(event) => setTicker(event.target.value.toUpperCase())}
                placeholder={market === 'krx' ? '005930' : 'AAPL'}
              />
              <p className="helper-text helper-text--tight">{tickerHelpText(market)}</p>
            </div>

            <div>
              <label className="field-label" htmlFor="simulation-capital">
                초기 자산
              </label>
              <input
                id="simulation-capital"
                className="text-field"
                inputMode="numeric"
                value={initialCapital}
                onChange={(event) => setInitialCapital(sanitizeIntegerInput(event.target.value))}
              />
            </div>
          </div>

          <div className="field-grid">
            <div>
              <label className="field-label" htmlFor="simulation-start-date">
                시작일
              </label>
              <input
                id="simulation-start-date"
                className="text-field"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </div>

            <div>
              <label className="field-label" htmlFor="simulation-end-date">
                종료일
              </label>
              <input
                id="simulation-end-date"
                className="text-field"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="field-label">주문 방식</label>
            <div className="segmented-control" role="tablist" aria-label="주문 방식">
              <button
                type="button"
                className={
                  orderType === 'all_in'
                    ? 'segmented-control__button segmented-control__button--active'
                    : 'segmented-control__button'
                }
                onClick={() => setOrderType('all_in')}
              >
                전액 매수
              </button>
              <button
                type="button"
                className={
                  orderType === 'fixed_amount'
                    ? 'segmented-control__button segmented-control__button--active'
                    : 'segmented-control__button'
                }
                onClick={() => setOrderType('fixed_amount')}
              >
                분할 매수
              </button>
            </div>
          </div>

          {orderType === 'fixed_amount' ? (
            <div>
              <label className="field-label" htmlFor="simulation-fixed-amount">
                회당 매수 금액
              </label>
              <input
                id="simulation-fixed-amount"
                className="text-field"
                inputMode="numeric"
                value={fixedAmount}
                onChange={(event) => setFixedAmount(sanitizeIntegerInput(event.target.value))}
              />
            </div>
          ) : null}

          {mode === 'optimize' ? (
            <div>
              <label className="field-label" htmlFor="simulation-optimize-metric">
                최적화 기준 지표
              </label>
              <select
                id="simulation-optimize-metric"
                className="text-field"
                value={metricToOptimize}
                onChange={(event) => setMetricToOptimize(event.target.value as StrategyMetric)}
              >
                {METRIC_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {strategy === 'moving_average' ? (
            mode === 'backtest' ? (
              <div className="field-grid">
                <div>
                  <label className="field-label" htmlFor="simulation-short-window">
                    단기 평균 기간
                  </label>
                  <input
                    id="simulation-short-window"
                    className="text-field"
                    inputMode="numeric"
                    value={shortWindow}
                    onChange={(event) => setShortWindow(sanitizeIntegerInput(event.target.value))}
                  />
                </div>

                <div>
                  <label className="field-label" htmlFor="simulation-long-window">
                    장기 평균 기간
                  </label>
                  <input
                    id="simulation-long-window"
                    className="text-field"
                    inputMode="numeric"
                    value={longWindow}
                    onChange={(event) => setLongWindow(sanitizeIntegerInput(event.target.value))}
                  />
                </div>
              </div>
            ) : (
              <>
                <div>
                  <label className="field-label">단기 평균 기간 범위</label>
                  <div className="range-grid">
                    <input
                      className="text-field"
                      inputMode="numeric"
                      value={shortWindowRangeStart}
                      onChange={(event) => setShortWindowRangeStart(sanitizeIntegerInput(event.target.value))}
                      placeholder="시작"
                    />
                    <input
                      className="text-field"
                      inputMode="numeric"
                      value={shortWindowRangeEnd}
                      onChange={(event) => setShortWindowRangeEnd(sanitizeIntegerInput(event.target.value))}
                      placeholder="끝"
                    />
                    <input
                      className="text-field"
                      inputMode="numeric"
                      value={shortWindowRangeStep}
                      onChange={(event) => setShortWindowRangeStep(sanitizeIntegerInput(event.target.value))}
                      placeholder="간격"
                    />
                  </div>
                </div>

                <div>
                  <label className="field-label">장기 평균 기간 범위</label>
                  <div className="range-grid">
                    <input
                      className="text-field"
                      inputMode="numeric"
                      value={longWindowRangeStart}
                      onChange={(event) => setLongWindowRangeStart(sanitizeIntegerInput(event.target.value))}
                      placeholder="시작"
                    />
                    <input
                      className="text-field"
                      inputMode="numeric"
                      value={longWindowRangeEnd}
                      onChange={(event) => setLongWindowRangeEnd(sanitizeIntegerInput(event.target.value))}
                      placeholder="끝"
                    />
                    <input
                      className="text-field"
                      inputMode="numeric"
                      value={longWindowRangeStep}
                      onChange={(event) => setLongWindowRangeStep(sanitizeIntegerInput(event.target.value))}
                      placeholder="간격"
                    />
                  </div>
                </div>
              </>
            )
          ) : null}

          {strategy === 'rsi' ? (
            mode === 'backtest' ? (
              <>
                <div className="field-grid">
                  <div>
                    <label className="field-label" htmlFor="simulation-rsi-window">
                      RSI 기간
                    </label>
                    <input
                      id="simulation-rsi-window"
                      className="text-field"
                      inputMode="numeric"
                      value={rsiWindow}
                      onChange={(event) => setRsiWindow(sanitizeIntegerInput(event.target.value))}
                    />
                  </div>

                  <div>
                    <label className="field-label" htmlFor="simulation-rsi-oversold">
                      과매도 기준선
                    </label>
                    <input
                      id="simulation-rsi-oversold"
                      className="text-field"
                      inputMode="numeric"
                      value={oversoldThreshold}
                      onChange={(event) => setOversoldThreshold(sanitizeIntegerInput(event.target.value))}
                    />
                  </div>
                </div>

                <div>
                  <label className="field-label" htmlFor="simulation-rsi-overbought">
                    과매수 기준선
                  </label>
                  <input
                    id="simulation-rsi-overbought"
                    className="text-field"
                    inputMode="numeric"
                    value={overboughtThreshold}
                    onChange={(event) => setOverboughtThreshold(sanitizeIntegerInput(event.target.value))}
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="field-label">RSI 기간 범위</label>
                  <div className="range-grid">
                    <input
                      className="text-field"
                      inputMode="numeric"
                      value={rsiWindowRangeStart}
                      onChange={(event) => setRsiWindowRangeStart(sanitizeIntegerInput(event.target.value))}
                      placeholder="시작"
                    />
                    <input
                      className="text-field"
                      inputMode="numeric"
                      value={rsiWindowRangeEnd}
                      onChange={(event) => setRsiWindowRangeEnd(sanitizeIntegerInput(event.target.value))}
                      placeholder="끝"
                    />
                    <input
                      className="text-field"
                      inputMode="numeric"
                      value={rsiWindowRangeStep}
                      onChange={(event) => setRsiWindowRangeStep(sanitizeIntegerInput(event.target.value))}
                      placeholder="간격"
                    />
                  </div>
                </div>

                <div>
                  <label className="field-label">과매도 기준선 범위</label>
                  <div className="range-grid">
                    <input
                      className="text-field"
                      inputMode="numeric"
                      value={oversoldRangeStart}
                      onChange={(event) => setOversoldRangeStart(sanitizeIntegerInput(event.target.value))}
                      placeholder="시작"
                    />
                    <input
                      className="text-field"
                      inputMode="numeric"
                      value={oversoldRangeEnd}
                      onChange={(event) => setOversoldRangeEnd(sanitizeIntegerInput(event.target.value))}
                      placeholder="끝"
                    />
                    <input
                      className="text-field"
                      inputMode="numeric"
                      value={oversoldRangeStep}
                      onChange={(event) => setOversoldRangeStep(sanitizeIntegerInput(event.target.value))}
                      placeholder="간격"
                    />
                  </div>
                </div>

                <div>
                  <label className="field-label">과매수 기준선 범위</label>
                  <div className="range-grid">
                    <input
                      className="text-field"
                      inputMode="numeric"
                      value={overboughtRangeStart}
                      onChange={(event) => setOverboughtRangeStart(sanitizeIntegerInput(event.target.value))}
                      placeholder="시작"
                    />
                    <input
                      className="text-field"
                      inputMode="numeric"
                      value={overboughtRangeEnd}
                      onChange={(event) => setOverboughtRangeEnd(sanitizeIntegerInput(event.target.value))}
                      placeholder="끝"
                    />
                    <input
                      className="text-field"
                      inputMode="numeric"
                      value={overboughtRangeStep}
                      onChange={(event) => setOverboughtRangeStep(sanitizeIntegerInput(event.target.value))}
                      placeholder="간격"
                    />
                  </div>
                </div>
              </>
            )
          ) : null}

          {strategy === 'bollinger_bands' ? (
            mode === 'backtest' ? (
              <div className="field-grid">
                <div>
                  <label className="field-label" htmlFor="simulation-bb-window">
                    밴드 계산 기간
                  </label>
                  <input
                    id="simulation-bb-window"
                    className="text-field"
                    inputMode="numeric"
                    value={bollingerWindow}
                    onChange={(event) => setBollingerWindow(sanitizeIntegerInput(event.target.value))}
                  />
                </div>

                <div>
                  <label className="field-label" htmlFor="simulation-bb-std">
                    표준편차 배수
                  </label>
                  <input
                    id="simulation-bb-std"
                    className="text-field"
                    inputMode="decimal"
                    value={numStdDev}
                    onChange={(event) => setNumStdDev(sanitizeDecimalInput(event.target.value))}
                  />
                </div>
              </div>
            ) : (
              <>
                <div>
                  <label className="field-label">밴드 계산 기간 범위</label>
                  <div className="range-grid">
                    <input
                      className="text-field"
                      inputMode="numeric"
                      value={bollingerWindowRangeStart}
                      onChange={(event) => setBollingerWindowRangeStart(sanitizeIntegerInput(event.target.value))}
                      placeholder="시작"
                    />
                    <input
                      className="text-field"
                      inputMode="numeric"
                      value={bollingerWindowRangeEnd}
                      onChange={(event) => setBollingerWindowRangeEnd(sanitizeIntegerInput(event.target.value))}
                      placeholder="끝"
                    />
                    <input
                      className="text-field"
                      inputMode="numeric"
                      value={bollingerWindowRangeStep}
                      onChange={(event) => setBollingerWindowRangeStep(sanitizeIntegerInput(event.target.value))}
                      placeholder="간격"
                    />
                  </div>
                </div>

                <div>
                  <label className="field-label">표준편차 배수 범위</label>
                  <div className="range-grid">
                    <input
                      className="text-field"
                      inputMode="decimal"
                      value={numStdDevRangeStart}
                      onChange={(event) => setNumStdDevRangeStart(sanitizeDecimalInput(event.target.value))}
                      placeholder="시작"
                    />
                    <input
                      className="text-field"
                      inputMode="decimal"
                      value={numStdDevRangeEnd}
                      onChange={(event) => setNumStdDevRangeEnd(sanitizeDecimalInput(event.target.value))}
                      placeholder="끝"
                    />
                    <input
                      className="text-field"
                      inputMode="decimal"
                      value={numStdDevRangeStep}
                      onChange={(event) => setNumStdDevRangeStep(sanitizeDecimalInput(event.target.value))}
                      placeholder="간격"
                    />
                  </div>
                </div>
              </>
            )
          ) : null}

        </div>

        {error ? <div className="state-box state-box--error">{error}</div> : null}
      </section>

      {backtestResult ? (
        <>
          <section className="content-panel">
            <p className="content-panel__eyebrow">백테스트 결과</p>
            <h3 className="content-panel__title">
              {backtestResult.resolved_ticker} 백테스트 결과
            </h3>
            <p className="content-panel__description">
              입력 종목 {backtestResult.ticker} 기준으로 조회한 실제 심볼은 {backtestResult.resolved_ticker}입니다.
            </p>

            <div className="simulation-metric-grid">
              <article className="summary-mini-card">
                <span className="summary-mini-card__label">총수익률</span>
                <strong className="summary-mini-card__value">
                  {formatPct(metrics.total_return_pct)}
                </strong>
              </article>
              <article className="summary-mini-card">
                <span className="summary-mini-card__label">샤프 지수</span>
                <strong className="summary-mini-card__value">
                  {formatNumber(metrics.sharpe_ratio)}
                </strong>
              </article>
              <article className="summary-mini-card">
                <span className="summary-mini-card__label">최대 낙폭</span>
                <strong className="summary-mini-card__value">
                  {formatPct(metrics.max_drawdown_pct)}
                </strong>
              </article>
              <article className="summary-mini-card">
                <span className="summary-mini-card__label">최종 자산</span>
                <strong className="summary-mini-card__value">
                  {formatMoney(metrics.final_total_value, backtestResult.market)}
                </strong>
              </article>
            </div>

            <div className="simulation-compare-grid">
              <article className="sector-card">
                <p className="sector-card__rank">전략 성과</p>
                <h4 className="sector-card__title">{strategyLabel(strategy)}</h4>
                <p className="sector-card__metric">
                  CAGR {formatPct(metrics.cagr_pct)} / 변동성 {formatPct(metrics.annual_volatility_pct)}
                </p>
                <p className="sector-card__meta">
                  총 거래 {formatNumber(metrics.total_trades, 0)}회 / 승률 {formatPct(metrics.win_rate)}
                </p>
              </article>

              <article className="sector-card">
                <p className="sector-card__rank">단순 보유 비교</p>
                <h4 className="sector-card__title">Buy & Hold</h4>
                <p className="sector-card__metric">
                  단순 보유 수익률 {formatPct(benchmarkMetrics.total_return_pct)}
                </p>
                <p className="sector-card__meta">
                  초과 수익률 {formatPct(comparisonMetrics.excess_return_pct)}
                </p>
              </article>
            </div>

            <div className="content-panel content-panel--nested">
              <p className="content-panel__eyebrow">실행 파라미터</p>
              <div className="simulation-parameter-list">
                {Object.entries(backtestResult.strategy_params).map(([key, value]) => (
                  <div key={key} className="simulation-parameter-item">
                    <span>{parameterLabel(key)}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="content-panel">
            <div className="section-block__header">
              <h3>최근 거래 내역</h3>
            </div>
            {backtestResult.trades.length === 0 ? (
              <div className="state-box">해당 기간에는 거래가 발생하지 않았습니다.</div>
            ) : (
              <div className="trade-list">
                {backtestResult.trades.map((trade, index) => (
                  <article key={`${trade.Date}-${index}`} className="trade-item">
                    <div className="trade-item__top">
                      <strong>{trade.Type === 'BUY' ? '매수 체결' : '매도 체결'}</strong>
                      <span className={trade.Type === 'BUY' ? 'badge badge--buy' : 'badge badge--sell'}>
                        {trade.Type}
                      </span>
                    </div>
                    <p className="trade-item__meta">체결일 {formatDateTime(trade.Date)}</p>
                    <p className="trade-item__meta">
                      단가 {formatMoney(trade.Price, backtestResult.market)} / 수량 {trade.Shares}주
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}

      {optimizationResult ? (
        <>
          <section className="content-panel">
            <p className="content-panel__eyebrow">전략 최적화 결과</p>
            <h3 className="content-panel__title">
              {optimizationResult.resolved_ticker} 최적 파라미터 탐색
            </h3>
            <p className="content-panel__description">
              기준 지표는 {metricLabel(optimizationResult.metric_optimized)}이며, 가능한 조합 중 가장 높은 값을 찾았습니다.
            </p>

            <div className="simulation-metric-grid">
              <article className="summary-mini-card">
                <span className="summary-mini-card__label">최적화 기준</span>
                <strong className="summary-mini-card__value">
                  {metricLabel(optimizationResult.metric_optimized)}
                </strong>
              </article>
              <article className="summary-mini-card">
                <span className="summary-mini-card__label">최적 지표 값</span>
                <strong className="summary-mini-card__value">
                  {formatNumber(optimizationResult.best_metric_value)}
                </strong>
              </article>
              <article className="summary-mini-card">
                <span className="summary-mini-card__label">탐색 전략</span>
                <strong className="summary-mini-card__value">{strategyLabel(strategy)}</strong>
              </article>
              <article className="summary-mini-card">
                <span className="summary-mini-card__label">조합 수</span>
                <strong className="summary-mini-card__value">
                  {optimizationResult.all_optimization_results.length.toLocaleString('ko-KR')}
                </strong>
              </article>
            </div>

            <div className="content-panel content-panel--nested">
              <p className="content-panel__eyebrow">최적 파라미터</p>
              <div className="simulation-parameter-list">
                {Object.entries(optimizationResult.best_params).map(([key, value]) => (
                  <div key={key} className="simulation-parameter-item">
                    <span>{parameterLabel(key)}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="content-panel">
            <div className="section-block__header">
              <h3>상위 최적화 결과</h3>
            </div>
            <div className="optimization-result-list">
              {sortedOptimizationResults.slice(0, 10).map((item, index) => (
                <article key={index} className="optimization-result-item">
                  <div className="optimization-result-item__top">
                    <strong>조합 {index + 1}</strong>
                    <span className="badge">{formatNumber(Number(item.metrics[optimizationResult.metric_optimized]))}</span>
                  </div>
                  <div className="simulation-parameter-list simulation-parameter-list--compact">
                    {Object.entries(item.params).map(([key, value]) => (
                      <div key={key} className="simulation-parameter-item">
                        <span>{parameterLabel(key)}</span>
                        <strong>{value}</strong>
                      </div>
                    ))}
                  </div>
                  <p className="optimization-result-item__meta">
                    총수익률 {formatPct(Number(item.metrics.total_return_pct))} / 샤프 {formatNumber(Number(item.metrics.sharpe_ratio))}
                  </p>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : null}

      <section className="content-panel">
        <p className="content-panel__eyebrow">현재 범위</p>
        <ul className="bullet-list">
          <li>백테스트는 전략 요약과 최근 거래 내역까지 바로 확인할 수 있습니다.</li>
          <li>전략 최적화는 상위 조합 요약까지 제공하며, 이후 단계에서 시각화와 전체 결과 탐색 UX를 더 보강할 수 있습니다.</li>
          <li>포트폴리오 곡선 차트는 다음 시각화 단계에서 추가하는 편이 구조적으로 깔끔합니다.</li>
        </ul>
      </section>
    </main>
  )
}
