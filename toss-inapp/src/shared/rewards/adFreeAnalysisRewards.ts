import { useEffect, useState } from 'react'

const AD_FREE_ANALYSIS_REWARDS_STORAGE_KEY = 'quant.toss_inapp.ad_free_analysis_rewards'
const AD_FREE_ANALYSIS_REWARDS_UPDATED_EVENT = 'quant:ad-free-analysis-rewards-updated'

export const ATTENDANCE_REWARD_GOAL_DAYS = 5
export const ATTENDANCE_REWARD_AMOUNT = 5

interface AdFreeAnalysisRewardState {
  balance: number
  attendanceRewardGranted: boolean
}

const EMPTY_REWARD_STATE: AdFreeAnalysisRewardState = {
  balance: 0,
  attendanceRewardGranted: false,
}

function readRewardState(): AdFreeAnalysisRewardState {
  if (typeof window === 'undefined') {
    return EMPTY_REWARD_STATE
  }

  const raw = window.localStorage.getItem(AD_FREE_ANALYSIS_REWARDS_STORAGE_KEY)
  if (!raw) {
    return EMPTY_REWARD_STATE
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AdFreeAnalysisRewardState>
    return {
      balance: Number.isSafeInteger(parsed.balance) && Number(parsed.balance) >= 0
        ? Number(parsed.balance)
        : 0,
      attendanceRewardGranted: parsed.attendanceRewardGranted === true,
    }
  } catch {
    return EMPTY_REWARD_STATE
  }
}

function persistRewardState(state: AdFreeAnalysisRewardState) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(AD_FREE_ANALYSIS_REWARDS_STORAGE_KEY, JSON.stringify(state))
  window.dispatchEvent(new Event(AD_FREE_ANALYSIS_REWARDS_UPDATED_EVENT))
}

export function grantAttendanceReward(streak: number) {
  const state = readRewardState()
  if (streak < ATTENDANCE_REWARD_GOAL_DAYS || state.attendanceRewardGranted) {
    return false
  }

  persistRewardState({
    balance: state.balance + ATTENDANCE_REWARD_AMOUNT,
    attendanceRewardGranted: true,
  })
  return true
}

export function claimAdFreeAnalysisReward() {
  const state = readRewardState()
  if (state.balance < 1) {
    return false
  }

  persistRewardState({
    ...state,
    balance: state.balance - 1,
  })
  return true
}

export function refundAdFreeAnalysisReward() {
  const state = readRewardState()
  persistRewardState({
    ...state,
    balance: state.balance + 1,
  })
}

export function useAdFreeAnalysisRewards() {
  const [state, setState] = useState<AdFreeAnalysisRewardState>(readRewardState)

  useEffect(() => {
    const syncState = () => setState(readRewardState())
    window.addEventListener('storage', syncState)
    window.addEventListener(AD_FREE_ANALYSIS_REWARDS_UPDATED_EVENT, syncState)
    return () => {
      window.removeEventListener('storage', syncState)
      window.removeEventListener(AD_FREE_ANALYSIS_REWARDS_UPDATED_EVENT, syncState)
    }
  }, [])

  return state
}
