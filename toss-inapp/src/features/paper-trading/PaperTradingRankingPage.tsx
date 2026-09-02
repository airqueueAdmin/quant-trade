import { useEffect, useRef, useState } from 'react'
import { getAnonymousKey } from '@apps-in-toss/web-bridge'
import { getTossShareLink, share } from '@apps-in-toss/web-framework'
import { Link } from 'react-router-dom'

import { trackGrowthEvent } from '../../shared/analytics/growthAnalytics'
import { apiClient } from '../../shared/api/client'
import { ApiError } from '../../shared/api/http'
import type {
  PaperTradingRankingEntry,
  PaperTradingRankingResponse,
  PaperTradingRankingSort,
} from '../../shared/api/types'
import {
  clearStoredSession,
  readStoredSession,
  writeStoredSession,
  type AppSession,
} from '../../shared/session/appSession'

const RANKING_REFRESH_INTERVAL_MS = 60_000

function formatKrw(value?: number | null) {
  if (value === undefined || value === null) {
    return '-'
  }
  return `${Math.round(value).toLocaleString('ko-KR')}원`
}

function formatPct(value?: number | null) {
  if (value === undefined || value === null) {
    return '-'
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function formatAsOf(value?: string | null) {
  if (!value) {
    return '-'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function returnClass(value: number) {
  if (value > 0) {
    return 'value-positive'
  }
  if (value < 0) {
    return 'value-negative'
  }
  return 'value-neutral'
}

function rankingErrorMessage(caughtError: unknown, fallback: string) {
  if (caughtError instanceof ApiError) {
    if (caughtError.status === 404) {
      return '랭킹 API를 찾지 못했습니다. 최신 백엔드가 실행 중인지 확인해주세요.'
    }
    return caughtError.detail
  }
  if (caughtError instanceof TypeError) {
    return '랭킹 서버에 연결하지 못했습니다. 로컬에서는 백엔드의 8000 포트가 실행 중인지 확인해주세요.'
  }
  if (caughtError instanceof Error) {
    return caughtError.message
  }
  return fallback
}

function ProfileAvatar({ entry, compact = false }: { entry: PaperTradingRankingEntry; compact?: boolean }) {
  const animal = entry.nickname.split(' ')[1] ?? entry.nickname.slice(0, 1)
  return (
    <span
      className={`ranking-avatar ranking-avatar--${entry.profile_color}${compact ? ' ranking-avatar--compact' : ''}`}
      aria-hidden="true"
    >
      {animal.slice(0, 1)}
    </span>
  )
}

function PodiumCard({ entry }: { entry: PaperTradingRankingEntry }) {
  return (
    <article className={`ranking-podium-card ranking-podium-card--${entry.rank}`}>
      <span className="ranking-podium-card__medal" aria-label={`${entry.rank}위`}>
        {entry.rank}
      </span>
      <ProfileAvatar entry={entry} />
      <strong className="ranking-podium-card__name">
        {entry.nickname}
        {entry.is_me ? <em>나</em> : null}
      </strong>
      <b className={returnClass(entry.total_return_pct)}>{formatPct(entry.total_return_pct)}</b>
      <small>{formatKrw(entry.total_assets_krw)}</small>
    </article>
  )
}

export function PaperTradingRankingPage() {
  const [session, setSession] = useState<AppSession | null>(() => readStoredSession())
  const [sessionLoading, setSessionLoading] = useState(true)
  const [identityRefreshToken, setIdentityRefreshToken] = useState(0)
  const [sortBy, setSortBy] = useState<PaperTradingRankingSort>('return')
  const [ranking, setRanking] = useState<PaperTradingRankingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [sharingRanking, setSharingRanking] = useState(false)
  const [shareFeedback, setShareFeedback] = useState<string | null>(null)
  const rankingViewTrackedRef = useRef(false)

  useEffect(() => {
    const refreshVisibleRanking = () => {
      if (document.visibilityState === 'visible') {
        setRefreshToken((value) => value + 1)
      }
    }
    const intervalId = window.setInterval(refreshVisibleRanking, RANKING_REFRESH_INTERVAL_MS)
    document.addEventListener('visibilitychange', refreshVisibleRanking)
    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', refreshVisibleRanking)
    }
  }, [])

  useEffect(() => {
    const abortController = new AbortController()

    async function ensureSession() {
      setSessionLoading(true)
      setError(null)
      try {
        let anonymousKeyResult: Awaited<ReturnType<typeof getAnonymousKey>>
        try {
          anonymousKeyResult = await getAnonymousKey()
        } catch {
          anonymousKeyResult = undefined
        }
        if (abortController.signal.aborted) {
          return
        }

        if (anonymousKeyResult && anonymousKeyResult !== 'ERROR' && anonymousKeyResult.type === 'HASH') {
          const response = await apiClient.tossUserSession(anonymousKeyResult.hash)
          if (abortController.signal.aborted) {
            return
          }
          const nextSession: AppSession = {
            accountId: response.account_id,
            sessionToken: response.session_token,
            identitySource: response.identity_source,
          }
          writeStoredSession(nextSession)
          setSession(nextSession)
          return
        }

        const storedSession = readStoredSession()
        if (storedSession) {
          setSession(storedSession)
          return
        }

        const response = await apiClient.bootstrapSession()
        if (abortController.signal.aborted) {
          return
        }
        const nextSession: AppSession = {
          accountId: response.account_id,
          sessionToken: response.session_token,
          identitySource: response.identity_source,
        }
        writeStoredSession(nextSession)
        setSession(nextSession)
      } catch (caughtError) {
        setError(rankingErrorMessage(caughtError, '랭킹 참여 정보를 준비하지 못했습니다.'))
      } finally {
        if (!abortController.signal.aborted) {
          setSessionLoading(false)
        }
      }
    }

    void ensureSession()
    return () => abortController.abort()
  }, [identityRefreshToken])

  useEffect(() => {
    const abortController = new AbortController()

    async function loadRanking() {
      if (sessionLoading || !session) {
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)
      try {
        const response = await apiClient.paperTradingRankings(session.sessionToken, sortBy, abortController.signal)
        setRanking(response)
        if (!rankingViewTrackedRef.current) {
          rankingViewTrackedRef.current = true
          trackGrowthEvent('ranking_viewed', {
            sort_by: sortBy,
            participant_count: response.participant_count,
            has_my_entry: Boolean(response.my_entry),
          })
        }
      } catch (caughtError) {
        if (abortController.signal.aborted) {
          return
        }
        if (caughtError instanceof ApiError && caughtError.status === 401) {
          clearStoredSession()
          setSession(null)
          setRanking(null)
          setIdentityRefreshToken((value) => value + 1)
          return
        }
        setError(rankingErrorMessage(caughtError, '모의투자 랭킹을 불러오지 못했습니다.'))
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false)
        }
      }
    }

    void loadRanking()
    return () => abortController.abort()
  }, [refreshToken, session, sessionLoading, sortBy])

  const podiumEntries = ranking?.entries.slice(0, 3) ?? []
  const listEntries = ranking?.entries.slice(3) ?? []
  const myEntry = ranking?.my_entry
  const myPercentile = myEntry && ranking?.participant_count
    ? Math.max(1, Math.ceil((myEntry.rank / ranking.participant_count) * 100))
    : null

  async function handleShareRanking() {
    if (!myEntry || sharingRanking) {
      return
    }

    setSharingRanking(true)
    setShareFeedback(null)
    trackGrowthEvent('ranking_share_started', {
      rank: myEntry.rank,
      participant_count: ranking?.participant_count ?? 0,
    })

    try {
      const tossLink = await getTossShareLink('intoss://glance-invest/paper-trading/rankings')
      await share({
        message: `한눈투자 모의투자에서 ${myEntry.rank}위를 기록했어요. 내 투자 감각도 확인해보세요.\n${tossLink}`,
      })
      setShareFeedback('공유 화면을 열었어요.')
      trackGrowthEvent('ranking_share_opened', {
        rank: myEntry.rank,
      })
    } catch {
      setShareFeedback('순위 공유는 토스 앱에서 이용할 수 있어요.')
      trackGrowthEvent('ranking_share_failed', {
        reason: 'share_unavailable',
      })
    } finally {
      setSharingRanking(false)
    }
  }

  return (
    <main className="page-shell ranking-page">
      <header className="ranking-page__header">
        <div>
          <p className="paper-page__eyebrow">모의투자 랭킹</p>
          <h1>투자 실력,<br />어디쯤일까요?</h1>
          <p>모의투자 결과로 랭킹을 알 수 있어요.</p>
        </div>
        <Link className="ranking-page__account-link" to="/paper-trading">내 계좌</Link>
      </header>

      {sessionLoading || (loading && !ranking) ? (
        <section className="ranking-loading" aria-live="polite">
          <span className="ranking-loading__shine" />
          <p>최신 평가금액으로 순위를 계산하고 있어요.</p>
        </section>
      ) : null}

      {error ? (
        <section className="ranking-error state-box state-box--error" role="alert">
          <p>{error}</p>
          <button type="button" className="secondary-action" onClick={() => setRefreshToken((value) => value + 1)}>
            다시 불러오기
          </button>
        </section>
      ) : null}

      {ranking && myEntry ? (
        <section className="ranking-my-card" aria-label="내 모의투자 순위">
          <div className="ranking-my-card__top">
            <div>
              <span>내 현재 순위</span>
              <strong>{myEntry.rank}<small>위</small></strong>
            </div>
            <span className="ranking-my-card__percentile">상위 {myPercentile}%</span>
          </div>
          <div className="ranking-my-card__metric">
            <span>누적 수익률</span>
            <strong className={returnClass(myEntry.total_return_pct)}>{formatPct(myEntry.total_return_pct)}</strong>
          </div>
          <div className="ranking-my-card__bottom">
            <span>총 자산 <b>{formatKrw(myEntry.total_assets_krw)}</b></span>
            <span>평균보다 <b>{formatPct(myEntry.total_return_pct - ranking.average_return_pct)}</b></span>
          </div>
          <button
            type="button"
            className="ranking-my-card__share"
            onClick={() => void handleShareRanking()}
            disabled={sharingRanking}
          >
            {sharingRanking ? '공유 링크 준비 중...' : '내 순위 친구에게 공유하기'}
          </button>
          {shareFeedback ? (
            <p className="ranking-my-card__share-feedback" role="status" aria-live="polite">
              {shareFeedback}
            </p>
          ) : null}
        </section>
      ) : null}

      {ranking && !myEntry ? (
        <section className="ranking-start-card">
          <span aria-hidden="true">🏁</span>
          <div>
            <strong>첫 거래 후 랭킹에 참여해요</strong>
            <p>모의투자로 한 번 이상 매매하면 내 순위가 자동으로 표시돼요.</p>
          </div>
          <Link to="/paper-trading">거래 시작</Link>
        </section>
      ) : null}

      {ranking ? (
        <>
          <section className="ranking-summary" aria-label="랭킹 요약">
            <article>
              <span>참여자</span>
              <strong>{ranking.participant_count.toLocaleString('ko-KR')}명</strong>
            </article>
            <article>
              <span>수익 중</span>
              <strong>{ranking.profitable_count.toLocaleString('ko-KR')}명</strong>
            </article>
            <article>
              <span>평균 수익률</span>
              <strong className={returnClass(ranking.average_return_pct)}>{formatPct(ranking.average_return_pct)}</strong>
            </article>
          </section>

          <section className="ranking-board">
            <div className="ranking-board__header">
              <div>
                <p>리더보드</p>
                <h2>실시간 전체 순위</h2>
              </div>
              <button
                type="button"
                className="ranking-refresh-button"
                onClick={() => setRefreshToken((value) => value + 1)}
                disabled={loading}
                aria-label="랭킹 새로고침"
              >
                <span aria-hidden="true">↻</span>
              </button>
            </div>

            <div className="ranking-sort" role="tablist" aria-label="랭킹 정렬 기준">
              <button
                type="button"
                role="tab"
                aria-selected={sortBy === 'return'}
                className={sortBy === 'return' ? 'ranking-sort__button ranking-sort__button--active' : 'ranking-sort__button'}
                onClick={() => setSortBy('return')}
              >
                수익률순
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sortBy === 'assets'}
                className={sortBy === 'assets' ? 'ranking-sort__button ranking-sort__button--active' : 'ranking-sort__button'}
                onClick={() => setSortBy('assets')}
              >
                자산순
              </button>
            </div>

            {podiumEntries.length > 0 ? (
              <div className="ranking-podium">
                {podiumEntries.map((entry) => <PodiumCard key={`${entry.rank}-${entry.nickname}`} entry={entry} />)}
              </div>
            ) : (
              <div className="state-box">아직 랭킹 참여자가 없습니다.</div>
            )}

            {listEntries.length > 0 ? (
              <div className="ranking-list" aria-label="4위 이하 순위">
                {listEntries.map((entry) => (
                  <article className={entry.is_me ? 'ranking-list-item ranking-list-item--me' : 'ranking-list-item'} key={`${entry.rank}-${entry.nickname}`}>
                    <strong className="ranking-list-item__rank">{entry.rank}</strong>
                    <ProfileAvatar entry={entry} compact />
                    <div className="ranking-list-item__identity">
                      <strong>{entry.nickname}{entry.is_me ? <em>나</em> : null}</strong>
                      <span>
                        {entry.top_holding
                          ? `최다 보유 ${entry.top_holding.company_name}`
                          : '아직 보유 종목이 없어요'}
                      </span>
                    </div>
                    <div className="ranking-list-item__value">
                      <strong className={returnClass(entry.total_return_pct)}>{formatPct(entry.total_return_pct)}</strong>
                      <span>{formatKrw(entry.total_assets_krw)}</span>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}

            <p className="ranking-board__as-of">
              {formatAsOf(ranking.as_of)} 기준 · 1분마다 자동 갱신
              {ranking.entries.some((entry) => entry.valuation_status === 'partial')
                ? ' · 일부 종목은 평균 매입가로 계산했어요.'
                : ''}
              {ranking.entries.some((entry) => entry.valuation_status === 'stale')
                ? ' · 일부 종목은 최근 정상 시세로 계산했어요.'
                : ''}
            </p>
          </section>

          <aside className="ranking-privacy-note">
            <span aria-hidden="true">🔒</span>
            <p><strong>모두 익명으로 참여해요</strong>계좌번호와 토스 사용자 정보는 다른 사람에게 공개되지 않아요.</p>
          </aside>
        </>
      ) : null}
    </main>
  )
}
