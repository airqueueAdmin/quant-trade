const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-session',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Content-Type': 'application/json',
}

const seedCashKrw = 10_000_000

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders })
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}

async function accountIdFromSession(token: string | null) {
  if (!token) throw new Error('앱 세션이 필요합니다.')
  const [encodedPayload, encodedSignature] = token.trim().split('.', 2)
  const secret = Deno.env.get('APP_SESSION_SECRET')?.trim()
  if (!encodedPayload || !encodedSignature || !secret) throw new Error('세션 토큰을 확인할 수 없습니다.')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const payload = base64UrlDecode(encodedPayload)
  const signature = base64UrlDecode(encodedSignature)
  if (!await crypto.subtle.verify('HMAC', key, signature, payload)) throw new Error('세션 토큰 검증에 실패했습니다.')
  const accountId = new TextDecoder().decode(payload)
  if (!/^[A-Za-z0-9_-]+$/.test(accountId)) throw new Error('세션 계정 형식이 올바르지 않습니다.')
  return accountId
}

function supabaseConfig() {
  const url = Deno.env.get('SUPABASE_URL')?.trim()
  const key = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_KEY'))?.trim()
  if (!url || !key) throw new Error('Supabase service role is not configured')
  return { url: url.replace(/\/$/, ''), key }
}

async function supabaseRequest(path: string, init: RequestInit = {}) {
  const config = supabaseConfig()
  const result = await fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  if (!result.ok) throw new Error(`Supabase 요청 실패 (${result.status})`)
  const text = await result.text()
  return text ? JSON.parse(text) : null
}

async function ensureAccount(accountId: string) {
  const query = new URLSearchParams({ account_id: `eq.${accountId}`, select: 'account_id', limit: '1' })
  const rows = await supabaseRequest(`paper_trading_accounts?${query.toString()}`)
  if (rows[0]) return
  await supabaseRequest('paper_trading_accounts?on_conflict=account_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ account_id: accountId, cash_krw: seedCashKrw, seed_cash_krw: seedCashKrw }]),
  })
}

async function listNotifications(accountId: string) {
  await ensureAccount(accountId)
  const query = new URLSearchParams({
    account_id: `eq.${accountId}`,
    select: 'id,account_id,ticker,market,krx_exchange,channel,destination,threshold_score,active,company_name,resolved_ticker,last_score,last_signal_date,last_notified_at,last_evaluated_at,created_at,updated_at',
    order: 'updated_at.desc',
  })
  return { items: await supabaseRequest(`closing_bet_notifications?${query.toString()}`) }
}

async function listAlerts(accountId: string) {
  await ensureAccount(accountId)
  const query = new URLSearchParams({
    account_id: `eq.${accountId}`,
    select: 'id,notification_id,delivered_channel,title,message,ticker,market,signal_date,total_score,is_read,created_at,read_at',
    order: 'created_at.desc',
    limit: '50',
  })
  return { items: await supabaseRequest(`closing_bet_alert_events?${query.toString()}`) }
}

async function evaluate(ticker: string, market: string, exchange: string) {
  const { url } = supabaseConfig()
  const result = await fetch(`${url}/functions/v1/closing-bet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticker, market, krx_exchange: exchange }),
  })
  if (!result.ok) throw new Error('종가베팅 분석을 완료하지 못했습니다.')
  return result.json()
}

async function upsertNotification(accountId: string, body: Record<string, unknown>) {
  const ticker = String(body.ticker || '').trim()
  const market = String(body.market || 'krx') === 'us' ? 'us' : 'krx'
  const exchange = market === 'krx' ? String(body.krx_exchange || 'auto') : 'auto'
  const channel = body.channel === 'email' ? 'email' : 'toss_inapp'
  const destination = String(body.destination || '').trim()
  const threshold = Number(body.threshold_score)
  if (!ticker || !destination) throw new Error('종목과 알림 대상을 입력해 주세요.')
  if (!['auto', 'kospi', 'kosdaq'].includes(exchange)) throw new Error('거래소 값이 올바르지 않습니다.')
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) throw new Error('점수 기준은 0~100 사이여야 합니다.')

  await ensureAccount(accountId)
  const analysis = await evaluate(ticker, market, exchange)
  const now = new Date().toISOString()
  const payload = [{
    account_id: accountId,
    ticker,
    market,
    krx_exchange: exchange,
    channel,
    destination,
    threshold_score: Math.round(threshold),
    active: body.active !== false,
    toss_user_key: typeof body.toss_user_key === 'string' ? body.toss_user_key : null,
    company_name: analysis.company_name || null,
    resolved_ticker: analysis.resolved_ticker || ticker,
    last_score: analysis.total_score ?? null,
    last_signal_date: analysis.signal_date || null,
    last_evaluated_at: now,
    updated_at: now,
  }]
  const result = await supabaseRequest('closing_bet_notifications?on_conflict=account_id,channel,market,ticker,destination', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(payload),
  })
  if (!result?.[0]) throw new Error('알림 구독을 저장하지 못했습니다.')
  return { subscription: result[0], evaluation: analysis }
}

async function deleteNotification(accountId: string, id: number) {
  await ensureAccount(accountId)
  const query = new URLSearchParams({ id: `eq.${id}`, account_id: `eq.${accountId}` })
  await supabaseRequest(`closing_bet_notifications?${query.toString()}`, { method: 'DELETE' })
  return { deleted: true, id }
}

async function markAlertRead(accountId: string, id: number) {
  await ensureAccount(accountId)
  const query = new URLSearchParams({ id: `eq.${id}`, account_id: `eq.${accountId}`, select: 'id,notification_id,delivered_channel,title,message,ticker,market,signal_date,total_score,is_read,created_at,read_at' })
  const rows = await supabaseRequest(`closing_bet_alert_events?${query.toString()}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ is_read: true, read_at: new Date().toISOString() }),
  })
  if (!rows?.[0]) throw new Error('알림을 찾지 못했습니다.')
  return { item: rows[0] }
}

function notificationWindow(market: string) {
  const timeZone = market === 'us' ? 'America/New_York' : 'Asia/Seoul'
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now)
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  const weekday = values.weekday
  const minutes = Number(values.hour) * 60 + Number(values.minute)
  const start = market === 'us' ? 15 * 60 + 50 : 15 * 60 + 20
  const end = market === 'us' ? 16 * 60 : 15 * 60 + 30
  return { allowed: !['Sat', 'Sun'].includes(weekday) && minutes >= start && minutes < end, date: `${values.year || ''}-${values.month || ''}-${values.day || ''}` }
}

function messageFor(evaluation: Record<string, unknown>, threshold: number) {
  const company = evaluation.company_name || evaluation.resolved_ticker || evaluation.ticker
  const subject = `[한눈투자] 종가베팅 알림 - ${company}`
  const flags = Array.isArray(evaluation.risk_flags) && evaluation.risk_flags.length ? evaluation.risk_flags.join(', ') : '없음'
  const message = `${company} 종가베팅 점수 ${evaluation.total_score}점이 기준 ${threshold}점을 넘었습니다.\n- 시장: ${evaluation.market === 'us' ? '미국' : '국내'}\n- 시그널 날짜: ${evaluation.signal_date}\n- 시나리오: ${evaluation.scenario}\n- 해석: ${evaluation.score_label}\n- 행동 가이드: ${evaluation.score_action}\n- 제외 신호: ${flags}`
  return { subject, message }
}

async function sendTossMessage(recipientKey: string, evaluation: Record<string, unknown>) {
  const cert = Deno.env.get('APPS_IN_TOSS_CERT_PATH_PEM')?.trim()
  const key = Deno.env.get('APPS_IN_TOSS_KEY_PATH_PEM')?.trim()
  const template = Deno.env.get('TOSS_SMART_MESSAGE_TEMPLATE_CODE')?.trim()
  if (!cert || !key || !template) throw new Error('토스 Smart Message mTLS 설정이 없습니다.')
  const recipientHeader = /^\d+$/.test(recipientKey) ? { 'x-user-key': recipientKey } : { 'x-anon-key': recipientKey }
  const baseUrl = (Deno.env.get('APPS_IN_TOSS_API_BASE_URL') || 'https://apps-in-toss-api.toss.im').replace(/\/$/, '')
  const client = Deno.createHttpClient({ cert, key })
  try {
    const response = await fetch(`${baseUrl}/api-partner/v1/apps-in-toss/messenger/send-message`, {
      method: 'POST',
      client,
      headers: { 'Content-Type': 'application/json', ...recipientHeader },
      body: JSON.stringify({
        templateSetCode: template,
        context: {
          ticker: String(evaluation.resolved_ticker || evaluation.ticker || ''),
          companyName: String(evaluation.company_name || evaluation.resolved_ticker || evaluation.ticker || ''),
          score: String(evaluation.total_score || ''),
          signalDate: String(evaluation.signal_date || ''),
          market: String(evaluation.market || ''),
          marketName: evaluation.market === 'us' ? '미국' : '국내',
          scenario: String(evaluation.scenario || ''),
          scoreLabel: String(evaluation.score_label || ''),
        },
      }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || payload?.resultType === 'FAIL') throw new Error(`토스 Smart Message 발송 실패 (${response.status})`)
    return payload
  } finally {
    client.close()
  }
}

async function dispatch(accountId: string | null, market: string | null, force: boolean) {
  const query = new URLSearchParams({ active: 'eq.true', select: 'id,account_id,ticker,market,krx_exchange,channel,destination,toss_user_key,threshold_score,last_score,last_signal_date,last_notified_at', order: 'updated_at.desc', limit: '100' })
  if (accountId) query.set('account_id', `eq.${accountId}`)
  if (market === 'krx' || market === 'us') query.set('market', `eq.${market}`)
  const subscriptions = await supabaseRequest(`closing_bet_notifications?${query.toString()}`)
  const checked: unknown[] = []
  const sent: unknown[] = []
  const skipped: unknown[] = []
  const failures: unknown[] = []
  for (const item of subscriptions as Record<string, unknown>[]) {
    if (item.channel !== 'toss_inapp') {
      skipped.push({ id: item.id, reason: 'unsupported_channel' })
      continue
    }
    const window = notificationWindow(String(item.market || 'krx'))
    if (!force && !window.allowed) {
      skipped.push({ id: item.id, reason: 'outside_closing_bet_window' })
      continue
    }
    checked.push(item.id)
    try {
      if (!item.toss_user_key) throw new Error('토스 수신자 키가 없습니다.')
      const evaluation = await evaluate(String(item.ticker), String(item.market || 'krx'), String(item.krx_exchange || 'auto'))
      const score = Number(evaluation.total_score || 0)
      const threshold = Number(item.threshold_score || 0)
      if (score < threshold) {
        skipped.push({ id: item.id, reason: 'below_threshold', score, threshold })
        continue
      }
      if (!force && item.last_notified_at && item.last_signal_date === evaluation.signal_date) {
        skipped.push({ id: item.id, reason: 'already_notified', signal_date: evaluation.signal_date })
        continue
      }
      await sendTossMessage(String(item.toss_user_key), evaluation)
      const message = messageFor(evaluation, threshold)
      await supabaseRequest('closing_bet_alert_events', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify([{ account_id: item.account_id, notification_id: item.id, delivered_channel: 'toss_inapp', title: message.subject, message: `${item.destination ? `${item.destination}\n` : ''}${message.message}`, ticker: evaluation.resolved_ticker || evaluation.ticker, market: evaluation.market, signal_date: evaluation.signal_date, total_score: score }]),
      })
      const updateQuery = new URLSearchParams({ id: `eq.${item.id}`, account_id: `eq.${item.account_id}` })
      await supabaseRequest(`closing_bet_notifications?${updateQuery.toString()}`, { method: 'PATCH', body: JSON.stringify({ last_score: score, last_signal_date: evaluation.signal_date, last_evaluated_at: new Date().toISOString(), last_notified_at: new Date().toISOString(), updated_at: new Date().toISOString() }) })
      sent.push({ id: item.id, ticker: evaluation.resolved_ticker || evaluation.ticker, score })
    } catch (error) {
      failures.push({ id: item.id, reason: error instanceof Error ? error.message : '발송 실패' })
    }
  }
  return { market, force, checked: checked.length, sent, skipped, failures }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) return response({ detail: 'Method not allowed' }, 405)
  try {
    const url = new URL(request.url)
    const action = url.searchParams.get('action') || (request.method === 'GET' ? 'notifications' : 'notifications')
    if (action === 'dispatch') {
      if (request.method !== 'POST') return response({ detail: 'POST method is required for dispatch' }, 405)
      const expected = Deno.env.get('NOTIFICATION_DISPATCH_TOKEN')?.trim() || Deno.env.get('APP_SESSION_SECRET')?.trim()
      const provided = request.headers.get('X-Dispatch-Token')?.trim()
      if (!expected || provided !== expected) return response({ detail: '배치 발송 인증이 필요합니다.' }, 401)
      return response(await dispatch(url.searchParams.get('account_id'), url.searchParams.get('market'), url.searchParams.get('force') === 'true'))
    }
    const accountId = await accountIdFromSession(request.headers.get('X-App-Session'))
    if (request.method === 'GET' && action === 'notifications') return response(await listNotifications(accountId))
    if (request.method === 'GET' && action === 'alerts') return response(await listAlerts(accountId))
    if (request.method === 'DELETE' && action === 'notifications') {
      const id = Number(url.searchParams.get('id'))
      if (!Number.isInteger(id) || id <= 0) return response({ detail: 'notification id가 필요합니다.' }, 400)
      return response(await deleteNotification(accountId, id))
    }
    if (request.method === 'POST' && action === 'notifications') return response(await upsertNotification(accountId, await request.json()))
    if (request.method === 'POST' && action === 'alerts-read') {
      const id = Number(url.searchParams.get('id'))
      if (!Number.isInteger(id) || id <= 0) return response({ detail: 'alert id가 필요합니다.' }, 400)
      return response(await markAlertRead(accountId, id))
    }
    return response({ detail: 'Unknown notification action' }, 400)
  } catch (error) {
    return response({ detail: error instanceof Error ? error.message : '알림 처리를 완료하지 못했습니다.' }, 400)
  }
})
