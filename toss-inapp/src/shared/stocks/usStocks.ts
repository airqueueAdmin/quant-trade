import type { KRXSearchResult, USSearchResult } from '../api/types'

export const POPULAR_US_STOCKS: USSearchResult[] = [
  { name: 'Apple', ticker: 'AAPL', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['애플'] },
  { name: 'NVIDIA', ticker: 'NVDA', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['엔비디아'] },
  { name: 'Microsoft', ticker: 'MSFT', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['마이크로소프트'] },
  { name: 'Tesla', ticker: 'TSLA', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['테슬라'] },
  { name: 'Amazon', ticker: 'AMZN', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['아마존'] },
  { name: 'Alphabet', ticker: 'GOOGL', exchange: 'NASDAQ', quote_type: 'equity', currency: 'USD', aliases: ['알파벳', '구글'] },
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
      || stock.aliases?.some((alias) => alias.includes(normalized)),
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
