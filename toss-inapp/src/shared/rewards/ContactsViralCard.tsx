import {
  contactsViral,
  getOperationalEnvironment,
  isMinVersionSupported,
} from '@apps-in-toss/web-framework'
import { useCallback, useEffect, useRef, useState } from 'react'

type ViralPhase = 'idle' | 'opening' | 'active'
type FeedbackTone = 'neutral' | 'positive' | 'error'

interface ViralFeedback {
  message: string
  tone: FeedbackTone
}

interface ContactsViralCardProps {
  moduleId: string
}

function logContactsViralError(error: unknown) {
  console.warn('[rewards] Failed to open contacts viral module.', error)
}

export function ContactsViralCard({ moduleId }: ContactsViralCardProps) {
  const cleanupRef = useRef<(() => void) | null>(null)
  const mountedRef = useRef(false)
  const [phase, setPhase] = useState<ViralPhase>('idle')
  const [feedback, setFeedback] = useState<ViralFeedback | null>(null)

  const cleanup = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
  }, [])

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      cleanup()
    }
  }, [cleanup])

  const updatePhase = useCallback((nextPhase: ViralPhase) => {
    if (mountedRef.current) {
      setPhase(nextPhase)
    }
  }, [])

  const updateFeedback = useCallback((nextFeedback: ViralFeedback) => {
    if (mountedRef.current) {
      setFeedback(nextFeedback)
    }
  }, [])

  const handleShare = useCallback(() => {
    if (!moduleId || cleanupRef.current) {
      return
    }

    updatePhase('opening')
    setFeedback(null)

    try {
      if (getOperationalEnvironment() !== 'toss') {
        updatePhase('idle')
        updateFeedback({
          message: '공유 리워드는 토스 앱의 콘솔 QR에서 확인할 수 있어요.',
          tone: 'neutral',
        })
        return
      }

      if (
        !isMinVersionSupported({
          android: '5.223.0',
          ios: '5.223.0',
        })
      ) {
        updatePhase('idle')
        updateFeedback({
          message: '공유 리워드를 사용하려면 토스 앱을 최신 버전으로 업데이트해주세요.',
          tone: 'neutral',
        })
        return
      }

      let finishedBeforeRegistration = false
      let finished = false

      const finish = () => {
        if (finished) {
          return
        }

        finished = true
        if (cleanupRef.current) {
          cleanup()
        } else {
          finishedBeforeRegistration = true
        }
        updatePhase('idle')
      }

      const unregister = contactsViral({
        options: { moduleId: moduleId.trim() },
        onEvent: (event) => {
          if (event.type === 'sendViral') {
            updateFeedback({
              message: `${event.data.rewardAmount.toLocaleString('ko-KR')} ${event.data.rewardUnit} 리워드가 지급됐어요.`,
              tone: 'positive',
            })
            return
          }

          if (event.data.closeReason === 'noReward') {
            updateFeedback({
              message: '현재 받을 수 있는 공유 리워드가 없어요.',
              tone: 'neutral',
            })
          } else if (event.data.sentRewardsCount > 0) {
            updateFeedback({
              message: `${event.data.sentRewardsCount.toLocaleString('ko-KR')}명에게 공유를 완료했어요.`,
              tone: 'positive',
            })
          } else {
            updateFeedback({
              message: '공유 화면을 닫았어요.',
              tone: 'neutral',
            })
          }

          finish()
        },
        onError: (error) => {
          logContactsViralError(error)
          updateFeedback({
            message: '공유 리워드를 열지 못했어요. 토스 앱 버전과 미니앱 승인 상태를 확인해주세요.',
            tone: 'error',
          })
          finish()
        },
      })

      if (finishedBeforeRegistration) {
        unregister()
      } else {
        cleanupRef.current = unregister
        updatePhase('active')
      }
    } catch (error) {
      logContactsViralError(error)
      cleanup()
      updatePhase('idle')
      updateFeedback({
        message: '공유 리워드는 토스 앱의 콘솔 QR에서 실행해주세요.',
        tone: 'error',
      })
    }
  }, [cleanup, moduleId, updateFeedback, updatePhase])

  if (!moduleId) {
    return null
  }

  const isBusy = phase !== 'idle'

  return (
    <section className="content-panel viral-reward-card">
      <p className="content-panel__eyebrow">친구 초대</p>
      <h3 className="content-panel__title">친구와 함께 한눈투자 시작하기</h3>
      <p className="content-panel__description">
        친구에게 한눈투자를 공유하고 콘솔에서 정한 리워드를 받아보세요.
      </p>
      <button
        type="button"
        className="primary-action viral-reward-card__action"
        onClick={handleShare}
        disabled={isBusy}
      >
        {isBusy ? '공유 화면 진행 중...' : '친구에게 공유하고 리워드 받기'}
      </button>
      {feedback ? (
        <p
          className={`viral-reward-card__feedback viral-reward-card__feedback--${feedback.tone}`}
          role="status"
          aria-live="polite"
        >
          {feedback.message}
        </p>
      ) : null}
      <p className="helper-text helper-text--tight">
        리워드 조건과 수량은 앱인토스 콘솔 설정에 따라 달라질 수 있어요.
      </p>
    </section>
  )
}
