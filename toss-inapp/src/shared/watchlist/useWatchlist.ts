import { useEffect, useState } from 'react'

import type { KrxExchange, Market } from '../api/types'

const WATCHLIST_STORAGE_KEY = 'quant.toss_inapp.watchlist'
const WATCHLIST_UPDATED_EVENT = 'quant:watchlist-updated'
const WATCHLIST_LIMIT = 20

export type WatchlistItem = {
  id: string
  market: Extract<Market, 'krx' | 'us'>
  ticker: string
  name: string
  krxExchange: KrxExchange
  createdAt: string
}

export type WatchlistItemInput = Omit<WatchlistItem, 'id' | 'createdAt'>

function normalizeInput(item: WatchlistItemInput): WatchlistItem {
  const ticker = item.market === 'us' ? item.ticker.trim().toUpperCase() : item.ticker.trim()
  const name = item.name.trim() || ticker
  return {
    ...item,
    id: `${item.market}:${ticker}`,
    ticker,
    name,
    krxExchange: item.market === 'krx' ? item.krxExchange : 'auto',
    createdAt: new Date().toISOString(),
  }
}

function isWatchlistItem(value: unknown): value is WatchlistItem {
  if (!value || typeof value !== 'object') {
    return false
  }
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string'
    && (item.market === 'krx' || item.market === 'us')
    && typeof item.ticker === 'string'
    && typeof item.name === 'string'
    && (item.krxExchange === 'auto' || item.krxExchange === 'kospi' || item.krxExchange === 'kosdaq')
    && typeof item.createdAt === 'string'
  )
}

function readWatchlist(): WatchlistItem[] {
  if (typeof window === 'undefined') {
    return []
  }
  const raw = window.localStorage.getItem(WATCHLIST_STORAGE_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter(isWatchlistItem).slice(0, WATCHLIST_LIMIT) : []
  } catch {
    return []
  }
}

function persistWatchlist(items: WatchlistItem[]) {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(items))
  window.dispatchEvent(new Event(WATCHLIST_UPDATED_EVENT))
}

export function useWatchlist() {
  const [items, setItems] = useState<WatchlistItem[]>(readWatchlist)

  useEffect(() => {
    const handleUpdate = () => setItems(readWatchlist())
    window.addEventListener('storage', handleUpdate)
    window.addEventListener(WATCHLIST_UPDATED_EVENT, handleUpdate)
    return () => {
      window.removeEventListener('storage', handleUpdate)
      window.removeEventListener(WATCHLIST_UPDATED_EVENT, handleUpdate)
    }
  }, [])

  function addItem(input: WatchlistItemInput) {
    const nextItem = normalizeInput(input)
    const current = readWatchlist()
    if (current.some((item) => item.id === nextItem.id)) {
      return false
    }
    persistWatchlist([nextItem, ...current].slice(0, WATCHLIST_LIMIT))
    return true
  }

  function removeItem(id: string) {
    persistWatchlist(readWatchlist().filter((item) => item.id !== id))
  }

  return { items, addItem, removeItem, limit: WATCHLIST_LIMIT }
}
