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

function asNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

async function fetchChart(symbol: string) {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`)
  url.searchParams.set('range', '3mo')
  url.searchParams.set('interval', '1d')
  url.searchParams.set('includePrePost', 'false')
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 QuantInvestor/1.0' },
  })
  if (!response.ok) return null
  const payload = await response.json()
  const result = payload?.chart?.result?.[0]
  if (!result) return null

  const closes = result.indicators?.quote?.[0]?.close ?? []
  const timestamps = result.timestamp ?? []
  const points: Array<{ timestamp: number; close: number }> = []
  for (let index = 0; index < closes.length; index += 1) {
    const close = asNumber(closes[index])
    const timestamp = asNumber(timestamps[index])
    if (close !== null && timestamp !== null) points.push({ timestamp, close })
  }
  if (points.length === 0) return null

  const latest = points[points.length - 1]
  const previous = points[points.length - 2] ?? latest
  const changeAmount = latest.close - previous.close
  const changePct = previous.close ? (changeAmount / previous.close) * 100 : 0
  const meta = result.meta ?? {}
  return {
    resolved_ticker: symbol,
    company_name: meta.longName || meta.shortName || null,
    as_of: new Date(latest.timestamp * 1000).toISOString(),
    close: latest.close,
    previous_close: previous.close,
    change_amount: changeAmount,
    change_pct: changePct,
    market_status: meta.marketState || null,
    currency: meta.currency || null,
  }
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
    const chart = await fetchChart(candidate)
    if (!chart) continue
    return new Response(JSON.stringify({
      ticker: market === 'krx' ? ticker : ticker.toUpperCase(),
      resolved_ticker: market === 'krx' ? candidate : ticker.toUpperCase(),
      market,
      krx_exchange: market === 'krx'
        ? candidate.endsWith('.KS') ? 'kospi' : candidate.endsWith('.KQ') ? 'kosdaq' : exchange
        : 'auto',
      ...chart,
      source: 'yahoo_finance_chart',
    }), { headers: corsHeaders })
  }

  return errorResponse(404, `${ticker}의 시세 데이터를 찾을 수 없습니다.`)
})
