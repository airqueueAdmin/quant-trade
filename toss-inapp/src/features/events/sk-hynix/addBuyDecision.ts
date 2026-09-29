import type { StockHistoryRow } from '../../../shared/api/types'

export type AddBuyInputs = {
  averagePrice: number
  shares: number
  budget: number
  portfolioWeight: number
}

export type AddBuyFactor = {
  label: string
  value: string
  explanation: string
  tone: 'positive' | 'neutral' | 'negative'
}

export type AddBuyDecision = {
  score: number
  verdict: 'consider' | 'split' | 'wait'
  verdictLabel: string
  headline: string
  action: string
  purchasableShares: number
  expectedSpend: number
  newAveragePrice: number
  returnPct: number
  afterWeight: number
  factors: AddBuyFactor[]
  safeguards: string[]
}

type TechnicalSnapshot = {
  dataPoints: number
  ma20: number | null
  ma60: number | null
  rsi14: number | null
  twentyDayHigh: number | null
}

type DecisionContext = {
  currentPrice: number
  changePct: number
  rows: StockHistoryRow[]
  positiveNewsCount: number
  negativeNewsCount: number
  newsReady: boolean
  inputs: AddBuyInputs
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

function formatKrw(value: number) {
  return `${Math.round(value).toLocaleString('ko-KR')}원`
}

function formatPct(value: number, signed = false) {
  const sign = signed && value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

function average(values: number[]) {
  if (values.length === 0) {
    return null
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function calculateRsi(closes: number[], period = 14) {
  if (closes.length <= period) {
    return null
  }

  const changes = closes.slice(-(period + 1)).slice(1).map((close, index) => {
    const previous = closes[closes.length - (period + 1) + index]
    return close - previous
  })
  const gains = changes.reduce((sum, value) => sum + Math.max(value, 0), 0) / period
  const losses = changes.reduce((sum, value) => sum + Math.max(-value, 0), 0) / period

  if (losses === 0) {
    return gains === 0 ? 50 : 100
  }
  return 100 - 100 / (1 + gains / losses)
}

function deriveTechnicalSnapshot(rows: StockHistoryRow[], currentPrice: number): TechnicalSnapshot {
  const closes = rows
    .map((row) => Number(row.Close))
    .filter((value) => Number.isFinite(value) && value > 0)

  if (closes.length === 0 || Math.abs(closes[closes.length - 1] - currentPrice) / currentPrice > 0.0001) {
    closes.push(currentPrice)
  } else {
    closes[closes.length - 1] = currentPrice
  }

  return {
    dataPoints: closes.length,
    ma20: closes.length >= 20 ? average(closes.slice(-20)) : null,
    ma60: closes.length >= 60 ? average(closes.slice(-60)) : null,
    rsi14: calculateRsi(closes),
    twentyDayHigh: closes.length >= 20 ? Math.max(...closes.slice(-20)) : null,
  }
}

export function isValidAddBuyInputs(inputs: AddBuyInputs) {
  return (
    Number.isFinite(inputs.averagePrice) &&
    inputs.averagePrice > 0 &&
    Number.isFinite(inputs.shares) &&
    inputs.shares > 0 &&
    Number.isFinite(inputs.budget) &&
    inputs.budget > 0 &&
    Number.isFinite(inputs.portfolioWeight) &&
    inputs.portfolioWeight > 0 &&
    inputs.portfolioWeight <= 100
  )
}

export function calculateAddBuyDecision({
  currentPrice,
  changePct,
  rows,
  positiveNewsCount,
  negativeNewsCount,
  newsReady,
  inputs,
}: DecisionContext): AddBuyDecision | null {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !isValidAddBuyInputs(inputs)) {
    return null
  }

  const purchasableShares = Math.floor(inputs.budget / currentPrice)
  if (purchasableShares < 1) {
    return null
  }

  const expectedSpend = purchasableShares * currentPrice
  const currentCost = inputs.averagePrice * inputs.shares
  const currentMarketValue = currentPrice * inputs.shares
  const newAveragePrice = (currentCost + expectedSpend) / (inputs.shares + purchasableShares)
  const returnPct = ((currentPrice / inputs.averagePrice) - 1) * 100
  const totalPortfolioValue = currentMarketValue / (inputs.portfolioWeight / 100)
  const afterWeight = ((currentMarketValue + expectedSpend) / (totalPortfolioValue + expectedSpend)) * 100
  const addRatio = expectedSpend / currentMarketValue
  const technical = deriveTechnicalSnapshot(rows, currentPrice)
  const factors: AddBuyFactor[] = []
  const safeguards: string[] = []
  let score = 55

  if (returnPct <= -20) {
    score -= 14
    factors.push({
      label: '내 수익률',
      value: formatPct(returnPct, true),
      explanation: '손실 폭이 커서 평단을 낮추는 것보다 하락 추세가 멈췄는지 확인하는 게 먼저예요.',
      tone: 'negative',
    })
    safeguards.push('큰 손실을 만회하려는 추매는 금지하고, 반등 확인 전에는 추가 자금을 넣지 마세요.')
  } else if (returnPct <= -10) {
    score -= 7
    factors.push({
      label: '내 수익률',
      value: formatPct(returnPct, true),
      explanation: '가격 매력은 생겼지만 단순 물타기로 손실 규모가 더 커질 수 있어요.',
      tone: 'negative',
    })
  } else if (returnPct <= -3) {
    score += 4
    factors.push({
      label: '내 수익률',
      value: formatPct(returnPct, true),
      explanation: '평단보다 완만하게 낮은 구간이라 추세가 살아 있다면 분할 접근을 검토할 수 있어요.',
      tone: 'positive',
    })
  } else if (returnPct <= 10) {
    score += 6
    factors.push({
      label: '내 수익률',
      value: formatPct(returnPct, true),
      explanation: '평단과 현재가 차이가 과도하지 않아 추가 진입 부담이 비교적 작아요.',
      tone: 'positive',
    })
  } else if (returnPct > 20) {
    score -= 8
    factors.push({
      label: '내 수익률',
      value: formatPct(returnPct, true),
      explanation: '수익 구간이 큰 만큼 추격 매수가 될 가능성을 먼저 점검해야 해요.',
      tone: 'negative',
    })
  } else {
    factors.push({
      label: '내 수익률',
      value: formatPct(returnPct, true),
      explanation: '수익 구간이므로 평단보다 추세와 매수 단가 관리가 더 중요해요.',
      tone: 'neutral',
    })
  }

  if (technical.ma20 !== null && technical.ma60 !== null) {
    if (currentPrice >= technical.ma20 && technical.ma20 >= technical.ma60) {
      score += 12
      factors.push({
        label: '가격 추세',
        value: '상승 추세',
        explanation: `현재가가 20일선 ${formatKrw(technical.ma20)} 위이고, 20일선도 60일선 위예요.`,
        tone: 'positive',
      })
    } else if (currentPrice >= technical.ma20) {
      score += 3
      factors.push({
        label: '가격 추세',
        value: '회복 시도',
        explanation: `현재가는 20일선 위지만 60일 추세까지 돌아섰다고 보기는 일러요.`,
        tone: 'neutral',
      })
    } else if (currentPrice >= technical.ma60) {
      score += 1
      factors.push({
        label: '가격 추세',
        value: '단기 조정',
        explanation: '20일선 아래지만 60일선은 지키고 있어 지지 여부를 확인할 구간이에요.',
        tone: 'neutral',
      })
    } else {
      score -= 12
      factors.push({
        label: '가격 추세',
        value: '하락 추세',
        explanation: '현재가가 20일선과 60일선 아래라, 싸 보인다는 이유만으로 추매하기 위험해요.',
        tone: 'negative',
      })
      safeguards.push('현재가가 20일선 또는 60일선을 회복하는지 확인한 뒤 다시 판단하세요.')
    }
  } else {
    factors.push({
      label: '가격 추세',
      value: '데이터 부족',
      explanation: '이동평균을 계산할 가격 데이터가 충분하지 않아 보수적으로 판단했어요.',
      tone: 'neutral',
    })
  }

  if (technical.rsi14 !== null) {
    if (technical.rsi14 < 30) {
      score -= 8
      factors.push({
        label: 'RSI(14)',
        value: technical.rsi14.toFixed(0),
        explanation: '과매도 구간이지만 하락 가속 중일 수 있어 반등 확인이 필요해요.',
        tone: 'negative',
      })
    } else if (technical.rsi14 <= 45) {
      score += 6
      factors.push({
        label: 'RSI(14)',
        value: technical.rsi14.toFixed(0),
        explanation: '과열되지 않은 눌림 구간으로 볼 수 있어요.',
        tone: 'positive',
      })
    } else if (technical.rsi14 <= 60) {
      score += 8
      factors.push({
        label: 'RSI(14)',
        value: technical.rsi14.toFixed(0),
        explanation: '추세가 살아 있으면서 과열 부담은 크지 않은 구간이에요.',
        tone: 'positive',
      })
    } else if (technical.rsi14 <= 70) {
      factors.push({
        label: 'RSI(14)',
        value: technical.rsi14.toFixed(0),
        explanation: '상승 힘은 있지만 추가 매수 단가를 나눌 필요가 있어요.',
        tone: 'neutral',
      })
    } else {
      score -= 12
      factors.push({
        label: 'RSI(14)',
        value: technical.rsi14.toFixed(0),
        explanation: '단기 과열권이라 지금 한 번에 추매하면 고점 부담이 커요.',
        tone: 'negative',
      })
      safeguards.push('RSI가 70 아래로 내려오거나 가격이 눌릴 때까지 추격 매수를 피하세요.')
    }
  }

  if (!newsReady) {
    factors.push({
      label: '오늘 뉴스',
      value: '확인 중',
      explanation: '뉴스 수집 전 결과이므로 기사가 반영되면 판단이 달라질 수 있어요.',
      tone: 'neutral',
    })
  } else {
    const newsBalance = positiveNewsCount - negativeNewsCount
    if (newsBalance >= 2) {
      score += 10
    } else if (newsBalance > 0) {
      score += 5
    } else if (newsBalance <= -2) {
      score -= 10
    } else if (newsBalance < 0) {
      score -= 5
    }
    factors.push({
      label: '오늘 뉴스',
      value: `호재 ${positiveNewsCount} · 악재 ${negativeNewsCount}`,
      explanation:
        newsBalance > 0
          ? '긍정 재료가 더 많지만 기사 원문과 공시의 지속성을 함께 확인하세요.'
          : newsBalance < 0
            ? '부정 재료가 더 많아 가격이 싸 보여도 서두르기 어려운 구간이에요.'
            : '뉴스만으로 추매 방향을 정하기 어려워 가격과 비중 신호를 더 크게 봤어요.',
      tone: newsBalance > 0 ? 'positive' : newsBalance < 0 ? 'negative' : 'neutral',
    })
  }

  if (changePct <= -5) {
    score -= 10
    safeguards.push('하루 급락 중에는 종가와 다음 거래일 지지 여부를 확인하기 전 추매를 미루세요.')
  } else if (changePct < -2) {
    score -= 3
  } else if (changePct >= 5) {
    score -= 8
    safeguards.push('하루 급등 뒤 추격 매수가 되지 않도록 목표 금액을 여러 번 나누세요.')
  } else if (changePct >= 2) {
    score += 2
  }

  if (addRatio <= 0.25) {
    score += 8
    factors.push({
      label: '추가 규모',
      value: `기존 평가액의 ${formatPct(addRatio * 100)}`,
      explanation: '기존 보유액 대비 작은 규모라 한 번의 판단이 계좌에 미치는 충격이 제한적이에요.',
      tone: 'positive',
    })
  } else if (addRatio <= 0.5) {
    score += 3
    factors.push({
      label: '추가 규모',
      value: `기존 평가액의 ${formatPct(addRatio * 100)}`,
      explanation: '한 번에 집행하기보다 2회 이상 나누는 편이 안전해요.',
      tone: 'neutral',
    })
  } else if (addRatio <= 1) {
    score -= 6
    factors.push({
      label: '추가 규모',
      value: `기존 평가액의 ${formatPct(addRatio * 100)}`,
      explanation: '기존 보유액과 비슷한 규모라 판단이 틀릴 때 손실 증가 폭이 커요.',
      tone: 'negative',
    })
  } else {
    score -= 14
    factors.push({
      label: '추가 규모',
      value: `기존 평가액의 ${formatPct(addRatio * 100)}`,
      explanation: '기존 보유액보다 큰 추매라 계좌 위험이 급격히 커질 수 있어요.',
      tone: 'negative',
    })
  }

  if (afterWeight <= 15) {
    score += 8
  } else if (afterWeight <= 25) {
    score += 4
  } else if (afterWeight > 40) {
    score -= 15
    safeguards.push('추매 후 SK하이닉스 비중이 40%를 넘습니다. 종목 집중 위험부터 낮추세요.')
  } else if (afterWeight > 30) {
    score -= 8
    safeguards.push('추매 후 종목 비중이 30%를 넘으므로 추가 금액을 줄이는 편이 안전해요.')
  }
  factors.push({
    label: '추매 후 비중',
    value: formatPct(afterWeight),
    explanation:
      afterWeight <= 25
        ? '한 종목 쏠림이 비교적 제한적인 범위예요.'
        : afterWeight <= 30
          ? '집중도가 커지기 시작하는 구간이라 추가 매수 횟수를 나누세요.'
          : '한 종목 의존도가 높아져 가격 판단보다 비중 관리가 우선이에요.',
    tone: afterWeight <= 25 ? 'positive' : afterWeight <= 30 ? 'neutral' : 'negative',
  })

  const belowBothAverages =
    technical.ma20 !== null &&
    technical.ma60 !== null &&
    currentPrice < technical.ma20 &&
    currentPrice < technical.ma60
  const hardWait =
    afterWeight > 40 ||
    (technical.rsi14 !== null && technical.rsi14 >= 75) ||
    changePct <= -7 ||
    (belowBothAverages && newsReady && negativeNewsCount > positiveNewsCount)

  score = Math.round(clamp(score, 0, 100))
  let verdict: AddBuyDecision['verdict']
  if (hardWait || score < 52) {
    verdict = 'wait'
  } else if (score < 72 || technical.dataPoints < 60 || !newsReady) {
    verdict = 'split'
  } else {
    verdict = 'consider'
  }

  const verdictCopy = {
    consider: {
      label: '추매 고려',
      headline: '조건은 괜찮지만, 한 번에 전액 매수하지는 마세요.',
      action:
        purchasableShares >= 2
          ? `계획한 ${purchasableShares.toLocaleString('ko-KR')}주를 2~3회로 나누고, 추세가 깨지면 남은 매수를 멈추세요.`
          : '예산상 1주만 가능하므로 원하는 매수 단가를 먼저 정하고, 그 가격이 올 때만 접근하세요.',
    },
    split: {
      label: '소액 분할 접근',
      headline: '일부만 접근하고 다음 확인 신호를 기다리는 구간이에요.',
      action:
        purchasableShares >= 2
          ? '우선 계획 수량의 30~50%만 검토하고, 20일선 지지와 뉴스 흐름을 확인한 뒤 나머지를 판단하세요.'
          : '1주를 나눠 살 수 없으므로 지금 바로 사기보다 원하는 매수 단가와 취소 조건을 먼저 정하세요.',
    },
    wait: {
      label: '지금은 보류',
      headline: '평단을 낮추기보다 추가 손실을 막는 것이 먼저예요.',
      action: '하락이 멈추고 추세·뉴스·종목 비중 중 위험 신호가 줄어든 뒤 다시 계산하세요.',
    },
  } as const

  if (technical.twentyDayHigh && currentPrice >= technical.twentyDayHigh * 0.98) {
    safeguards.push('현재가가 20거래일 고점 부근입니다. 신고가 추격 대신 눌림 가격을 정해 두세요.')
  }

  return {
    score,
    verdict,
    verdictLabel: verdictCopy[verdict].label,
    headline: verdictCopy[verdict].headline,
    action: verdictCopy[verdict].action,
    purchasableShares,
    expectedSpend,
    newAveragePrice,
    returnPct,
    afterWeight,
    factors,
    safeguards: [...new Set(safeguards)].slice(0, 4),
  }
}
