const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
}

const KRX_STOCKS = [
  ['005930', '삼성전자', 'kospi'], ['000660', 'SK하이닉스', 'kospi'],
  ['373220', 'LG에너지솔루션', 'kospi'], ['207940', '삼성바이오로직스', 'kospi'],
  ['005380', '현대차', 'kospi'], ['000270', '기아', 'kospi'],
  ['035420', 'NAVER', 'kospi'], ['035720', '카카오', 'kospi'],
  ['105560', 'KB금융', 'kospi'], ['055550', '신한지주', 'kospi'],
  ['086790', '하나금융지주', 'kospi'], ['138040', '메리츠금융지주', 'kospi'],
  ['005490', 'POSCO홀딩스', 'kospi'], ['006400', '삼성SDI', 'kospi'],
  ['051910', 'LG화학', 'kospi'], ['012450', '한화에어로스페이스', 'kospi'],
  ['034020', '두산에너빌리티', 'kospi'], ['196170', '알테오젠', 'kosdaq'],
  ['247540', '에코프로비엠', 'kosdaq'], ['086520', '에코프로', 'kosdaq'],
  ['028300', 'HLB', 'kosdaq'], ['277810', '레인보우로보틱스', 'kosdaq'],
] as const

const POPULAR_US = [
  ['AAPL', 'Apple Inc.', 'NASDAQ'], ['MSFT', 'Microsoft Corporation', 'NASDAQ'],
  ['NVDA', 'NVIDIA Corporation', 'NASDAQ'], ['AMZN', 'Amazon.com, Inc.', 'NASDAQ'],
  ['GOOGL', 'Alphabet Inc.', 'NASDAQ'], ['META', 'Meta Platforms, Inc.', 'NASDAQ'],
  ['TSLA', 'Tesla, Inc.', 'NASDAQ'], ['AVGO', 'Broadcom Inc.', 'NASDAQ'],
  ['AMD', 'Advanced Micro Devices, Inc.', 'NASDAQ'], ['QCOM', 'Qualcomm Incorporated', 'NASDAQ'],
  ['MU', 'Micron Technology, Inc.', 'NASDAQ'], ['TSM', 'Taiwan Semiconductor', 'NYSE'],
  ['ASML', 'ASML Holding N.V.', 'NASDAQ'], ['PLTR', 'Palantir Technologies', 'NASDAQ'],
  ['JPM', 'JPMorgan Chase & Co.', 'NYSE'], ['V', 'Visa Inc.', 'NYSE'],
] as const

function errorResponse(status: number, detail: string) {
  return new Response(JSON.stringify({ detail }), { status, headers: corsHeaders })
}

function searchKrx(query: string, limit: number) {
  const normalized = query.trim().toLowerCase()
  return KRX_STOCKS.filter(([ticker, name]) => !normalized || ticker.includes(normalized) || name.toLowerCase().includes(normalized))
    .slice(0, limit)
    .map(([ticker, name, exchange]) => ({ ticker, name, krx_exchange: exchange, display_name: `${name} (${ticker}, ${exchange.toUpperCase()})` }))
}

function normalizeUsResult(raw: Record<string, unknown>) {
  const ticker = String(raw.symbol || '').trim().toUpperCase()
  const name = String(raw.longname || raw.shortname || ticker).trim()
  const exchange = String(raw.exchDisp || raw.exchange || 'US').trim()
  const quoteType = String(raw.quoteType || 'EQUITY').toLowerCase()
  if (!ticker || !/^[A-Z0-9.-]{1,16}$/.test(ticker) || !['equity', 'etf'].includes(quoteType)) return null
  return { ticker, name, exchange, quote_type: quoteType, currency: 'USD', aliases: [] }
}

async function searchUs(query: string, limit: number) {
  const local = POPULAR_US.filter(([ticker, name]) => {
    const q = query.toLowerCase()
    return !q || ticker.toLowerCase().includes(q) || name.toLowerCase().includes(q)
  }).map(([ticker, name, exchange]) => ({ ticker, name, exchange, quote_type: 'equity', currency: 'USD', aliases: [] }))

  try {
    const url = new URL('https://query1.finance.yahoo.com/v1/finance/search')
    url.searchParams.set('q', query)
    url.searchParams.set('quotesCount', String(limit))
    url.searchParams.set('newsCount', '0')
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 QuantInvestor/1.0' } })
    if (response.ok) {
      const payload = await response.json()
      const remote = (payload.quotes || []).map(normalizeUsResult).filter(Boolean)
      const merged = new Map([...remote, ...local].map((item) => [item.ticker, item]))
      return [...merged.values()].slice(0, limit)
    }
  } catch {
    // The local popular-symbol fallback keeps search usable during provider errors.
  }
  return local.slice(0, limit)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'GET') return errorResponse(405, 'Method not allowed')

  const url = new URL(request.url)
  const query = url.searchParams.get('q') || ''
  const market = url.searchParams.get('market') === 'krx' ? 'krx' : 'us'
  const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') || 20), 50))
  const results = market === 'krx' ? searchKrx(query, limit) : await searchUs(query, limit)
  return new Response(JSON.stringify({ query, results }), { headers: corsHeaders })
})
