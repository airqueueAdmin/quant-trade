const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-session',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

function output(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders })
}

function apiBaseUrl() {
  return (Deno.env.get('APPS_IN_TOSS_API_BASE_URL') || 'https://apps-in-toss-api.toss.im').replace(/\/$/, '')
}

function parseError(payload: Record<string, unknown> | null, fallback: string) {
  const error = payload?.error as Record<string, unknown> | undefined
  return `${error?.errorCode || 'UNKNOWN'} / ${error?.reason || payload?.message || fallback}`
}

async function tossRequest(url: string, init: RequestInit) {
  const cert = Deno.env.get('APPS_IN_TOSS_CERT_PATH_PEM')?.trim()
  const key = Deno.env.get('APPS_IN_TOSS_KEY_PATH_PEM')?.trim()
  if (!cert || !key) throw new Error('Apps in Toss mTLS 인증서 설정이 없습니다.')
  const client = Deno.createHttpClient({ cert, key })
  try {
    return await fetch(url, { ...init, client })
  } finally {
    client.close()
  }
}

function accessToken(payload: Record<string, unknown>) {
  const candidates: Record<string, unknown>[] = [payload]
  if (payload.success && typeof payload.success === 'object') {
    candidates.push(payload.success as Record<string, unknown>)
    const data = (payload.success as Record<string, unknown>).data
    if (data && typeof data === 'object') candidates.push(data as Record<string, unknown>)
  }
  if (payload.data && typeof payload.data === 'object') candidates.push(payload.data as Record<string, unknown>)
  for (const candidate of candidates) {
    const value = candidate.access_token || candidate.accessToken
    if (value) return String(value)
  }
  return ''
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return output({ detail: 'Method not allowed' }, 405)

  try {
    const body = await request.json() as Record<string, unknown>
    const authorizationCode = String(body.authorization_code || '').trim()
    const referrer = body.referrer === 'SANDBOX' ? 'SANDBOX' : 'DEFAULT'
    if (!authorizationCode) return output({ detail: 'authorization_code가 필요합니다.' }, 400)

    const tokenResponse = await tossRequest(`${apiBaseUrl()}/api-partner/v1/apps-in-toss/user/oauth2/generate-token`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ authorizationCode, referrer }),
    })
    const tokenPayload = await tokenResponse.json().catch(() => null) as Record<string, unknown> | null
    if (!tokenResponse.ok || tokenPayload?.resultType === 'FAIL') {
      return output({ detail: `토스 로그인 토큰 교환에 실패했습니다: ${parseError(tokenPayload, '요청에 실패했습니다.')}` }, 503)
    }
    const bearer = tokenPayload ? accessToken(tokenPayload) : ''
    if (!bearer) return output({ detail: '토스 로그인 토큰 응답에 access token이 없습니다.' }, 503)

    const userResponse = await tossRequest(`${apiBaseUrl()}/api-partner/v1/apps-in-toss/user/oauth2/login-me`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${bearer}` },
    })
    const userPayload = await userResponse.json().catch(() => null) as Record<string, unknown> | null
    if (!userResponse.ok || userPayload?.resultType === 'FAIL') {
      return output({ detail: `토스 로그인 사용자 조회에 실패했습니다: ${parseError(userPayload, '요청에 실패했습니다.')}` }, 503)
    }
    const success = (userPayload?.success || {}) as Record<string, unknown>
    const userKey = success.userKey
    if (userKey === undefined || userKey === null || userKey === '') return output({ detail: '토스 로그인 사용자 조회 응답에 userKey가 없습니다.' }, 503)
    const scope = String(success.scope || '')
    return output({ user_key: String(userKey), scope, scope_list: scope.split(',').map((item) => item.trim()).filter(Boolean), referrer })
  } catch (error) {
    return output({ detail: error instanceof Error ? error.message : '토스 로그인을 완료하지 못했습니다.' }, 503)
  }
})
