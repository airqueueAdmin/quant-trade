const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
}

type Market = 'krx' | 'us'
type KrxExchange = 'auto' | 'kospi' | 'kosdaq'

function normalizeMarket(value: string | null): Market {
  return value?.toLowerCase() === 'krx' ? 'krx' : 'us'
}

function normalizeExchange(value: string | null): KrxExchange {
  if (value === 'kospi' || value === 'kosdaq') return value
  return 'auto'
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

function toUnixSeconds(value: string | null, fallback: number) {
  if (!value) return fallback
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : fallback
}

async function fetchHistory(symbol: string, startDate: string | null, endDate: string | null) {
  const now = Math.floor(Date.now() / 1000)
  const period1 = toUnixSeconds(startDate, now - 120 * 24 * 60 * 60)
  const period2 = toUnixSeconds(endDate, now + 24 * 60 * 60)
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`)
  url.searchParams.set('period1', String(period1))
  url.searchParams.set('period2', String(period2))
  url.searchParams.set('interval', '1d')
  url.searchParams.set('includePrePost', 'false')

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 QuantInvestor/1.0' },
  })
  if (!response.ok) return null
  const payload = await response.json()
  const result = payload?.chart?.result?.[0]
  if (!result) return null

  const timestamps = result.timestamp ?? []
  const quote = result.indicators?.quote?.[0] ?? {}
  const rows = []
  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = timestamps[index]
    const close = quote.close?.[index]
    if (typeof timestamp !== 'number' || typeof close !== 'number') continue
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
    rows.push({
      Date: date,
      Open: typeof quote.open?.[index] === 'number' ? quote.open[index] : undefined,
      High: typeof quote.high?.[index] === 'number' ? quote.high[index] : undefined,
      Low: typeof quote.low?.[index] === 'number' ? quote.low[index] : undefined,
      Close: close,
      Volume: typeof quote.volume?.[index] === 'number' ? quote.volume[index] : undefined,
    })
  }
  return rows.length > 0 ? rows : null
}

function errorResponse(status: number, detail: string) {
  return new Response(JSON.stringify({ detail }), { status, headers: corsHeaders })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'GET') return errorResponse(405, 'Method not allowed')

  const url = new URL(request.url)
  const ticker = (url.searchParams.get('ticker') || '').trim()
  if (!ticker) return errorResponse(400, 'ticker is required')

  const market = normalizeMarket(url.searchParams.get('market'))
  const exchange = normalizeExchange(url.searchParams.get('krx_exchange'))
  const candidates = buildCandidates(ticker, market, exchange)

  for (const candidate of candidates) {
    const rows = await fetchHistory(candidate, url.searchParams.get('start_date'), url.searchParams.get('end_date'))
    if (!rows) continue
    return new Response(JSON.stringify({
      ticker: market === 'krx' ? ticker : ticker.toUpperCase(),
      resolved_ticker: candidate,
      market,
      krx_exchange: market === 'krx'
        ? candidate.endsWith('.KS') ? 'kospi' : candidate.endsWith('.KQ') ? 'kosdaq' : exchange
        : 'auto',
      rows,
    }), { headers: corsHeaders })
  }

  return errorResponse(404, `${ticker}의 기간 데이터를 찾을 수 없습니다.`)
})
