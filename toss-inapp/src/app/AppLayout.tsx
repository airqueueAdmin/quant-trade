import { NavLink, Outlet } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/', label: '홈' },
  { to: '/sector-flow', label: '섹터 흐름' },
  { to: '/ai-analysis', label: 'AI 분석' },
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
            <span className="app-header__pill">투자 연습</span>
          </div>
          <h1 className="app-header__title">시장을 읽고, 전략을 보고, 모의로 연습하는 투자 앱</h1>
          <p className="app-header__description">
            복잡한 투자 도구를 한 화면에 몰아넣지 않고, 섹터 흐름부터 AI 분석, 전략 시뮬레이션,
            모의투자까지 모바일에서 이해하기 쉽게 이어 붙였습니다.
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
