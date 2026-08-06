import {
  TossAds,
  type TossAdsAttachBannerResult,
} from '@apps-in-toss/web-framework'
import { useEffect, useRef, useState } from 'react'

type BannerStatus =
  | 'disabled'
  | 'initializing'
  | 'loading'
  | 'visible'
  | 'unavailable'

function logBannerError(action: 'initialize' | 'render', error: unknown) {
  console.warn(`[ads] Failed to ${action} banner ad.`, error)
}

function isBannerSupported() {
  try {
    return (
      typeof TossAds.initialize.isSupported === 'function'
      && typeof TossAds.attachBanner.isSupported === 'function'
      && TossAds.initialize.isSupported()
      && TossAds.attachBanner.isSupported()
    )
  } catch (error) {
    logBannerError('initialize', error)
    return false
  }
}

interface BannerAdProps {
  adGroupId: string
}

export function BannerAd({ adGroupId }: BannerAdProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<BannerStatus>(
    adGroupId ? 'initializing' : 'disabled',
  )

  useEffect(() => {
    const container = containerRef.current

    if (!adGroupId || !container) {
      setStatus('disabled')
      return
    }

    if (!isBannerSupported()) {
      setStatus('unavailable')
      return
    }

    let disposed = false
    let attachedBanner: TossAdsAttachBannerResult | null = null

    const updateStatus = (nextStatus: BannerStatus) => {
      if (!disposed) {
        setStatus(nextStatus)
      }
    }

    const attachBanner = () => {
      if (disposed || attachedBanner) {
        return
      }

      updateStatus('loading')

      try {
        attachedBanner = TossAds.attachBanner(adGroupId, container, {
          theme: 'light',
          tone: 'grey',
          variant: 'expanded',
          callbacks: {
            onAdRendered: () => updateStatus('visible'),
            onAdFailedToRender: (payload) => {
              updateStatus('unavailable')
              logBannerError('render', payload.error)
            },
            onNoFill: () => updateStatus('unavailable'),
          },
        })
      } catch (error) {
        updateStatus('unavailable')
        logBannerError('render', error)
      }
    }

    setStatus('initializing')

    try {
      TossAds.initialize({
        callbacks: {
          onInitialized: attachBanner,
          onInitializationFailed: (error) => {
            updateStatus('unavailable')
            logBannerError('initialize', error)
          },
        },
      })
    } catch (error) {
      updateStatus('unavailable')
      logBannerError('initialize', error)
    }

    return () => {
      disposed = true
      attachedBanner?.destroy()
    }
  }, [adGroupId])

  if (!adGroupId) {
    return null
  }

  return (
    <aside
      className={`banner-ad banner-ad--${status}`}
      aria-label="광고"
    >
      <div ref={containerRef} className="banner-ad__slot" />
    </aside>
  )
}
