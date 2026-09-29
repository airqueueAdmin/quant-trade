const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-session',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
}

const seedCashKrw = 10_000_000
const rankingAdjectives = ['차분한', '꾸준한', '날쌘', '영리한', '담대한', '신중한', '반짝이는', '부지런한']
const rankingAnimals = ['수달', '여우', '다람쥐', '고양이', '강아지', '판다', '토끼', '부엉이', '고래']
const rankingColors = ['blue', 'purple', 'green', 'orange', 'pink']

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function sessionAccountId(token: string | null) {
  if (!token) throw new Error('앱 세션이 필요합니다.')
  const [encodedPayload, encodedSignature] = token.trim().split('.', 2)
  if (!encodedPayload || !encodedSignature) throw new Error('세션 토큰 형식이 올바르지 않습니다.')

  const secret = Deno.env.get('APP_SESSION_SECRET')?.trim()
  if (!secret) throw new Error('APP_SESSION_SECRET is not configured')
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const payload = base64UrlDecode(encodedPayload)
  const signature = base64UrlDecode(encodedSignature)
  const valid = await crypto.subtle.verify('HMAC', key, signature, payload)
  if (!valid) throw new Error('세션 토큰 검증에 실패했습니다.')

  const accountId = new TextDecoder().decode(payload)
  if (!/^[A-Za-z0-9_-]+$/.test(accountId)) throw new Error('세션 계정 형식이 올바르지 않습니다.')
  return accountId
}

function supabaseConfig() {
  const url = Deno.env.get('SUPABASE_URL')?.trim()
  const serviceRoleKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_KEY'))?.trim()
  if (!url || !serviceRoleKey) throw new Error('Supabase service role is not configured')
  return { url: url.replace(/\/$/, ''), serviceRoleKey }
}

async function supabaseRequest(path: string, init: RequestInit = {}) {
  const { url, serviceRoleKey } = supabaseConfig()
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Supabase 요청 실패 (${response.status}): ${detail.slice(0, 300)}`)
  }
  return response.json()
}

async function rankingProfile(accountId: string) {
  const bytes = new TextEncoder().encode(`paper-ranking:${accountId}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const suffix = 100 + ((digest[2] * 256 + digest[3]) % 900)
  return {
    nickname: `${rankingAdjectives[digest[0] % rankingAdjectives.length]} ${rankingAnimals[digest[1] % rankingAnimals.length]} ${suffix}`,
    profile_color: rankingColors[digest[4] % rankingColors.length],
  }
}

async function ensureAccount(accountId: string) {
  const params = new URLSearchParams({
    account_id: `eq.${accountId}`,
    select: 'account_id,cash_krw,seed_cash_krw,updated_at',
    limit: '1',
  })
  const rows = await supabaseRequest(`paper_trading_accounts?${params.toString()}`)
  if (rows[0]) return rows[0]

  const created = await supabaseRequest('paper_trading_accounts?on_conflict=account_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([{ account_id: accountId, cash_krw: seedCashKrw, seed_cash_krw: seedCashKrw }]),
  })
  if (created[0]) return created[0]
  throw new Error('Supabase 계좌를 생성하지 못했습니다.')
}

async function getState(accountId: string) {
  const account = await ensureAccount(accountId)
  const holdingsParams = new URLSearchParams({
    account_id: `eq.${accountId}`,
    select: 'ticker,company_name,market,krx_exchange,shares,avg_price,updated_at',
    order: 'updated_at.desc',
  })
  const tradesParams = new URLSearchParams({
    account_id: `eq.${accountId}`,
    select: 'id,side,ticker,company_name,market,krx_exchange,price,native_price,usdkrw_rate,shares,amount_krw,traded_at',
    order: 'traded_at.desc',
    limit: '200',
  })
  const [holdings, trades, profile] = await Promise.all([
    supabaseRequest(`paper_trading_positions?${holdingsParams.toString()}`),
    supabaseRequest(`paper_trading_trades?${tradesParams.toString()}`),
    rankingProfile(accountId),
  ])
  return {
    account_id: accountId,
    cash_krw: account.cash_krw ?? seedCashKrw,
    seed_cash_krw: account.seed_cash_krw ?? seedCashKrw,
    holdings,
    trades,
    ranking_profile: profile,
    updated_at: account.updated_at ?? null,
  }
}

function yahooCandidates(ticker: string, market: string, exchange: string) {
  const normalized = ticker.trim().toUpperCase()
  if (market === 'us') return [normalized]
  if (normalized.endsWith('.KS') || normalized.endsWith('.KQ')) return [normalized]
  const code = normalized.replace(/\D/g, '')
  if (!/^\d{6}$/.test(code)) return [normalized]
  if (exchange === 'kospi') return [`${code}.KS`]
  if (exchange === 'kosdaq') return [`${code}.KQ`]
  return [`${code}.KS`, `${code}.KQ`]
}

async function yahooClose(symbol: string) {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`)
  url.searchParams.set('range', '3mo')
  url.searchParams.set('interval', '1d')
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 QuantInvestor/1.0' } })
  if (!response.ok) return null
  const payload = await response.json()
  const result = payload?.chart?.result?.[0]
  const closes = result?.indicators?.quote?.[0]?.close ?? []
  const points = closes.filter((value: unknown) => typeof value === 'number' && Number.isFinite(value))
  if (!points.length) return null
  const meta = result.meta ?? {}
  return {
    close: points[points.length - 1] as number,
    previousClose: (points[points.length - 2] ?? points[points.length - 1]) as number,
    companyName: meta.longName || meta.shortName || null,
    marketStatus: meta.marketState || null,
    currency: meta.currency || null,
    resolvedTicker: symbol,
  }
}

async function currentPrice(ticker: string, market: string, exchange: string) {
  for (const candidate of yahooCandidates(ticker, market, exchange)) {
    const quote = await yahooClose(candidate)
    if (quote) return quote
  }
  return null
}

async function usdKrwRate() {
  const quote = await yahooClose('KRW=X')
  return quote?.close ?? null
}

async function orderQuote(ticker: string, market: string, exchange: string) {
  for (const candidate of yahooCandidates(ticker, market, exchange)) {
    const quote = await yahooClose(candidate)
    if (!quote) continue
    const changeAmount = quote.close - quote.previousClose
    return {
      ticker: market === 'krx' ? ticker : ticker.toUpperCase(),
      resolved_ticker: candidate,
      market,
      krx_exchange: market === 'krx'
        ? candidate.endsWith('.KS') ? 'kospi' : candidate.endsWith('.KQ') ? 'kosdaq' : exchange
        : 'auto',
      company_name: quote.companyName,
      as_of: new Date().toISOString(),
      close: quote.close,
      previous_close: quote.previousClose,
      change_amount: changeAmount,
      change_pct: quote.previousClose ? changeAmount / quote.previousClose * 100 : 0,
      market_status: quote.marketStatus,
      source: 'yahoo_finance_chart',
      currency: market === 'krx' ? 'KRW' : 'USD',
    }
  }
  return null
}

async function executeOrder(accountId: string, body: Record<string, unknown>) {
  const ticker = String(body.ticker || '').trim()
  const market = String(body.market || 'krx').toLowerCase()
  const exchange = String(body.krx_exchange || 'auto').toLowerCase()
  const side = String(body.side || '').toLowerCase()
  const shares = Number(body.shares)
  if (!ticker) throw new Error('ticker가 필요합니다.')
  if (market !== 'krx' && market !== 'us') throw new Error('market은 krx 또는 us여야 합니다.')
  if (!['auto', 'kospi', 'kosdaq'].includes(exchange)) throw new Error('krx_exchange가 올바르지 않습니다.')
  if (side !== 'buy' && side !== 'sell') throw new Error('side는 buy 또는 sell이어야 합니다.')
  if (!Number.isInteger(shares) || shares <= 0) throw new Error('shares는 1 이상의 정수여야 합니다.')

  const quote = await orderQuote(ticker, market, exchange)
  if (!quote) throw new Error(`${ticker}의 현재가를 찾을 수 없습니다.`)
  const rate = market === 'us' ? await usdKrwRate() : 1
  if (!rate) throw new Error('환율 데이터를 가져오지 못했습니다.')
  const nativePrice = Number(quote.close)
  const priceKrw = nativePrice * rate
  quote.native_price = nativePrice
  quote.price_krw = priceKrw
  quote.usdkrw_rate = rate
  quote.currency = market === 'us' ? 'USD' : 'KRW'

  const result = await supabaseRequest('rpc/execute_paper_trade', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      p_account_id: accountId,
      p_ticker: ticker,
      p_company_name: String(body.company_name || quote.company_name || ticker),
      p_market: market,
      p_krx_exchange: market === 'krx' ? exchange : 'auto',
      p_side: side,
      p_price: priceKrw,
      p_native_price: nativePrice,
      p_usdkrw_rate: rate,
      p_shares: shares,
    }),
  })
  return { quote, result }
}

async function resetAccount(accountId: string) {
  const result = await supabaseRequest('rpc/reset_paper_trading_account', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ p_account_id: accountId, p_seed_cash_krw: seedCashKrw }),
  })
  return { account_id: accountId, result }
}

async function getRankings(accountId: string, sortBy: string, requestedLimit: string | null) {
  if (sortBy !== 'return' && sortBy !== 'assets') throw new Error('sort_by는 return 또는 assets여야 합니다.')
  const limit = Math.max(1, Math.min(Number(requestedLimit || 50) || 50, 100))
  await ensureAccount(accountId)

  const [accounts, positions, trades] = await Promise.all([
    supabaseRequest('paper_trading_accounts?select=account_id,cash_krw,seed_cash_krw,updated_at&order=updated_at.desc&limit=500'),
    supabaseRequest('paper_trading_positions?select=account_id,ticker,company_name,market,krx_exchange,shares,avg_price,updated_at&limit=5000'),
    supabaseRequest('paper_trading_trades?select=account_id&order=traded_at.desc&limit=5000'),
  ])
  const participantIds = new Set(
    [...positions, ...trades].map((row: Record<string, unknown>) => String(row.account_id || '')).filter(Boolean),
  )
  const participantAccounts = accounts.filter((row: Record<string, unknown>) => participantIds.has(String(row.account_id || '')))
  const participantPositions = positions.filter((row: Record<string, unknown>) => participantIds.has(String(row.account_id || '')))

  const quoteKeys = [...new Set(participantPositions.map((position: Record<string, unknown>) => (
    `${String(position.market || 'krx')}|${String(position.ticker || '')}|${String(position.krx_exchange || 'auto')}`
  )))]
  const rawQuotes = await Promise.all(quoteKeys.map(async (key) => {
    const [market, ticker, exchange] = key.split('|')
    return [key, await currentPrice(ticker, market, exchange)] as const
  }))
  const quotes = new Map(rawQuotes.filter((entry) => entry[1] !== null))
  const usPositions = participantPositions.some((position: Record<string, unknown>) => position.market === 'us')
  const fxRate = usPositions ? await usdKrwRate() : null
  const positionsByAccount = new Map<string, Record<string, unknown>[]>()
  for (const position of participantPositions) {
    const key = String(position.account_id || '')
    const existing = positionsByAccount.get(key) || []
    existing.push(position)
    positionsByAccount.set(key, existing)
  }

  const entries = await Promise.all(participantAccounts.map(async (account: Record<string, unknown>) => {
    const id = String(account.account_id || '')
    const accountPositions = positionsByAccount.get(id) || []
    let holdingsValue = 0
    let missingQuoteCount = 0
    let topHolding: Record<string, unknown> | null = null
    for (const position of accountPositions) {
      const market = String(position.market || 'krx')
      const ticker = String(position.ticker || '')
      const exchange = String(position.krx_exchange || 'auto')
      const quote = quotes.get(`${market}|${ticker}|${exchange}`)
      const shares = Number(position.shares || 0)
      const averagePrice = Number(position.avg_price || 0)
      const currentValue = quote
        ? Number(quote.close) * (market === 'us' ? Number(fxRate || 0) : 1)
        : averagePrice
      if (!quote || (market === 'us' && !fxRate)) missingQuoteCount += 1
      const marketValue = Math.max(0, shares * currentValue)
      holdingsValue += marketValue
      if (!topHolding || marketValue > Number(topHolding.market_value)) {
        topHolding = { ticker, company_name: position.company_name || ticker, market_value: marketValue }
      }
    }
    const cash = Number(account.cash_krw || 0)
    const seedCash = Number(account.seed_cash_krw || seedCashKrw)
    const totalAssets = cash + holdingsValue
    const profit = totalAssets - seedCash
    const returnPct = seedCash > 0 ? profit / seedCash * 100 : 0
    const profile = await rankingProfile(id)
    return { accountId: id, account, accountPositions, profile, totalAssets, profit, returnPct, topHolding, missingQuoteCount }
  }))

  const resolvedEntries = entries
  resolvedEntries.sort((left, right) => sortBy === 'assets'
    ? right.totalAssets - left.totalAssets || right.returnPct - left.returnPct
    : right.returnPct - left.returnPct || right.totalAssets - left.totalAssets)
  let previousMetric: number | null = null
  let rank = 0
  const publicEntries = resolvedEntries.map((entry, index) => {
    const metric = sortBy === 'assets' ? entry.totalAssets : entry.returnPct
    if (previousMetric === null || metric !== previousMetric) {
      rank = index + 1
      previousMetric = metric
    }
    const topHolding = entry.topHolding
      ? {
          ticker: entry.topHolding.ticker,
          company_name: entry.topHolding.company_name,
          allocation_pct: entry.totalAssets > 0 ? Number(entry.topHolding.market_value) / entry.totalAssets * 100 : 0,
        }
      : null
    return {
      ...entry.profile,
      is_me: entry.accountId === accountId,
      total_assets_krw: Math.round(entry.totalAssets),
      profit_krw: Math.round(entry.profit),
      total_return_pct: Number(entry.returnPct.toFixed(4)),
      holding_count: entry.accountPositions.length,
      top_holding: topHolding,
      updated_at: entry.account.updated_at ?? null,
      valuation_status: entry.missingQuoteCount ? 'partial' : 'complete',
      rank,
    }
  })
  const returns = publicEntries.map((entry) => entry.total_return_pct)
  return {
    sort_by: sortBy,
    participant_count: publicEntries.length,
    profitable_count: returns.filter((value) => value > 0).length,
    average_return_pct: returns.length ? Number((returns.reduce((sum, value) => sum + value, 0) / returns.length).toFixed(4)) : 0,
    best_return_pct: returns.length ? Math.max(...returns) : 0,
    entries: publicEntries.slice(0, limit),
    my_entry: publicEntries.find((entry) => entry.is_me) || null,
    as_of: new Date().toISOString(),
  }
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'GET' && request.method !== 'POST') return response({ detail: 'Method not allowed' }, 405)

  try {
    const url = new URL(request.url)
    const action = url.searchParams.get('action') || 'state'
    const accountId = await sessionAccountId(request.headers.get('X-App-Session'))
    if (action === 'state') return response(await getState(accountId))
    if (action === 'rankings') {
      return response(await getRankings(accountId, url.searchParams.get('sort_by') || 'return', url.searchParams.get('limit')))
    }
    if (request.method !== 'POST') return response({ detail: 'POST method is required for this action' }, 405)
    if (action === 'order') return response(await executeOrder(accountId, await request.json()))
    if (action === 'reset') return response(await resetAccount(accountId))
    return response({ detail: 'Unknown paper trading action' }, 400)
  } catch (error) {
    return response({ detail: error instanceof Error ? error.message : '모의투자 상태를 불러오지 못했습니다.' }, 400)
  }
})
