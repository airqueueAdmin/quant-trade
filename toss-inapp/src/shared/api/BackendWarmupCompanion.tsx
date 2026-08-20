import { useEffect, useMemo, useState } from 'react'

import { apiClient } from './client'

const SLOW_BACKEND_THRESHOLD_MS = 1_000
const READY_MESSAGE_DURATION_MS = 1_600

const WARMUP_CHECKS = [
  {
    question: '매수 전에 가장 먼저 정할 것은?',
    choices: ['손실 한도', '목표 수익률', '기사 개수'],
    answer: 0,
    explanation: '손실 한도를 먼저 정하면 한 번의 판단이 계좌 전체를 흔드는 일을 줄일 수 있어요.',
  },
  {
    question: '급등 종목을 볼 때 함께 확인할 것은?',
    choices: ['거래량', '종목명 길이', '검색 순위'],
    answer: 0,
    explanation: '가격 변화와 거래량을 같이 보면 움직임에 실제 참여가 붙었는지 판단하기 쉬워요.',
  },
  {
    question: '수익률 비교에서 놓치기 쉬운 것은?',
    choices: ['투자 기간', '글자 색상', '종목 코드'],
    answer: 0,
    explanation: '같은 수익률도 걸린 기간과 감수한 변동성에 따라 의미가 달라져요.',
  },
] as const

type WarmupPhase = 'hidden' | 'warming' | 'ready'

export function BackendWarmupCompanion() {
  const [phase, setPhase] = useState<WarmupPhase>('hidden')
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null)
  const check = useMemo(() => WARMUP_CHECKS[new Date().getDate() % WARMUP_CHECKS.length], [])

  useEffect(() => {
    let disposed = false
    let readyTimer: number | undefined
    const startedAt = Date.now()
    const slowTimer = window.setTimeout(() => {
      if (!disposed) setPhase('warming')
    }, SLOW_BACKEND_THRESHOLD_MS)

    async function wakeBackend() {
      try {
        await apiClient.health()
        if (disposed) return
        window.clearTimeout(slowTimer)
        if (Date.now() - startedAt < SLOW_BACKEND_THRESHOLD_MS) {
          setPhase('hidden')
          return
        }
        setPhase('ready')
        readyTimer = window.setTimeout(() => setPhase('hidden'), READY_MESSAGE_DURATION_MS)
      } catch {
        // Other page requests retain their own error handling.  The companion
        // stays useful while a sleeping or temporarily unreachable backend is
        // still being prepared.
      }
    }

    void wakeBackend()
    return () => {
      disposed = true
      window.clearTimeout(slowTimer)
      if (readyTimer !== undefined) window.clearTimeout(readyTimer)
    }
  }, [])

  if (phase === 'hidden') return null

  const answered = selectedChoice !== null
  const isCorrect = selectedChoice === check.answer

  return (
    <aside className={`backend-warmup backend-warmup--${phase}`} aria-live="polite">
      <div className="backend-warmup__status">
        <span aria-hidden="true">{phase === 'ready' ? '✓' : ''}</span>
        <div>
          <strong>{phase === 'ready' ? '시장 데이터 연결 완료' : '시장 데이터를 깨우고 있어요'}</strong>
          <small>{phase === 'ready' ? '최신 내용을 곧 화면에 반영할게요.' : '기다리는 동안 10초 투자 체크를 해보세요.'}</small>
        </div>
      </div>

      {phase === 'warming' ? (
        <div className="backend-warmup__check">
          <p>{check.question}</p>
          <div className="backend-warmup__choices">
            {check.choices.map((choice, index) => (
              <button
                key={choice}
                type="button"
                className={selectedChoice === index ? 'backend-warmup__choice backend-warmup__choice--selected' : 'backend-warmup__choice'}
                aria-pressed={selectedChoice === index}
                onClick={() => setSelectedChoice(index)}
              >
                {choice}
              </button>
            ))}
          </div>
          {answered ? (
            <p className={isCorrect ? 'backend-warmup__answer backend-warmup__answer--correct' : 'backend-warmup__answer'}>
              <b>{isCorrect ? '좋아요.' : '한 번 더 생각해보면,'}</b> {check.explanation}
            </p>
          ) : null}
        </div>
      ) : null}
    </aside>
  )
}
