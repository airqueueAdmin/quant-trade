import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { apiClient } from '../../../shared/api/client'
import { ApiError } from '../../../shared/api/http'
import type {
  QuoteSnapshot,
  SentimentArticle,
  SentimentResult,
  StockHistoryRow,
} from '../../../shared/api/types'
import {
  calculateAddBuyDecision,
  isValidAddBuyInputs,
  type AddBuyInputs,
} from './addBuyDecision'

const SK_HYNIX_PARAMS = '?market=krx&ticker=000660&krx_exchange=kospi'
const POSITIVE_TERMS = [
  '사상 최대',
  '최대 실적',
  '호실적',
  '깜짝 실적',
  '상향',
  '성장',
  '증가',
  '확대',
  '수주',
  '공급 계약',
  '협력',
  '양산',
  '승인',
  '반등',
  '목표가 상향',
  '목표주가 상향',
  '목표가 올',
  '목표주가 올',
  'record',
  'beats',
  'growth',
  'raises',
  'partnership',
  'supply deal',
  'expands',
] as const
const NEGATIVE_TERMS = [
  '급락',
  '하락',
  '우려',
  '위험',
  '리스크',
  '부진',
  '감소',
  '하향',
  '규제',
  '제재',
  '경쟁 심화',
  '매도',
  '적자',
  '조사',
  '차질',
  '소송',
  '반토막',
  '약세',
  '어닝 미스',
  'plunge',
  'slump',
  'falls',
  'drop',
  'concern',
  'risk',
  'downgrade',
  'decline',
  'lawsuit',
  'delay',
  'weak',
] as const

const EVENT_ACTIONS = [
  {
    number: '01',
    eyebrow: '뉴스 온도',
    title: 'AI로 투자 심리 보기',
    description: '조금 더 넓은 기간의 뉴스 분위기와 투자 심리를 확인해요.',
    to: `/ai-analysis${SK_HYNIX_PARAMS}`,
    color: 'coral',
  },
  {
    number: '02',
    eyebrow: '과거 검증',
    title: '투자 전략 돌려보기',
    description: '이동평균·RSI 같은 전략을 과거 데이터로 먼저 검증해요.',
    to: `/strategy-simulation${SK_HYNIX_PARAMS}`,
    color: 'violet',
  },
  {
    number: '03',
    eyebrow: '실전 전 연습',
    title: '모의투자로 대응하기',
    description: '현재가를 기준으로 사고파는 과정을 실제 돈 없이 연습해요.',
    to: '/paper-trading?ticker=000660',
    color: 'amber',
  },
] as const

type NewsTone = 'positive' | 'negative' | 'neutral'
type ClassifiedArticle = SentimentArticle & {
  sentiment: NewsTone
  sentiment_reason: string
}

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

function kstDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  )
  return `${values.year}-${values.month}-${values.day}`
}

function isPublishedTodayKst(value?: string) {
  if (!value) {
    return false
  }
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && kstDateKey(parsed) === kstDateKey(new Date())
}

function formatKstDateTime(value?: string) {
  if (!value) {
    return '기준 시점 확인 중'
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value.slice(0, 16).replace('T', ' ')
  }
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(parsed)
}

function formatTodayLabel() {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date())
}

function recentStockWindow() {
  const endDate = new Date()
  endDate.setDate(endDate.getDate() + 1)
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - 120)
  const format = (value: Date) => {
    const year = value.getFullYear()
    const month = `${value.getMonth() + 1}`.padStart(2, '0')
    const day = `${value.getDate()}`.padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  return { startDate: format(startDate), endDate: format(endDate) }
}

function parseAmount(value: string) {
  const parsed = Number(value.replaceAll(',', '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeAmountInput(value: string) {
  return value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
}

function classifyArticle(article: SentimentArticle): ClassifiedArticle {
  if (article.sentiment) {
    return {
      ...article,
      sentiment: article.sentiment,
      sentiment_reason:
        article.sentiment_reason || 'AI가 기사 제목의 투자 영향을 분류했어요.',
    }
  }

  const normalizedTitle = article.title.toLowerCase()
  const positiveHits = POSITIVE_TERMS.filter((term) => normalizedTitle.includes(term))
  const negativeHits = NEGATIVE_TERMS.filter((term) => normalizedTitle.includes(term))

  if (positiveHits.length > negativeHits.length) {
    return {
      ...article,
      sentiment: 'positive',
      sentiment_reason: '제목의 실적·성장·계약 관련 긍정 표현을 반영했어요.',
    }
  }
  if (negativeHits.length > positiveHits.length) {
    return {
      ...article,
      sentiment: 'negative',
      sentiment_reason: '제목의 하락·우려·위험 관련 부정 표현을 반영했어요.',
    }
  }
  return {
    ...article,
    sentiment: 'neutral',
    sentiment_reason: '제목만으로 투자 방향을 단정하기 어려운 소식이에요.',
  }
}

function NewsGroup({
  title,
  description,
  tone,
  articles,
}: {
  title: string
  description: string
  tone: 'positive' | 'negative'
  articles: ClassifiedArticle[]
}) {
  return (
    <section className={`hynix-news__group hynix-news__group--${tone}`}>
      <div className="hynix-news__group-heading">
        <span aria-hidden="true">{tone === 'positive' ? '+' : '−'}</span>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <strong>{articles.length}</strong>
      </div>

      {articles.length > 0 ? (
        <div className="hynix-news__list">
          {articles.map((article, index) => (
            <a
              key={`${article.url}-${index}`}
              className="hynix-news__item"
              href={article.url}
              target="_blank"
              rel="noreferrer"
            >
              <span className="hynix-news__item-meta">
                <b>{article.source_name || article.source || '뉴스'}</b>
                <time dateTime={article.published_at}>
                  {formatKstDateTime(article.published_at)}
                </time>
              </span>
              <strong>{article.title}</strong>
              <span className="hynix-news__reason">{article.sentiment_reason}</span>
              <span className="hynix-news__original">
                원문 보기 <b aria-hidden="true">↗</b>
              </span>
            </a>
          ))}
        </div>
      ) : (
        <p className="hynix-news__empty">오늘 이 분류에 해당하는 뉴스가 아직 없어요.</p>
      )}
    </section>
  )
}

export function SkHynixEventPage() {
  const [quote, setQuote] = useState<QuoteSnapshot | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(true)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [news, setNews] = useState<SentimentResult | null>(null)
  const [newsLoading, setNewsLoading] = useState(true)
  const [newsError, setNewsError] = useState<string | null>(null)
  const [historyRows, setHistoryRows] = useState<StockHistoryRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [averagePrice, setAveragePrice] = useState('')
  const [shares, setShares] = useState('')
  const [addBudget, setAddBudget] = useState('')
  const [portfolioWeight, setPortfolioWeight] = useState('')
  const [hasRequestedDecision, setHasRequestedDecision] = useState(false)

  useEffect(() => {
    const abortController = new AbortController()

    async function loadQuote() {
      setQuoteLoading(true)
      setQuoteError(null)
      try {
        const response = await apiClient.quote('000660', 'krx', 'kospi', abortController.signal)
        setQuote(response)
      } catch (caughtError) {
        if (abortController.signal.aborted) {
          return
        }
        setQuote(null)
        setQuoteError(
          caughtError instanceof ApiError
            ? caughtError.detail
            : '시세 API 서버에 연결하지 못했습니다.',
        )
      } finally {
        if (!abortController.signal.aborted) {
          setQuoteLoading(false)
        }
      }
    }

    async function loadTodayNews() {
      setNewsLoading(true)
      setNewsError(null)
      try {
        const response = await apiClient.todaySentiment(
          '000660',
          'krx',
          'kospi',
          abortController.signal,
        )
        setNews(response)
      } catch (caughtError) {
        if (abortController.signal.aborted) {
          return
        }
        setNews(null)
        setNewsError(
          caughtError instanceof ApiError
            ? caughtError.detail
            : '최신 뉴스 API 서버에 연결하지 못했습니다.',
        )
      } finally {
        if (!abortController.signal.aborted) {
          setNewsLoading(false)
        }
      }
    }

    async function loadHistory() {
      setHistoryLoading(true)
      setHistoryError(null)
      try {
        const { startDate, endDate } = recentStockWindow()
        const response = await apiClient.stockData(
          '000660',
          startDate,
          endDate,
          'krx',
          'kospi',
          abortController.signal,
        )
        setHistoryRows(response.rows)
      } catch (caughtError) {
        if (abortController.signal.aborted) {
          return
        }
        setHistoryRows([])
        setHistoryError(
          caughtError instanceof ApiError
            ? caughtError.detail
            : '최근 가격 흐름을 불러오지 못했습니다.',
        )
      } finally {
        if (!abortController.signal.aborted) {
          setHistoryLoading(false)
        }
      }
    }

    void loadQuote()
    void loadTodayNews()
    void loadHistory()
    return () => abortController.abort()
  }, [refreshToken])

  const changeTone =
    quote && quote.change_pct > 0
      ? 'hynix-event__quote-change--up'
      : quote && quote.change_pct < 0
        ? 'hynix-event__quote-change--down'
        : ''
  const classifiedArticles = (news?.articles ?? [])
    .filter((article) => isPublishedTodayKst(article.published_at))
    .map(classifyArticle)
  const positiveArticles = classifiedArticles.filter(
    (article) => article.sentiment === 'positive',
  )
  const negativeArticles = classifiedArticles.filter(
    (article) => article.sentiment === 'negative',
  )
  const neutralArticles = classifiedArticles.filter(
    (article) => article.sentiment === 'neutral',
  )
  const addBuyInputs: AddBuyInputs = {
    averagePrice: parseAmount(averagePrice),
    shares: parseAmount(shares),
    budget: parseAmount(addBudget),
    portfolioWeight: parseAmount(portfolioWeight),
  }
  const addBuyDecision = useMemo(
    () =>
      calculateAddBuyDecision({
        currentPrice: quote?.close ?? 0,
        changePct: quote?.change_pct ?? 0,
        rows: historyRows,
        positiveNewsCount: positiveArticles.length,
        negativeNewsCount: negativeArticles.length,
        newsReady: !newsLoading && !newsError && news !== null,
        inputs: addBuyInputs,
      }),
    [
      addBuyInputs.averagePrice,
      addBuyInputs.budget,
      addBuyInputs.portfolioWeight,
      addBuyInputs.shares,
      historyRows,
      negativeArticles.length,
      news,
      newsError,
      newsLoading,
      positiveArticles.length,
      quote,
    ],
  )
  const addBuyInputError = !isValidAddBuyInputs(addBuyInputs)
    ? '평단가·보유 수량·추가 예산을 입력하고, 현재 비중은 0% 초과 100% 이하로 적어주세요.'
    : quote && addBuyInputs.budget < quote.close
      ? `추가 예산이 현재 1주 가격 ${formatKrw(quote.close)}보다 적어요.`
      : null

  return (
    <main className="page-shell hynix-event">
      <section className="hynix-event__hero">
        <div className="hynix-event__glow hynix-event__glow--one" aria-hidden="true" />
        <div className="hynix-event__glow hynix-event__glow--two" aria-hidden="true" />

        <div className="hynix-event__badge-row">
          <span className="hynix-event__badge">EVENT</span>
          <span>SK하이닉스 투자자 전용</span>
        </div>

        <p className="hynix-event__ticker">000660 · KOSPI</p>
        <h1 className="hynix-event__title">
          SK하이닉스를 보는
          <br />
          <em>네 가지 투자 시선</em>
        </h1>
        <p className="hynix-event__description">
          추매 판단부터 오늘의 뉴스, 과거 전략, 모의투자까지 필요한 체크만 모았어요.
        </p>

        <a className="hynix-event__primary-link" href="#hynix-add-buy">
          내 추매 판단 받기
          <span aria-hidden="true">↓</span>
        </a>

        <div className="hynix-event__quote" aria-live="polite">
          <div>
            <span>SK하이닉스 현재가</span>
            {quoteLoading ? <strong>불러오는 중...</strong> : null}
            {!quoteLoading && quote ? <strong>{formatKrw(quote.close)}</strong> : null}
            {!quoteLoading && quoteError ? <strong>시세 연결 필요</strong> : null}
          </div>
          {!quoteLoading && quote ? (
            <div className={`hynix-event__quote-change ${changeTone}`}>
              <strong>{formatPct(quote.change_pct)}</strong>
              <span>
                {quote.source === 'naver_finance_realtime' ? '실시간' : '최근 종가'} ·{' '}
                {formatKstDateTime(quote.as_of)}
              </span>
            </div>
          ) : null}
          {!quoteLoading && quoteError ? (
            <button
              type="button"
              className="hynix-event__retry"
              title={quoteError}
              onClick={() => setRefreshToken((value) => value + 1)}
            >
              다시 시도
            </button>
          ) : null}
        </div>
      </section>

      <section
        id="hynix-add-buy"
        className="hynix-add-buy"
        aria-labelledby="hynix-add-buy-title"
      >
        <div className="hynix-event__section-heading">
          <span>ADD-BUY CHECK</span>
          <h2 id="hynix-add-buy-title">지금 추매해도 될까요?</h2>
          <p>내 보유 정보와 최신 가격·추세·뉴스·종목 비중을 함께 계산해요.</p>
        </div>

        <div className="hynix-add-buy__form">
          <div className="hynix-add-buy__field-grid">
            <label className="hynix-add-buy__field" htmlFor="hynix-average-price">
              <span>내 평단가</span>
              <span className="hynix-add-buy__input-wrap">
                <input
                  id="hynix-average-price"
                  inputMode="decimal"
                  value={averagePrice}
                  onChange={(event) => {
                    setAveragePrice(normalizeAmountInput(event.target.value))
                    setHasRequestedDecision(false)
                  }}
                  placeholder="예: 180000"
                />
                <b>원</b>
              </span>
            </label>
            <label className="hynix-add-buy__field" htmlFor="hynix-shares">
              <span>보유 수량</span>
              <span className="hynix-add-buy__input-wrap">
                <input
                  id="hynix-shares"
                  inputMode="decimal"
                  value={shares}
                  onChange={(event) => {
                    setShares(normalizeAmountInput(event.target.value))
                    setHasRequestedDecision(false)
                  }}
                  placeholder="예: 10"
                />
                <b>주</b>
              </span>
            </label>
            <label className="hynix-add-buy__field" htmlFor="hynix-add-budget">
              <span>이번 추가 예산</span>
              <span className="hynix-add-buy__input-wrap">
                <input
                  id="hynix-add-budget"
                  inputMode="decimal"
                  value={addBudget}
                  onChange={(event) => {
                    setAddBudget(normalizeAmountInput(event.target.value))
                    setHasRequestedDecision(false)
                  }}
                  placeholder="예: 2000000"
                />
                <b>원</b>
              </span>
            </label>
            <label className="hynix-add-buy__field" htmlFor="hynix-portfolio-weight">
              <span>현재 계좌 내 SK 비중</span>
              <span className="hynix-add-buy__input-wrap">
                <input
                  id="hynix-portfolio-weight"
                  inputMode="decimal"
                  value={portfolioWeight}
                  onChange={(event) => {
                    setPortfolioWeight(normalizeAmountInput(event.target.value))
                    setHasRequestedDecision(false)
                  }}
                  placeholder="예: 20"
                />
                <b>%</b>
              </span>
            </label>
          </div>

          <div className="hynix-add-buy__data-status" aria-live="polite">
            {quoteLoading || historyLoading ? (
              <span>최신 시세와 120일 가격 흐름을 확인하고 있어요.</span>
            ) : null}
            {!quoteLoading && !historyLoading && !quoteError && !historyError ? (
              <span>최신 시세 · 이동평균 · RSI · 오늘 뉴스 반영 준비 완료</span>
            ) : null}
            {historyError ? <span>가격 추세 데이터가 부족해 보수적으로 판단해요.</span> : null}
            {quoteError ? <span>현재가를 불러온 뒤 판단할 수 있어요.</span> : null}
          </div>

          <button
            type="button"
            className="hynix-add-buy__submit"
            disabled={quoteLoading || historyLoading || Boolean(quoteError)}
            onClick={() => setHasRequestedDecision(true)}
          >
            {quoteLoading || historyLoading ? '판단 데이터 준비 중...' : '추매 판단 계산하기'}
          </button>
          <p className="hynix-add-buy__privacy">입력값은 서버로 전송하거나 저장하지 않아요.</p>
        </div>

        {hasRequestedDecision && addBuyInputError ? (
          <div className="hynix-add-buy__input-error" role="alert">
            {addBuyInputError}
          </div>
        ) : null}

        {hasRequestedDecision && addBuyDecision ? (
          <div className={`hynix-add-buy__result hynix-add-buy__result--${addBuyDecision.verdict}`}>
            <div className="hynix-add-buy__result-top">
              <div
                className="hynix-add-buy__score"
                style={{
                  background: `conic-gradient(var(--decision-color) ${addBuyDecision.score}%, #e9edf1 0)`,
                }}
                aria-label={`추매 판단 점수 ${addBuyDecision.score}점`}
              >
                <span>
                  <strong>{addBuyDecision.score}</strong>
                  <small>100점</small>
                </span>
              </div>
              <div className="hynix-add-buy__verdict">
                <span>{addBuyDecision.verdictLabel}</span>
                <h3>{addBuyDecision.headline}</h3>
                <p>{addBuyDecision.action}</p>
              </div>
            </div>

            <div className="hynix-add-buy__plan" aria-label="추매 후 예상 변화">
              <div>
                <span>살 수 있는 수량</span>
                <strong>{addBuyDecision.purchasableShares.toLocaleString('ko-KR')}주</strong>
                <small>{formatKrw(addBuyDecision.expectedSpend)} 사용</small>
              </div>
              <div>
                <span>추매 후 평단</span>
                <strong>{formatKrw(addBuyDecision.newAveragePrice)}</strong>
                <small>현재가 {formatKrw(quote?.close)}</small>
              </div>
              <div>
                <span>추매 후 SK 비중</span>
                <strong>{addBuyDecision.afterWeight.toFixed(1)}%</strong>
                <small>현재 {addBuyInputs.portfolioWeight.toFixed(1)}%</small>
              </div>
            </div>

            <div className="hynix-add-buy__factors">
              <h4>왜 이렇게 판단했나요?</h4>
              <div className="hynix-add-buy__factor-list">
                {addBuyDecision.factors.map((factor) => (
                  <article key={factor.label} className={`hynix-add-buy__factor hynix-add-buy__factor--${factor.tone}`}>
                    <span>{factor.label}</span>
                    <strong>{factor.value}</strong>
                    <p>{factor.explanation}</p>
                  </article>
                ))}
              </div>
            </div>

            {addBuyDecision.safeguards.length > 0 ? (
              <div className="hynix-add-buy__safeguards">
                <h4>매수 전 멈춤 조건</h4>
                <ul>
                  {addBuyDecision.safeguards.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            ) : null}

            <p className="hynix-add-buy__result-note">
              점수는 수익을 보장하는 예측값이 아니라, 감정적인 물타기와 과도한 비중 확대를 막기 위한 체크 결과예요.
            </p>
          </div>
        ) : null}
      </section>

      <section
        id="today-hynix-news"
        className="hynix-news"
        aria-labelledby="today-hynix-news-title"
      >
        <div className="hynix-event__section-heading">
          <span>TODAY NEWS · {formatTodayLabel()}</span>
          <h2 id="today-hynix-news-title">오늘의 호재와 악재</h2>
          <p>한국 시간 기준 오늘 보도된 기사만 최신순으로 분류했어요.</p>
        </div>

        {newsLoading ? (
          <div className="hynix-news__state">최신 뉴스를 분석하고 있어요...</div>
        ) : null}

        {!newsLoading && newsError ? (
          <div className="hynix-news__state hynix-news__state--error">
            <strong>뉴스를 불러오지 못했어요.</strong>
            <span>{newsError}</span>
            <button type="button" onClick={() => setRefreshToken((value) => value + 1)}>
              다시 시도
            </button>
          </div>
        ) : null}

        {!newsLoading && !newsError && news ? (
          <>
            <div className="hynix-news__scoreboard" aria-label="오늘 뉴스 분류 요약">
              <div className="hynix-news__scoreboard-item hynix-news__scoreboard-item--positive">
                <span>호재</span>
                <strong>{positiveArticles.length}</strong>
              </div>
              <div className="hynix-news__scoreboard-item hynix-news__scoreboard-item--negative">
                <span>악재</span>
                <strong>{negativeArticles.length}</strong>
              </div>
              <div className="hynix-news__scoreboard-item">
                <span>중립</span>
                <strong>{neutralArticles.length}</strong>
              </div>
            </div>

            {classifiedArticles.length > 0 ? (
              <p className="hynix-news__summary">{news.summary}</p>
            ) : (
              <div className="hynix-news__state">
                오늘 한국 시간 기준으로 확인된 SK하이닉스 뉴스가 아직 없어요.
              </div>
            )}

            {classifiedArticles.length > 0 ? (
              <div className="hynix-news__groups">
                <NewsGroup
                  title="호재로 본 뉴스"
                  description="실적·성장·계약에 긍정적인 소식"
                  tone="positive"
                  articles={positiveArticles}
                />
                <NewsGroup
                  title="악재로 본 뉴스"
                  description="가격·수요·경쟁에 부담이 될 소식"
                  tone="negative"
                  articles={negativeArticles}
                />
              </div>
            ) : null}

            {neutralArticles.length > 0 ? (
              <details className="hynix-news__neutral">
                <summary>판단 보류 뉴스 {neutralArticles.length}건</summary>
                <div className="hynix-news__list">
                  {neutralArticles.map((article, index) => (
                    <a
                      key={`${article.url}-${index}`}
                      className="hynix-news__item"
                      href={article.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span className="hynix-news__item-meta">
                        <b>{article.source_name || article.source || '뉴스'}</b>
                        <time dateTime={article.published_at}>
                          {formatKstDateTime(article.published_at)}
                        </time>
                      </span>
                      <strong>{article.title}</strong>
                      <span className="hynix-news__reason">{article.sentiment_reason}</span>
                    </a>
                  ))}
                </div>
              </details>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="hynix-event__actions" aria-labelledby="hynix-event-actions-title">
        <div className="hynix-event__section-heading">
          <span>INVESTOR CHECK</span>
          <h2 id="hynix-event-actions-title">다음은 무엇을 볼까요?</h2>
          <p>원하는 메뉴를 누르면 SK하이닉스가 미리 선택된 상태로 시작해요.</p>
        </div>

        <div className="hynix-event__action-list">
          {EVENT_ACTIONS.map((action) => (
            <Link
              key={action.number}
              className={`hynix-event__action hynix-event__action--${action.color}`}
              to={action.to}
            >
              <span className="hynix-event__action-number">{action.number}</span>
              <span className="hynix-event__action-copy">
                <small>{action.eyebrow}</small>
                <strong>{action.title}</strong>
                <span>{action.description}</span>
              </span>
              <b aria-hidden="true">↗</b>
            </Link>
          ))}
        </div>
      </section>

      <p className="hynix-event__notice">
        추매 판단과 뉴스 분류는 가격 데이터·기사 제목·입력한 비중에 기반한 참고 정보이며,
        특정 종목의 매수·매도 추천이 아닙니다. 원문과 공시를 함께 확인하세요.
      </p>
    </main>
  )
}
