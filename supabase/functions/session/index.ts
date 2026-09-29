const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-session',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function sign(payload: Uint8Array) {
  const secret = Deno.env.get('APP_SESSION_SECRET')?.trim()
  if (!secret) throw new Error('APP_SESSION_SECRET is not configured')
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
  return { key, signature: new Uint8Array(await crypto.subtle.sign('HMAC', key, payload)) }
}

async function encodeSessionToken(accountId: string) {
  const payload = new TextEncoder().encode(accountId)
  const signed = await sign(payload)
  return `${base64UrlEncode(payload)}.${base64UrlEncode(signed.signature)}`
}

async function decodeSessionToken(token: string) {
  const [encodedPayload, encodedSignature] = token.split('.', 2)
  if (!encodedPayload || !encodedSignature) throw new Error('세션 토큰 형식이 올바르지 않습니다.')
  const payload = base64UrlDecode(encodedPayload)
  const signature = base64UrlDecode(encodedSignature)
  const signed = await sign(payload)
  const valid = await crypto.subtle.verify('HMAC', signed.key, signature, payload)
  if (!valid) throw new Error('세션 토큰 검증에 실패했습니다.')
  const accountId = new TextDecoder().decode(payload)
  if (!/^[A-Za-z0-9_-]+$/.test(accountId)) throw new Error('세션 계정 형식이 올바르지 않습니다.')
  return accountId
}

function randomHex(byteCount: number) {
  const bytes = new Uint8Array(byteCount)
  crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function createSession(accountId: string, identitySource: 'toss_user' | 'device') {
  return {
    auth_mode: 'session_account',
    identity_source: identitySource,
    account_id: accountId,
    session_token: await encodeSessionToken(accountId),
  }
}

function errorResponse(status: number, detail: string) {
  return new Response(JSON.stringify({ detail }), { status, headers: corsHeaders })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return errorResponse(405, 'Method not allowed')

  try {
    const url = new URL(request.url)
    const action = url.searchParams.get('action') || 'bootstrap'
    if (action === 'bootstrap') {
      const currentToken = request.headers.get('X-App-Session')?.trim()
      if (currentToken) {
        const accountId = await decodeSessionToken(currentToken)
        return new Response(JSON.stringify(await createSession(accountId, accountId.startsWith('paper-toss-') ? 'toss_user' : 'device')), { headers: corsHeaders })
      }
      return new Response(JSON.stringify(await createSession(`paper-${randomHex(6)}`, 'device')), { headers: corsHeaders })
    }

    if (action === 'toss-user') {
      const body = await request.json()
      const anonymousKey = String(body?.anonymous_key || '').trim()
      if (!anonymousKey) return errorResponse(400, 'anonymous_key is required')
      const digestInput = new TextEncoder().encode(`toss-user:${anonymousKey}`)
      const signed = await sign(digestInput)
      const digest = [...signed.signature].map((byte) => byte.toString(16).padStart(2, '0')).join('')
      return new Response(JSON.stringify(await createSession(`paper-toss-${digest.slice(0, 32)}`, 'toss_user')), { headers: corsHeaders })
    }

    if (action === 'rotate') {
      return new Response(JSON.stringify(await createSession(`paper-${randomHex(6)}`, 'device')), { headers: corsHeaders })
    }

    return errorResponse(400, 'Unknown session action')
  } catch (error) {
    return errorResponse(401, error instanceof Error ? error.message : '세션 처리에 실패했습니다.')
  }
})
