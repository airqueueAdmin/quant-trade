import type { Market, MarketMoversSnapshot } from '../api/types'

const STORAGE_KEY_PREFIX = 'quant.toss_inapp.market_movers'
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1_000

type StoredMarketMovers = {
  savedAt: number
  snapshot: MarketMoversSnapshot
}

function storageKey(market: Market) {
  return `${STORAGE_KEY_PREFIX}.${market}`
}

function markAsStoredSnapshot(snapshot: MarketMoversSnapshot): MarketMoversSnapshot {
  const status = snapshot.snapshot_status.includes('이전 데이터')
    ? snapshot.snapshot_status
    : `${snapshot.snapshot_status} · 이전 데이터`
  return { ...snapshot, is_stale: true, snapshot_status: status }
}

export function readStoredMarketMovers(market: Market): MarketMoversSnapshot | null {
  if (typeof window === 'undefined') return null

  const raw = window.localStorage.getItem(storageKey(market))
  if (!raw) return null

  try {
    const stored = JSON.parse(raw) as StoredMarketMovers
    if (
      !Number.isFinite(stored.savedAt)
      || Date.now() - stored.savedAt >= MAX_CACHE_AGE_MS
      || stored.snapshot?.market !== market
      || !Array.isArray(stored.snapshot.gainers)
      || !Array.isArray(stored.snapshot.losers)
    ) {
      window.localStorage.removeItem(storageKey(market))
      return null
    }
    return markAsStoredSnapshot(stored.snapshot)
  } catch {
    window.localStorage.removeItem(storageKey(market))
    return null
  }
}

export function storeMarketMovers(snapshot: MarketMoversSnapshot) {
  if (typeof window === 'undefined' || snapshot.is_stale) return
  const stored: StoredMarketMovers = { savedAt: Date.now(), snapshot }
  window.localStorage.setItem(storageKey(snapshot.market), JSON.stringify(stored))
}
