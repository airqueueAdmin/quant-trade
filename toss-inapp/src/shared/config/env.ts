const fallbackBackendUrl = 'http://127.0.0.1:8000'

function readConfiguredValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function readAdGroupId(value: unknown) {
  const adGroupId = readConfiguredValue(value)

  // Test ad groups must never be embedded in a mini-app bundle. When no
  // console-issued ID is configured, the ad feature stays disabled.
  return /(?:^|[-_.])test(?:[-_.]|$)/i.test(adGroupId) ? '' : adGroupId
}

function readConsoleIdentifier(value: unknown) {
  const identifier = readConfiguredValue(value)

  // Do not activate a test or placeholder promotion module in any build.
  return /(?:^|[-_.])test(?:[-_.]|$)|replace[-_ ]?with/i.test(identifier)
    ? ''
    : identifier
}

const configuredInterstitialAdGroupId = (
  readAdGroupId(import.meta.env.VITE_INTERSTITIAL_AD_GROUP_ID)
)

const configuredRewardedAdGroupId = (
  readAdGroupId(import.meta.env.VITE_REWARDED_AD_GROUP_ID)
)

const configuredBannerAdGroupId = (
  readAdGroupId(import.meta.env.VITE_BANNER_AD_GROUP_ID)
)

const configuredContactsViralModuleId = (
  readConsoleIdentifier(import.meta.env.VITE_CONTACTS_VIRAL_MODULE_ID)
)

export const env = {
  backendUrl: (import.meta.env.VITE_BACKEND_URL || fallbackBackendUrl).trim(),
  // Optional migration target. When configured, the lightweight health check
  // bypasses the legacy FastAPI service while all other routes keep using it.
  edgeHealthUrl: readConfiguredValue(import.meta.env.VITE_EDGE_HEALTH_URL),
  // Optional Phase 2 migration target. Leave empty until the Edge Function
  // has the same production secrets and feature flags as FastAPI.
  edgeAppConfigUrl: readConfiguredValue(import.meta.env.VITE_EDGE_APP_CONFIG_URL),
  // Optional Phase 3 migration target for quote reads.
  edgeQuoteUrl: readConfiguredValue(import.meta.env.VITE_EDGE_QUOTE_URL),
  // Optional Phase 3 migration target for historical stock reads.
  edgeStockUrl: readConfiguredValue(import.meta.env.VITE_EDGE_STOCK_URL),
  // Optional Phase 3 migration target for news sentiment reads.
  edgeSentimentUrl: readConfiguredValue(import.meta.env.VITE_EDGE_SENTIMENT_URL),
  // Optional Phase 3 migration target for sector snapshots.
  edgeSectorUrl: readConfiguredValue(import.meta.env.VITE_EDGE_SECTOR_URL),
  // Optional Phase 4 migration target for stock search.
  edgeSearchUrl: readConfiguredValue(import.meta.env.VITE_EDGE_SEARCH_URL),
  // Optional Phase 4 migration target for session issuance.
  edgeSessionUrl: readConfiguredValue(import.meta.env.VITE_EDGE_SESSION_URL),
  // Optional Phase 5 migration target for paper-trading state.
  edgePaperTradingUrl: readConfiguredValue(import.meta.env.VITE_EDGE_PAPER_TRADING_URL),
  // Optional Phase 5 migration target for the closing-bet evaluator.
  edgeClosingBetUrl: readConfiguredValue(import.meta.env.VITE_EDGE_CLOSING_BET_URL),
  // Optional migration target for market movers.
  edgeMarketMoversUrl: readConfiguredValue(import.meta.env.VITE_EDGE_MARKET_MOVERS_URL),
  // Optional migration target for closing-bet notification storage.
  edgeClosingBetNotificationsUrl: readConfiguredValue(import.meta.env.VITE_EDGE_CLOSING_BET_NOTIFICATIONS_URL),
  // Optional migration target for USD/KRW exchange rates.
  edgeUsdKrwUrl: readConfiguredValue(import.meta.env.VITE_EDGE_USDKRW_URL),
  // Optional migration target for Toss login user-key exchange.
  edgeTossLoginUrl: readConfiguredValue(import.meta.env.VITE_EDGE_TOSS_LOGIN_URL),
  // Optional migration target for strategy backtests and optimization.
  edgeStrategySimulationUrl: readConfiguredValue(import.meta.env.VITE_EDGE_STRATEGY_SIMULATION_URL),
  ads: {
    interstitialAdGroupId: configuredInterstitialAdGroupId,
    rewardedAdGroupId: configuredRewardedAdGroupId,
    bannerAdGroupId: configuredBannerAdGroupId,
  },
  rewards: {
    contactsViralModuleId: configuredContactsViralModuleId,
  },
}
