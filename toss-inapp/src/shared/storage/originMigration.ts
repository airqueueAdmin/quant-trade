import { Migration } from '@apps-in-toss/web-framework'

const MIGRATION_VERSION = 'quant.toss_inapp.origin_migration.v1'
const WATCHLIST_KEY = 'quant.toss_inapp.watchlist'
const DAILY_ROUTINE_KEY = 'quant.toss_inapp.daily_routine'
const RETENTION_KEY = 'quant.toss_inapp.retention'
const REWARDS_KEY = 'quant.toss_inapp.ad_free_analysis_rewards'
const MARKET_MOVERS_PREFIX = 'quant.toss_inapp.market_movers.'
const SESSION_KEY = 'quant.toss_inapp.app_session'
const MAX_WATCHLIST_ITEMS = 20
const MAX_ROUTINE_DAYS = 35
const MIGRATION_TIMEOUT_MS = 5_000

type StorageDump = {
  origin: string
  localStorage: Record<string, string | null>
}

type MigrationResult = {
  previous: StorageDump
  current: StorageDump
}

function hasTossBridge() {
  if (typeof window === 'undefined') {
    return false
  }

  return '__appsInTossConstants' in window
}

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function stringify(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

function mergeWatchlist(currentValue: string | null, previousValue: string | null) {
  const current = parseJson<unknown[]>(currentValue)
  const previous = parseJson<unknown[]>(previousValue)
  if (!Array.isArray(current) || !Array.isArray(previous)) {
    return currentValue ?? previousValue
  }

  const merged = [...current]
  const ids = new Set(
    current
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => item.id)
      .filter((id): id is string => typeof id === 'string'),
  )

  for (const item of previous) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const id = (item as Record<string, unknown>).id
    if (typeof id !== 'string' || ids.has(id)) {
      continue
    }
    ids.add(id)
    merged.push(item)
  }

  return stringify(merged.slice(0, MAX_WATCHLIST_ITEMS)) ?? currentValue
}

function mergeDailyRoutine(currentValue: string | null, previousValue: string | null) {
  const current = parseJson<Record<string, unknown>>(currentValue)
  const previous = parseJson<Record<string, unknown>>(previousValue)
  if (!current || !previous || Array.isArray(current) || Array.isArray(previous)) {
    return currentValue ?? previousValue
  }

  const merged: Record<string, string[]> = {}
  for (const [date, paths] of Object.entries(previous)) {
    if (Array.isArray(paths)) {
      merged[date] = paths.filter((path): path is string => typeof path === 'string')
    }
  }
  for (const [date, paths] of Object.entries(current)) {
    if (!Array.isArray(paths)) {
      continue
    }
    merged[date] = Array.from(new Set([
      ...(merged[date] ?? []),
      ...paths.filter((path): path is string => typeof path === 'string'),
    ]))
  }

  return stringify(
    Object.fromEntries(
      Object.entries(merged)
        .sort(([left], [right]) => right.localeCompare(left))
        .slice(0, MAX_ROUTINE_DAYS),
    ),
  ) ?? currentValue
}

function mergeRetention(currentValue: string | null, previousValue: string | null) {
  const current = parseJson<Record<string, unknown>>(currentValue)
  const previous = parseJson<Record<string, unknown>>(previousValue)
  if (!current || !previous || Array.isArray(current) || Array.isArray(previous)) {
    return currentValue ?? previousValue
  }

  const currentFirstSeen = typeof current.first_seen_at === 'number' ? current.first_seen_at : Infinity
  const previousFirstSeen = typeof previous.first_seen_at === 'number' ? previous.first_seen_at : Infinity
  const firstSeen = Math.min(currentFirstSeen, previousFirstSeen)
  if (!Number.isFinite(firstSeen)) {
    return currentValue ?? previousValue
  }

  return stringify({
    first_seen_at: firstSeen,
    d1_returned: current.d1_returned === true || previous.d1_returned === true,
    d7_returned: current.d7_returned === true || previous.d7_returned === true,
  }) ?? currentValue
}

function mergeRewards(currentValue: string | null, previousValue: string | null) {
  const current = parseJson<Record<string, unknown>>(currentValue)
  const previous = parseJson<Record<string, unknown>>(previousValue)
  if (!current || !previous || Array.isArray(current) || Array.isArray(previous)) {
    return currentValue ?? previousValue
  }

  const currentBalance = typeof current.balance === 'number' && Number.isSafeInteger(current.balance)
    ? Math.max(0, current.balance)
    : 0
  const previousBalance = typeof previous.balance === 'number' && Number.isSafeInteger(previous.balance)
    ? Math.max(0, previous.balance)
    : 0

  return stringify({
    balance: currentBalance + previousBalance,
    attendanceRewardGranted: current.attendanceRewardGranted === true
      || previous.attendanceRewardGranted === true,
  }) ?? currentValue
}

function mergeMarketCache(currentValue: string | null, previousValue: string | null) {
  const current = parseJson<{ savedAt?: unknown }>(currentValue)
  const previous = parseJson<{ savedAt?: unknown }>(previousValue)
  if (!current || !previous) {
    return currentValue ?? previousValue
  }

  const currentSavedAt = typeof current.savedAt === 'number' ? current.savedAt : 0
  const previousSavedAt = typeof previous.savedAt === 'number' ? previous.savedAt : 0
  return currentSavedAt >= previousSavedAt ? currentValue : previousValue
}

function mergeValue(key: string, currentValue: string | null, previousValue: string | null) {
  if (key === WATCHLIST_KEY) {
    return mergeWatchlist(currentValue, previousValue)
  }
  if (key === DAILY_ROUTINE_KEY) {
    return mergeDailyRoutine(currentValue, previousValue)
  }
  if (key === RETENTION_KEY) {
    return mergeRetention(currentValue, previousValue)
  }
  if (key === REWARDS_KEY) {
    return mergeRewards(currentValue, previousValue)
  }
  if (key.startsWith(MARKET_MOVERS_PREFIX)) {
    return mergeMarketCache(currentValue, previousValue)
  }
  if (key === SESSION_KEY) {
    return currentValue ?? previousValue
  }

  // Unknown keys are preserved without overwriting data already created by the
  // current Origin.
  return currentValue ?? previousValue
}

async function getOriginStorage() {
  const migrationPromise = Migration.getOriginStorage() as Promise<MigrationResult>
  const timeoutPromise = new Promise<never>((_, reject) => {
    window.setTimeout(() => reject(new Error('Origin storage migration timed out')), MIGRATION_TIMEOUT_MS)
  })
  return Promise.race([migrationPromise, timeoutPromise])
}

/**
 * Moves browser localStorage data from the SDK 3.x Origin to the SDK 2.x
 * Origin. It is intentionally idempotent and safe to skip outside Toss.
 */
export async function migrateOriginStorage() {
  if (typeof window === 'undefined' || !hasTossBridge()) {
    return
  }

  try {
    if (window.localStorage.getItem(MIGRATION_VERSION) === 'done') {
      return
    }

    const result = await getOriginStorage()
    const target = [result.previous, result.current].find(
      (dump) => dump.origin === window.location.origin,
    ) ?? result.current
    const source = [result.previous, result.current].find(
      (dump) => dump !== target && dump.origin !== target.origin,
    )

    if (!source) {
      window.localStorage.setItem(MIGRATION_VERSION, 'done')
      return
    }

    const keys = new Set([
      ...Object.keys(source.localStorage),
      ...Object.keys(target.localStorage),
    ])
    for (const key of keys) {
      if (key === MIGRATION_VERSION) {
        continue
      }

      const mergedValue = mergeValue(
        key,
        target.localStorage[key] ?? null,
        source.localStorage[key] ?? null,
      )
      if (mergedValue !== null && mergedValue !== undefined) {
        window.localStorage.setItem(key, mergedValue)
      }
    }

    window.localStorage.setItem(MIGRATION_VERSION, 'done')
  } catch {
    // Migration must never prevent the app from opening. A later launch can
    // retry because the completion marker is written only after success.
  }
}
