const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
}

type Market = 'krx' | 'us'
type Direction = 'gainers' | 'losers'

function errorResponse(status: number, detail: string) {
  return new Response(JSON.stringify({ detail }), { status, headers: corsHeaders })
}

function parseNumber(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const normalized = String(value ?? '').replace(/,/g, '').replace(/%/g, '').trim()
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function asOfFromUnix(value: unknown, market: Market) {
  const timestamp = parseNumber(value)
  if (timestamp > 0) return new Date(timestamp * 1000).toISOString()
  return new Date().toISOString()
}

function normalizeYahoo(raw: Record<string, unknown>, market: Market) {
  const resolvedTicker = String(raw.symbol || '').trim().toUpperCase()
  if (!resolvedTicker) return null
  const price = parseNumber(raw.regularMarketPrice)
  const previousClose = parseNumber(raw.regularMarketPreviousClose)
  const changeAmount = parseNumber(raw.regularMarketChange) || price - previousClose
  const changePct = raw.regularMarketChangePercent === undefined
    ? previousClose ? changeAmount / previousClose * 100 : 0
    : parseNumber(raw.regularMarketChangePercent)
  return {
    ticker: resolvedTicker,
    resolved_ticker: resolvedTicker,
    name: String(raw.longName || raw.shortName || resolvedTicker),
    market,
    krx_exchange: 'auto',
    exchange: String(raw.fullExchangeName || raw.exchange || 'US'),
    currency: String(raw.currency || 'USD').toUpperCase(),
    price,
    previous_close: previousClose,
    change_amount: changeAmount,
    change_pct: changePct,
    volume: Math.round(parseNumber(raw.regularMarketVolume)),
    market_cap: parseNumber(raw.marketCap),
    as_of: asOfFromUnix(raw.regularMarketTime, market),
  }
}

async function fetchYahoo(direction: Direction, limit: number) {
  const url = new URL('https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved')
  url.searchParams.set('scrIds', direction === 'gainers' ? 'day_gainers' : 'day_losers')
  url.searchParams.set('count', String(Math.max(25, Math.min(limit * 3, 100))))
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 QuantInvestor/1.0' } })
  if (!response.ok) throw new Error(`Yahoo 급등락 응답 오류 (${response.status})`)
  const payload = await response.json()
  const quotes = payload?.finance?.result?.[0]?.quotes || []
  const rows = quotes
    .map((raw: Record<string, unknown>) => normalizeYahoo(raw, 'us'))
    .filter((row: ReturnType<typeof normalizeYahoo>): row is NonNullable<ReturnType<typeof normalizeYahoo>> => row !== null)
    .filter((row: NonNullable<ReturnType<typeof normalizeYahoo>>) => row.price >= 5 && row.market_cap >= 2_000_000_000)
    .filter((row: NonNullable<ReturnType<typeof normalizeYahoo>>) => direction === 'gainers' ? row.change_pct > 0 : row.change_pct < 0)
  rows.sort((left, right) => direction === 'gainers' ? right.change_pct - left.change_pct : left.change_pct - right.change_pct)
  return rows.slice(0, limit)
}

function normalizeNaver(raw: Record<string, unknown>) {
  const ticker = String(raw.itemCode || '').trim()
  if (!/^\d{6}$/.test(ticker)) return null
  const changeAmount = parseNumber(raw.compareToPreviousClosePriceRaw || raw.compareToPreviousClosePrice)
  const price = parseNumber(raw.closePriceRaw || raw.closePrice)
  const changePct = parseNumber(raw.fluctuationsRatio)
  const volume = Math.round(parseNumber(raw.accumulatedTradingVolumeRaw || raw.accumulatedTradingVolume))
  const marketCap = parseNumber(raw.marketValueRaw || raw.marketValue)
  const exchangePayload = (raw.stockExchangeType || {}) as Record<string, unknown>
  const isKosdaq = String(raw.sosok || '') === '1' || String(exchangePayload.code || '').toUpperCase() === 'KQ'
  const exchange = isKosdaq ? 'kosdaq' : 'kospi'
  return {
    ticker,
    resolved_ticker: `${ticker}.${isKosdaq ? 'KQ' : 'KS'}`,
    name: String(raw.stockName || ticker),
    market: 'krx',
    krx_exchange: exchange,
    exchange: isKosdaq ? 'KOSDAQ' : 'KOSPI',
    currency: 'KRW',
    price,
    previous_close: price - changeAmount,
    change_amount: changeAmount,
    change_pct: changePct,
    volume,
    market_cap: marketCap,
    as_of: String(raw.localTradedAt || new Date().toISOString()),
  }
}

async function fetchNaver(direction: Direction, limit: number) {
  const route = direction === 'gainers' ? 'up' : 'down'
  const pageSize = Math.max(50, Math.min(limit * 10, 100))
  const results = await Promise.all(['KOSPI', 'KOSDAQ'].map(async (category) => {
    const url = new URL(`https://m.stock.naver.com/api/stocks/${route}/${category}`)
    url.searchParams.set('page', '1')
    url.searchParams.set('pageSize', String(pageSize))
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 QuantInvestor/1.0' } })
    if (!response.ok) throw new Error(`Naver 급등락 응답 오류 (${response.status})`)
    const payload = await response.json()
    return (payload.stocks || []) as Record<string, unknown>[]
  }))
  const rows = results.flat()
    .map(normalizeNaver)
    .filter((row): row is NonNullable<ReturnType<typeof normalizeNaver>> => row !== null)
    .filter((row) => row.market_cap >= 100_000_000_000 && row.volume > 10_000)
    .filter((row) => direction === 'gainers' ? row.change_pct > 0 : row.change_pct < 0)
  rows.sort((left, right) => direction === 'gainers' ? right.change_pct - left.change_pct : left.change_pct - right.change_pct)
  return rows.slice(0, limit)
}

function snapshotStatus(market: Market) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: market === 'krx' ? 'Asia/Seoul' : 'America/New_York',
    hour: 'numeric',
    hour12: false,
  })
  const hour = Number(formatter.format(new Date()))
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: market === 'krx' ? 'Asia/Seoul' : 'America/New_York', weekday: 'short' }).format(new Date())
  if (weekday === 'Sat' || weekday === 'Sun') return { text: '휴장일 기준 최근 영업일 확정값', estimate: false }
  const closeHour = market === 'krx' ? 15 : 16
  if (hour >= closeHour) return { text: '장 마감 기준 확정값', estimate: false }
  return { text: '장중 잠정값', estimate: true }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'GET') return errorResponse(405, 'Method not allowed')
  try {
    const url = new URL(request.url)
    const market: Market = url.searchParams.get('market') === 'krx' ? 'krx' : 'us'
    const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') || 10) || 10, 20))
    const fetchMovers = market === 'krx' ? fetchNaver : fetchYahoo
    const [gainers, losers] = await Promise.all([fetchMovers('gainers', limit), fetchMovers('losers', limit)])
    if (!gainers.length && !losers.length) throw new Error('급등·급락 종목 데이터를 찾지 못했습니다.')
    const allRows = [...gainers, ...losers]
    const status = snapshotStatus(market)
    return new Response(JSON.stringify({
      market,
      market_name: market === 'krx' ? '국내' : '미국',
      as_of: allRows.map((row) => row.as_of).sort().at(-1) || new Date().toISOString(),
      snapshot_status: status.text,
      intraday_estimate: status.estimate,
      universe_note: market === 'us'
        ? 'NASDAQ·NYSE 상장 보통주 중 주가 5달러·시가총액 20억달러 이상'
        : 'KOSPI·KOSDAQ 상장 종목 중 시가총액 1천억원·거래량 1만주 이상',
      is_stale: false,
      data_source: market === 'krx' ? 'naver_finance' : 'yahoo_finance',
      gainers,
      losers,
    }), { headers: corsHeaders })
  } catch (error) {
    return errorResponse(503, error instanceof Error ? error.message : '급등·급락 데이터를 가져오지 못했습니다.')
  }
})
