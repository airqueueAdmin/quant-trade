import { NavLink, Outlet } from 'react-router-dom'

import { BannerAd } from '../shared/ads/BannerAd'
import { env } from '../shared/config/env'

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
            <span className="app-header__pill">Closing Bet</span>
          </div>
        </header>

        <main className="app-content">
          <Outlet />
        </main>

        <BannerAd adGroupId={env.ads.bannerAdGroupId} />

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
