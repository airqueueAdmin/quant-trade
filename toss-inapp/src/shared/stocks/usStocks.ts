import type { KRXSearchResult, USSearchResult } from '../api/types'

export const POPULAR_US_STOCKS: USSearchResult[] = [
  { name: 'Apple', ticker: 'AAPL', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['애플'] },
  { name: 'NVIDIA', ticker: 'NVDA', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['엔비디아'] },
  { name: 'SK hynix ADR', ticker: 'SKHY', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['SK하이닉스', 'SK 하이닉스', '에스케이하이닉스', '하이닉스'] },
  { name: 'Microsoft', ticker: 'MSFT', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['마이크로소프트'] },
  { name: 'Tesla', ticker: 'TSLA', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['테슬라'] },
  { name: 'Amazon', ticker: 'AMZN', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['아마존'] },
  { name: 'Alphabet', ticker: 'GOOGL', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['알파벳', '구글'] },
  { name: 'Meta Platforms', ticker: 'META', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['메타', '페이스북'] },
  { name: 'Broadcom', ticker: 'AVGO', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['브로드컴'] },
  { name: 'Advanced Micro Devices', ticker: 'AMD', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['에이엠디'] },
  { name: 'Qualcomm', ticker: 'QCOM', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['퀄컴'] },
  { name: 'Micron Technology', ticker: 'MU', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['마이크론'] },
  { name: 'Arm Holdings', ticker: 'ARM', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['암홀딩스', 'ARM 홀딩스'] },
  { name: 'Taiwan Semiconductor', ticker: 'TSM', exchange: 'NYSE', quote_type: 'equity', currency: 'USD', aliases: ['TSMC', '대만반도체', '타이완반도체'] },
  { name: 'ASML Holding', ticker: 'ASML', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['에이에스엠엘'] },
  { name: 'Applied Materials', ticker: 'AMAT', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['어플라이드머티리얼즈'] },
  { name: 'Lam Research', ticker: 'LRCX', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['램리서치'] },
  { name: 'Palantir Technologies', ticker: 'PLTR', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['팔란티어'] },
  { name: 'Oracle', ticker: 'ORCL', exchange: 'NYSE', quote_type: 'equity', currency: 'USD', aliases: ['오라클'] },
  { name: 'Salesforce', ticker: 'CRM', exchange: 'NYSE', quote_type: 'equity', currency: 'USD', aliases: ['세일즈포스'] },
  { name: 'Adobe', ticker: 'ADBE', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['어도비'] },
  { name: 'ServiceNow', ticker: 'NOW', exchange: 'NYSE', quote_type: 'equity', currency: 'USD', aliases: ['서비스나우'] },
  { name: 'CrowdStrike', ticker: 'CRWD', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['크라우드스트라이크'] },
  { name: 'Palo Alto Networks', ticker: 'PANW', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['팔로알토', '팔로알토네트웍스'] },
  { name: 'Netflix', ticker: 'NFLX', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['넷플릭스'] },
]

export function usStockToCompany(stock: USSearchResult): KRXSearchResult {
  return {
    name: stock.name,
    ticker: stock.ticker,
    krx_exchange: 'auto',
    display_name: stock.display_name ?? `${stock.name} (${stock.ticker}, ${stock.exchange})`,
  }
}

export function searchLocalUsStocks(query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) {
    return []
  }

  return POPULAR_US_STOCKS
    .filter((stock) =>
      stock.ticker.toLowerCase().includes(normalized)
      || stock.name.toLowerCase().includes(normalized)
      || stock.aliases?.some((alias) => alias.toLowerCase().includes(normalized)),
    )
    .map(usStockToCompany)
}

export function mergeCompanyResults(primary: KRXSearchResult[], secondary: KRXSearchResult[], limit = 20) {
  const merged = new Map<string, KRXSearchResult>()
  for (const company of [...primary, ...secondary]) {
    merged.set(company.ticker, company)
  }
  return [...merged.values()].slice(0, limit)
}
