import { useEffect, useMemo, useState } from 'react'

import { trackGrowthEvent } from '../analytics/growthAnalytics'
import { grantAttendanceReward } from '../rewards/adFreeAnalysisRewards'

const DAILY_ROUTINE_STORAGE_KEY = 'quant.toss_inapp.daily_routine'
const DAILY_ROUTINE_UPDATED_EVENT = 'quant:daily-routine-updated'
const HISTORY_LIMIT_DAYS = 35

export const DAILY_ROUTINE_ITEMS = [
  {
    path: '/sector-flow',
    label: '시장 온도 확인',
    description: '강한 섹터와 수급을 살펴봐요',
  },
  {
    path: '/ai-analysis',
    label: '관심종목 점검',
    description: '뉴스와 투자 심리를 확인해요',
  },
  {
    path: '/closing-bet',
    label: '오늘 후보 정리',
    description: '점수와 제외 신호를 비교해요',
  },
] as const

type DailyRoutinePath = (typeof DAILY_ROUTINE_ITEMS)[number]['path']
type RoutineHistory = Record<string, DailyRoutinePath[]>

function localDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function shiftDate(date: Date, dayOffset: number) {
  const shifted = new Date(date)
  shifted.setHours(12, 0, 0, 0)
  shifted.setDate(shifted.getDate() + dayOffset)
  return shifted
}

function isRoutinePath(value: unknown): value is DailyRoutinePath {
  return DAILY_ROUTINE_ITEMS.some((item) => item.path === value)
}

function readHistory(): RoutineHistory {
  if (typeof window === 'undefined') {
    return {}
  }

  const raw = window.localStorage.getItem(DAILY_ROUTINE_STORAGE_KEY)
  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([date, paths]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Array.isArray(paths))
        .map(([date, paths]) => [date, paths.filter(isRoutinePath)]),
    )
  } catch {
    return {}
  }
}

function persistHistory(history: RoutineHistory) {
  if (typeof window === 'undefined') {
    return
  }

  const recentHistory = Object.fromEntries(
    Object.entries(history)
      .sort(([left], [right]) => right.localeCompare(left))
      .slice(0, HISTORY_LIMIT_DAYS),
  )
  window.localStorage.setItem(DAILY_ROUTINE_STORAGE_KEY, JSON.stringify(recentHistory))
  window.dispatchEvent(new Event(DAILY_ROUTINE_UPDATED_EVENT))
}

export function recordDailyRoutineCompletion(pathname: string, now = new Date()) {
  const history = readHistory()
  if (!isRoutinePath(pathname)) {
    return
  }

  const today = localDateKey(now)
  const completedPaths = new Set(history[today] ?? [])
  if (completedPaths.has(pathname)) {
    grantAttendanceReward(calculateStreak(history, now))
    return
  }

  const previouslyCompletedCount = completedPaths.size
  completedPaths.add(pathname)
  const nextHistory = {
    ...history,
    [today]: [...completedPaths],
  }
  persistHistory(nextHistory)
  const nextStreak = calculateStreak(nextHistory, now)
  grantAttendanceReward(nextStreak)
  trackGrowthEvent('daily_routine_item_completed', {
    item_path: pathname,
    completed_count: completedPaths.size,
    total_count: DAILY_ROUTINE_ITEMS.length,
    streak_days: nextStreak,
  })

  if (
    previouslyCompletedCount < DAILY_ROUTINE_ITEMS.length
    && completedPaths.size === DAILY_ROUTINE_ITEMS.length
  ) {
    trackGrowthEvent('daily_routine_completed', {
      streak_days: nextStreak,
    })
  }
}

function calculateStreak(history: RoutineHistory, now: Date) {
  const todayHasActivity = (history[localDateKey(now)]?.length ?? 0) > 0
  let cursor = todayHasActivity ? 0 : -1
  let streak = 0

  while ((history[localDateKey(shiftDate(now, cursor))]?.length ?? 0) > 0) {
    streak += 1
    cursor -= 1
  }

  return streak
}

function createSnapshot(history: RoutineHistory, now: Date) {
  const today = localDateKey(now)
  const completedPaths = history[today] ?? []
  const completedSet = new Set(completedPaths)
  const nextItem = DAILY_ROUTINE_ITEMS.find((item) => !completedSet.has(item.path)) ?? null
  const recentDays = Array.from({ length: 7 }, (_, index) => {
    const date = shiftDate(now, index - 6)
    return {
      key: localDateKey(date),
      label: new Intl.DateTimeFormat('ko-KR', { weekday: 'short' }).format(date),
      active: (history[localDateKey(date)]?.length ?? 0) > 0,
      isToday: index === 6,
    }
  })

  return {
    completedPaths,
    completedCount: completedPaths.length,
    totalCount: DAILY_ROUTINE_ITEMS.length,
    nextItem,
    streak: calculateStreak(history, now),
    recentDays,
  }
}

export function useDailyRoutine() {
  const [history, setHistory] = useState<RoutineHistory>(readHistory)

  useEffect(() => {
    const syncHistory = () => setHistory(readHistory())
    window.addEventListener('storage', syncHistory)
    window.addEventListener(DAILY_ROUTINE_UPDATED_EVENT, syncHistory)
    return () => {
      window.removeEventListener('storage', syncHistory)
      window.removeEventListener(DAILY_ROUTINE_UPDATED_EVENT, syncHistory)
    }
  }, [])

  return useMemo(() => createSnapshot(history, new Date()), [history])
}
