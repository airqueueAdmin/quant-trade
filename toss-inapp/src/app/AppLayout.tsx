import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'

import { BannerAd } from '../shared/ads/BannerAd'
import { trackScreenView } from '../shared/analytics/growthAnalytics'
import { BackendWarmupCompanion } from '../shared/api/BackendWarmupCompanion'
import { env } from '../shared/config/env'

type NavIconName = 'home' | 'market' | 'ai' | 'event' | 'more'

const PRIMARY_NAV_ITEMS: Array<{
  to: string
  label: string
  icon: NavIconName
  event?: boolean
}> = [
  { to: '/', label: '홈', icon: 'home' },
  { to: '/sector-flow', label: '시장', icon: 'market' },
  { to: '/ai-analysis', label: 'AI 분석', icon: 'ai' },
  { to: '/events/sk-hynix', label: 'SK 이벤트', icon: 'event', event: true },
]

const MORE_NAV_ITEMS = [
  {
    to: '/market-movers',
    label: '전일 대비 급등락',
    description: '미국·국내 증시의 급등주와 급락주를 한눈에 확인해요.',
  },
  {
    to: '/closing-bet',
    label: '종가베팅',
    description: '수급 지속 가능성과 제외 신호로 후보를 추려요.',
  },
  {
    to: '/paper-trading',
    label: '모의투자',
    description: '실제 돈 없이 매매와 계좌 관리를 연습해요.',
  },
  {
    to: '/paper-trading/rankings',
    label: '투자 랭킹',
    description: '다른 투자자와 수익률을 비교하고 내 순위를 확인해요.',
  },
  {
    to: '/strategy-simulation',
    label: '전략 연습',
    description: '과거 데이터로 투자 전략을 검증해요.',
  },
] as const

function NavIcon({ name }: { name: NavIconName }) {
  if (name === 'home') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3.8 10.4 12 3.7l8.2 6.7v8.3a1.6 1.6 0 0 1-1.6 1.6H5.4a1.6 1.6 0 0 1-1.6-1.6Z" />
        <path d="M9.2 20.3v-6.2h5.6v6.2" />
      </svg>
    )
  }

  if (name === 'market') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 19V5M4 19h16" />
        <path d="m7 15 3.2-3.4 3 2.1L19 7.5" />
      </svg>
    )
  }

  if (name === 'event') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12.2 3.2 9.3 9H5.8l4.1 3.2-1.6 7.1 8-8.5h-4.1l3.1-7.6Z" />
      </svg>
    )
  }

  if (name === 'ai') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 3 1.2 4.1L17 9l-3.8 1.9L12 15l-1.2-4.1L7 9l3.8-1.9Z" />
        <path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7Z" />
        <path d="M5 14.5V20m-2.7-2.7h5.4" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="6" r="1.3" />
      <circle cx="12" cy="6" r="1.3" />
      <circle cx="18" cy="6" r="1.3" />
      <circle cx="6" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="18" cy="12" r="1.3" />
      <circle cx="6" cy="18" r="1.3" />
      <circle cx="12" cy="18" r="1.3" />
      <circle cx="18" cy="18" r="1.3" />
    </svg>
  )
}

export function AppLayout() {
  const location = useLocation()
  const [isMoreOpen, setIsMoreOpen] = useState(false)
  const closeMoreRef = useRef<HTMLButtonElement>(null)
  const isMoreRoute = MORE_NAV_ITEMS.some((item) => item.to === location.pathname)

  useEffect(() => {
    trackScreenView(location.pathname)
    setIsMoreOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const closeEntrySheet = () => setIsMoreOpen(false)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        closeEntrySheet()
      }
    }

    closeEntrySheet()
    window.addEventListener('pageshow', closeEntrySheet)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('pageshow', closeEntrySheet)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (!isMoreOpen) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      setIsMoreOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isMoreOpen])

  useEffect(() => {
    if (isMoreOpen) {
      closeMoreRef.current?.focus()
    }
  }, [isMoreOpen])

  return (
    <div className="app-shell">
      <div className="app-frame">
        <header className="app-header">
          <div className="app-header__topline">
            <p className="app-header__eyebrow">한눈투자</p>
          </div>
        </header>

        <BackendWarmupCompanion />

        <main className="app-content">
          <Outlet />
        </main>

        <BannerAd adGroupId={env.ads.bannerAdGroupId} />

        <nav className="app-nav" aria-label="하단 메뉴">
          {PRIMARY_NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                [
                  'app-nav__link',
                  item.event ? 'app-nav__link--event' : '',
                  isActive ? 'app-nav__link--active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')
              }
              end={item.to === '/'}
              onClick={() => setIsMoreOpen(false)}
            >
              <NavIcon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
          <button
            type="button"
            className={isMoreOpen || isMoreRoute ? 'app-nav__link app-nav__link--active' : 'app-nav__link'}
            aria-expanded={isMoreOpen}
            aria-controls="app-more-menu"
            onClick={() => setIsMoreOpen((value) => !value)}
          >
            <NavIcon name="more" />
            <span>더보기</span>
          </button>
        </nav>
      </div>

      {isMoreOpen ? (
        <div className="app-overlay" role="presentation" onMouseDown={() => setIsMoreOpen(false)}>
          <section
            id="app-more-menu"
            className="app-menu-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-more-menu-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="app-menu-sheet__header">
              <div>
                <p>전체 메뉴</p>
                <h2 id="app-more-menu-title">다른 기능도 둘러보세요</h2>
              </div>
              <button
                ref={closeMoreRef}
                type="button"
                className="app-dialog__icon-button"
                aria-label="전체 메뉴 닫기"
                onClick={() => setIsMoreOpen(false)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div className="app-menu-sheet__list">
              {MORE_NAV_ITEMS.map((item) => (
                <NavLink key={item.to} to={item.to} onClick={() => setIsMoreOpen(false)}>
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                  <b aria-hidden="true">›</b>
                </NavLink>
              ))}
            </div>
          </section>
        </div>
      ) : null}

    </div>
  )
}
