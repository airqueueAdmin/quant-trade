const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
}

type Point = { date: string; close: number }
type Component = { ticker: string; name: string; krx_exchange?: string }
type SectorDefinition = {
  key: string
  name: string
  note: string
  proxy?: string
  components: Component[]
}

const US_SECTORS: SectorDefinition[] = [
  { key: 'technology', name: '기술', proxy: 'XLK', components: [{ ticker: 'XLK', name: 'Technology Select Sector SPDR Fund' }], note: '미국 대형 기술주 ETF' },
  { key: 'semiconductors', name: '반도체', proxy: 'SOXX', components: [{ ticker: 'SOXX', name: 'iShares Semiconductor ETF' }], note: '미국 반도체 ETF' },
  { key: 'communication', name: '커뮤니케이션', proxy: 'XLC', components: [{ ticker: 'XLC', name: 'Communication Services Select Sector SPDR Fund' }], note: '미국 커뮤니케이션 ETF' },
  { key: 'consumer_discretionary', name: '소비재', proxy: 'XLY', components: [{ ticker: 'XLY', name: 'Consumer Discretionary Select Sector SPDR Fund' }], note: '미국 경기민감 소비 ETF' },
  { key: 'financials', name: '금융', proxy: 'XLF', components: [{ ticker: 'XLF', name: 'Financial Select Sector SPDR Fund' }], note: '미국 금융 ETF' },
  { key: 'industrials', name: '산업재', proxy: 'XLI', components: [{ ticker: 'XLI', name: 'Industrial Select Sector SPDR Fund' }], note: '미국 산업재 ETF' },
  { key: 'healthcare', name: '헬스케어', proxy: 'XLV', components: [{ ticker: 'XLV', name: 'Health Care Select Sector SPDR Fund' }], note: '미국 헬스케어 ETF' },
  { key: 'energy', name: '에너지', proxy: 'XLE', components: [{ ticker: 'XLE', name: 'Energy Select Sector SPDR Fund' }], note: '미국 에너지 ETF' },
  { key: 'utilities', name: '유틸리티', proxy: 'XLU', components: [{ ticker: 'XLU', name: 'Utilities Select Sector SPDR Fund' }], note: '미국 유틸리티 ETF' },
  { key: 'real_estate', name: '리츠/부동산', proxy: 'XLRE', components: [{ ticker: 'XLRE', name: 'Real Estate Select Sector SPDR Fund' }], note: '미국 부동산 ETF' },
  { key: 'materials', name: '소재', proxy: 'XLB', components: [{ ticker: 'XLB', name: 'Materials Select Sector SPDR Fund' }], note: '미국 소재 ETF' },
]

const KRX_SECTORS: SectorDefinition[] = [
  { key: 'semiconductors', name: '반도체', note: '국내 대표 반도체 3종목 평균', components: [{ ticker: '005930', name: '삼성전자', krx_exchange: 'kospi' }, { ticker: '000660', name: 'SK하이닉스', krx_exchange: 'kospi' }, { ticker: '042700', name: '한미반도체', krx_exchange: 'kospi' }] },
  { key: 'secondary_battery', name: '2차전지', note: '국내 대표 2차전지 3종목 평균', components: [{ ticker: '373220', name: 'LG에너지솔루션', krx_exchange: 'kospi' }, { ticker: '006400', name: '삼성SDI', krx_exchange: 'kospi' }, { ticker: '003670', name: '포스코퓨처엠', krx_exchange: 'kospi' }] },
  { key: 'autos', name: '자동차', note: '국내 대표 자동차 3종목 평균', components: [{ ticker: '005380', name: '현대차', krx_exchange: 'kospi' }, { ticker: '000270', name: '기아', krx_exchange: 'kospi' }, { ticker: '012330', name: '현대모비스', krx_exchange: 'kospi' }] },
  { key: 'bio', name: '바이오', note: '국내 대표 바이오 3종목 평균', components: [{ ticker: '207940', name: '삼성바이오로직스', krx_exchange: 'kospi' }, { ticker: '068270', name: '셀트리온', krx_exchange: 'kospi' }, { ticker: '196170', name: '알테오젠', krx_exchange: 'kosdaq' }] },
  { key: 'internet_platform', name: '인터넷/플랫폼', note: '국내 플랫폼/콘텐츠 대표주 평균', components: [{ ticker: '035420', name: 'NAVER', krx_exchange: 'kospi' }, { ticker: '035720', name: '카카오', krx_exchange: 'kospi' }, { ticker: '251270', name: '넷마블', krx_exchange: 'kospi' }] },
  { key: 'defense', name: '방산', note: '국내 대표 방산 3종목 평균', components: [{ ticker: '012450', name: '한화에어로스페이스', krx_exchange: 'kospi' }, { ticker: '047810', name: '한국항공우주', krx_exchange: 'kospi' }, { ticker: '079550', name: 'LIG넥스원', krx_exchange: 'kospi' }] },
  { key: 'financials', name: '금융', note: '국내 대표 금융지주 3종목 평균', components: [{ ticker: '105560', name: 'KB금융', krx_exchange: 'kospi' }, { ticker: '055550', name: '신한지주', krx_exchange: 'kospi' }, { ticker: '086790', name: '하나금융지주', krx_exchange: 'kospi' }] },
]

function errorResponse(status: number, detail: string) {
  return new Response(JSON.stringify({ detail }), { status, headers: corsHeaders })
}

function symbolFor(component: Component, market: 'krx' | 'us') {
  if (market === 'us') return component.ticker
  return `${component.ticker}.${component.krx_exchange === 'kosdaq' ? 'KQ' : 'KS'}`
}

async function fetchSeries(symbol: string): Promise<Point[]> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`)
  url.searchParams.set('range', '1y')
  url.searchParams.set('interval', '1d')
  url.searchParams.set('includePrePost', 'false')
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 QuantInvestor/1.0' } })
  if (!response.ok) return []
  const result = (await response.json())?.chart?.result?.[0]
  if (!result) return []
  const timestamps = result.timestamp ?? []
  const closes = result.indicators?.quote?.[0]?.close ?? []
  const points: Point[] = []
  for (let index = 0; index < timestamps.length; index += 1) {
    if (typeof timestamps[index] !== 'number' || typeof closes[index] !== 'number') continue
    points.push({ date: new Date(timestamps[index] * 1000).toISOString().slice(0, 10), close: closes[index] })
  }
  return points
}

function returnPct(values: number[], lookback: number) {
  if (values.length <= lookback) return null
  const start = values[values.length - 1 - lookback]
  return start ? ((values[values.length - 1] / start) - 1) * 100 : null
}

function averageSeries(seriesList: Point[][]) {
  const maps = seriesList.map((series) => new Map(series.map((point) => [point.date, point.close])))
  const dates = [...new Set(seriesList.flat().map((point) => point.date))].sort()
  const result: Point[] = []
  for (const date of dates) {
    const values = maps.map((map) => map.get(date)).filter((value): value is number => typeof value === 'number')
    if (values.length > 0) result.push({ date, close: values.reduce((sum, value) => sum + value, 0) / values.length })
  }
  return result
}

function buildRow(definition: SectorDefinition, series: Point[], market: 'krx' | 'us') {
  if (series.length < 22) return null
  const values = series.map((point) => point.close)
  const latest = values[values.length - 1]
  const ma20 = values.slice(-20).reduce((sum, value) => sum + value, 0) / 20
  const ma60 = values.length >= 60 ? values.slice(-60).reduce((sum, value) => sum + value, 0) / 60 : null
  const metrics = {
    return_1d_pct: returnPct(values, 1),
    return_5d_pct: returnPct(values, 5),
    return_21d_pct: returnPct(values, 21),
    return_63d_pct: returnPct(values, 63),
  }
  const trendScore = (metrics.return_1d_pct || 0) * 0.1 + (metrics.return_5d_pct || 0) * 0.2 + (metrics.return_21d_pct || 0) * 0.3 + (metrics.return_63d_pct || 0) * 0.4
  const above20 = latest >= ma20
  const above60 = ma60 !== null && latest >= ma60
  const month = metrics.return_21d_pct || 0
  const quarter = metrics.return_63d_pct || 0
  const trendLabel = above20 && above60 && trendScore >= 8 && month >= 4
    ? '강한 상승 추세'
    : above20 && trendScore >= 2 && month >= 0
      ? '상승 우위'
      : month >= 0 || quarter >= 0
        ? '반등/혼조'
        : !above20 && !above60 && trendScore <= -5 ? '약세 지속' : '조정 구간'

  return {
    key: definition.key,
    name: definition.name,
    note: definition.note,
    proxy_type: market === 'us' ? 'etf' : 'basket',
    proxy_label: market === 'us' ? definition.proxy : '대표 종목 바스켓',
    components: definition.components,
    component_count: definition.components.length,
    as_of: series[series.length - 1].date,
    latest_level: latest,
    ma20_gap_pct: ma20 ? ((latest / ma20) - 1) * 100 : null,
    ma60_gap_pct: ma60 ? ((latest / ma60) - 1) * 100 : null,
    above_20dma: above20,
    above_60dma: above60,
    trend_score: trendScore,
    trend_label: trendLabel,
    ...metrics,
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'GET') return errorResponse(405, 'Method not allowed')

  const market = new URL(request.url).searchParams.get('market') === 'krx' ? 'krx' : 'us'
  const definitions = market === 'us' ? US_SECTORS : KRX_SECTORS
  const rows = (await Promise.all(definitions.map(async (definition) => {
    const seriesList = await Promise.all(definition.components.map((component) => fetchSeries(symbolFor(component, market))))
    return buildRow(definition, market === 'us' ? seriesList[0] : averageSeries(seriesList), market)
  }))).filter((row): row is NonNullable<typeof row> => row !== null)

  if (rows.length === 0) return errorResponse(503, '섹터 데이터를 가져오지 못했습니다.')
  rows.sort((left, right) => right.trend_score - left.trend_score)
  const leaders = rows.slice(0, 3)
  const laggards = [...rows].slice(-3).reverse()
  const marketName = market === 'krx' ? '국내' : '미국'
  const positiveMonth = rows.filter((row) => (row.return_21d_pct || 0) > 0).length
  const above20 = rows.filter((row) => row.above_20dma).length

  return new Response(JSON.stringify({
    market,
    market_name: marketName,
    as_of: rows.map((row) => row.as_of).sort().at(-1),
    snapshot_status: 'daily_snapshot',
    intraday_estimate: false,
    summary: `${marketName} 시장에서 최근 1개월 기준 상대적으로 강한 섹터는 ${leaders.map((row) => row.name).join(', ')}입니다. 약한 흐름은 ${laggards.map((row) => row.name).join(', ')} 쪽입니다. 전체 ${rows.length}개 섹터 중 ${positiveMonth}개가 최근 1개월 상승했고, ${above20}개가 20일 이동평균선 위에 있습니다.`,
    leaders,
    laggards,
    sectors: rows,
  }), { headers: corsHeaders })
})
