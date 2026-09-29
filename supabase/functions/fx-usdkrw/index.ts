const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
}

function errorResponse(status: number, detail: string) {
  return new Response(JSON.stringify({ detail }), { status, headers: corsHeaders })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'GET') return errorResponse(405, 'Method not allowed')

  try {
    const url = new URL('https://query1.finance.yahoo.com/v8/finance/chart/KRW=X')
    url.searchParams.set('range', '5d')
    url.searchParams.set('interval', '1d')
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 QuantInvestor/1.0' } })
    if (!response.ok) return errorResponse(503, '환율 데이터를 가져오지 못했습니다.')
    const result = (await response.json())?.chart?.result?.[0]
    const timestamps = result?.timestamp ?? []
    const closes = result?.indicators?.quote?.[0]?.close ?? []
    const points: Array<{ timestamp: number; close: number }> = []
    for (let index = 0; index < closes.length; index += 1) {
      if (typeof timestamps[index] === 'number' && typeof closes[index] === 'number' && Number.isFinite(closes[index])) {
        points.push({ timestamp: timestamps[index], close: closes[index] })
      }
    }
    const latest = points.at(-1)
    if (!latest) return errorResponse(503, '환율 데이터를 가져오지 못했습니다.')
    return new Response(JSON.stringify({
      rate: latest.close,
      as_of: new Date(latest.timestamp * 1000).toISOString(),
      source: 'yahoo_finance:KRW=X',
    }), { headers: corsHeaders })
  } catch {
    return errorResponse(503, '환율 데이터를 가져오지 못했습니다.')
  }
})
