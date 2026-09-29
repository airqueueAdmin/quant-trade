const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-session',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Content-Type': 'application/json',
}

const seedCashKrw = 10_000_000
const strategyNames: Record<string, string> = {
  moving_average: '이동평균',
  rsi: 'RSI',
  bollinger_bands: '볼린저 밴드',
}
const runTypeNames: Record<string, string> = { backtest: '백테스트', optimization: '최적화' }
const summaryFields = 'id,save_name,run_type,strategy_key,strategy_name,ticker,resolved_ticker,company_name,market,krx_exchange,start_date,end_date,initial_capital,order_type,fixed_amount,metric_to_optimize,performance_summary,created_at,updated_at'
const detailFields = `${summaryFields},request_payload,result_payload`

function output(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders })
}

function decode(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(normalized + '='.repeat((4 - normalized.length % 4) % 4)), (character) => character.charCodeAt(0))
}

async function accountFromSession(token: string | null) {
  if (!token) throw new Error('앱 세션이 필요합니다.')
  const [payloadPart, signaturePart] = token.trim().split('.', 2)
  const secret = Deno.env.get('APP_SESSION_SECRET')?.trim()
  if (!payloadPart || !signaturePart || !secret) throw new Error('세션 토큰을 확인할 수 없습니다.')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const payload = decode(payloadPart)
  if (!await crypto.subtle.verify('HMAC', key, decode(signaturePart), payload)) throw new Error('세션 토큰 검증에 실패했습니다.')
  const accountId = new TextDecoder().decode(payload)
  if (!/^[A-Za-z0-9_-]+$/.test(accountId)) throw new Error('세션 계정 형식이 올바르지 않습니다.')
  return accountId
}

function config() {
  const url = Deno.env.get('SUPABASE_URL')?.trim()
  const key = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_KEY'))?.trim()
  if (!url || !key) throw new Error('Supabase service role is not configured')
  return { url: url.replace(/\/$/, ''), key }
}

async function db(path: string, init: RequestInit = {}) {
  const { url, key } = config()
  const result = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...init.headers },
  })
  if (!result.ok) throw new Error(`Supabase 요청 실패 (${result.status})`)
  const text = await result.text()
  return text ? JSON.parse(text) : null
}

async function ensureAccount(accountId: string) {
  const query = new URLSearchParams({ account_id: `eq.${accountId}`, select: 'account_id', limit: '1' })
  const rows = await db(`paper_trading_accounts?${query.toString()}`)
  if (!rows[0]) await db('paper_trading_accounts?on_conflict=account_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ account_id: accountId, cash_krw: seedCashKrw, seed_cash_krw: seedCashKrw }]) })
}

function performanceSummary(body: Record<string, unknown>) {
  if (body.run_type === 'optimization') {
    const payload = (body.result_payload || {}) as Record<string, unknown>
    return { best_metric_value: payload.best_metric_value ?? 0, metric_optimized: payload.metric_optimized ?? null, best_params: payload.best_params ?? {}, result_count: Array.isArray(payload.all_optimization_results) ? payload.all_optimization_results.length : 0 }
  }
  const payload = (body.result_payload || {}) as Record<string, unknown>
  const metrics = (payload.performance_metrics || {}) as Record<string, unknown>
  const benchmark = (payload.benchmark_metrics || {}) as Record<string, unknown>
  const comparison = (payload.comparison_metrics || {}) as Record<string, unknown>
  return { total_return_pct: metrics.total_return_pct ?? 0, sharpe_ratio: metrics.sharpe_ratio ?? 0, max_drawdown_pct: metrics.max_drawdown_pct ?? 0, cagr_pct: metrics.cagr_pct ?? 0, final_total_value: metrics.final_total_value ?? 0, total_trades: metrics.total_trades ?? 0, benchmark_total_return_pct: benchmark.total_return_pct ?? 0, excess_return_pct: comparison.excess_return_pct ?? 0 }
}

function validate(body: Record<string, unknown>) {
  const runType = String(body.run_type || 'backtest').toLowerCase()
  const strategyKey = String(body.strategy_key || '').toLowerCase()
  const market = String(body.market || 'us').toLowerCase() === 'krx' ? 'krx' : 'us'
  const exchange = ['auto', 'kospi', 'kosdaq'].includes(String(body.krx_exchange || 'auto')) ? String(body.krx_exchange || 'auto') : 'auto'
  const orderType = String(body.order_type || 'all_in')
  const ticker = String(body.ticker || '').trim().toUpperCase()
  const startDate = String(body.start_date || '')
  const endDate = String(body.end_date || '')
  const initialCapital = Number(body.initial_capital || 100000)
  if (!runTypeNames[runType] || !strategyNames[strategyKey] || !ticker) throw new Error('백테스트 저장 요청이 올바르지 않습니다.')
  if (!['all_in', 'fixed_amount'].includes(orderType) || (orderType === 'fixed_amount' && !(Number(body.fixed_amount) > 0))) throw new Error('주문 방식과 고정 금액을 확인해 주세요.')
  if (!startDate || !endDate || startDate >= endDate || !(initialCapital > 0)) throw new Error('기간과 초기 자본을 확인해 주세요.')
  return { runType, strategyKey, market, exchange, orderType, ticker, startDate, endDate, initialCapital }
}

async function list(accountId: string) {
  await ensureAccount(accountId)
  const query = new URLSearchParams({ account_id: `eq.${accountId}`, select: summaryFields, order: 'updated_at.desc', limit: '50' })
  return { items: await db(`saved_backtests?${query.toString()}`) }
}

async function detail(accountId: string, id: number) {
  await ensureAccount(accountId)
  const query = new URLSearchParams({ account_id: `eq.${accountId}`, id: `eq.${id}`, select: detailFields, limit: '1' })
  const rows = await db(`saved_backtests?${query.toString()}`)
  if (!rows[0]) throw new Error('저장한 백테스트 결과를 찾지 못했습니다.')
  return { item: rows[0] }
}

async function create(accountId: string, body: Record<string, unknown>) {
  await ensureAccount(accountId)
  const normalized = validate(body)
  const name = String(body.save_name || '').trim() || `${body.company_name || body.resolved_ticker || normalized.ticker} ${strategyNames[normalized.strategyKey]} ${runTypeNames[normalized.runType]}`
  const now = new Date().toISOString()
  const payload = [{
    account_id: accountId,
    save_name: name,
    run_type: normalized.runType,
    strategy_key: normalized.strategyKey,
    strategy_name: strategyNames[normalized.strategyKey],
    ticker: normalized.ticker,
    resolved_ticker: String(body.resolved_ticker || normalized.ticker).toUpperCase(),
    company_name: body.company_name || null,
    market: normalized.market,
    krx_exchange: normalized.exchange,
    start_date: normalized.startDate,
    end_date: normalized.endDate,
    initial_capital: normalized.initialCapital,
    order_type: normalized.orderType,
    fixed_amount: normalized.orderType === 'fixed_amount' ? Number(body.fixed_amount) : null,
    metric_to_optimize: body.metric_to_optimize || null,
    request_payload: body.request_payload || {},
    result_payload: body.result_payload || {},
    performance_summary: performanceSummary({ ...body, run_type: normalized.runType }),
    created_at: now,
    updated_at: now,
  }]
  const rows = await db('saved_backtests', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload) })
  if (!rows?.[0]) throw new Error('백테스트 결과를 저장하지 못했습니다.')
  return { item: rows[0] }
}

async function remove(accountId: string, id: number) {
  await detail(accountId, id)
  const query = new URLSearchParams({ account_id: `eq.${accountId}`, id: `eq.${id}` })
  await db(`saved_backtests?${query.toString()}`, { method: 'DELETE' })
  return { deleted: true, id }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) return output({ detail: 'Method not allowed' }, 405)
  try {
    const url = new URL(request.url)
    const action = url.searchParams.get('action') || (request.method === 'GET' ? 'list' : 'create')
    const accountId = await accountFromSession(request.headers.get('X-App-Session'))
    const id = Number(url.searchParams.get('id'))
    if (action === 'list' && request.method === 'GET') return output(await list(accountId))
    if (action === 'detail' && request.method === 'GET' && Number.isInteger(id)) return output(await detail(accountId, id))
    if (action === 'create' && request.method === 'POST') return output(await create(accountId, await request.json()))
    if (action === 'delete' && request.method === 'DELETE' && Number.isInteger(id)) return output(await remove(accountId, id))
    return output({ detail: 'Unknown saved backtest action' }, 400)
  } catch (error) {
    return output({ detail: error instanceof Error ? error.message : '백테스트 저장을 완료하지 못했습니다.' }, 400)
  }
})
