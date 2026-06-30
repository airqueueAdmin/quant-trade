import { StatusCard } from '../../components/StatusCard'

export function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero-section hero-section--home">
        <p className="eyebrow">Smart Investing, Made Simple</p>
        <h2 className="hero-title">한눈에 정리해주는 투자 도우미</h2>
        <p className="hero-description">
          한눈투자는 섹터 흐름 확인부터 AI 뉴스 요약, 전략 백테스트, 모의투자까지 이어지는
          모바일 투자 학습 경험을 제공합니다. 어렵게 흩어진 정보를 빠르게 이해하고 바로
          다음 행동으로 연결하는 데 초점을 맞췄습니다.
        </p>

        <dl className="meta-list">
          <div>
            <dt>시장 보기</dt>
            <dd>강한 섹터 빠르게 확인</dd>
          </div>
          <div>
            <dt>뉴스 읽기</dt>
            <dd>AI로 핵심만 빠르게 요약</dd>
          </div>
          <div>
            <dt>직접 연습</dt>
            <dd>전략 검증부터 모의투자까지</dd>
          </div>
        </dl>
      </section>

      <section className="status-grid" aria-label="주요 서비스 소개">
        <StatusCard
          title="지금 강한 섹터 찾기"
          description="미국과 국내 시장에서 최근 강한 섹터와 약한 섹터를 빠르게 비교하고, 어디에 자금이 몰리는지 감을 잡을 수 있습니다."
          tag="시장 흐름"
          tone="positive"
          meta="섹터 흐름"
        />
        <StatusCard
          title="뉴스를 AI로 빠르게 요약"
          description="종목을 입력하면 최신 뉴스 흐름과 투자 심리를 한 번에 정리해, 긴 기사 여러 개를 읽기 전에 핵심부터 파악할 수 있습니다."
          tag="AI"
          tone="positive"
          meta="AI 분석"
        />
        <StatusCard
          title="전략을 숫자로 검증"
          description="이동평균, RSI, 볼린저 밴드 전략을 백테스트하고 최적화하면서, 감이 아니라 결과로 전략을 비교할 수 있습니다."
          tag="전략 분석"
          tone="neutral"
          meta="전략 시뮬레이션"
        />
        <StatusCard
          title="실전 전 모의 연습"
          description="국내주식 기준으로 현재가 확인, 주문 연습, 보유 종목 확인까지 이어서 보며 실제 매매 전에 흐름을 점검할 수 있습니다."
          tag="투자 연습"
          tone="warning"
          meta="모의투자"
        />
      </section>

      <section className="content-panel">
        <p className="content-panel__eyebrow">서비스 흐름</p>
        <h3 className="content-panel__title">처음 보는 사람도 바로 따라갈 수 있게 구성했습니다.</h3>
        <ul className="bullet-list bullet-list--spaced">
          <li>먼저 섹터 흐름에서 오늘 강한 시장 구간을 확인합니다.</li>
          <li>관심 종목이 생기면 AI 분석으로 뉴스와 투자 심리를 빠르게 요약합니다.</li>
          <li>전략 시뮬레이션에서 백테스트와 최적화로 아이디어를 검증합니다.</li>
          <li>마지막으로 모의투자에서 실제 주문 전 흐름을 연습합니다.</li>
        </ul>
      </section>
    </main>
  )
}
