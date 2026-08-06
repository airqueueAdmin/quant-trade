import { loadFullScreenAd, showFullScreenAd } from '@apps-in-toss/web-framework'
import { useCallback, useEffect, useRef, useState } from 'react'

type AdStatus = 'disabled' | 'loading' | 'ready' | 'showing' | 'unavailable'

export interface FullScreenAdReward {
  unitType: string
  unitAmount: number
}

export interface FullScreenAdShowHandlers {
  onReward?: (reward: FullScreenAdReward) => void
  onDismissed?: (rewardEarned: boolean) => void
  onFailedToShow?: () => void
}

function logAdError(action: 'load' | 'show', error: unknown) {
  console.warn(`[ads] Failed to ${action} full-screen ad.`, error)
}

function isAdCommandSupported(command: typeof loadFullScreenAd | typeof showFullScreenAd) {
  try {
    return typeof command.isSupported === 'function' && command.isSupported()
  } catch (error) {
    logAdError('load', error)
    return false
  }
}

export function useFullScreenAd(adGroupId: string) {
  const [status, setStatus] = useState<AdStatus>(adGroupId ? 'loading' : 'disabled')
  const mountedRef = useRef(false)
  const loadingRef = useRef(false)
  const readyRef = useRef(false)
  const showingRef = useRef(false)
  const unregisterLoadRef = useRef<(() => void) | null>(null)
  const unregisterShowRef = useRef<(() => void) | null>(null)

  const updateStatus = useCallback((nextStatus: AdStatus) => {
    if (mountedRef.current) {
      setStatus(nextStatus)
    }
  }, [])

  const unregisterLoad = useCallback(() => {
    unregisterLoadRef.current?.()
    unregisterLoadRef.current = null
  }, [])

  const unregisterShow = useCallback(() => {
    unregisterShowRef.current?.()
    unregisterShowRef.current = null
  }, [])

  const loadAd = useCallback(() => {
    if (!adGroupId) {
      updateStatus('disabled')
      return
    }

    if (!isAdCommandSupported(loadFullScreenAd) || !isAdCommandSupported(showFullScreenAd)) {
      updateStatus('unavailable')
      return
    }

    if (loadingRef.current || readyRef.current || showingRef.current) {
      return
    }

    loadingRef.current = true
    updateStatus('loading')
    unregisterLoad()

    let loadFinished = false

    try {
      const unregister = loadFullScreenAd({
        options: { adGroupId },
        onEvent: (event) => {
          if (event.type !== 'loaded' || loadFinished) {
            return
          }

          loadFinished = true
          loadingRef.current = false
          readyRef.current = true
          updateStatus('ready')
          unregisterLoad()
        },
        onError: (error) => {
          if (loadFinished) {
            return
          }

          loadFinished = true
          loadingRef.current = false
          readyRef.current = false
          updateStatus('unavailable')
          logAdError('load', error)
          unregisterLoad()
        },
      })

      if (loadFinished) {
        unregister()
      } else {
        unregisterLoadRef.current = unregister
      }
    } catch (error) {
      loadFinished = true
      loadingRef.current = false
      readyRef.current = false
      updateStatus('unavailable')
      logAdError('load', error)
      unregisterLoad()
    }
  }, [adGroupId, unregisterLoad, updateStatus])

  useEffect(() => {
    mountedRef.current = true
    loadAd()

    return () => {
      mountedRef.current = false
      loadingRef.current = false
      readyRef.current = false
      showingRef.current = false
      unregisterLoad()
      unregisterShow()
    }
  }, [loadAd, unregisterLoad, unregisterShow])

  const showAd = useCallback((handlers: FullScreenAdShowHandlers = {}) => {
    if (
      !adGroupId ||
      !readyRef.current ||
      showingRef.current ||
      !isAdCommandSupported(showFullScreenAd)
    ) {
      return false
    }

    readyRef.current = false
    showingRef.current = true
    updateStatus('showing')
    unregisterShow()

    let showFinished = false
    let rewardEarned = false

    const finishAndLoadNext = () => {
      if (showFinished) {
        return false
      }

      showFinished = true
      showingRef.current = false
      unregisterShow()
      loadAd()
      return true
    }

    try {
      const unregister = showFullScreenAd({
        options: { adGroupId },
        onEvent: (event) => {
          if (event.type === 'userEarnedReward') {
            if (!rewardEarned) {
              rewardEarned = true
              handlers.onReward?.(event.data)
            }
            return
          }

          if (event.type === 'dismissed') {
            if (finishAndLoadNext()) {
              handlers.onDismissed?.(rewardEarned)
            }
            return
          }

          if (event.type === 'failedToShow' && finishAndLoadNext()) {
            handlers.onFailedToShow?.()
          }
        },
        onError: (error) => {
          logAdError('show', error)
          if (finishAndLoadNext()) {
            handlers.onFailedToShow?.()
          }
        },
      })

      if (showFinished) {
        unregister()
      } else {
        unregisterShowRef.current = unregister
      }

      return true
    } catch (error) {
      logAdError('show', error)
      finishAndLoadNext()
      return false
    }
  }, [adGroupId, loadAd, unregisterShow, updateStatus])

  return {
    enabled: Boolean(adGroupId),
    isReady: status === 'ready',
    showAd,
    status,
  }
}
