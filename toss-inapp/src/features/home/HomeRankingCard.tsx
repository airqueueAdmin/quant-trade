import { useEffect, useState } from 'react'
import { getAnonymousKey } from '@apps-in-toss/web-bridge'
import { Link } from 'react-router-dom'

import { apiClient } from '../../shared/api/client'
import { ApiError } from '../../shared/api/http'
import type { PaperTradingRankingResponse } from '../../shared/api/types'
import {
  clearStoredSession,
  readStoredSession,
  writeStoredSession,
  type AppSession,
} from '../../shared/session/appSession'

function formatPct(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function returnClass(value: number) {
  if (value > 0) return 'value-positive'
  if (value < 0) return 'value-negative'
  return 'value-neutral'
}

function rankingErrorMessage(caughtError: unknown) {
  if (caughtError instanceof ApiError) {
    return caughtError.status === 404
      ? '최신 랭킹 API에 연결하지 못했어요.'
      : caughtError.detail
  }
  if (caughtError instanceof TypeError) {
    return '랭킹 서버에 연결하지 못했어요.'
  }
  return '랭킹을 불러오지 못했어요.'
}

export function HomeRankingCard() {
  const [session, setSession] = useState<AppSession | null>(() => readStoredSession())
  const [ranking, setRanking] = useState<PaperTradingRankingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    const abortController = new AbortController()

    async function loadSessionAndRanking() {
      setLoading(true)
      setError(null)
      try {
        let activeSession = session ?? readStoredSession()
        if (!activeSession) {
          let anonymousKeyResult: Awaited<ReturnType<typeof getAnonymousKey>>
          try {
            anonymousKeyResult = await getAnonymousKey()
          } catch {
            anonymousKeyResult = undefined
          }

          if (anonymousKeyResult && anonymousKeyResult !== 'ERROR' && anonymousKeyResult.type === 'HASH') {
            const response = await apiClient.tossUserSession(anonymousKeyResult.hash)
            activeSession = {
              accountId: response.account_id,
              sessionToken: response.session_token,
              identitySource: response.identity_source,
            }
          } else {
            const response = await apiClient.bootstrapSession()
            activeSession = {
              accountId: response.account_id,
              sessionToken: response.session_token,
              identitySource: response.identity_source,
            }
          }
          writeStoredSession(activeSession)
          setSession(activeSession)
        }

        const response = await apiClient.paperTradingRankings(
          activeSession.sessionToken,
          'return',
          abortController.signal,
        )
        if (!abortController.signal.aborted) {
          setRanking(response)
        }
      } catch (caughtError) {
        if (abortController.signal.aborted) return
        if (caughtError instanceof ApiError && caughtError.status === 401) {
          clearStoredSession()
          setSession(null)
          setRefreshToken((value) => value + 1)
          return
        }
        setError(rankingErrorMessage(caughtError))
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false)
        }
      }
    }

    void loadSessionAndRanking()
    return () => abortController.abort()
  }, [refreshToken, session])

  return (
    <section className="home-ranking" aria-labelledby="home-ranking-title">
      <div className="home-ranking__header">
        <div>
          <p>모의투자 랭킹</p>
          <h2 id="home-ranking-title">투자 실력을 비교해보세요</h2>
        </div>
        <Link to="/paper-trading/rankings">전체보기 <span aria-hidden="true">›</span></Link>
      </div>

      {loading && !ranking ? <div className="home-ranking__state">순위를 계산하고 있어요...</div> : null}

      {error ? (
        <div className="home-ranking__state home-ranking__state--error">
          <span>{error}</span>
          <button type="button" onClick={() => setRefreshToken((value) => value + 1)}>다시 시도</button>
        </div>
      ) : null}

      {ranking ? (
        <>
          {ranking.my_entry ? (
            <div className="home-ranking__mine">
              <div>
                <span>내 현재 순위</span>
                <strong>{ranking.my_entry.rank}<small>위</small></strong>
              </div>
              <div>
                <span>누적 수익률</span>
                <strong className={returnClass(ranking.my_entry.total_return_pct)}>
                  {formatPct(ranking.my_entry.total_return_pct)}
                </strong>
              </div>
            </div>
          ) : (
            <Link className="home-ranking__start" to="/paper-trading">
              <span aria-hidden="true">🏁</span>
              <span>
                <strong>첫 거래 후 내 순위가 생겨요</strong>
                <small>모의투자로 부담 없이 시작해보세요</small>
              </span>
              <b aria-hidden="true">›</b>
            </Link>
          )}

          {ranking.entries.length > 0 ? (
            <div className="home-ranking__leaders" aria-label="모의투자 상위 3명">
              {ranking.entries.slice(0, 3).map((entry) => (
                <article key={`${entry.rank}-${entry.nickname}`}>
                  <span className={`home-ranking__rank home-ranking__rank--${entry.rank}`}>{entry.rank}</span>
                  <div>
                    <strong>{entry.nickname}{entry.is_me ? <em>나</em> : null}</strong>
                    <small>{entry.top_holding ? `최다 보유 ${entry.top_holding.company_name}` : '보유 종목 없음'}</small>
                  </div>
                  <b className={returnClass(entry.total_return_pct)}>{formatPct(entry.total_return_pct)}</b>
                </article>
              ))}
            </div>
          ) : (
            <div className="home-ranking__state">아직 랭킹 참여자가 없어요.</div>
          )}

          <p className="home-ranking__summary">
            지금 {ranking.participant_count.toLocaleString('ko-KR')}명이 모의투자에 참여하고 있어요
          </p>
        </>
      ) : null}
    </section>
  )
}
