import { useEffect, useMemo, useState } from 'react'
import { appLogin, env, getAnonymousKey, requestNotificationAgreement } from '@apps-in-toss/web-bridge'

import { apiClient } from '../../shared/api/client'
import { ApiError } from '../../shared/api/http'
import type {
  ClosingBetAlertEvent,
  ClosingBetNotification,
  ClosingBetNotificationChannel,
  KrxExchange,
  KRXSearchResult,
  Market,
  QuoteSnapshot,
  SectorRow,
  SectorSnapshot,
  StockHistoryRow,
  SentimentResult,
} from '../../shared/api/types'
import { clearStoredSession, readStoredSession, writeStoredSession, type AppSession } from '../../shared/session/appSession'

type MarketOption = Extract<Market, 'krx' | 'us'>

const MARKET_OPTIONS: Array<{ value: MarketOption; label: string }> = [
  { value: 'krx', label: '국내주식' },
  { value: 'us', label: '미국주식' },
] as const

const KRX_EXCHANGE_OPTIONS: Array<{ value: KrxExchange; label: string }> = [
  { value: 'auto', label: '자동 판별' },
  { value: 'kospi', label: 'KOSPI' },
  { value: 'kosdaq', label: 'KOSDAQ' },
] as const

const DEFAULT_TOSS_TEMPLATE_CODE = 'glance-invest-reminder'

const COMMON_KRX_COMPANIES: KRXSearchResult[] = [
  { name: '삼성전자', ticker: '005930', krx_exchange: 'kospi', display_name: '삼성전자 (005930, KOSPI)' },
  { name: 'SK하이닉스', ticker: '000660', krx_exchange: 'kospi', display_name: 'SK하이닉스 (000660, KOSPI)' },
  { name: 'LG에너지솔루션', ticker: '373220', krx_exchange: 'kospi', display_name: 'LG에너지솔루션 (373220, KOSPI)' },
  { name: '삼성바이오로직스', ticker: '207940', krx_exchange: 'kospi', display_name: '삼성바이오로직스 (207940, KOSPI)' },
  { name: '현대차', ticker: '005380', krx_exchange: 'kospi', display_name: '현대차 (005380, KOSPI)' },
  { name: '기아', ticker: '000270', krx_exchange: 'kospi', display_name: '기아 (000270, KOSPI)' },
  { name: 'NAVER', ticker: '035420', krx_exchange: 'kospi', display_name: 'NAVER (035420, KOSPI)' },
  { name: '카카오', ticker: '035720', krx_exchange: 'kospi', display_name: '카카오 (035720, KOSPI)' },
  { name: 'KB금융', ticker: '105560', krx_exchange: 'kospi', display_name: 'KB금융 (105560, KOSPI)' },
  { name: '신한지주', ticker: '055550', krx_exchange: 'kospi', display_name: '신한지주 (055550, KOSPI)' },
  { name: '하나금융지주', ticker: '086790', krx_exchange: 'kospi', display_name: '하나금융지주 (086790, KOSPI)' },
  { name: '메리츠금융지주', ticker: '138040', krx_exchange: 'kospi', display_name: '메리츠금융지주 (138040, KOSPI)' },
  { name: 'POSCO홀딩스', ticker: '005490', krx_exchange: 'kospi', display_name: 'POSCO홀딩스 (005490, KOSPI)' },
  { name: '삼성SDI', ticker: '006400', krx_exchange: 'kospi', display_name: '삼성SDI (006400, KOSPI)' },
  { name: 'LG화학', ticker: '051910', krx_exchange: 'kospi', display_name: 'LG화학 (051910, KOSPI)' },
  { name: '한화에어로스페이스', ticker: '012450', krx_exchange: 'kospi', display_name: '한화에어로스페이스 (012450, KOSPI)' },
  { name: '두산에너빌리티', ticker: '034020', krx_exchange: 'kospi', display_name: '두산에너빌리티 (034020, KOSPI)' },
  { name: '알테오젠', ticker: '196170', krx_exchange: 'kosdaq', display_name: '알테오젠 (196170, KOSDAQ)' },
  { name: '에코프로비엠', ticker: '247540', krx_exchange: 'kosdaq', display_name: '에코프로비엠 (247540, KOSDAQ)' },
  { name: '에코프로', ticker: '086520', krx_exchange: 'kosdaq', display_name: '에코프로 (086520, KOSDAQ)' },
  { name: 'HLB', ticker: '028300', krx_exchange: 'kosdaq', display_name: 'HLB (028300, KOSDAQ)' },
  { name: '레인보우로보틱스', ticker: '277810', krx_exchange: 'kosdaq', display_name: '레인보우로보틱스 (277810, KOSDAQ)' },
]

const QUICK_SCENARIOS = [
  '섹터가 하루 종일 강했고 종가까지 눌림이 적음',
  '장중 눌림 뒤 거래대금이 다시 붙으며 종가 회복',
  '뉴스 한 번으로 급등했지만 종가까지 매도 물량이 계속 나옴',
  '고가 돌파는 했지만 종가가 중간 이하에서 끝남',
] as const

const SCENARIO_MODIFIERS: Record<(typeof QUICK_SCENARIOS)[number], number> = {
  [QUICK_SCENARIOS[0]]: 4,
  [QUICK_SCENARIOS[1]]: 2,
  [QUICK_SCENARIOS[2]]: -4,
  [QUICK_SCENARIOS[3]]: -6,
}

const INITIAL_SCORES = {
  sectorStrength: 0,
  closeStrength: 0,
  volumePersistence: 0,
  leaderStatus: 0,
  newsFollowThrough: 0,
  tomorrowCatalyst: 0,
  riskControl: 0,
} as const

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function clampMetric(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, Math.round(value)))
}

function formatPct(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return '-'
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function formatDate(value?: string) {
  if (!value) {
    return '-'
  }
  return value.split('T', 1)[0]
}

function channelLabel(channel: ClosingBetNotificationChannel) {
  return channel === 'email' ? '이메일' : '토스 앱 알림'
}

function defaultTicker(market: MarketOption) {
  return market === 'krx' ? '005930' : 'NVDA'
}

function normalizeTicker(value: string, market: MarketOption) {
  return market === 'krx' ? value.trim() : value.trim().toUpperCase()
}

function friendlyApiError(caughtError: unknown, fallback: string) {
  if (caughtError instanceof ApiError) {
    if (caughtError.status === 404) {
      return '종목을 찾지 못했습니다. 티커나 종목코드를 다시 확인하세요.'
    }
    return caughtError.detail || fallback
  }
  if (caughtError instanceof Error) {
    return caughtError.message
  }
  return fallback
}

function searchLocalKrxCompanies(query: string, companies: KRXSearchResult[]) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return companies.slice(0, 20)
  }

  return companies
    .map((item) => {
      const name = item.name.toLowerCase()
      const ticker = item.ticker.toLowerCase()
      const displayName = (item.display_name ?? '').toLowerCase()

      let rank = 99
      if (name.startsWith(normalizedQuery) || ticker.startsWith(normalizedQuery)) {
        rank = 1
      } else if (
        name.includes(normalizedQuery) ||
        ticker.includes(normalizedQuery) ||
        displayName.includes(normalizedQuery)
      ) {
        rank = 2
      }

      return { item, rank }
    })
    .filter((entry) => entry.rank < 99)
    .sort((left, right) => {
      if (left.rank !== right.rank) {
        return left.rank - right.rank
      }
      return left.item.name.localeCompare(right.item.name, 'ko')
    })
    .slice(0, 20)
    .map((entry) => entry.item)
}

function mergeKrxSearchResults(
  primary: KRXSearchResult[],
  secondary: KRXSearchResult[],
  limit = 20,
) {
  const merged = new Map<string, KRXSearchResult>()

  for (const item of [...primary, ...secondary]) {
    merged.set(`${item.ticker}-${item.krx_exchange}`, item)
  }

  return Array.from(merged.values()).slice(0, limit)
}

function scoreLabel(score: number) {
  if (score >= 76) {
    return '내일 이어질 가능성이 상대적으로 높음'
  }
  if (score >= 60) {
    return '관심 후보지만 장 막판 구조를 더 확인해야 함'
  }
  if (score >= 45) {
    return '애매함, 억지 진입보다 관찰 우선'
  }
  return '종가베팅보다 제외가 유리한 구간'
}

function scoreTone(score: number) {
  if (score >= 76) {
    return 'positive'
  }
  if (score >= 50) {
    return 'neutral'
  }
  return 'negative'
}

function scoreAction(score: number) {
  if (score >= 76) {
    return '후보군 상단. 내일 갭상승보다 시가 이후 지지 여부까지 같이 준비합니다.'
  }
  if (score >= 60) {
    return '관심 유지 구간입니다. 주요 지표는 나쁘지 않지만 확신 구간은 아닙니다.'
  }
  if (score >= 45) {
    return '복기 후보 정도로 보는 편이 낫습니다. 억지 진입보다 관찰이 우선입니다.'
  }
  return '오늘 살아남은 수급으로 보기 어렵습니다. 다른 후보를 우선 검토하는 편이 맞습니다.'
}

function findSectorMatch(snapshot: SectorSnapshot | null, ticker: string) {
  if (!snapshot) {
    return null
  }

  const normalized = ticker.trim().toUpperCase()
  return (
    snapshot.sectors.find((sector) =>
      sector.components?.some((item) => item.ticker.trim().toUpperCase() === normalized),
    ) ?? null
  )
}

function deriveSectorStrength(match: SectorRow | null, snapshot: SectorSnapshot | null) {
  if (!match || !snapshot) {
    return 50
  }

  const sectorIndex = snapshot.sectors.findIndex((item) => item.key === match.key)
  const leaderBoost = snapshot.leaders.some((item) => item.key === match.key) ? 14 : 0
  const laggardPenalty = snapshot.laggards.some((item) => item.key === match.key) ? 18 : 0
  const rankingBoost = sectorIndex >= 0 ? Math.max(0, 18 - sectorIndex * 2) : 0

  return clampMetric(
    52 +
      Number(match.return_1d_pct ?? 0) * 3 +
      Number(match.return_5d_pct ?? 0) * 1.2 +
      match.trend_score * 1.5 +
      leaderBoost +
      rankingBoost -
      laggardPenalty,
  )
}

function deriveLeaderStatus(match: SectorRow | null, snapshot: SectorSnapshot | null, ticker: string) {
  if (!match || !snapshot) {
    return 45
  }

  const normalized = ticker.trim().toUpperCase()
  const componentIndex =
    match.components?.findIndex((item) => item.ticker.trim().toUpperCase() === normalized) ?? -1
  const componentBoost = componentIndex === 0 ? 18 : componentIndex > 0 ? Math.max(4, 12 - componentIndex * 2) : 0
  const leaderBoost = snapshot.leaders.some((item) => item.key === match.key) ? 12 : 0

  return clampMetric(48 + componentBoost + leaderBoost + match.trend_score * 1.2)
}

function deriveCloseStrength(quote: QuoteSnapshot | null) {
  if (!quote) {
    return 55
  }
  return clampMetric(55 + quote.change_pct * 4)
}

function deriveCloseStrengthFromRows(rows: StockHistoryRow[]) {
  if (rows.length < 2) {
    return 55
  }
  const latest = rows[rows.length - 1]
  const previous = rows[rows.length - 2]
  const latestClose = Number(latest.Close ?? 0)
  const latestOpen = Number(latest.Open ?? latestClose)
  const latestHigh = Number(latest.High ?? latestClose)
  const latestLow = Number(latest.Low ?? latestClose)
  const previousClose = Number(previous.Close ?? latestClose)
  const dayRange = Math.max(latestHigh - latestLow, 0.000001)
  const closePosition = ((latestClose - latestLow) / dayRange) * 100
  const bodyStrength = ((latestClose / Math.max(latestOpen, 0.000001)) - 1) * 100
  const changePct = ((latestClose / Math.max(previousClose, 0.000001)) - 1) * 100
  return clampMetric(20 + closePosition * 0.55 + bodyStrength * 4 + changePct * 3)
}

function deriveVolumePersistence(match: SectorRow | null, quote: QuoteSnapshot | null, rows: StockHistoryRow[]) {
  if (!match && !quote && rows.length === 0) {
    return 52
  }

  let volumeScore = 0
  if (rows.length >= 21) {
    const latestVolume = Number(rows[rows.length - 1].Volume ?? 0)
    const previousVolumes = rows.slice(-21, -1).map((row) => Number(row.Volume ?? 0))
    const avgVolume = previousVolumes.reduce((sum, value) => sum + value, 0) / Math.max(previousVolumes.length, 1)
    if (avgVolume > 0) {
      const volumeRatio = latestVolume / avgVolume
      volumeScore = Math.min(30, volumeRatio * 12)
    }
  }

  return clampMetric(
    50 +
      (quote?.change_pct ?? 0) * 2.5 +
      (match?.trend_score ?? 0) * 1.8 +
      Number(match?.return_1d_pct ?? 0) * 2 +
      volumeScore,
  )
}

function deriveNewsFollowThrough(sentiment: SentimentResult | null) {
  if (!sentiment) {
    return 50
  }
  return clampMetric(sentiment.sentiment_score)
}

function deriveTomorrowCatalyst(sentiment: SentimentResult | null) {
  if (!sentiment) {
    return 48
  }
  const articleBoost = Math.min(12, sentiment.articles.length * 3)
  const apiBoost = sentiment.news_api_enabled ? 6 : 0
  return clampMetric(sentiment.sentiment_score * 0.65 + articleBoost + apiBoost)
}

function deriveRiskControl(
  quote: QuoteSnapshot | null,
  match: SectorRow | null,
  sentiment: SentimentResult | null,
  rows: StockHistoryRow[],
) {
  if (!quote && !match && !sentiment && rows.length === 0) {
    return 50
  }

  let closeLocationBonus = 0
  let pullbackPenalty = 0

  if (rows.length >= 20) {
    const recentRows = rows.slice(-20)
    const closes = recentRows.map((row) => Number(row.Close ?? 0))
    const highs = recentRows.map((row) => Number(row.High ?? 0))
    const latestClose = closes[closes.length - 1]
    const twentyDayHigh = Math.max(...highs)
    if (twentyDayHigh > 0) {
      closeLocationBonus = (latestClose / twentyDayHigh) * 18
    }

    const latest = recentRows[recentRows.length - 1]
    const latestHigh = Number(latest.High ?? latestClose)
    const latestLow = Number(latest.Low ?? latestClose)
    const latestOpen = Number(latest.Open ?? latestClose)
    const candleRangePct = ((latestHigh - latestLow) / Math.max(latestClose, 0.000001)) * 100
    if (latestClose < latestOpen) {
      pullbackPenalty += 8
    }
    pullbackPenalty += Math.min(12, candleRangePct * 1.5)
  }

  return clampMetric(
    48 +
      (quote?.change_pct ?? 0) * 1.5 +
      (match?.trend_score ?? 0) * 1.1 +
      ((sentiment?.sentiment_score ?? 50) - 50) * 0.3 +
      closeLocationBonus -
      pullbackPenalty,
  )
}

function deriveMarketCloseScenario(rows: StockHistoryRow[], sentiment: SentimentResult | null) {
  if (rows.length < 2) {
    return QUICK_SCENARIOS[1]
  }

  const latest = rows[rows.length - 1]
  const previous = rows[rows.length - 2]
  const latestOpen = Number(latest.Open ?? 0)
  const latestHigh = Number(latest.High ?? 0)
  const latestLow = Number(latest.Low ?? 0)
  const latestClose = Number(latest.Close ?? 0)
  const previousClose = Number(previous.Close ?? latestClose)
  const latestVolume = Number(latest.Volume ?? 0)

  const dayRange = Math.max(latestHigh - latestLow, 0.000001)
  const closePosition = (latestClose - latestLow) / dayRange
  const bodyReturnPct = ((latestClose / Math.max(latestOpen, 0.000001)) - 1) * 100
  const dayReturnPct = ((latestClose / Math.max(previousClose, 0.000001)) - 1) * 100
  const previousVolumes = rows.length >= 21 ? rows.slice(-21, -1).map((row) => Number(row.Volume ?? 0)) : []
  const avgVolume = previousVolumes.reduce((sum, value) => sum + value, 0) / Math.max(previousVolumes.length, 1)
  const volumeRatio = avgVolume > 0 ? latestVolume / avgVolume : 1
  const sentimentScore = sentiment?.sentiment_score ?? 50

  if (closePosition >= 0.8 && bodyReturnPct >= 0 && dayReturnPct >= 1) {
    return QUICK_SCENARIOS[0]
  }
  if (closePosition >= 0.58 && bodyReturnPct >= -0.5 && volumeRatio >= 1.1) {
    return QUICK_SCENARIOS[1]
  }
  if (dayReturnPct >= 2 && closePosition < 0.45 && sentimentScore >= 55) {
    return QUICK_SCENARIOS[2]
  }
  return QUICK_SCENARIOS[3]
}

function deriveRiskFlags(
  rows: StockHistoryRow[],
  match: SectorRow | null,
  sentiment: SentimentResult | null,
  scenario: (typeof QUICK_SCENARIOS)[number],
  scores: Record<string, number>,
) {
  const flags: string[] = []

  if (scenario === QUICK_SCENARIOS[2]) {
    flags.push('뉴스 영향으로 급등했지만 종가까지 매도 물량이 남아 있을 가능성이 있습니다.')
  }
  if (scenario === QUICK_SCENARIOS[3]) {
    flags.push('고가 대비 종가 위치가 낮아 장 마감까지 힘이 유지됐다고 보기 어렵습니다.')
  }

  if (rows.length >= 2) {
    const latest = rows[rows.length - 1]
    const latestOpen = Number(latest.Open ?? 0)
    const latestHigh = Number(latest.High ?? 0)
    const latestLow = Number(latest.Low ?? 0)
    const latestClose = Number(latest.Close ?? 0)
    const latestVolume = Number(latest.Volume ?? 0)
    const dayRange = Math.max(latestHigh - latestLow, 0.000001)
    const closePosition = (latestClose - latestLow) / dayRange
    const upperWickRatio = (latestHigh - Math.max(latestOpen, latestClose)) / dayRange
    if (closePosition < 0.45 || upperWickRatio > 0.45) {
      flags.push('윗꼬리 또는 종가 밀림이 커서 종가베팅 관점에서는 방어력이 약해 보입니다.')
    }
    if (rows.length >= 21) {
      const previousVolumes = rows.slice(-21, -1).map((row) => Number(row.Volume ?? 0))
      const avgVolume = previousVolumes.reduce((sum, value) => sum + value, 0) / Math.max(previousVolumes.length, 1)
      if (avgVolume > 0) {
        const volumeRatio = latestVolume / avgVolume
        if (volumeRatio < 0.9 && scores.volumePersistence < 60) {
          flags.push('거래량이 평소보다 크게 늘지 않아 수급 지속성 신호가 약합니다.')
        }
      }
    }
  }

  if (match && scores.leaderStatus < 55) {
    flags.push(`${match.name} 섹터 안에서는 대장주보다 후발주에 가까워 보입니다.`)
  }

  if (sentiment) {
    if (sentiment.sentiment_score < 45) {
      flags.push('뉴스와 시장 심리가 약해서 내일 재료가 다시 이어질 가능성이 높지 않습니다.')
    }
    if (!sentiment.news_api_enabled) {
      flags.push('최신 뉴스 수집 범위가 좁아 재료 지속성 판단 신뢰도가 낮을 수 있습니다.')
    }
  } else {
    flags.push('뉴스 재료 확인이 충분하지 않아 내일 연결성 판단이 제한적입니다.')
  }

  if (scores.riskControl < 50) {
    flags.push('손절 기준을 잡기 쉬운 구조로 보기 어려워 대응 난도가 높을 수 있습니다.')
  }

  return [...new Set(flags)].slice(0, 5)
}

function recentStockWindow() {
  const endDate = new Date()
  endDate.setDate(endDate.getDate() + 1)
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - 90)
  const format = (value: Date) => {
    const year = value.getFullYear()
    const month = `${value.getMonth() + 1}`.padStart(2, '0')
    const day = `${value.getDate()}`.padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  return { startDate: format(startDate), endDate: format(endDate) }
}

export function ClosingBetPage() {
  const [session, setSession] = useState<AppSession | null>(() => readStoredSession())
  const [market, setMarket] = useState<MarketOption>('krx')
  const [ticker, setTicker] = useState(defaultTicker('krx'))
  const [krxExchange, setKrxExchange] = useState<KrxExchange>('auto')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<KRXSearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quote, setQuote] = useState<QuoteSnapshot | null>(null)
  const [sentiment, setSentiment] = useState<SentimentResult | null>(null)
  const [sectorSnapshot, setSectorSnapshot] = useState<SectorSnapshot | null>(null)
  const [resolvedSector, setResolvedSector] = useState<SectorRow | null>(null)
  const [stockRows, setStockRows] = useState<StockHistoryRow[]>([])
  const [scenario, setScenario] = useState<(typeof QUICK_SCENARIOS)[number]>(QUICK_SCENARIOS[1])
  const [scores, setScores] = useState(INITIAL_SCORES)
  const [notifications, setNotifications] = useState<ClosingBetNotification[]>([])
  const [alerts, setAlerts] = useState<ClosingBetAlertEvent[]>([])
  const [notificationLoading, setNotificationLoading] = useState(false)
  const [notificationError, setNotificationError] = useState<string | null>(null)
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null)
  const [notificationChannel, setNotificationChannel] = useState<ClosingBetNotificationChannel>('toss_inapp')
  const [notificationDestination, setNotificationDestination] = useState('')
  const [notificationThreshold, setNotificationThreshold] = useState('0')
  const [tossUserKey, setTossUserKey] = useState<string | null>(null)
  const [tossRecipientKeyType, setTossRecipientKeyType] = useState<'anonymous_key' | 'user_key' | null>(null)
  const [tossLoginScope, setTossLoginScope] = useState<string[]>([])
  const [tossLoginConfigured, setTossLoginConfigured] = useState<boolean | null>(null)
  const [tossSmartMessageConfigured, setTossSmartMessageConfigured] = useState<boolean | null>(null)
  const [tossLoginLoading, setTossLoginLoading] = useState(false)
  const [notificationTemplateCode, setNotificationTemplateCode] = useState(DEFAULT_TOSS_TEMPLATE_CODE)
  const [notificationAgreementReady, setNotificationAgreementReady] = useState(false)
  const [savingNotification, setSavingNotification] = useState(false)
  const [testingNotification, setTestingNotification] = useState(false)
  const [deletingNotificationId, setDeletingNotificationId] = useState<number | null>(null)

  const hasAnalysis = quote !== null || sentiment !== null || sectorSnapshot !== null || stockRows.length > 0

  const totalScore = useMemo(() => {
    if (!hasAnalysis) {
      return 0
    }
    return clampScore(
      scores.sectorStrength * 0.2 +
        scores.closeStrength * 0.24 +
        scores.volumePersistence * 0.2 +
        scores.leaderStatus * 0.16 +
        scores.newsFollowThrough * 0.1 +
        scores.tomorrowCatalyst * 0.05 +
        scores.riskControl * 0.05 +
        SCENARIO_MODIFIERS[scenario],
    )
  }, [hasAnalysis, scenario, scores])

  const tone = scoreTone(totalScore)
  const tickerLabel = normalizeTicker(ticker, market) || defaultTicker(market)
  const riskFlags = useMemo(
    () => deriveRiskFlags(stockRows, resolvedSector, sentiment, scenario, scores),
    [resolvedSector, scenario, scores, sentiment, stockRows],
  )

  const commonKrxCompanies = useMemo(() => COMMON_KRX_COMPANIES, [])
  const instantSearchResults = useMemo(
    () => searchLocalKrxCompanies(searchQuery, commonKrxCompanies),
    [commonKrxCompanies, searchQuery],
  )

  async function refreshNotificationCenter(sessionValue: AppSession, signal?: AbortSignal) {
    const [notificationResponse, alertResponse] = await Promise.all([
      apiClient.closingBetNotifications(sessionValue.sessionToken, signal),
      apiClient.closingBetAlerts(sessionValue.sessionToken, signal),
    ])
    setNotifications(notificationResponse.items)
    setAlerts(alertResponse.items)
  }

  async function ensureTossRecipientKey() {
    if (tossUserKey) {
      return tossUserKey
    }

    const anonymousKeyResult = await getAnonymousKey()
    if (anonymousKeyResult && anonymousKeyResult !== 'ERROR' && anonymousKeyResult.type === 'HASH') {
      setTossUserKey(anonymousKeyResult.hash)
      setTossRecipientKeyType('anonymous_key')
      setTossLoginScope([])
      return anonymousKeyResult.hash
    }

    if (tossLoginConfigured === false) {
      throw new Error('토스 로그인 연동이 없고 anonKey도 가져오지 못했습니다.')
    }

    const loginResult = await appLogin()
    if (!loginResult?.authorizationCode) {
      throw new Error('토스 로그인 인가 코드를 가져오지 못했습니다.')
    }

    const response = await apiClient.tossLoginUserKey({
      authorization_code: loginResult.authorizationCode,
      referrer: loginResult.referrer,
    }, session?.sessionToken)
    setTossUserKey(response.user_key)
    setTossRecipientKeyType('user_key')
    setTossLoginScope(response.scope_list)
    return response.user_key
  }

  async function ensureNotificationAgreement() {
    if (notificationChannel !== 'toss_inapp') {
      return
    }
    if (notificationAgreementReady) {
      return
    }

    await new Promise<void>((resolve, reject) => {
      requestNotificationAgreement({
        options: { templateCode: notificationTemplateCode },
        onEvent: (result) => {
          if (result.type === 'agreementRejected') {
            reject(new Error('사용자가 알림 동의를 거부했습니다.'))
            return
          }
          setNotificationAgreementReady(true)
          resolve()
        },
        onError: (error) => {
          reject(error instanceof Error ? error : new Error('알림 동의 요청에 실패했습니다.'))
        },
      })
    })
  }

  useEffect(() => {
    const abortController = new AbortController()

    async function loadAppConfig() {
      try {
        const response = await apiClient.appConfig(abortController.signal)
        const nextTemplateCode = response.toss_smart_message?.template_code?.trim()
        if (!abortController.signal.aborted && nextTemplateCode) {
          setNotificationTemplateCode(nextTemplateCode)
        }
        if (!abortController.signal.aborted) {
          setTossLoginConfigured(response.toss_login?.configured ?? false)
          setTossSmartMessageConfigured(response.toss_smart_message?.configured ?? false)
        }
      } catch {
        // Keep the local fallback when app config cannot be fetched.
      }
    }

    void loadAppConfig()
    return () => abortController.abort()
  }, [])

  useEffect(() => {
    const abortController = new AbortController()

    async function ensureSession() {
      if (session) {
        return
      }

      try {
        const response = await apiClient.bootstrapSession()
        if (abortController.signal.aborted) {
          return
        }
        const nextSession = {
          accountId: response.account_id,
          sessionToken: response.session_token,
        }
        writeStoredSession(nextSession)
        setSession(nextSession)
      } catch (caughtError) {
        if (abortController.signal.aborted) {
          return
        }
        setNotificationError(friendlyApiError(caughtError, '알림 세션을 준비하지 못했습니다.'))
      }
    }

    void ensureSession()
    return () => abortController.abort()
  }, [session])

  useEffect(() => {
    const abortController = new AbortController()

    async function loadNotifications() {
      if (!session) {
        setNotifications([])
        return
      }
      setNotificationLoading(true)
      setNotificationError(null)

      try {
        await refreshNotificationCenter(session, abortController.signal)
        if (abortController.signal.aborted) {
          return
        }
      } catch (caughtError) {
        if (abortController.signal.aborted) {
          return
        }
        if (caughtError instanceof ApiError && caughtError.status === 401) {
          clearStoredSession()
          setSession(null)
          setNotifications([])
          setAlerts([])
          setNotificationError('알림 세션이 만료되어 다시 연결 중입니다.')
          return
        }
        setNotificationError(friendlyApiError(caughtError, '알림 구독 목록을 불러오지 못했습니다.'))
      } finally {
        if (!abortController.signal.aborted) {
          setNotificationLoading(false)
        }
      }
    }

    void loadNotifications()
    return () => abortController.abort()
  }, [session])

  async function handleSearch() {
    const normalizedQuery = searchQuery.trim()
    if (!normalizedQuery) {
      setSearchResults([])
      setSearchError('검색어를 입력하세요.')
      return
    }

    setSearchLoading(true)
    setSearchError(null)
    const localResults = searchLocalKrxCompanies(normalizedQuery, commonKrxCompanies)
    if (localResults.length > 0) {
      setSearchResults(localResults)
    }

    try {
      const response = await apiClient.searchKrxStocks(normalizedQuery, 20)
      const mergedResults = mergeKrxSearchResults(response.results, localResults, 20)
      setSearchResults(mergedResults)
      if (mergedResults.length === 0) {
        setSearchError('검색 결과가 없습니다.')
      }
    } catch (caughtError) {
      if (localResults.length > 0) {
        setSearchResults(localResults)
        setSearchError(null)
      } else {
        setSearchResults([])
        setSearchError(friendlyApiError(caughtError, '국내 종목 검색에 실패했습니다.'))
      }
    } finally {
      setSearchLoading(false)
    }
  }

  function handleSearchQueryChange(value: string) {
    setSearchQuery(value)
    setSearchError(null)

    const normalizedQuery = value.trim()
    if (!normalizedQuery) {
      setSearchResults([])
      return
    }

    setSearchResults(searchLocalKrxCompanies(normalizedQuery, commonKrxCompanies))
  }

  function handlePickCompany(company: KRXSearchResult) {
    setTicker(company.ticker)
    setKrxExchange(company.krx_exchange)
    setError(null)
    setSearchError(null)
  }

  async function handleAnalyzeAssist() {
    const normalizedTicker = normalizeTicker(ticker, market)
    if (!normalizedTicker) {
      setError('종목을 입력한 뒤 분석 보조를 실행하세요.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const { startDate, endDate } = recentStockWindow()
      const [quoteResult, sentimentResult, sectorResult, stockResult] = await Promise.all([
        apiClient.quote(normalizedTicker, market, krxExchange),
        apiClient.sentiment(normalizedTicker, market, krxExchange),
        apiClient.marketSectors(market),
        apiClient.stockData(normalizedTicker, startDate, endDate, market, krxExchange),
      ])

      const matchedSector = findSectorMatch(
        sectorResult,
        quoteResult.resolved_ticker || normalizedTicker,
      )

      setQuote(quoteResult)
      setSentiment(sentimentResult)
      setSectorSnapshot(sectorResult)
      setResolvedSector(matchedSector)
      setStockRows(stockResult.rows)
      setScenario(deriveMarketCloseScenario(stockResult.rows, sentimentResult))
      setScores({
        sectorStrength: deriveSectorStrength(matchedSector, sectorResult),
        closeStrength:
          stockResult.rows.length > 0
            ? deriveCloseStrengthFromRows(stockResult.rows)
            : deriveCloseStrength(quoteResult),
        volumePersistence: deriveVolumePersistence(matchedSector, quoteResult, stockResult.rows),
        leaderStatus: deriveLeaderStatus(matchedSector, sectorResult, quoteResult.resolved_ticker || normalizedTicker),
        newsFollowThrough: deriveNewsFollowThrough(sentimentResult),
        tomorrowCatalyst: deriveTomorrowCatalyst(sentimentResult),
        riskControl: deriveRiskControl(quoteResult, matchedSector, sentimentResult, stockResult.rows),
      })
    } catch (caughtError) {
      setError(friendlyApiError(caughtError, '종가베팅 보조 데이터를 불러오지 못했습니다.'))
      setQuote(null)
      setSentiment(null)
      setSectorSnapshot(null)
      setResolvedSector(null)
      setStockRows([])
      setScores(INITIAL_SCORES)
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveNotification() {
    if (!session) {
      setNotificationError('알림 세션을 준비 중입니다. 잠시 후 다시 시도하세요.')
      return
    }

    const normalizedTicker = normalizeTicker(ticker, market)
    const normalizedDestination = notificationDestination.trim()
    const threshold = Number(notificationThreshold)

    if (!quote && !normalizedTicker) {
      setNotificationError('먼저 종가베팅 분석을 실행한 뒤 알림을 저장하세요.')
      return
    }
    if (!normalizedDestination) {
      setNotificationError(notificationChannel === 'email' ? '이메일 주소를 입력하세요.' : '토스 앱 알림 메모를 입력하세요.')
      return
    }
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
      setNotificationError('점수 기준은 0~100 사이로 입력하세요.')
      return
    }

    setSavingNotification(true)
    setNotificationError(null)
    setNotificationMessage(null)

    try {
      let nextTossUserKey: string | undefined
      if (notificationChannel === 'toss_inapp') {
        nextTossUserKey = await ensureTossRecipientKey()
        await ensureNotificationAgreement()
      }
      const response = await apiClient.closingBetNotificationUpsert(session.sessionToken, {
        ticker: quote?.resolved_ticker || normalizedTicker,
        market,
        krx_exchange: market === 'krx' ? krxExchange : 'auto',
        channel: notificationChannel,
        destination: normalizedDestination,
        toss_user_key: nextTossUserKey,
        threshold_score: Math.round(threshold),
        active: true,
      })
      setNotifications((current) => {
        const others = current.filter((item) => item.id !== response.subscription.id)
        return [response.subscription, ...others]
      })
      await refreshNotificationCenter(session)
      setNotificationMessage(`${channelLabel(notificationChannel)} 알림 구독을 저장했습니다.`)
    } catch (caughtError) {
      setNotificationError(friendlyApiError(caughtError, '알림 구독 저장에 실패했습니다.'))
    } finally {
      setSavingNotification(false)
    }
  }

  async function handleTestNotification() {
    const normalizedDestination = notificationDestination.trim()
    const normalizedTicker = normalizeTicker(ticker, market) || defaultTicker(market)

    if (!normalizedDestination) {
      setNotificationError(notificationChannel === 'email' ? '이메일 주소를 입력하세요.' : '토스 앱 알림 메모를 입력하세요.')
      return
    }

    setTestingNotification(true)
    setNotificationError(null)
    setNotificationMessage(null)
    try {
      let nextTossUserKey: string | undefined
      let deploymentId: string | undefined
      if (notificationChannel === 'toss_inapp') {
        nextTossUserKey = await ensureTossRecipientKey()
        await ensureNotificationAgreement()
        deploymentId = env.getDeploymentId()
      }
      await apiClient.closingBetNotificationTest({
        channel: notificationChannel,
        destination: normalizedDestination,
        toss_user_key: nextTossUserKey,
        deployment_id: deploymentId,
        ticker: normalizedTicker,
        market,
      }, session?.sessionToken)
      if (session) {
        await refreshNotificationCenter(session)
      }
      setNotificationMessage(`${channelLabel(notificationChannel)} 테스트 알림을 발송했습니다.`)
    } catch (caughtError) {
      setNotificationError(friendlyApiError(caughtError, '테스트 알림 발송에 실패했습니다.'))
    } finally {
      setTestingNotification(false)
    }
  }

  async function handleConnectTossLogin() {
    setTossLoginLoading(true)
    setNotificationError(null)
    setNotificationMessage(null)
    try {
      const recipientKey = await ensureTossRecipientKey()
      setNotificationMessage(
        tossRecipientKeyType === 'anonymous_key' || (recipientKey && !/^\d+$/.test(recipientKey))
          ? '토스 anonKey를 연결했습니다.'
          : '토스 로그인 userKey를 연결했습니다.',
      )
    } catch (caughtError) {
      setNotificationError(friendlyApiError(caughtError, '토스 로그인 연결에 실패했습니다.'))
    } finally {
      setTossLoginLoading(false)
    }
  }

  async function handleDeleteNotification(notificationId: number) {
    if (!session) {
      setNotificationError('알림 세션을 준비 중입니다. 잠시 후 다시 시도하세요.')
      return
    }

    setDeletingNotificationId(notificationId)
    setNotificationError(null)
    setNotificationMessage(null)
    try {
      await apiClient.closingBetNotificationDelete(session.sessionToken, notificationId)
      await refreshNotificationCenter(session)
      setNotificationMessage('알림 구독을 삭제했습니다.')
    } catch (caughtError) {
      setNotificationError(friendlyApiError(caughtError, '알림 구독 삭제에 실패했습니다.'))
    } finally {
      setDeletingNotificationId(null)
    }
  }

  async function handleReadAlert(alertId: number) {
    if (!session) {
      setNotificationError('알림 세션을 준비 중입니다. 잠시 후 다시 시도하세요.')
      return
    }

    try {
      const response = await apiClient.closingBetAlertMarkRead(session.sessionToken, alertId)
      setAlerts((current) => current.map((item) => (item.id === alertId ? response.item : item)))
    } catch (caughtError) {
      setNotificationError(friendlyApiError(caughtError, '알림 읽음 처리에 실패했습니다.'))
    }
  }

  function handleMarketChange(nextMarket: MarketOption) {
    setMarket(nextMarket)
    setTicker(defaultTicker(nextMarket))
    setKrxExchange('auto')
    setSearchQuery('')
    setSearchResults([])
    setSearchError(null)
    setQuote(null)
    setSentiment(null)
    setSectorSnapshot(null)
    setResolvedSector(null)
    setStockRows([])
    setScenario(QUICK_SCENARIOS[1])
    setScores(INITIAL_SCORES)
    setError(null)
  }

  return (
    <main className="page-shell">
      <section className="content-panel">
        <p className="content-panel__eyebrow">종가베팅 핵심 판단</p>
        <h2 className="content-panel__title">종가베팅</h2>
        <p className="content-panel__description">
          오늘 끝까지 살아남은 수급이 내일도 이어질 확률을 서비스가 자동으로 점검하는
          핵심 화면입니다. 실제 매매 기능은 없고, 후보 압축과 제외 신호 정리에 집중합니다.
        </p>
      </section>

      <section className="content-panel">
        <div className="toolbar-row toolbar-row--stacked">
          <div className="segmented-control segmented-control--full" role="tablist" aria-label="시장 선택">
            {MARKET_OPTIONS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={
                  item.value === market
                    ? 'segmented-control__button segmented-control__button--active'
                    : 'segmented-control__button'
                }
                onClick={() => handleMarketChange(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="form-stack">
          {market === 'krx' ? (
            <>
              <div>
                <label className="field-label">대표 국내 종목 빠른 선택</label>
                <div className="chip-row">
                  {commonKrxCompanies.map((company) => (
                    <button
                      key={company.ticker}
                      type="button"
                      className={ticker === company.ticker ? 'chip chip--active' : 'chip'}
                      onClick={() => handlePickCompany(company)}
                    >
                      {company.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field-grid field-grid--single-when-narrow">
                <div>
                  <label className="field-label" htmlFor="closing-bet-krx-exchange">
                    국내 거래소
                  </label>
                  <select
                    id="closing-bet-krx-exchange"
                    className="text-field"
                    value={krxExchange}
                    onChange={(event) => setKrxExchange(event.target.value as KrxExchange)}
                  >
                    {KRX_EXCHANGE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="field-label" htmlFor="closing-bet-search">
                    국내 종목명 검색
                  </label>
                  <div className="input-action-row input-action-row--stacked">
                    <input
                      id="closing-bet-search"
                      className="text-field"
                      value={searchQuery}
                      onChange={(event) => handleSearchQueryChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          void handleSearch()
                        }
                      }}
                      placeholder="회사명 일부나 6자리 종목코드"
                    />
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={() => void handleSearch()}
                      disabled={searchLoading}
                    >
                      {searchLoading ? '검색 중...' : '검색'}
                    </button>
                  </div>
                </div>
              </div>

              <p className="helper-text helper-text--tight helper-text--relaxed-break">
                예: KB, KB금융, 105560처럼 일부만 입력해도 됩니다.
              </p>

              {searchError ? <div className="state-box state-box--error">{searchError}</div> : null}

              {(searchResults.length > 0 || (searchQuery.trim() && instantSearchResults.length > 0)) ? (
                <div className="search-result-list">
                  {(searchResults.length > 0 ? searchResults : instantSearchResults).map((item) => (
                    <button
                      key={`${item.ticker}-${item.krx_exchange}`}
                      type="button"
                      className="search-result-item"
                      onClick={() => handlePickCompany(item)}
                    >
                      <strong>{item.name}</strong>
                      <span>
                        {item.display_name ?? `${item.ticker} (${item.krx_exchange.toUpperCase()})`}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}

          <div>
            <label className="field-label" htmlFor="closing-bet-ticker">
              {market === 'krx' ? '종목 코드' : '관심 종목'}
            </label>
            <input
              id="closing-bet-ticker"
              className="text-field"
              value={ticker}
              onChange={(event) => setTicker(normalizeTicker(event.target.value, market))}
              placeholder={market === 'krx' ? '예: 005930' : '예: NVDA'}
            />
            <p className="helper-text helper-text--tight">
              자동 판정은 최근 종가 구조, AI 뉴스, 섹터 문맥, 거래량 데이터를 반영합니다.
            </p>
          </div>

          <button
            type="button"
            className="primary-action"
            onClick={() => void handleAnalyzeAssist()}
            disabled={loading}
          >
            {loading ? '보조 데이터 불러오는 중...' : 'AI + 섹터 기반으로 자동 판정'}
          </button>
        </div>

        {error ? <div className="state-box state-box--error">{error}</div> : null}

        <div className={`sentiment-card sentiment-card--${tone}`}>
          <div className="sentiment-card__top">
            <div>
              <p className="sentiment-card__eyebrow">종가베팅 점수</p>
              <h3 className="sentiment-card__title">{tickerLabel}</h3>
            </div>
            <div className="sentiment-score-box">
              <span className="sentiment-score-box__label">총점</span>
              <strong className="sentiment-score-box__value">{totalScore}</strong>
            </div>
          </div>

          <div className="sentiment-meter" aria-hidden="true">
            <div className="sentiment-meter__fill" style={{ width: `${totalScore}%` }} />
          </div>

          <p className="sentiment-card__summary-label">{scoreLabel(totalScore)}</p>
          <p className="sentiment-card__summary-text">{scoreAction(totalScore)}</p>
        </div>

        {quote || sentiment || resolvedSector ? (
          <div className="analysis-summary-grid">
            {quote ? (
              <article className="summary-mini-card">
                <span className="summary-mini-card__label">최근 종가 흐름</span>
                <strong className="summary-mini-card__value">{formatPct(quote.change_pct)}</strong>
                <p className="summary-card__text">
                  {quote.company_name ? `${quote.company_name} / ` : ''}기준일 {formatDate(quote.as_of)}
                </p>
              </article>
            ) : null}

            {resolvedSector ? (
              <article className="summary-mini-card">
                <span className="summary-mini-card__label">매칭 섹터</span>
                <strong className="summary-mini-card__value">{resolvedSector.name}</strong>
                <p className="summary-card__text">
                  1일 {formatPct(resolvedSector.return_1d_pct)} / {resolvedSector.trend_label}
                </p>
              </article>
            ) : null}

            {sentiment ? (
              <article className="summary-mini-card">
                <span className="summary-mini-card__label">AI 뉴스 점수</span>
                <strong className="summary-mini-card__value">{sentiment.sentiment_score}</strong>
                <p className="summary-card__text">기사 {sentiment.articles.length}건 기반 요약</p>
              </article>
            ) : null}
          </div>
        ) : null}

        <div className="content-panel content-panel--nested">
          <p className="content-panel__eyebrow">알림 설정</p>
          <p className="content-panel__description">
            카카오 대신 Toss in-app 안에서 확인하는 알림함 기준으로 설계했습니다. 이메일도 함께 둘 수 있습니다.
          </p>

          <div className="field-grid field-grid--single-when-narrow">
            <div>
              <label className="field-label" htmlFor="closing-bet-notification-channel">
                알림 채널
              </label>
              <select
                id="closing-bet-notification-channel"
                className="text-field"
                value={notificationChannel}
                onChange={(event) => setNotificationChannel(event.target.value as ClosingBetNotificationChannel)}
              >
                <option value="toss_inapp">토스 앱 알림</option>
                <option value="email">이메일</option>
              </select>
            </div>

            <div>
              <label className="field-label" htmlFor="closing-bet-notification-destination">
                {notificationChannel === 'email' ? '수신 이메일' : '알림 메모'}
              </label>
              <input
                id="closing-bet-notification-destination"
                className="text-field"
                value={notificationDestination}
                onChange={(event) => setNotificationDestination(event.target.value)}
                placeholder={
                  notificationChannel === 'email'
                    ? 'me@example.com'
                    : '예: 종가 후보 즉시 확인'
                }
              />
            </div>
          </div>

          <div className="field-grid field-grid--single-when-narrow">
            <div>
              <label className="field-label" htmlFor="closing-bet-notification-threshold">
                알림 점수 기준
              </label>
              <input
                id="closing-bet-notification-threshold"
                className="text-field"
                inputMode="numeric"
                value={notificationThreshold}
                onChange={(event) => setNotificationThreshold(event.target.value)}
                placeholder="0"
              />
            </div>
            {notificationChannel === 'toss_inapp' ? (
              <div className="summary-card">
                <p className="summary-card__label">토스 발송 식별 키</p>
                <strong className="summary-card__value">{tossUserKey ? '연결됨' : '연결 필요'}</strong>
                <p className="summary-card__text">
                  {tossSmartMessageConfigured === false
                    ? '백엔드에 Apps in Toss 스마트 발송 설정이 없어 실제 발송은 동작하지 않습니다.'
                    : tossRecipientKeyType === 'anonymous_key'
                      ? '현재 스마트 발송용 anonKey를 확보했습니다.'
                      : tossUserKey
                        ? `현재 스마트 발송용 userKey를 확보했습니다. scope: ${tossLoginScope.join(', ') || '미확인'}`
                        : '가능하면 anonKey를 먼저 사용하고, 실패하면 토스 로그인 userKey를 대체로 사용합니다.'}
                </p>
                <div className="input-action-row input-action-row--wide">
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => void handleConnectTossLogin()}
                    disabled={tossLoginLoading}
                  >
                    {tossLoginLoading
                      ? '토스 식별 키 연결 중...'
                      : tossUserKey
                        ? '토스 식별 키 다시 연결'
                        : '토스 식별 키 연결'}
                  </button>
                </div>
              </div>
            ) : null}
            <div className="input-action-row input-action-row--stacked">
              <button
                type="button"
                className="secondary-action"
                onClick={() => void handleTestNotification()}
                disabled={testingNotification || (notificationChannel === 'toss_inapp' && tossSmartMessageConfigured === false)}
              >
                {testingNotification
                  ? '테스트 발송 중...'
                  : notificationChannel === 'toss_inapp'
                    ? '토스 앱 알림 도착 테스트'
                    : '이메일 테스트'}
              </button>
              <button
                type="button"
                className="primary-action"
                onClick={() => void handleSaveNotification()}
                disabled={savingNotification || (notificationChannel === 'toss_inapp' && tossSmartMessageConfigured === false)}
              >
                {savingNotification ? '저장 중...' : '현재 종목으로 알림 저장'}
              </button>
            </div>
          </div>

          {notificationMessage ? <div className="state-box">{notificationMessage}</div> : null}
          {notificationError ? <div className="state-box state-box--error">{notificationError}</div> : null}
          {notificationLoading ? <div className="state-box">알림 구독과 알림함을 불러오는 중입니다...</div> : null}

          <div className="section-block">
            <div className="section-block__header">
              <h3>내 알림 구독</h3>
            </div>
            <div className="sector-list">
              {notifications.length === 0 ? (
                <div className="state-box">저장된 알림 구독이 없습니다.</div>
              ) : (
                notifications.map((item) => (
                  <article key={item.id} className="sector-list__item">
                    <div className="sector-list__top">
                      <div>
                        <h4 className="sector-list__title">
                          {item.company_name || item.resolved_ticker || item.ticker}
                        </h4>
                        <p className="sector-list__subtitle">
                          {channelLabel(item.channel)} / 기준 {item.threshold_score}점 / 최근 {item.last_score ?? '-'}점
                        </p>
                      </div>
                      <button
                        type="button"
                        className="secondary-action"
                        onClick={() => void handleDeleteNotification(item.id)}
                        disabled={deletingNotificationId === item.id}
                      >
                        {deletingNotificationId === item.id ? '삭제 중...' : '삭제'}
                      </button>
                    </div>
                    <p className="sector-list__meta">
                      {item.destination} / 최근 시그널 {formatDate(item.last_signal_date ?? undefined)}
                    </p>
                  </article>
                ))
              )}
            </div>
          </div>

          <div className="section-block">
            <div className="section-block__header">
              <h3>토스 앱 알림함</h3>
            </div>
            <div className="sector-list">
              {alerts.length === 0 ? (
                <div className="state-box">아직 도착한 알림이 없습니다.</div>
              ) : (
                alerts.map((item) => (
                  <article key={item.id} className="sector-list__item">
                    <div className="sector-list__top">
                      <div>
                        <h4 className="sector-list__title">{item.title}</h4>
                        <p className="sector-list__subtitle">
                          {item.total_score ?? '-'}점 / {formatDate(item.signal_date ?? undefined)} / {item.is_read ? '읽음' : '안읽음'}
                        </p>
                      </div>
                      {!item.is_read ? (
                        <button
                          type="button"
                          className="secondary-action"
                          onClick={() => void handleReadAlert(item.id)}
                        >
                          읽음 처리
                        </button>
                      ) : null}
                    </div>
                    <p className="sector-list__meta">{item.message}</p>
                  </article>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="content-panel">
        <p className="content-panel__eyebrow">자동 점검 항목</p>
        <h3 className="content-panel__title">직접 점수를 넣지 않고 자동 판정 결과만 보여줍니다.</h3>
        <div className="diagnostic-list">
          <article className="diagnostic-item">
            <strong>섹터 강도</strong>
            <span>{scores.sectorStrength}</span>
            <p>섹터 1일·1주 수익률, 추세 점수, 강세 섹터 포함 여부를 반영합니다.</p>
          </article>
          <article className="diagnostic-item">
            <strong>종가 강도</strong>
            <span>{scores.closeStrength}</span>
            <p>당일 종가가 고가·저가 범위 어디에서 끝났는지와 몸통 강도를 반영합니다.</p>
          </article>
          <article className="diagnostic-item">
            <strong>거래대금 지속성</strong>
            <span>{scores.volumePersistence}</span>
            <p>최근 20일 평균 대비 거래량과 종가 변화율, 섹터 추세를 같이 반영합니다.</p>
          </article>
          <article className="diagnostic-item">
            <strong>대장주 여부</strong>
            <span>{scores.leaderStatus}</span>
            <p>해당 종목이 섹터 대표 바스켓에서 얼마나 앞쪽에 있는지 반영합니다.</p>
          </article>
          <article className="diagnostic-item">
            <strong>재료 지속성</strong>
            <span>{scores.newsFollowThrough}</span>
            <p>AI 뉴스 감성 점수와 기사 흐름을 그대로 반영합니다.</p>
          </article>
          <article className="diagnostic-item">
            <strong>내일 이벤트 연결</strong>
            <span>{scores.tomorrowCatalyst}</span>
            <p>AI 감성 점수와 기사 수를 기반으로 다음 날 재점화 가능성을 추정합니다.</p>
          </article>
          <article className="diagnostic-item">
            <strong>리스크 통제 가능성</strong>
            <span>{scores.riskControl}</span>
            <p>20일 고점 대비 위치와 당일 캔들 범위를 합쳐 손절 구조를 추정합니다.</p>
          </article>
          <article className="diagnostic-item">
            <strong>장 마감 구조 보정</strong>
            <span>{SCENARIO_MODIFIERS[scenario]}</span>
            <p>서비스가 자동으로 판정한 장 마감 구조를 최종 점수에 가감합니다.</p>
          </article>
        </div>
      </section>

      <section className="content-panel">
        <p className="content-panel__eyebrow">빠른 해석</p>
        <div className="content-panel content-panel--nested">
          <p className="content-panel__description">
            서비스가 판단한 오늘 장 마감 구조: <strong>{scenario}</strong>
          </p>
          <ul className="bullet-list bullet-list--spaced">
            <li>종가베팅은 오늘 강했던 이유보다 그 강함이 종가까지 남았는지를 더 중요하게 봅니다.</li>
            <li>점수가 높아도 종가가 억지로 끌어올려진 흐름이면 다음 날 갭만 주고 밀릴 수 있습니다.</li>
            <li>점수가 낮아도 대장주가 눌림 뒤 재집결하는 날은 복기 대상으로 따로 볼 가치가 있습니다.</li>
          </ul>
        </div>

        {sentiment ? (
          <div className="content-panel content-panel--nested">
            <p className="content-panel__eyebrow">AI 요약 반영</p>
            <p className="content-panel__description">{sentiment.summary}</p>
          </div>
        ) : null}

        {resolvedSector && sectorSnapshot ? (
          <div className="content-panel content-panel--nested">
            <p className="content-panel__eyebrow">섹터 문맥</p>
            <p className="content-panel__description">
              {resolvedSector.name} 섹터에 속하며, 현재 시장 요약은 "{sectorSnapshot.summary}" 입니다.
            </p>
            <ul className="bullet-list">
              <li>섹터 1일 수익률은 {formatPct(resolvedSector.return_1d_pct)} 입니다.</li>
              <li>1주 수익률은 {formatPct(resolvedSector.return_5d_pct)} 입니다.</li>
              <li>추세 라벨은 {resolvedSector.trend_label} 입니다.</li>
            </ul>
          </div>
        ) : null}

        <div className="content-panel content-panel--nested">
          <p className="content-panel__eyebrow">제외 신호</p>
          <div className="sector-list">
            {(riskFlags.length > 0
              ? riskFlags
              : ['현재 자동 판정 기준에서는 뚜렷한 제외 신호가 강하게 잡히지 않았습니다.']
            ).map((item) => (
              <article key={item} className="sector-list__item">
                <div className="sector-list__top">
                  <div>
                    <h4 className="sector-list__title">{item}</h4>
                    <p className="sector-list__subtitle">종가베팅 제외 우선 검토</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="content-panel content-panel--nested">
          <p className="content-panel__eyebrow">체크 순서</p>
          <ul className="bullet-list bullet-list--spaced">
            <li>1. 섹터와 대장주가 같이 강한지 먼저 봅니다.</li>
            <li>2. 종가가 고가 부근인지, 장 마감까지 살아남았는지 확인합니다.</li>
            <li>3. 내일 다시 소화될 재료가 있는지 확인합니다.</li>
            <li>4. 틀렸을 때 빨리 접을 기준이 없다면 점수가 높아도 제외합니다.</li>
          </ul>
        </div>

        <div className="content-panel content-panel--nested">
          <p className="content-panel__eyebrow">자동 보정 범위</p>
          <ul className="bullet-list">
            <li>자동 보정은 섹터 흐름, 최근 종가 변화율, 일봉 가격 구조, 거래량, AI 뉴스 점수를 반영합니다.</li>
            <li>사용자가 직접 점수를 넣지 않도록 구성해 같은 기준으로 후보를 비교할 수 있게 했습니다.</li>
            <li>이 화면은 매수 신호가 아니라 후보 압축과 복기 보조 화면으로 보는 편이 맞습니다.</li>
          </ul>
        </div>
      </section>
    </main>
  )
}
