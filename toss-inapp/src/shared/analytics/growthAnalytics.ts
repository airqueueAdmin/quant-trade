import { Analytics, eventLog } from '@apps-in-toss/web-framework'

type AnalyticsParam = string | number | boolean | null | undefined
type AnalyticsParams = Record<string, AnalyticsParam>

const REFERRAL_STORAGE_KEY = 'quant.toss_inapp.referral_activation'
const RETENTION_STORAGE_KEY = 'quant.toss_inapp.retention'

const SCREEN_NAMES: Record<string, string> = {
  '/': 'home',
  '/sector-flow': 'sector_flow',
  '/market-movers': 'market_movers',
  '/ai-analysis': 'ai_analysis',
  '/closing-bet': 'closing_bet',
  '/strategy-simulation': 'strategy_simulation',
  '/paper-trading': 'paper_trading',
  '/paper-trading/rankings': 'paper_trading_rankings',
  '/events/sk-hynix': 'sk_hynix_event',
}

function ignoreAnalyticsFailure(result: Promise<void> | undefined) {
  result?.catch(() => undefined)
}

export function trackScreenView(pathname: string) {
  const fallbackScreenName = pathname.replace(/^\/+|\/+$/g, '').replaceAll('/', '_') || 'home'
  const screenName = SCREEN_NAMES[pathname] ?? fallbackScreenName

  try {
    ignoreAnalyticsFailure(Analytics.screen({
      log_name: `screen_${screenName}`,
      pathname,
    }))
  } catch {
    // Analytics must never interrupt the user flow outside the Toss runtime.
  }
}

export function trackGrowthEvent(logName: string, params: AnalyticsParams = {}) {
  try {
    ignoreAnalyticsFailure(eventLog({
      log_name: logName,
      log_type: 'event',
      params,
    }))
  } catch {
    // Analytics must never interrupt the user flow outside the Toss runtime.
  }
}

function safeAttributionValue(value: string | null) {
  const normalized = value?.trim() ?? ''
  return /^[A-Za-z0-9_-]{1,40}$/.test(normalized) ? normalized : null
}

function getReferralContext(): AnalyticsParams | null {
  if (typeof window === 'undefined') {
    return null
  }

  const searchParams = new URLSearchParams(window.location.search)
  const referrer = safeAttributionValue(
    searchParams.get('ref') ?? searchParams.get('referrer') ?? searchParams.get('utm_source'),
  )
  if (!referrer) {
    return null
  }

  const context: AnalyticsParams = { referrer }
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']) {
    const value = safeAttributionValue(searchParams.get(key))
    if (value) {
      context[key] = value
    }
  }
  return context
}

export function trackReferralLinkOpened() {
  const context = getReferralContext()
  if (!context || typeof window === 'undefined') {
    return
  }

  try {
    const dedupeKey = `${REFERRAL_STORAGE_KEY}:opened:${context.referrer}`
    if (window.sessionStorage.getItem(dedupeKey)) {
      return
    }
    window.sessionStorage.setItem(dedupeKey, '1')
  } catch {
    // Storage restrictions must never interrupt the user flow.
  }

  trackGrowthEvent('referral_link_opened', context)
}

export function trackReferralActivation(activation: string, params: AnalyticsParams = {}) {
  const context = getReferralContext()
  if (!context || typeof window === 'undefined') {
    return
  }

  try {
    if (window.sessionStorage.getItem(REFERRAL_STORAGE_KEY)) {
      return
    }
    window.sessionStorage.setItem(REFERRAL_STORAGE_KEY, '1')
  } catch {
    // Storage restrictions must never interrupt the user flow.
  }

  trackGrowthEvent('referral_user_activated', {
    ...context,
    activation,
    ...params,
  })
}

export function trackReturnVisits() {
  if (typeof window === 'undefined') {
    return
  }

  const now = Date.now()
  let retention: {
    first_seen_at: number
    d1_returned?: boolean
    d7_returned?: boolean
  }

  try {
    const stored = window.localStorage.getItem(RETENTION_STORAGE_KEY)
    retention = stored ? JSON.parse(stored) : { first_seen_at: now }
    if (!Number.isFinite(retention.first_seen_at)) {
      retention = { first_seen_at: now }
    }
  } catch {
    retention = { first_seen_at: now }
  }

  const elapsedDays = (now - retention.first_seen_at) / 86_400_000
  if (elapsedDays >= 1 && !retention.d1_returned) {
    trackGrowthEvent('d1_returned', { days_since_first_visit: Math.floor(elapsedDays) })
    retention.d1_returned = true
  }
  if (elapsedDays >= 7 && !retention.d7_returned) {
    trackGrowthEvent('d7_returned', { days_since_first_visit: Math.floor(elapsedDays) })
    retention.d7_returned = true
  }

  try {
    window.localStorage.setItem(RETENTION_STORAGE_KEY, JSON.stringify(retention))
  } catch {
    // Storage restrictions must never interrupt the user flow.
  }
}
