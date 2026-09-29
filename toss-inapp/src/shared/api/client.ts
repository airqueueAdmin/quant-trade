import { apiRequest } from './http'
import { env } from '../config/env'
import type {
  AppConfig,
  BacktestResult,
  BollingerBandsBacktestRequest,
  BollingerBandsOptimizationRequest,
  ClosingBetAlertEvent,
  ClosingBetEvaluation,
  ClosingBetNotification,
  ClosingBetNotificationUpsertRequest,
  KrxExchange,
  KRXSearchResult,
  Market,
  MarketMoversSnapshot,
  MovingAverageBacktestRequest,
  MovingAverageOptimizationRequest,
  OptimizationResult,
  PaperTradingOrderRequest,
  PaperTradingRankingResponse,
  PaperTradingRankingSort,
  PaperTradingState,
  QuoteSnapshot,
  RSIBacktestRequest,
  RSIOptimizationRequest,
  SectorSnapshot,
  SessionBootstrapResponse,
  StockHistoryRow,
  SentimentResult,
  TossLoginUserKeyResponse,
  USSearchResult,
} from './types'

export const apiClient = {
  health() {
    return apiRequest<{ status: string }>(env.edgeHealthUrl ? '' : '/healthz', {
      baseUrl: env.edgeHealthUrl || undefined,
    })
  },

  appConfig(signal?: AbortSignal) {
    return apiRequest<AppConfig>(env.edgeAppConfigUrl ? '' : '/app-config', {
      signal,
      baseUrl: env.edgeAppConfigUrl || undefined,
    })
  },

  tossLoginUserKey(payload: {
    authorization_code: string
    referrer?: 'DEFAULT' | 'SANDBOX'
  }, sessionToken?: string) {
    if (env.edgeTossLoginUrl) {
      return apiRequest<TossLoginUserKeyResponse>('', {
        method: 'POST',
        body: payload,
        headers: sessionToken ? { 'X-App-Session': sessionToken } : undefined,
        baseUrl: env.edgeTossLoginUrl,
      })
    }

    return apiRequest<TossLoginUserKeyResponse>('/toss-login/user-key', {
      method: 'POST',
      body: payload,
      headers: sessionToken ? { 'X-App-Session': sessionToken } : undefined,
    })
  },

  bootstrapSession(sessionToken?: string) {
    if (env.edgeSessionUrl) {
      return apiRequest<SessionBootstrapResponse>('', {
        method: 'POST',
        params: { action: 'bootstrap' },
        headers: sessionToken ? { 'X-App-Session': sessionToken } : undefined,
        baseUrl: env.edgeSessionUrl,
      })
    }

    return apiRequest<SessionBootstrapResponse>('/session/bootstrap', {
      method: 'POST',
      headers: sessionToken ? { 'X-App-Session': sessionToken } : undefined,
    })
  },

  tossUserSession(anonymousKey: string) {
    if (env.edgeSessionUrl) {
      return apiRequest<SessionBootstrapResponse>('', {
        method: 'POST',
        params: { action: 'toss-user' },
        body: { anonymous_key: anonymousKey },
        baseUrl: env.edgeSessionUrl,
      })
    }

    return apiRequest<SessionBootstrapResponse>('/session/toss-user', {
      method: 'POST',
      body: { anonymous_key: anonymousKey },
    })
  },

  rotateSession() {
    if (env.edgeSessionUrl) {
      return apiRequest<SessionBootstrapResponse>('', {
        method: 'POST',
        params: { action: 'rotate' },
        baseUrl: env.edgeSessionUrl,
      })
    }

    return apiRequest<SessionBootstrapResponse>('/session/rotate', {
      method: 'POST',
    })
  },

  searchKrxStocks(query: string, limit = 20, signal?: AbortSignal) {
    if (env.edgeSearchUrl) {
      return apiRequest<{ query: string; results: KRXSearchResult[] }>('', {
        params: { q: query, limit, market: 'krx' },
        signal,
        baseUrl: env.edgeSearchUrl,
      })
    }

    return apiRequest<{ query: string; results: KRXSearchResult[] }>('/stocks/krx/search', {
      params: { q: query, limit },
      signal,
    })
  },

  searchUsStocks(query: string, limit = 20, signal?: AbortSignal) {
    if (env.edgeSearchUrl) {
      return apiRequest<{ query: string; results: USSearchResult[] }>('', {
        params: { q: query, limit, market: 'us' },
        signal,
        baseUrl: env.edgeSearchUrl,
      })
    }

    return apiRequest<{ query: string; results: USSearchResult[] }>('/stocks/us/search', {
      params: { q: query, limit },
      signal,
    })
  },

  usdKrwRate() {
    if (env.edgeUsdKrwUrl) {
      return apiRequest<{ rate: number; as_of: string; source: string }>('', {
        baseUrl: env.edgeUsdKrwUrl,
      })
    }

    return apiRequest<{ rate: number; as_of: string; source: string }>('/fx/usdkrw')
  },

  marketSectors(market: Market, signal?: AbortSignal) {
    if (env.edgeSectorUrl) {
      return apiRequest<SectorSnapshot>('', {
        params: { market },
        signal,
        baseUrl: env.edgeSectorUrl,
      })
    }

    return apiRequest<SectorSnapshot>('/market/sectors', {
      params: { market },
      signal,
    })
  },

  marketMovers(market: Market, limit = 10, signal?: AbortSignal) {
    if (env.edgeMarketMoversUrl) {
      return apiRequest<MarketMoversSnapshot>('', {
        params: { market, limit },
        signal,
        baseUrl: env.edgeMarketMoversUrl,
      })
    }

    return apiRequest<MarketMoversSnapshot>('/market/movers', {
      params: { market, limit },
      signal,
    })
  },

  quote(
    ticker: string,
    market: Market,
    krxExchange: KrxExchange = 'auto',
    signal?: AbortSignal,
  ) {
    if (env.edgeQuoteUrl) {
      return apiRequest<QuoteSnapshot>('', {
        params: { ticker, market, krx_exchange: krxExchange },
        signal,
        baseUrl: env.edgeQuoteUrl,
      })
    }

    return apiRequest<QuoteSnapshot>(`/quote/${encodeURIComponent(ticker)}`, {
      params: { market, krx_exchange: krxExchange },
      signal,
    })
  },

  stockData(
    ticker: string,
    startDate: string,
    endDate: string,
    market: Market,
    krxExchange: KrxExchange = 'auto',
    signal?: AbortSignal,
  ) {
    if (env.edgeStockUrl) {
      return apiRequest<{
        ticker: string
        resolved_ticker: string
        market: Market
        krx_exchange: KrxExchange
        rows: StockHistoryRow[]
      }>('', {
        params: {
          ticker,
          start_date: startDate,
          end_date: endDate,
          market,
          krx_exchange: krxExchange,
        },
        signal,
        baseUrl: env.edgeStockUrl,
      })
    }

    return apiRequest<{
      ticker: string
      resolved_ticker: string
      market: Market
      krx_exchange: KrxExchange
      rows: StockHistoryRow[]
    }>(`/stock/${encodeURIComponent(ticker)}`, {
      params: {
        start_date: startDate,
        end_date: endDate,
        market,
        krx_exchange: krxExchange,
      },
      signal,
    })
  },

  sentiment(
    ticker: string,
    market: Market,
    krxExchange: KrxExchange = 'auto',
    signal?: AbortSignal,
  ) {
    if (env.edgeSentimentUrl) {
      return apiRequest<SentimentResult>('', {
        params: { ticker, market, krx_exchange: krxExchange },
        signal,
        baseUrl: env.edgeSentimentUrl,
      })
    }

    return apiRequest<SentimentResult>(`/sentiment/${encodeURIComponent(ticker)}`, {
      params: { market, krx_exchange: krxExchange },
      signal,
    })
  },

  todaySentiment(
    ticker: string,
    market: Market,
    krxExchange: KrxExchange = 'auto',
    signal?: AbortSignal,
  ) {
    if (env.edgeSentimentUrl) {
      return apiRequest<SentimentResult>('', {
        params: {
          ticker,
          market,
          krx_exchange: krxExchange,
          period_days: 1,
          source_filter: 'exclude_press_release',
          today_only: true,
        },
        signal,
        baseUrl: env.edgeSentimentUrl,
      })
    }

    return apiRequest<SentimentResult>(`/sentiment/${encodeURIComponent(ticker)}`, {
      params: {
        market,
        krx_exchange: krxExchange,
        period_days: 1,
        source_filter: 'exclude_press_release',
        today_only: true,
      },
      signal,
    })
  },

  paperTradingState(sessionToken: string, signal?: AbortSignal) {
    if (env.edgePaperTradingUrl) {
      return apiRequest<PaperTradingState>('', {
        params: { action: 'state' },
        headers: { 'X-App-Session': sessionToken },
        signal,
        baseUrl: env.edgePaperTradingUrl,
      })
    }

    return apiRequest<PaperTradingState>('/paper-trading/state', {
      headers: { 'X-App-Session': sessionToken },
      signal,
    })
  },

  paperTradingRankings(
    sessionToken: string,
    sortBy: PaperTradingRankingSort = 'return',
    signal?: AbortSignal,
  ) {
    if (env.edgePaperTradingUrl) {
      return apiRequest<PaperTradingRankingResponse>('', {
        params: { action: 'rankings', sort_by: sortBy, limit: 50 },
        headers: { 'X-App-Session': sessionToken },
        signal,
        baseUrl: env.edgePaperTradingUrl,
      })
    }

    return apiRequest<PaperTradingRankingResponse>('/paper-trading/rankings', {
      params: { sort_by: sortBy, limit: 50 },
      headers: { 'X-App-Session': sessionToken },
      signal,
    })
  },

  paperTradingOrder(sessionToken: string, payload: PaperTradingOrderRequest) {
    if (env.edgePaperTradingUrl) {
      return apiRequest<{
        quote: QuoteSnapshot
        result: unknown
      }>('', {
        method: 'POST',
        params: { action: 'order' },
        body: payload,
        headers: { 'X-App-Session': sessionToken },
        baseUrl: env.edgePaperTradingUrl,
      })
    }

    return apiRequest<{
      quote: QuoteSnapshot
      result: unknown
    }>('/paper-trading/order', {
      method: 'POST',
      body: payload,
      headers: { 'X-App-Session': sessionToken },
    })
  },

  paperTradingReset(sessionToken: string) {
    if (env.edgePaperTradingUrl) {
      return apiRequest<{
        account_id: string
        result: unknown
      }>('', {
        method: 'POST',
        params: { action: 'reset' },
        body: {},
        headers: { 'X-App-Session': sessionToken },
        baseUrl: env.edgePaperTradingUrl,
      })
    }

    return apiRequest<{
      account_id: string
      result: unknown
    }>('/paper-trading/reset', {
      method: 'POST',
      body: {},
      headers: { 'X-App-Session': sessionToken },
    })
  },

  closingBetEvaluate(payload: { ticker: string; market: Market; krx_exchange: KrxExchange }) {
    if (env.edgeClosingBetUrl) {
      return apiRequest<ClosingBetEvaluation>('', {
        method: 'POST',
        body: payload,
        baseUrl: env.edgeClosingBetUrl,
      })
    }

    return apiRequest<ClosingBetEvaluation>('/closing-bet/evaluate', {
      method: 'POST',
      body: payload,
    })
  },

  closingBetNotifications(sessionToken: string, signal?: AbortSignal) {
    if (env.edgeClosingBetNotificationsUrl) {
      return apiRequest<{ items: ClosingBetNotification[] }>('', {
        params: { action: 'notifications' },
        headers: { 'X-App-Session': sessionToken },
        signal,
        baseUrl: env.edgeClosingBetNotificationsUrl,
      })
    }

    return apiRequest<{ items: ClosingBetNotification[] }>('/closing-bet/notifications', {
      headers: { 'X-App-Session': sessionToken },
      signal,
    })
  },

  closingBetAlerts(sessionToken: string, signal?: AbortSignal) {
    if (env.edgeClosingBetNotificationsUrl) {
      return apiRequest<{ items: ClosingBetAlertEvent[] }>('', {
        params: { action: 'alerts' },
        headers: { 'X-App-Session': sessionToken },
        signal,
        baseUrl: env.edgeClosingBetNotificationsUrl,
      })
    }

    return apiRequest<{ items: ClosingBetAlertEvent[] }>('/closing-bet/alerts', {
      headers: { 'X-App-Session': sessionToken },
      signal,
    })
  },

  closingBetNotificationUpsert(sessionToken: string, payload: ClosingBetNotificationUpsertRequest) {
    if (env.edgeClosingBetNotificationsUrl) {
      return apiRequest<{ subscription: ClosingBetNotification; evaluation: ClosingBetEvaluation }>('', {
        method: 'POST',
        params: { action: 'notifications' },
        body: payload,
        headers: { 'X-App-Session': sessionToken },
        baseUrl: env.edgeClosingBetNotificationsUrl,
      })
    }

    return apiRequest<{ subscription: ClosingBetNotification; evaluation: ClosingBetEvaluation }>('/closing-bet/notifications', {
      method: 'POST',
      body: payload,
      headers: { 'X-App-Session': sessionToken },
    })
  },

  closingBetNotificationDelete(sessionToken: string, notificationId: number) {
    if (env.edgeClosingBetNotificationsUrl) {
      return apiRequest<{ deleted: boolean; id: number }>('', {
        method: 'DELETE',
        params: { action: 'notifications', id: notificationId },
        headers: { 'X-App-Session': sessionToken },
        baseUrl: env.edgeClosingBetNotificationsUrl,
      })
    }

    return apiRequest<{ deleted: boolean; id: number }>(`/closing-bet/notifications/${notificationId}`, {
      method: 'DELETE',
      headers: { 'X-App-Session': sessionToken },
    })
  },

  closingBetAlertMarkRead(sessionToken: string, alertId: number) {
    if (env.edgeClosingBetNotificationsUrl) {
      return apiRequest<{ item: ClosingBetAlertEvent }>('', {
        method: 'POST',
        params: { action: 'alerts-read', id: alertId },
        headers: { 'X-App-Session': sessionToken },
        baseUrl: env.edgeClosingBetNotificationsUrl,
      })
    }

    return apiRequest<{ item: ClosingBetAlertEvent }>(`/closing-bet/alerts/${alertId}/read`, {
      method: 'POST',
      headers: { 'X-App-Session': sessionToken },
    })
  },

  closingBetNotificationTest(payload: {
    channel: 'email' | 'toss_inapp'
    destination: string
    toss_user_key?: string
    deployment_id?: string
    ticker: string
    market: Market
  }, sessionToken?: string) {
    return apiRequest<{ sent: boolean; channel: string; destination: string }>('/closing-bet/notifications/test', {
      method: 'POST',
      body: payload,
      headers: sessionToken ? { 'X-App-Session': sessionToken } : undefined,
    })
  },

  movingAverageBacktest(payload: MovingAverageBacktestRequest) {
    if (env.edgeStrategySimulationUrl) {
      return apiRequest<BacktestResult>('', {
        method: 'POST',
        params: { action: 'backtest', strategy: 'moving_average' },
        body: payload,
        baseUrl: env.edgeStrategySimulationUrl,
      })
    }
    return apiRequest<BacktestResult>('/backtest/moving_average', {
      method: 'POST',
      body: payload,
    })
  },

  rsiBacktest(payload: RSIBacktestRequest) {
    if (env.edgeStrategySimulationUrl) {
      return apiRequest<BacktestResult>('', {
        method: 'POST',
        params: { action: 'backtest', strategy: 'rsi' },
        body: payload,
        baseUrl: env.edgeStrategySimulationUrl,
      })
    }
    return apiRequest<BacktestResult>('/backtest/rsi', {
      method: 'POST',
      body: payload,
    })
  },

  bollingerBandsBacktest(payload: BollingerBandsBacktestRequest) {
    if (env.edgeStrategySimulationUrl) {
      return apiRequest<BacktestResult>('', {
        method: 'POST',
        params: { action: 'backtest', strategy: 'bollinger_bands' },
        body: payload,
        baseUrl: env.edgeStrategySimulationUrl,
      })
    }
    return apiRequest<BacktestResult>('/backtest/bollinger_bands', {
      method: 'POST',
      body: payload,
    })
  },

  movingAverageOptimize(payload: MovingAverageOptimizationRequest) {
    if (env.edgeStrategySimulationUrl) {
      return apiRequest<OptimizationResult>('', {
        method: 'POST',
        params: { action: 'optimize', strategy: 'moving_average' },
        body: payload,
        baseUrl: env.edgeStrategySimulationUrl,
      })
    }
    return apiRequest<OptimizationResult>('/optimize/moving_average', {
      method: 'POST',
      body: payload,
    })
  },

  rsiOptimize(payload: RSIOptimizationRequest) {
    if (env.edgeStrategySimulationUrl) {
      return apiRequest<OptimizationResult>('', {
        method: 'POST',
        params: { action: 'optimize', strategy: 'rsi' },
        body: payload,
        baseUrl: env.edgeStrategySimulationUrl,
      })
    }
    return apiRequest<OptimizationResult>('/optimize/rsi', {
      method: 'POST',
      body: payload,
    })
  },

  bollingerBandsOptimize(payload: BollingerBandsOptimizationRequest) {
    if (env.edgeStrategySimulationUrl) {
      return apiRequest<OptimizationResult>('', {
        method: 'POST',
        params: { action: 'optimize', strategy: 'bollinger_bands' },
        body: payload,
        baseUrl: env.edgeStrategySimulationUrl,
      })
    }
    return apiRequest<OptimizationResult>('/optimize/bollinger_bands', {
      method: 'POST',
      body: payload,
    })
  },
}
