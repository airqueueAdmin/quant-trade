import { useState } from 'react'

import { useFullScreenAd, type FullScreenAdReward } from './useFullScreenAd'

type FeedbackTone = 'neutral' | 'positive' | 'error'

interface RewardedAdFeedback {
  message: string
  tone: FeedbackTone
}

interface RewardedAdCardProps {
  adGroupId: string
}

function formatReward({ unitAmount, unitType }: FullScreenAdReward) {
  const amount = unitAmount.toLocaleString('ko-KR')
  const unit = unitType.trim() || '리워드'
  return `${amount} ${unit}`
}

export function RewardedAdCard({ adGroupId }: RewardedAdCardProps) {
  const rewardedAd = useFullScreenAd(adGroupId)
  const [feedback, setFeedback] = useState<RewardedAdFeedback | null>(null)

  if (!adGroupId) {
    return null
  }

  const handleShowAd = () => {
    setFeedback({
      message: '광고 시청을 완료하면 리워드가 지급돼요.',
      tone: 'neutral',
    })

    const didRequestAd = rewardedAd.showAd({
      onReward: (reward) => {
        setFeedback({
          message: `${formatReward(reward)} 리워드가 지급됐어요.`,
          tone: 'positive',
        })
      },
      onDismissed: (rewardEarned) => {
        if (!rewardEarned) {
          setFeedback({
            message: '광고 시청이 완료되지 않아 리워드가 지급되지 않았어요.',
            tone: 'neutral',
          })
        }
      },
      onFailedToShow: () => {
        setFeedback({
          message: '광고를 표시하지 못했어요. 다음 광고를 준비하고 있어요.',
          tone: 'error',
        })
      },
    })

    if (!didRequestAd) {
      setFeedback({
        message: '리워드 광고가 아직 준비되지 않았어요. 잠시 후 다시 시도해주세요.',
        tone: 'neutral',
      })
    }
  }

  const buttonLabel = (() => {
    switch (rewardedAd.status) {
      case 'loading':
        return '리워드 광고 준비 중...'
      case 'showing':
        return '광고 시청 중...'
      case 'unavailable':
        return '현재 광고를 이용할 수 없어요'
      default:
        return '광고 보고 리워드 받기'
    }
  })()

  return (
    <section className="content-panel rewarded-ad-card">
      <p className="content-panel__eyebrow">리워드 광고</p>
      <h3 className="content-panel__title">광고 시청하고 리워드 받기</h3>
      <p className="content-panel__description">
        원할 때 광고를 끝까지 시청하고 광고 그룹에 설정된 리워드를 받아보세요.
      </p>
      <button
        type="button"
        className="primary-action rewarded-ad-card__action"
        onClick={handleShowAd}
        disabled={!rewardedAd.isReady}
      >
        {buttonLabel}
      </button>
      {feedback ? (
        <p
          className={`rewarded-ad-card__feedback rewarded-ad-card__feedback--${feedback.tone}`}
          role="status"
          aria-live="polite"
        >
          {feedback.message}
        </p>
      ) : null}
      <p className="helper-text helper-text--tight">
        광고 시청 완료 이벤트가 확인된 경우에만 리워드가 지급돼요.
      </p>
    </section>
  )
}
