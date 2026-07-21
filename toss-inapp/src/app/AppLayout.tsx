import { useEffect, useRef, useState } from 'react'
import { closeView } from '@apps-in-toss/web-bridge'
import { NavLink, Outlet, useLocation } from 'react-router-dom'

import { BannerAd } from '../shared/ads/BannerAd'
import { env } from '../shared/config/env'

type NavIconName = 'home' | 'market' | 'ai' | 'target' | 'more'

const PRIMARY_NAV_ITEMS: Array<{ to: string; label: string; icon: NavIconName }> = [
  { to: '/', label: '홈', icon: 'home' },
  { to: '/sector-flow', label: '시장', icon: 'market' },
  { to: '/ai-analysis', label: 'AI 분석', icon: 'ai' },
  { to: '/closing-bet', label: '종가베팅', icon: 'target' },
]

const MORE_NAV_ITEMS = [
  {
    to: '/paper-trading',
    label: '모의투자',
    description: '실제 돈 없이 매매와 계좌 관리를 연습해요.',
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

  if (name === 'target') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.2" />
        <circle cx="12" cy="12" r="3.2" />
        <path d="M18.2 5.8 21 3m0 0v4m0-4h-4" />
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
  const [isExitOpen, setIsExitOpen] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [exitError, setExitError] = useState<string | null>(null)
  const cancelExitRef = useRef<HTMLButtonElement>(null)
  const closeMoreRef = useRef<HTMLButtonElement>(null)
  const isMoreRoute = MORE_NAV_ITEMS.some((item) => item.to === location.pathname)

  useEffect(() => {
    if (!isMoreOpen && !isExitOpen) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      setIsMoreOpen(false)
      setIsExitOpen(false)
      setExitError(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isExitOpen, isMoreOpen])

  useEffect(() => {
    if (isExitOpen) {
      cancelExitRef.current?.focus()
    }
  }, [isExitOpen])

  useEffect(() => {
    if (isMoreOpen) {
      closeMoreRef.current?.focus()
    }
  }, [isMoreOpen])

  function openExitConfirmation() {
    setIsMoreOpen(false)
    setExitError(null)
    setIsExitOpen(true)
  }

  function closeExitConfirmation() {
    if (isClosing) {
      return
    }
    setIsExitOpen(false)
    setExitError(null)
  }

  async function handleCloseApp() {
    setIsClosing(true)
    setExitError(null)
    try {
      await closeView()
    } catch {
      setExitError('토스 앱 안에서만 서비스를 종료할 수 있어요.')
      setIsClosing(false)
    }
  }

  return (
    <div className="app-shell">
      <div className="app-frame">
        <header className="app-header">
          <div className="app-header__topline">
            <p className="app-header__eyebrow">한눈투자</p>
            <button
              type="button"
              className="app-header__close"
              aria-label="서비스 종료"
              onClick={openExitConfirmation}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </header>

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
                isActive ? 'app-nav__link app-nav__link--active' : 'app-nav__link'
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

      {isExitOpen ? (
        <div className="app-overlay app-overlay--center" role="presentation" onMouseDown={closeExitConfirmation}>
          <section
            className="app-exit-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-exit-dialog-title"
            aria-describedby="app-exit-dialog-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="app-exit-dialog-title">종료하시겠습니까?</h2>
            <p id="app-exit-dialog-description">한눈투자를 종료하고 토스로 돌아갑니다.</p>
            {exitError ? <p className="app-exit-dialog__error">{exitError}</p> : null}
            <div className="app-exit-dialog__actions">
              <button ref={cancelExitRef} type="button" className="secondary-action" onClick={closeExitConfirmation}>
                취소
              </button>
              <button type="button" className="primary-action" onClick={() => void handleCloseApp()} disabled={isClosing}>
                {isClosing ? '종료 중...' : '종료'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
