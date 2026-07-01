import { NavLink, Outlet } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/', label: '홈' },
  { to: '/sector-flow', label: '섹터 흐름' },
  { to: '/ai-analysis', label: 'AI 분석' },
  { to: '/closing-bet', label: '종가베팅' },
  { to: '/strategy-simulation', label: '전략 연습' },
  { to: '/paper-trading', label: '모의투자' },
] as const

export function AppLayout() {
  return (
    <div className="app-shell">
      <div className="app-frame">
        <header className="app-header">
          <div className="app-header__topline">
            <p className="app-header__eyebrow">한눈투자</p>
            <span className="app-header__pill">종가베팅 준비</span>
          </div>
          <h1 className="app-header__title">내일 이어질 수급을 찾는 종가베팅 지원 앱</h1>
          <p className="app-header__description">
            종가베팅이 중심이고, 섹터 흐름과 AI 분석은 후보 발굴용, 전략 연습과 모의투자는
            검증과 대응 점검용으로 이어지게 구성했습니다.
          </p>
        </header>

        <main className="app-content">
          <Outlet />
        </main>

        <nav className="app-nav" aria-label="주요 페이지">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? 'app-nav__link app-nav__link--active' : 'app-nav__link'
              }
              end={item.to === '/'}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  )
}
