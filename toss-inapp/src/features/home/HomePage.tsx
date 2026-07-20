import { useState } from 'react'

import { StatusCard } from '../../components/StatusCard'
import { StepFlow } from '../../components/StepFlow'
import { env } from '../../shared/config/env'
import { ContactsViralCard } from '../../shared/rewards/ContactsViralCard'

const HOME_STEPS = [
  {
    label: '핵심',
    title: '먼저 투자 흐름을 이해해요',
    description: '지금은 세 가지 핵심만 가볍게 확인하세요.',
  },
  {
    label: '순서',
    title: '메뉴를 따라 한 단계씩 이동해요',
    description: '처음이라면 아래 순서대로 확인하는 것이 가장 쉽습니다.',
  },
  {
    label: '기능',
    title: '필요한 기능만 골라보세요',
    description: '익숙해진 뒤에는 원하는 기능부터 바로 사용할 수 있습니다.',
  },
] as const

export function HomePage() {
  const [currentStep, setCurrentStep] = useState(0)

  return (
    <main className="page-shell">
      <StepFlow
        pageTitle="처음 시작하기"
        steps={HOME_STEPS}
        currentStep={currentStep}
        onStepChange={setCurrentStep}
      >
        <section className="content-panel">
          <dl className="meta-list">
            <div>
              <dt>1단계</dt>
              <dd>강한 섹터 먼저 확인</dd>
            </div>
            <div>
              <dt>2단계</dt>
              <dd>뉴스와 재료 해석</dd>
            </div>
            <div>
              <dt>핵심</dt>
              <dd>내일 이어질 수급 선별</dd>
            </div>
          </dl>
        </section>

        <section className="content-panel">
          <div className="journey-list">
            <article className="journey-item">
              <span className="journey-item__step">1</span>
              <div>
                <strong>섹터 흐름</strong>
                <p>오늘 강한 섹터를 찾습니다.</p>
              </div>
            </article>
            <article className="journey-item">
              <span className="journey-item__step">2</span>
              <div>
                <strong>AI 분석</strong>
                <p>뉴스와 투자 심리를 확인합니다.</p>
              </div>
            </article>
            <article className="journey-item">
              <span className="journey-item__step">3</span>
              <div>
                <strong>종가베팅</strong>
                <p>점수와 제외 신호로 후보를 추립니다.</p>
              </div>
            </article>
            <article className="journey-item">
              <span className="journey-item__step">4</span>
              <div>
                <strong>모의투자</strong>
                <p>실제 돈 없이 대응을 연습합니다.</p>
              </div>
            </article>
          </div>
        </section>

        <>
          <ContactsViralCard moduleId={env.rewards.contactsViralModuleId} />

          <details className="disclosure-panel">
            <summary>전체 기능 한 번에 보기</summary>
          <section className="status-grid" aria-label="주요 서비스 소개">
            <StatusCard
              title="지금 강한 섹터 찾기"
              description="오늘 강한 섹터를 빠르게 추립니다."
              tag="시장 흐름"
              tone="positive"
              meta="섹터 흐름"
            />
            <StatusCard
              title="뉴스를 AI로 빠르게 요약"
              description="종목 뉴스와 시장 심리를 요약합니다."
              tag="AI"
              tone="positive"
              meta="AI 분석"
            />
            <StatusCard
              title="전략을 숫자로 검증"
              description="아이디어를 과거 데이터로 검증합니다."
              tag="전략 분석"
              tone="neutral"
              meta="전략 시뮬레이션"
            />
            <StatusCard
              title="종가베팅 후보 추리기"
              description="수급 지속 가능성과 제외 신호를 점검합니다."
              tag="단기 전략"
              tone="positive"
              meta="종가베팅"
            />
            <StatusCard
              title="실전 전 모의 연습"
              description="선택한 종목의 매매 대응을 연습합니다."
              tag="투자 연습"
              tone="warning"
              meta="모의투자"
            />
          </section>
          </details>
        </>
      </StepFlow>

    </main>
  )
}
