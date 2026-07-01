import { apiRequest } from './http'
import type {
  AppConfig,
  BacktestResult,
  BollingerBandsBacktestRequest,
  BollingerBandsOptimizationRequest,
  KrxExchange,
  KRXSearchResult,
  Market,
  MovingAverageBacktestRequest,
  MovingAverageOptimizationRequest,
  OptimizationResult,
  PaperTradingOrderRequest,
  PaperTradingState,
  QuoteSnapshot,
  RSIBacktestRequest,
  RSIOptimizationRequest,
  SectorSnapshot,
  SessionBootstrapResponse,
  StockHistoryRow,
  SentimentResult,
} from './types'

export const apiClient = {
  health() {
    return apiRequest<{ status: string }>('/healthz')
  },

  appConfig(signal?: AbortSignal) {
    return apiRequest<AppConfig>('/app-config', { signal })
  },

  bootstrapSession(sessionToken?: string) {
    return apiRequest<SessionBootstrapResponse>('/session/bootstrap', {
      method: 'POST',
      headers: sessionToken ? { 'X-App-Session': sessionToken } : undefined,
    })
  },

  rotateSession() {
    return apiRequest<SessionBootstrapResponse>('/session/rotate', {
      method: 'POST',
    })
  },

  searchKrxStocks(query: string, limit = 20, signal?: AbortSignal) {
    return apiRequest<{ query: string; results: KRXSearchResult[] }>('/stocks/krx/search', {
      params: { q: query, limit },
      signal,
    })
  },

  usdKrwRate() {
    return apiRequest<{ rate: number; as_of: string; source: string }>('/fx/usdkrw')
  },

  marketSectors(market: Market, signal?: AbortSignal) {
    return apiRequest<SectorSnapshot>('/market/sectors', {
      params: { market },
      signal,
    })
  },

  quote(
    ticker: string,
    market: Market,
    krxExchange: KrxExchange = 'auto',
    signal?: AbortSignal,
  ) {
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
    return apiRequest<SentimentResult>(`/sentiment/${encodeURIComponent(ticker)}`, {
      params: { market, krx_exchange: krxExchange },
      signal,
    })
  },

  paperTradingState(sessionToken: string, signal?: AbortSignal) {
    return apiRequest<PaperTradingState>('/paper-trading/state', {
      headers: { 'X-App-Session': sessionToken },
      signal,
    })
  },

  paperTradingOrder(sessionToken: string, payload: PaperTradingOrderRequest) {
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
    return apiRequest<{
      account_id: string
      result: unknown
    }>('/paper-trading/reset', {
      method: 'POST',
      body: {},
      headers: { 'X-App-Session': sessionToken },
    })
  },

  movingAverageBacktest(payload: MovingAverageBacktestRequest) {
    return apiRequest<BacktestResult>('/backtest/moving_average', {
      method: 'POST',
      body: payload,
    })
  },

  rsiBacktest(payload: RSIBacktestRequest) {
    return apiRequest<BacktestResult>('/backtest/rsi', {
      method: 'POST',
      body: payload,
    })
  },

  bollingerBandsBacktest(payload: BollingerBandsBacktestRequest) {
    return apiRequest<BacktestResult>('/backtest/bollinger_bands', {
      method: 'POST',
      body: payload,
    })
  },

  movingAverageOptimize(payload: MovingAverageOptimizationRequest) {
    return apiRequest<OptimizationResult>('/optimize/moving_average', {
      method: 'POST',
      body: payload,
    })
  },

  rsiOptimize(payload: RSIOptimizationRequest) {
    return apiRequest<OptimizationResult>('/optimize/rsi', {
      method: 'POST',
      body: payload,
    })
  },

  bollingerBandsOptimize(payload: BollingerBandsOptimizationRequest) {
    return apiRequest<OptimizationResult>('/optimize/bollinger_bands', {
      method: 'POST',
      body: payload,
    })
  },
}
