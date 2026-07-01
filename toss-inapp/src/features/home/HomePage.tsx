import { StatusCard } from '../../components/StatusCard'

export function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero-section hero-section--home">
        <p className="eyebrow">Closing Bet, Made Clear</p>
        <h2 className="hero-title">종가베팅 준비를 한 흐름으로 묶은 투자 도우미</h2>
        <p className="hero-description">
          한눈투자는 종가베팅을 중심으로, 섹터 흐름 확인부터 AI 뉴스 요약, 후보 압축,
          전략 검증, 다음 날 대응 연습까지 모바일에서 이해하기 쉽게 이어 붙였습니다.
        </p>

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
        <p className="content-panel__eyebrow">처음이라면</p>
        <h3 className="content-panel__title">이 순서대로 보면 이해가 쉽습니다.</h3>
        <div className="journey-list">
          <article className="journey-item">
            <span className="journey-item__step">1</span>
            <div>
              <strong>섹터 흐름</strong>
              <p>오늘 시장에서 끝까지 강했던 섹터를 먼저 찾습니다.</p>
            </div>
          </article>
          <article className="journey-item">
            <span className="journey-item__step">2</span>
            <div>
              <strong>AI 분석</strong>
              <p>움직인 이유가 내일까지도 이어질지 빠르게 읽습니다.</p>
            </div>
          </article>
          <article className="journey-item">
            <span className="journey-item__step">3</span>
            <div>
              <strong>종가베팅</strong>
              <p>후보를 최종 압축하고 제외 신호까지 함께 확인합니다.</p>
            </div>
          </article>
          <article className="journey-item">
            <span className="journey-item__step">4</span>
            <div>
              <strong>모의투자</strong>
              <p>다음 날 대응을 실제 돈 없이 연습합니다.</p>
            </div>
          </article>
        </div>
      </section>

      <section className="status-grid" aria-label="주요 서비스 소개">
        <StatusCard
          title="지금 강한 섹터 찾기"
          description="종가베팅 전 가장 먼저 볼 메뉴입니다. 오늘 시장에서 끝까지 강했던 섹터를 빠르게 추립니다."
          tag="시장 흐름"
          tone="positive"
          meta="섹터 흐름"
        />
        <StatusCard
          title="뉴스를 AI로 빠르게 요약"
          description="종가베팅 후보에 붙은 뉴스와 시장 심리를 빠르게 정리해, 내일도 재료가 남을지 판단하기 쉽게 돕습니다."
          tag="AI"
          tone="positive"
          meta="AI 분석"
        />
        <StatusCard
          title="전략을 숫자로 검증"
          description="좋아 보이는 종가베팅 아이디어가 과거 데이터에서도 어느 정도 통했는지 백업 차원에서 검증할 수 있습니다."
          tag="전략 분석"
          tone="neutral"
          meta="전략 시뮬레이션"
        />
        <StatusCard
          title="종가베팅 후보 추리기"
          description="오늘 끝까지 살아남은 수급이 내일까지 이어질지 서비스가 자동으로 읽고, 후보와 제외 신호를 함께 정리합니다."
          tag="단기 전략"
          tone="positive"
          meta="종가베팅"
        />
        <StatusCard
          title="실전 전 모의 연습"
          description="종가 기준으로 고른 후보를 다음 날 어떻게 대응할지 연습하는 대응 점검용 메뉴입니다."
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
          <li>종가베팅에서 오늘 끝까지 남은 수급이 내일까지 이어질지 점검합니다.</li>
          <li>전략 시뮬레이션에서 백테스트와 최적화로 아이디어를 검증합니다.</li>
          <li>마지막으로 모의투자에서 다음 날 대응을 연습합니다.</li>
        </ul>
      </section>
    </main>
  )
}
