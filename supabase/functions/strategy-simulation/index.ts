const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

type Market = 'krx' | 'us'
type KrxExchange = 'auto' | 'kospi' | 'kosdaq'
type StrategyName = 'moving_average' | 'rsi' | 'bollinger_bands'
type Row = { Date: string; Open: number; Close: number }
type Trade = { Date: string; Type: 'BUY' | 'SELL'; Price: number; Shares: number }
type PortfolioPoint = { Date: string; cash: number; holdings_value: number; total_value: number }

const COMMISSION = 0.001

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders })
}

function errorResponse(status: number, detail: string) {
  return jsonResponse({ detail }, status)
}

function numberOr(value: unknown, fallback = 0) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : fallback
}

function integer(value: unknown, name: string, minimum = 1, maximum = 400) {
  const number = numberOr(value, NaN)
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return number
}

function positive(value: unknown, name: string) {
  const number = numberOr(value, NaN)
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be greater than 0`)
  return number
}

function normalizeMarket(value: unknown): Market {
  if (value !== 'us' && value !== 'krx') throw new Error("market must be 'us' or 'krx'")
  return value
}

function normalizeExchange(value: unknown): KrxExchange {
  if (value === 'kospi' || value === 'kosdaq' || value === 'auto') return value
  throw new Error("krx_exchange must be 'auto', 'kospi', or 'kosdaq'")
}

function normalizeDate(value: unknown, name: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) {
    throw new Error(`${name} is not a valid date`)
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new Error(`${name} is not a valid date`)
  return value.slice(0, 10)
}

function buildCandidates(ticker: string, market: Market, exchange: KrxExchange) {
  const normalized = ticker.trim().toUpperCase()
  if (market === 'us') return [normalized]
  if (normalized.endsWith('.KS') || normalized.endsWith('.KQ')) return [normalized]
  const code = normalized.replace(/\D/g, '')
  if (!/^\d{6}$/.test(code)) return [normalized]
  if (exchange === 'kospi') return [`${code}.KS`]
  if (exchange === 'kosdaq') return [`${code}.KQ`]
  return [`${code}.KS`, `${code}.KQ`]
}

function unixSeconds(date: string, end = false) {
  const timestamp = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(timestamp)) throw new Error('날짜 형식이 잘못되었습니다.')
  return Math.floor(timestamp / 1000) + (end ? 24 * 60 * 60 : 0)
}

async function fetchHistory(symbol: string, startDate: string, endDate: string): Promise<Row[] | null> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`)
  url.searchParams.set('period1', String(unixSeconds(startDate)))
  url.searchParams.set('period2', String(unixSeconds(endDate, true)))
  url.searchParams.set('interval', '1d')
  url.searchParams.set('includePrePost', 'false')

  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 QuantInvestor/1.0' } })
  if (!response.ok) return null
  const payload = await response.json()
  const result = payload?.chart?.result?.[0]
  if (!result) return null

  const timestamps = result.timestamp ?? []
  const quote = result.indicators?.quote?.[0] ?? {}
  const rows: Row[] = []
  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = timestamps[index]
    const open = quote.open?.[index]
    const close = quote.close?.[index]
    if (typeof timestamp !== 'number' || typeof open !== 'number' || typeof close !== 'number') continue
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
    if (date < startDate || date > endDate) continue
    rows.push({ Date: date, Open: open, Close: close })
  }
  return rows.length >= 2 ? rows : null
}

async function loadData(ticker: string, startDate: string, endDate: string, market: Market, exchange: KrxExchange) {
  const candidates = buildCandidates(ticker, market, exchange)
  for (const candidate of candidates) {
    const rows = await fetchHistory(candidate, startDate, endDate)
    if (!rows) continue
    return {
      rows,
      resolved_ticker: candidate,
      krx_exchange: market === 'krx'
        ? candidate.endsWith('.KS') ? 'kospi' : candidate.endsWith('.KQ') ? 'kosdaq' : exchange
        : 'auto',
    }
  }
  throw new Error(`${ticker}의 기간 데이터를 찾을 수 없습니다.`)
}

function rollingMean(values: number[], index: number, window: number) {
  const start = Math.max(0, index - window + 1)
  let total = 0
  for (let cursor = start; cursor <= index; cursor += 1) total += values[cursor]
  return total / (index - start + 1)
}

function rollingSampleStd(values: number[], index: number, window: number) {
  const start = Math.max(0, index - window + 1)
  const count = index - start + 1
  if (count < window || count < 2) return NaN
  const mean = rollingMean(values, index, window)
  let squared = 0
  for (let cursor = start; cursor <= index; cursor += 1) squared += (values[cursor] - mean) ** 2
  return Math.sqrt(squared / (count - 1))
}

function movingAverageSignals(rows: Row[], shortWindow: number, longWindow: number) {
  const signals: number[] = []
  for (let index = 0; index < rows.length; index += 1) {
    const signal = rollingMean(rows.map((row) => row.Close), index, shortWindow)
      > rollingMean(rows.map((row) => row.Close), index, longWindow) ? 1 : 0
    signals.push(index < shortWindow ? 0 : signal)
  }
  return positionsFromSignals(signals)
}

function rsiSignals(rows: Row[], window: number, oversold: number, overbought: number) {
  const closes = rows.map((row) => row.Close)
  const ups = closes.map((close, index) => index === 0 ? 0 : Math.max(close - closes[index - 1], 0))
  const downs = closes.map((close, index) => index === 0 ? 0 : Math.max(closes[index - 1] - close, 0))
  const signals: number[] = []
  let position = 0
  for (let index = 0; index < rows.length; index += 1) {
    let signal = 0
    if (index >= window - 1) {
      const alpha = 1 / window
      let upWeighted = 0
      let downWeighted = 0
      let weightTotal = 0
      for (let cursor = 0; cursor <= index; cursor += 1) {
        const weight = (1 - alpha) ** (index - cursor)
        upWeighted += ups[cursor] * weight
        downWeighted += downs[cursor] * weight
        weightTotal += weight
      }
      const maUp = upWeighted / weightTotal
      const maDown = downWeighted / weightTotal
      const rsi = maDown === 0 ? (maUp === 0 ? NaN : 100) : 100 - (100 / (1 + maUp / maDown))
      if (rsi < oversold) signal = 1
      else if (rsi > overbought) signal = -1
    }
    if (signal === 1) position = 1
    else if (signal === -1) position = 0
    signals.push(position)
  }
  return positionsFromSignals(signals)
}

function bollingerSignals(rows: Row[], window: number, numStdDev: number) {
  const closes = rows.map((row) => row.Close)
  const signals: number[] = []
  let position = 0
  for (let index = 0; index < rows.length; index += 1) {
    const mean = rollingMean(closes, index, window)
    const stdDev = rollingSampleStd(closes, index, window)
    const lower = mean - stdDev * numStdDev
    const upper = mean + stdDev * numStdDev
    const signal = closes[index] < lower ? 1 : closes[index] > upper ? -1 : 0
    if (signal === 1) position = 1
    else if (signal === -1) position = 0
    signals.push(position)
  }
  return positionsFromSignals(signals)
}

function positionsFromSignals(signals: number[]) {
  return signals.map((signal, index) => signal - (index === 0 ? 0 : signals[index - 1]))
}

function strategyPositions(rows: Row[], strategy: StrategyName, params: Record<string, number>) {
  if (strategy === 'moving_average') return movingAverageSignals(rows, params.short_window, params.long_window)
  if (strategy === 'rsi') return rsiSignals(rows, params.window, params.oversold_threshold, params.overbought_threshold)
  return bollingerSignals(rows, params.window, params.num_std_dev)
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function performanceMetrics(history: PortfolioPoint[], initialCapital: number, trades: Trade[] = []) {
  if (!history.length) return {}
  const finalValue = history[history.length - 1].total_value
  const totalReturn = (finalValue / initialCapital - 1) * 100
  const dailyReturns = history.slice(1).map((point, index) => point.total_value / history[index].total_value - 1)
  const dailyStd = standardDeviation(dailyReturns)
  const sharpe = dailyReturns.length > 0 && dailyStd !== 0
    ? (dailyReturns.reduce((sum, value) => sum + value, 0) / dailyReturns.length / dailyStd) * Math.sqrt(252)
    : 0
  const volatility = dailyStd !== 0 ? dailyStd * Math.sqrt(252) * 100 : 0
  const downside = dailyReturns.filter((value) => value < 0)
  const downsideStd = standardDeviation(downside)
  const sortino = downside.length > 0 && downsideStd !== 0
    ? (dailyReturns.reduce((sum, value) => sum + value, 0) / dailyReturns.length / downsideStd) * Math.sqrt(252)
    : 0
  let peak = -Infinity
  let maxDrawdown = 0
  for (const point of history) {
    peak = Math.max(peak, point.total_value)
    maxDrawdown = Math.min(maxDrawdown, (point.total_value - peak) / peak)
  }
  const cagr = history.length > 1 && initialCapital > 0 && finalValue > 0
    ? (finalValue / initialCapital) ** (252 / (history.length - 1)) - 1
    : 0

  const metrics: Record<string, number> = {
    initial_capital: initialCapital,
    final_total_value: finalValue,
    total_return_pct: totalReturn,
    cagr_pct: cagr * 100,
    sharpe_ratio: sharpe,
    sortino_ratio: sortino,
    annual_volatility_pct: volatility,
    max_drawdown_pct: maxDrawdown * 100,
  }
  if (trades.length) {
    const profits: number[] = []
    for (let index = 0; index + 1 < trades.length; index += 2) {
      const buy = trades[index]
      const sell = trades[index + 1]
      if (buy.Type === 'BUY' && sell.Type === 'SELL') {
        profits.push((sell.Price * (1 - COMMISSION)) / (buy.Price * (1 + COMMISSION)) - 1)
      }
    }
    if (!profits.length) {
      metrics.total_trades = trades.length
      metrics.win_rate = 0
      metrics.average_profit_pct = 0
      metrics.profit_factor = 0
    } else {
      const grossProfit = profits.filter((value) => value > 0).reduce((sum, value) => sum + value, 0)
      const grossLoss = Math.abs(profits.filter((value) => value < 0).reduce((sum, value) => sum + value, 0))
      metrics.total_trades = trades.length
      metrics.win_rate = profits.filter((value) => value > 0).length / profits.length * 100
      metrics.average_profit_pct = profits.reduce((sum, value) => sum + value, 0) / profits.length * 100
      metrics.profit_factor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit
    }
  }
  return metrics
}

function runStrategy(rows: Row[], positions: number[], initialCapital: number, orderType: string, fixedAmount: number) {
  let cash = initialCapital
  let shares = 0
  const trades: Trade[] = []
  const history: PortfolioPoint[] = []
  for (let index = 0; index < rows.length - 1; index += 1) {
    const row = rows[index]
    const nextRow = rows[index + 1]
    const positionSignal = positions[index]
    const tradePrice = nextRow.Open
    if (positionSignal === 1 && cash > 0) {
      const buyAmount = orderType === 'fixed_amount' ? Math.min(cash, fixedAmount) : cash
      const availableShares = Math.floor(buyAmount / (tradePrice * (1 + COMMISSION)))
      if (availableShares > 0) {
        cash -= availableShares * tradePrice * (1 + COMMISSION)
        shares += availableShares
        trades.push({ Date: nextRow.Date, Type: 'BUY', Price: tradePrice, Shares: availableShares })
      }
    } else if (positionSignal === -1 && shares > 0) {
      cash += shares * tradePrice * (1 - COMMISSION)
      trades.push({ Date: nextRow.Date, Type: 'SELL', Price: tradePrice, Shares: shares })
      shares = 0
    }
    const holdingsValue = shares * row.Close
    history.push({ Date: row.Date, cash, holdings_value: holdingsValue, total_value: cash + holdingsValue })
  }
  const last = rows[rows.length - 1]
  const holdingsValue = shares * last.Close
  history.push({ Date: last.Date, cash, holdings_value: holdingsValue, total_value: cash + holdingsValue })
  const metrics = performanceMetrics(history, initialCapital, trades)
  metrics.total_trades = trades.length
  return { history, trades, metrics }
}

function runBenchmark(rows: Row[], initialCapital: number) {
  const firstPrice = rows[0].Open
  const shares = Math.floor(initialCapital / (firstPrice * (1 + COMMISSION)))
  const cash = initialCapital - shares * firstPrice * (1 + COMMISSION)
  const history = rows.map((row) => {
    const holdingsValue = shares * row.Close
    return { Date: row.Date, cash, holdings_value: holdingsValue, total_value: cash + holdingsValue }
  })
  return { history, metrics: performanceMetrics(history, initialCapital) }
}

function baseRequest(body: Record<string, unknown>) {
  const ticker = typeof body.ticker === 'string' ? body.ticker.trim() : ''
  if (!ticker) throw new Error('ticker is required')
  const market = normalizeMarket(body.market ?? 'us')
  const exchange = normalizeExchange(body.krx_exchange ?? 'auto')
  const startDate = normalizeDate(body.start_date, 'start_date')
  const endDate = normalizeDate(body.end_date, 'end_date')
  if (startDate >= endDate) throw new Error('시작일은 종료일보다 빨라야 합니다.')
  const initialCapital = positive(body.initial_capital ?? 100000, 'initial_capital')
  const orderType = body.order_type ?? 'all_in'
  if (orderType !== 'all_in' && orderType !== 'fixed_amount') throw new Error("order_type must be 'all_in' or 'fixed_amount'")
  const fixedAmount = orderType === 'fixed_amount' ? positive(body.fixed_amount, 'fixed_amount') : initialCapital
  return { ticker, market, exchange, startDate, endDate, initialCapital, orderType, fixedAmount }
}

function buildParams(strategy: StrategyName, body: Record<string, unknown>, optimization = false) {
  if (strategy === 'moving_average') {
    const short = integer(optimization ? (body.short_window_range as unknown[])?.[0] : body.short_window, 'short_window')
    const long = integer(optimization ? (body.long_window_range as unknown[])?.[0] : body.long_window, 'long_window')
    return { short_window: short, long_window: long }
  }
  if (strategy === 'rsi') {
    const window = integer(optimization ? (body.window_range as unknown[])?.[0] : body.window, 'window')
    const oversold = integer(optimization ? (body.oversold_threshold_range as unknown[])?.[0] : body.oversold_threshold, 'oversold_threshold', 0, 100)
    const overbought = integer(optimization ? (body.overbought_threshold_range as unknown[])?.[0] : body.overbought_threshold, 'overbought_threshold', 0, 100)
    if (oversold >= overbought) throw new Error('oversold_threshold must be smaller than overbought_threshold')
    return { window, oversold_threshold: oversold, overbought_threshold: overbought }
  }
  return {
    window: integer(optimization ? (body.window_range as unknown[])?.[0] : body.window, 'window'),
    num_std_dev: positive(optimization ? (body.num_std_dev_range as unknown[])?.[0] : body.num_std_dev, 'num_std_dev'),
  }
}

function range(value: unknown, name: string, integerOnly = false) {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${name} must contain [start, end, step]`)
  const start = numberOr(value[0], NaN)
  const end = numberOr(value[1], NaN)
  const step = numberOr(value[2], NaN)
  if (![start, end, step].every(Number.isFinite) || step <= 0 || start > end) throw new Error(`${name} has an invalid range`)
  if (integerOnly && (![start, end, step].every(Number.isInteger) || start < 1 || end > 400)) {
    throw new Error(`${name} must contain valid integer values`)
  }
  const values: number[] = []
  if (integerOnly || [start, end, step].every((item) => Number.isInteger(item))) {
    for (let current = start; current <= end; current += step) values.push(current)
  } else {
    for (let current = start; current <= end + step / 2; current += step) values.push(Math.round(current * 1e10) / 1e10)
  }
  return values
}

function strategyList(strategy: StrategyName, body: Record<string, unknown>) {
  if (strategy === 'moving_average') {
    return {
      short_window: range(body.short_window_range, 'short_window_range', true),
      long_window: range(body.long_window_range, 'long_window_range', true),
    }
  }
  if (strategy === 'rsi') {
    return {
      window: range(body.window_range, 'window_range', true),
      oversold_threshold: range(body.oversold_threshold_range, 'oversold_threshold_range', true),
      overbought_threshold: range(body.overbought_threshold_range, 'overbought_threshold_range', true),
    }
  }
  return {
    window: range(body.window_range, 'window_range', true),
    num_std_dev: range(body.num_std_dev_range, 'num_std_dev_range'),
  }
}

function comparison(strategyMetrics: Record<string, number>, benchmarkMetrics: Record<string, number>) {
  return {
    excess_return_pct: (strategyMetrics.total_return_pct ?? 0) - (benchmarkMetrics.total_return_pct ?? 0),
    excess_cagr_pct: (strategyMetrics.cagr_pct ?? 0) - (benchmarkMetrics.cagr_pct ?? 0),
    excess_sharpe_ratio: (strategyMetrics.sharpe_ratio ?? 0) - (benchmarkMetrics.sharpe_ratio ?? 0),
    drawdown_gap_pct: (strategyMetrics.max_drawdown_pct ?? 0) - (benchmarkMetrics.max_drawdown_pct ?? 0),
  }
}

function readStrategy(value: unknown): StrategyName {
  if (value === 'moving_average' || value === 'rsi' || value === 'bollinger_bands') return value
  throw new Error('strategy must be moving_average, rsi, or bollinger_bands')
}

async function handle(request: Request) {
  const url = new URL(request.url)
  const action = url.searchParams.get('action') ?? 'backtest'
  const body = await request.json() as Record<string, unknown>
  const strategy = readStrategy(url.searchParams.get('strategy') ?? body.strategy)
  const common = baseRequest(body)
  const data = await loadData(common.ticker, common.startDate, common.endDate, common.market, common.exchange)

  if (action === 'backtest') {
    const params = buildParams(strategy, body)
    const positions = strategyPositions(data.rows, strategy, params)
    const result = runStrategy(data.rows, positions, common.initialCapital, common.orderType, common.fixedAmount)
    const benchmark = runBenchmark(data.rows, common.initialCapital)
    return {
      ticker: common.ticker,
      resolved_ticker: data.resolved_ticker,
      market: common.market,
      krx_exchange: data.krx_exchange,
      strategy_params: params,
      performance_metrics: result.metrics,
      benchmark_metrics: benchmark.metrics,
      comparison_metrics: comparison(result.metrics, benchmark.metrics),
      portfolio_history: result.history,
      benchmark_history: benchmark.history,
      trades: result.trades,
    }
  }

  if (action !== 'optimize') throw new Error("action must be 'backtest' or 'optimize'")
  const metric = body.metric_to_optimize ?? 'sharpe_ratio'
  if (!['sharpe_ratio', 'total_return_pct', 'cagr_pct', 'sortino_ratio'].includes(String(metric))) {
    throw new Error('metric_to_optimize is not supported')
  }
  const grids = strategyList(strategy, body)
  const keys = Object.keys(grids)
  const combinations = keys.reduce((total, key) => total * grids[key as keyof typeof grids].length, 1)
  if (combinations > 5000) throw new Error('최적화 조합이 너무 많습니다. 범위를 줄여 다시 시도해 주세요.')
  let bestMetric = -Infinity
  let bestParams: Record<string, number> = {}
  const allResults: Array<{ params: Record<string, number>; metrics: Record<string, number> }> = []
  const walk = (index: number, params: Record<string, number>) => {
    if (index === keys.length) {
      if (strategy === 'moving_average' && params.short_window >= params.long_window) return
      if (strategy === 'rsi' && params.oversold_threshold >= params.overbought_threshold) return
      const positions = strategyPositions(data.rows, strategy, params)
      const result = runStrategy(data.rows, positions, common.initialCapital, common.orderType, common.fixedAmount)
      const metricValue = result.metrics[String(metric)] ?? -Infinity
      allResults.push({ params: { ...params }, metrics: result.metrics })
      if (metricValue > bestMetric) {
        bestMetric = metricValue
        bestParams = { ...params }
      }
      return
    }
    const key = keys[index]
    for (const value of grids[key as keyof typeof grids]) walk(index + 1, { ...params, [key]: value })
  }
  walk(0, {})
  return {
    ticker: common.ticker,
    resolved_ticker: data.resolved_ticker,
    market: common.market,
    krx_exchange: data.krx_exchange,
    best_params: bestParams,
    best_metric_value: Number.isFinite(bestMetric) ? bestMetric : 0,
    metric_optimized: metric,
    all_optimization_results: allResults,
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return errorResponse(405, 'Method not allowed')
  try {
    return jsonResponse(await handle(request))
  } catch (error) {
    const detail = error instanceof Error ? error.message : '전략 시뮬레이션에 실패했습니다.'
    const status = detail.includes('찾을 수 없습니다') ? 404 : 400
    return errorResponse(status, detail)
  }
})
