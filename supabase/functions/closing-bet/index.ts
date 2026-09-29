const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

const scenarios = [
  '섹터가 하루 종일 강했고 종가까지 눌림이 적음',
  '장중 눌림 뒤 거래대금이 다시 붙으며 종가 회복',
  '뉴스 한 번으로 급등했지만 종가까지 매도 물량이 계속 나옴',
  '고가 돌파는 했지만 종가가 중간 이하에서 끝남',
]
const scenarioModifiers = [4, 2, -4, -6]

function errorResponse(status: number, detail: string) {
  return new Response(JSON.stringify({ detail }), { status, headers: corsHeaders })
}

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, Math.round(value)))
}

function number(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || fallback
}

function internalUrl(name: string, params: Record<string, string>) {
  const base = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '')
  const url = new URL(`${base}/functions/v1/${name}`)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
  return url
}

async function fetchJson(name: string, params: Record<string, string>) {
  const response = await fetch(internalUrl(name, params))
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.detail || `${name} 데이터를 가져오지 못했습니다.`)
  }
  return response.json()
}

function closeStrength(rows: Record<string, unknown>[]) {
  if (rows.length < 2) return 55
  const latest = rows.at(-1)!
  const previous = rows.at(-2)!
  const close = number(latest.Close)
  const open = number(latest.Open, close)
  const high = number(latest.High, close)
  const low = number(latest.Low, close)
  const previousClose = number(previous.Close, close)
  const range = Math.max(high - low, 0.000001)
  const closePosition = (close - low) / range * 100
  const bodyStrength = (close / Math.max(open, 0.000001) - 1) * 100
  const changePct = (close / Math.max(previousClose, 0.000001) - 1) * 100
  return clamp(20 + closePosition * 0.55 + bodyStrength * 4 + changePct * 3)
}

function volumePersistence(match: Record<string, unknown> | null, quote: Record<string, unknown> | null, rows: Record<string, unknown>[]) {
  if (!match && !quote && !rows.length) return 52
  let volumeScore = 0
  if (rows.length >= 21) {
    const latestVolume = number(rows.at(-1)?.Volume)
    const average = rows.slice(-21, -1).reduce((sum, row) => sum + number(row.Volume), 0) / 20
    if (average > 0) volumeScore = Math.min(30, latestVolume / average * 12)
  }
  return clamp(50 + number(quote?.change_pct) * 2.5 + number(match?.trend_score) * 1.8 + number(match?.return_1d_pct) * 2 + volumeScore)
}

function riskControl(quote: Record<string, unknown> | null, match: Record<string, unknown> | null, sentiment: Record<string, unknown> | null, rows: Record<string, unknown>[]) {
  if (!quote && !match && !sentiment && !rows.length) return 50
  let closeLocationBonus = 0
  let pullbackPenalty = 0
  if (rows.length >= 20) {
    const recent = rows.slice(-20)
    const latestClose = number(recent.at(-1)?.Close)
    const twentyDayHigh = Math.max(...recent.map((row) => number(row.High, latestClose)))
    if (twentyDayHigh > 0) closeLocationBonus = latestClose / twentyDayHigh * 18
    const latest = recent.at(-1)!
    const latestHigh = number(latest.High, latestClose)
    const latestLow = number(latest.Low, latestClose)
    const latestOpen = number(latest.Open, latestClose)
    pullbackPenalty += Math.min(12, (latestHigh - latestLow) / Math.max(latestClose, 0.000001) * 150)
    if (latestClose < latestOpen) pullbackPenalty += 8
  }
  return clamp(48 + number(quote?.change_pct) * 1.5 + number(match?.trend_score) * 1.1 + (number(sentiment?.sentiment_score, 50) - 50) * 0.3 + closeLocationBonus - pullbackPenalty)
}

function marketScenario(rows: Record<string, unknown>[], sentiment: Record<string, unknown> | null) {
  if (rows.length < 2) return 1
  const latest = rows.at(-1)!
  const previous = rows.at(-2)!
  const open = number(latest.Open)
  const high = number(latest.High)
  const low = number(latest.Low)
  const close = number(latest.Close)
  const previousClose = number(previous.Close, close)
  const volume = number(latest.Volume)
  const range = Math.max(high - low, 0.000001)
  const closePosition = (close - low) / range
  const bodyReturn = (close / Math.max(open, 0.000001) - 1) * 100
  const dayReturn = (close / Math.max(previousClose, 0.000001) - 1) * 100
  const previousVolumes = rows.length >= 21 ? rows.slice(-21, -1).map((row) => number(row.Volume)) : []
  const averageVolume = previousVolumes.reduce((sum, value) => sum + value, 0) / Math.max(previousVolumes.length, 1)
  const volumeRatio = averageVolume > 0 ? volume / averageVolume : 1
  const sentimentScore = number(sentiment?.sentiment_score, 50)
  if (closePosition >= 0.8 && bodyReturn >= 0 && dayReturn >= 1) return 0
  if (closePosition >= 0.58 && bodyReturn >= -0.5 && volumeRatio >= 1.1) return 1
  if (dayReturn >= 2 && closePosition < 0.45 && sentimentScore >= 55) return 2
  return 3
}

function riskFlags(rows: Record<string, unknown>[], match: Record<string, unknown> | null, sentiment: Record<string, unknown> | null, scenario: number, scores: Record<string, number>) {
  const flags: string[] = []
  if (scenario === 2) flags.push('뉴스 영향으로 급등했지만 종가까지 매도 물량이 남아 있을 가능성이 있습니다.')
  if (scenario === 3) flags.push('고가 대비 종가 위치가 낮아 장 마감까지 힘이 유지됐다고 보기 어렵습니다.')
  if (rows.length >= 2) {
    const latest = rows.at(-1)!
    const open = number(latest.Open)
    const high = number(latest.High)
    const low = number(latest.Low)
    const close = number(latest.Close)
    const range = Math.max(high - low, 0.000001)
    const closePosition = (close - low) / range
    const upperWick = (high - Math.max(open, close)) / range
    if (closePosition < 0.45 || upperWick > 0.45) flags.push('윗꼬리 또는 종가 밀림이 커서 종가베팅 관점에서는 방어력이 약해 보입니다.')
    if (rows.length >= 21) {
      const averageVolume = rows.slice(-21, -1).reduce((sum, row) => sum + number(row.Volume), 0) / 20
      if (averageVolume > 0 && number(latest.Volume) / averageVolume < 0.9 && scores.volume_persistence < 60) flags.push('거래량이 평소보다 크게 늘지 않아 수급 지속성 신호가 약합니다.')
    }
  }
  if (match && scores.leader_status < 55) flags.push(`${match.name || '해당'} 섹터 안에서는 대장주보다 후발주에 가까워 보입니다.`)
  if (sentiment) {
    if (number(sentiment.sentiment_score, 50) < 45) flags.push('뉴스와 시장 심리가 약해서 내일 재료가 다시 이어질 가능성이 높지 않습니다.')
    if (!sentiment.news_api_enabled) flags.push('최신 뉴스 수집 범위가 좁아 재료 지속성 판단 신뢰도가 낮을 수 있습니다.')
  } else flags.push('뉴스 재료 확인이 충분하지 않아 내일 연결성 판단이 제한적입니다.')
  if (scores.risk_control < 50) flags.push('손절 기준을 잡기 쉬운 구조로 보기 어려워 대응 난도가 높을 수 있습니다.')
  return [...new Set(flags)].slice(0, 5)
}

function scoreLabel(score: number) {
  if (score >= 76) return '내일 이어질 가능성이 상대적으로 높음'
  if (score >= 60) return '관심 후보지만 장 막판 구조를 더 확인해야 함'
  if (score >= 45) return '애매함, 억지 진입보다 관찰 우선'
  return '종가베팅보다 제외가 유리한 구간'
}

function scoreAction(score: number) {
  if (score >= 76) return '후보군 상단. 내일 갭상승보다 시가 이후 지지 여부까지 같이 준비합니다.'
  if (score >= 60) return '관심 유지 구간입니다. 주요 지표는 나쁘지 않지만 확신 구간은 아닙니다.'
  if (score >= 45) return '복기 후보 정도로 보는 편이 낫습니다. 억지 진입보다 관찰이 우선입니다.'
  return '오늘 살아남은 수급으로 보기 어렵습니다. 다른 후보를 우선 검토하는 편이 맞습니다.'
}

async function evaluate(body: Record<string, unknown>) {
  const ticker = String(body.ticker || '').trim()
  const market = String(body.market || 'krx').toLowerCase() === 'krx' ? 'krx' : 'us'
  const exchange = ['auto', 'kospi', 'kosdaq'].includes(String(body.krx_exchange || 'auto')) ? String(body.krx_exchange || 'auto') : 'auto'
  if (!ticker) throw new Error('ticker가 필요합니다.')
  const endDate = new Date()
  const startDate = new Date(endDate.getTime() - 100 * 24 * 60 * 60 * 1000)
  const date = (value: Date) => value.toISOString().slice(0, 10)
  const params = { ticker, market, krx_exchange: exchange }
  const [stock, quote, sentiment, sector] = await Promise.all([
    fetchJson('stock', { ...params, start_date: date(startDate), end_date: date(endDate) }),
    fetchJson('quote', params),
    fetchJson('sentiment', { ...params, period_days: '7', source_filter: 'all', today_only: 'false' }),
    fetchJson('sector', { market }),
  ])
  const rows = (stock.rows || []) as Record<string, unknown>[]
  const resolvedTicker = String(quote.resolved_ticker || ticker)
  const sectors = (sector.sectors || []) as Record<string, unknown>[]
  const normalizedResolved = resolvedTicker.toUpperCase()
  let resolvedSector: Record<string, unknown> | null = null
  for (const item of sectors) {
    const components = (item.components || []) as Record<string, unknown>[]
    if (components.some((component) => String(component.ticker || '').toUpperCase() === normalizedResolved || String(component.ticker || '').toUpperCase() === ticker.toUpperCase())) {
      resolvedSector = item
      break
    }
  }
  const leaders = (sector.leaders || []) as Record<string, unknown>[]
  const laggards = (sector.laggards || []) as Record<string, unknown>[]
  const sectorIndex = resolvedSector ? sectors.findIndex((item) => item.key === resolvedSector?.key) : -1
  const leaderBoost = resolvedSector && leaders.some((item) => item.key === resolvedSector?.key) ? 14 : 0
  const laggardPenalty = resolvedSector && laggards.some((item) => item.key === resolvedSector?.key) ? 18 : 0
  const rankingBoost = sectorIndex >= 0 ? Math.max(0, 18 - sectorIndex * 2) : 0
  const sectorStrength = resolvedSector
    ? clamp(52 + number(resolvedSector.return_1d_pct) * 3 + number(resolvedSector.return_5d_pct) * 1.2 + number(resolvedSector.trend_score) * 1.5 + leaderBoost + rankingBoost - laggardPenalty)
    : 50
  const components = (resolvedSector?.components || []) as Record<string, unknown>[]
  const componentIndex = components.findIndex((item) => String(item.ticker || '').toUpperCase() === normalizedResolved || String(item.ticker || '').toUpperCase() === ticker.toUpperCase())
  const componentBoost = componentIndex === 0 ? 18 : componentIndex > 0 ? Math.max(4, 12 - componentIndex * 2) : 0
  const sectorLeaderBoost = resolvedSector && leaders.some((item) => item.key === resolvedSector?.key) ? 12 : 0
  const leaderStatus = resolvedSector ? clamp(48 + componentBoost + sectorLeaderBoost + number(resolvedSector.trend_score) * 1.2) : 45
  const scores = {
    sector_strength: sectorStrength,
    close_strength: rows.length ? closeStrength(rows) : clamp(55 + number(quote.change_pct) * 4),
    volume_persistence: volumePersistence(resolvedSector, quote, rows),
    leader_status: leaderStatus,
    news_follow_through: sentiment ? clamp(number(sentiment.sentiment_score, 50)) : 50,
    tomorrow_catalyst: sentiment ? clamp(number(sentiment.sentiment_score, 50) * 0.65 + Math.min(12, (sentiment.articles || []).length * 3) + (sentiment.news_api_enabled ? 6 : 0)) : 48,
    risk_control: riskControl(quote, resolvedSector, sentiment, rows),
  }
  const scenarioIndex = marketScenario(rows, sentiment)
  const totalScore = clamp(scores.sector_strength * 0.2 + scores.close_strength * 0.24 + scores.volume_persistence * 0.2 + scores.leader_status * 0.16 + scores.news_follow_through * 0.1 + scores.tomorrow_catalyst * 0.05 + scores.risk_control * 0.05 + scenarioModifiers[scenarioIndex])
  const signalDate = String(rows.at(-1)?.Date || quote.as_of || '').split('T')[0]
  return {
    ticker,
    resolved_ticker: resolvedTicker,
    market,
    krx_exchange: exchange,
    company_name: quote.company_name || sentiment.company_name,
    signal_date: signalDate,
    quote,
    sentiment,
    sector_snapshot: sector,
    resolved_sector: resolvedSector,
    scores,
    scenario: scenarios[scenarioIndex],
    scenario_modifier: scenarioModifiers[scenarioIndex],
    total_score: totalScore,
    score_label: scoreLabel(totalScore),
    score_action: scoreAction(totalScore),
    risk_flags: riskFlags(rows, resolvedSector, sentiment, scenarioIndex, scores),
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return errorResponse(405, 'Method not allowed')
  try {
    return new Response(JSON.stringify(await evaluate(await request.json())), { headers: corsHeaders })
  } catch (error) {
    return errorResponse(400, error instanceof Error ? error.message : '자동 판정에 실패했습니다.')
  }
})
