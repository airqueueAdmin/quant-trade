export type Market = 'us' | 'krx'
export type KrxExchange = 'auto' | 'kospi' | 'kosdaq'
export type OrderType = 'all_in' | 'fixed_amount'
export type StrategyMetric = 'sharpe_ratio' | 'total_return_pct' | 'cagr_pct' | 'sortino_ratio'
export type FeatureStatus = 'ready' | 'limited' | 'deferred'

export type AppFeatureStatus = {
  status: FeatureStatus
  summary: string
  available: boolean
}

export type AppConfig = {
  auth_mode: 'session_account' | 'demo_account_id'
  cors_allowed_origins: string[]
  features: {
    sector_flow: AppFeatureStatus
    ai_analysis: AppFeatureStatus
    paper_trading: AppFeatureStatus
    strategy_simulation: AppFeatureStatus
  }
}

export type SessionBootstrapResponse = {
  auth_mode: 'session_account'
  account_id: string
  session_token: string
}

export type KRXSearchResult = {
  ticker: string
  name: string
  krx_exchange: KrxExchange
  display_name?: string
}

export type QuoteSnapshot = {
  ticker: string
  resolved_ticker: string
  market: Market
  krx_exchange: KrxExchange
  company_name?: string | null
  as_of: string
  close: number
  previous_close: number
  change_amount: number
  change_pct: number
}

export type StockHistoryRow = {
  Date: string
  Open?: number
  High?: number
  Low?: number
  Close?: number
  Volume?: number
}

export type SentimentArticle = {
  title: string
  url: string
  published_at?: string
  source?: string
}

export type SentimentResult = {
  ticker: string
  resolved_ticker: string
  market: Market
  krx_exchange: KrxExchange
  company_name?: string | null
  sentiment_score: number
  summary: string
  articles: SentimentArticle[]
  attempted_queries?: unknown[]
  news_api_enabled?: boolean
}

export type ClosingBetEvaluation = {
  ticker: string
  resolved_ticker: string
  market: Market
  krx_exchange: KrxExchange
  company_name?: string | null
  signal_date: string
  quote: QuoteSnapshot
  sentiment: SentimentResult | null
  sector_snapshot: SectorSnapshot
  resolved_sector: SectorRow | null
  scores: {
    sector_strength: number
    close_strength: number
    volume_persistence: number
    leader_status: number
    news_follow_through: number
    tomorrow_catalyst: number
    risk_control: number
  }
  scenario: string
  scenario_modifier: number
  total_score: number
  score_label: string
  score_action: string
  risk_flags: string[]
}

export type SectorRow = {
  key: string
  name: string
  note: string
  proxy_type: 'etf' | 'basket'
  proxy_label: string
  components?: Array<{
    ticker: string
    name: string
    krx_exchange?: KrxExchange
  }>
  component_count: number
  as_of: string
  latest_level: number
  ma20_gap_pct?: number | null
  ma60_gap_pct?: number | null
  above_20dma: boolean
  above_60dma: boolean
  trend_score: number
  trend_label: string
  return_1d_pct?: number | null
  return_5d_pct?: number | null
  return_21d_pct?: number | null
  return_63d_pct?: number | null
}

export type SectorSnapshot = {
  market: Market
  market_name: string
  as_of: string
  summary: string
  leaders: SectorRow[]
  laggards: SectorRow[]
  sectors: SectorRow[]
}

export type PaperTradingHolding = {
  ticker: string
  company_name?: string | null
  krx_exchange: KrxExchange
  shares: number
  avg_price: number
  updated_at?: string | null
}

export type PaperTradingTrade = {
  id: string | number
  side: 'buy' | 'sell'
  ticker: string
  company_name?: string | null
  krx_exchange: KrxExchange
  price: number
  shares: number
  amount_krw: number
  traded_at: string
}

export type PaperTradingState = {
  account_id: string
  cash_krw: number
  seed_cash_krw: number
  holdings: PaperTradingHolding[]
  trades: PaperTradingTrade[]
  updated_at?: string | null
}

export type PaperTradingOrderRequest = {
  ticker: string
  company_name?: string
  krx_exchange?: KrxExchange
  side: 'buy' | 'sell'
  shares: number
}

export type ClosingBetNotificationChannel = 'email' | 'toss_inapp'

export type ClosingBetNotification = {
  id: number
  account_id: string
  ticker: string
  resolved_ticker?: string | null
  company_name?: string | null
  market: Market
  krx_exchange: KrxExchange
  channel: ClosingBetNotificationChannel
  destination: string
  threshold_score: number
  active: boolean
  last_score?: number | null
  last_signal_date?: string | null
  last_notified_at?: string | null
  last_evaluated_at?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export type ClosingBetNotificationUpsertRequest = {
  ticker: string
  market: Market
  krx_exchange: KrxExchange
  channel: ClosingBetNotificationChannel
  destination: string
  toss_user_key?: string
  threshold_score: number
  active: boolean
}

export type ClosingBetAlertEvent = {
  id: number
  notification_id?: number | null
  delivered_channel: ClosingBetNotificationChannel
  title: string
  message: string
  ticker: string
  market: Market
  signal_date?: string | null
  total_score?: number | null
  is_read: boolean
  created_at?: string | null
  read_at?: string | null
}

export type BaseBacktestRequest = {
  ticker: string
  market: Market
  krx_exchange: KrxExchange
  start_date: string
  end_date: string
  initial_capital: number
  order_type: OrderType
  fixed_amount?: number | null
}

export type MovingAverageBacktestRequest = BaseBacktestRequest & {
  short_window: number
  long_window: number
}

export type RSIBacktestRequest = BaseBacktestRequest & {
  window: number
  oversold_threshold: number
  overbought_threshold: number
}

export type BollingerBandsBacktestRequest = BaseBacktestRequest & {
  window: number
  num_std_dev: number
}

export type BaseOptimizationRequest = BaseBacktestRequest & {
  metric_to_optimize: StrategyMetric
}

export type BacktestTrade = {
  Date: string
  Type: 'BUY' | 'SELL'
  Price: number
  Shares: number
}

export type PortfolioHistoryPoint = {
  Date: string
  cash: number
  holdings_value: number
  total_value: number
}

export type MovingAverageOptimizationRequest = BaseOptimizationRequest & {
  short_window_range: [number, number, number]
  long_window_range: [number, number, number]
}

export type RSIOptimizationRequest = BaseOptimizationRequest & {
  window_range: [number, number, number]
  oversold_threshold_range: [number, number, number]
  overbought_threshold_range: [number, number, number]
}

export type BollingerBandsOptimizationRequest = BaseOptimizationRequest & {
  window_range: [number, number, number]
  num_std_dev_range: [number, number, number]
}

export type BacktestResult = {
  ticker: string
  resolved_ticker: string
  market: Market
  krx_exchange: KrxExchange
  strategy_params: Record<string, number>
  performance_metrics: Record<string, number>
  benchmark_metrics: Record<string, number>
  comparison_metrics: Record<string, number>
  portfolio_history: PortfolioHistoryPoint[]
  benchmark_history: PortfolioHistoryPoint[]
  trades: BacktestTrade[]
}

export type OptimizationResult = {
  ticker: string
  resolved_ticker: string
  market: Market
  krx_exchange: KrxExchange
  metric_optimized: StrategyMetric
  best_params: Record<string, number>
  best_metric_value: number
  all_optimization_results: Array<{
    params: Record<string, number>
    metrics: Record<string, number>
  }>
}
