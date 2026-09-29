const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
}

const KRX_NAMES: Record<string, string> = {
  '005930': '삼성전자',
  '000660': 'SK하이닉스',
  '373220': 'LG에너지솔루션',
  '207940': '삼성바이오로직스',
  '005380': '현대차',
  '000270': '기아',
  '035420': 'NAVER',
  '035720': '카카오',
  '105560': 'KB금융',
  '055550': '신한지주',
  '086790': '하나금융지주',
  '012450': '한화에어로스페이스',
  '196170': '알테오젠',
  '086520': '에코프로',
}

const US_NAMES: Record<string, string> = {
  AAPL: 'Apple', MSFT: 'Microsoft', NVDA: 'NVIDIA', AMZN: 'Amazon',
  GOOGL: 'Google Alphabet', META: 'Meta', TSLA: 'Tesla', AVGO: 'Broadcom',
  AMD: 'AMD', TSM: 'TSMC', ASML: 'ASML', MU: 'Micron',
}

const POSITIVE_TERMS = ['성장', '증가', '호실적', '최대', '수주', '계약', '상향', '승인', 'growth', 'beat', 'record', 'upgrade', 'deal']
const NEGATIVE_TERMS = ['하락', '급락', '우려', '위험', '부진', '감소', '하향', '규제', '소송', 'risk', 'fall', 'drop', 'downgrade', 'lawsuit']

function errorResponse(status: number, detail: string) {
  return new Response(JSON.stringify({ detail }), { status, headers: corsHeaders })
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function classifyTitle(title: string) {
  const normalized = title.toLowerCase()
  const positive = POSITIVE_TERMS.filter((term) => normalized.includes(term.toLowerCase())).length
  const negative = NEGATIVE_TERMS.filter((term) => normalized.includes(term.toLowerCase())).length
  if (positive > negative) return { sentiment: 'positive', reason: '긍정적인 흐름을 암시하는 표현이 포함되어 있어요.' }
  if (negative > positive) return { sentiment: 'negative', reason: '부정적인 위험 표현이 포함되어 있어요.' }
  return { sentiment: 'neutral', reason: '제목만으로 방향성이 뚜렷하지 않아요.' }
}

function fallbackAnalysis(articles: Array<Record<string, unknown>>) {
  let score = 50
  const articleSentiments = articles.map((article) => {
    const classification = classifyTitle(String(article.title || ''))
    if (classification.sentiment === 'positive') score += 8
    if (classification.sentiment === 'negative') score -= 8
    return { title: article.title, ...classification }
  })
  return {
    sentiment_score: clamp(score),
    summary: articles.length > 0
      ? '최근 뉴스 제목을 기준으로 핵심 흐름을 간단히 분류했어요.'
      : '최근 뉴스 검색 결과가 없어 중립 점수로 표시합니다.',
    investment_implications: articles.length > 0
      ? '기사 원문과 공시를 함께 확인하면서 후속 흐름을 점검해 주세요.'
      : '참고할 뉴스가 부족하므로 가격과 거래량을 우선 확인해 주세요.',
    article_sentiments: articleSentiments,
  }
}

async function fetchArticles(query: string, periodDays: number) {
  const key = Deno.env.get('NEWS_API_KEY')?.trim()
  if (!key) return []
  const url = new URL('https://newsapi.org/v2/everything')
  url.searchParams.set('q', query)
  url.searchParams.set('sortBy', 'publishedAt')
  url.searchParams.set('pageSize', '10')
  url.searchParams.set('from', new Date(Date.now() - periodDays * 86400000).toISOString())
  url.searchParams.set('apiKey', key)

  const response = await fetch(url)
  if (!response.ok) return []
  const payload = await response.json()
  return (payload.articles ?? []).map((article: Record<string, unknown>) => ({
    title: String(article.title || '').trim(),
    url: String(article.url || '').trim(),
    published_at: article.publishedAt || null,
    source_name: (article.source as Record<string, unknown> | undefined)?.name || null,
  })).filter((article: Record<string, unknown>) => article.title && article.url)
}

async function fetchGoogleNews(query: string, periodDays: number) {
  const url = new URL('https://news.google.com/rss/search')
  url.searchParams.set('q', `${query} when:${Math.max(1, periodDays)}d`)
  url.searchParams.set('hl', 'ko')
  url.searchParams.set('gl', 'KR')
  url.searchParams.set('ceid', 'KR:ko')
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 QuantInvestor/1.0' } })
  if (!response.ok) return []
  const xml = await response.text()
  const decodeXml = (value: string) => value
    .replace(/^<!\[CDATA\[|\]\]>$/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
  const readTag = (body: string, tag: string) => {
    const match = body.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'))
    return match ? decodeXml(match[1]) : ''
  }
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((match) => {
    const body = match[1]
    return {
      title: readTag(body, 'title'),
      url: readTag(body, 'link'),
      published_at: readTag(body, 'pubDate') || null,
      source_name: readTag(body, 'source') || null,
    }
  }).filter((article) => article.title && article.url).slice(0, 10)
}

function kstDateKey(value: string | null) {
  if (!value) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

async function analyzeWithGemini(articles: Array<Record<string, unknown>>) {
  const key = Deno.env.get('GEMINI_API_KEY')?.trim()
  if (!key || articles.length === 0) return null
  const prompt = `다음 주식 뉴스 제목을 분석하고 JSON만 반환하세요. sentiment_score는 0~100 정수, summary와 investment_implications는 한국어 1~2문장, article_sentiments는 각 title마다 positive/negative/neutral과 짧은 reason을 포함해야 합니다. 사실을 지어내지 마세요.\n${articles.map((article) => `- ${article.title}`).join('\n')}`
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' + encodeURIComponent(key)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    }),
  })
  if (!response.ok) return null
  const payload = await response.json()
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text
  if (typeof text !== 'string') return null
  try {
    return JSON.parse(text.replace(/^```json\s*/i, '').replace(/\s*```$/, ''))
  } catch {
    return null
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'GET') return errorResponse(405, 'Method not allowed')

  const url = new URL(request.url)
  const ticker = (url.searchParams.get('ticker') || '').trim().toUpperCase()
  if (!ticker) return errorResponse(400, 'ticker is required')
  const market = url.searchParams.get('market') === 'krx' ? 'krx' : 'us'
  const krxExchange = url.searchParams.get('krx_exchange') || 'auto'
  const periodDays = Math.max(1, Math.min(Number(url.searchParams.get('period_days') || 7) || 7, 30))
  const todayOnly = url.searchParams.get('today_only') === 'true'
  const sourceFilter = url.searchParams.get('source_filter') || 'all'
  const companyName = market === 'krx' ? KRX_NAMES[ticker] || ticker : US_NAMES[ticker] || ticker
  const queries = market === 'krx' && ticker === '000660'
    ? ['SK hynix', 'SK하이닉스', '000660']
    : [companyName, ticker]
  const newsResults = await Promise.all(queries.map((query) => fetchArticles(query, periodDays)))
  const rssResults = market === 'krx'
    ? await fetchGoogleNews(queries[0], periodDays)
    : []
  const articleMap = new Map<string, Record<string, unknown>>()
  for (const article of [...newsResults.flat(), ...rssResults]) {
    if (!article.url || articleMap.has(article.url)) continue
    articleMap.set(article.url, article)
  }
  let articles = [...articleMap.values()].sort((left, right) => (
    Date.parse(String(right.published_at || '')) - Date.parse(String(left.published_at || ''))
  )).slice(0, 10)
  if (todayOnly) {
    const today = kstDateKey(new Date().toISOString())
    articles = articles.filter((article: Record<string, unknown>) => kstDateKey(String(article.published_at || '')) === today)
  }
  const analysis = (await analyzeWithGemini(articles)) || fallbackAnalysis(articles)

  return new Response(JSON.stringify({
    ticker,
    resolved_ticker: ticker,
    market,
    krx_exchange: krxExchange,
    company_name: companyName,
    sentiment_score: clamp(Number(analysis.sentiment_score) || 50),
    summary: String(analysis.summary || ''),
    investment_implications: String(analysis.investment_implications || ''),
    articles,
    period_days: periodDays,
    source_filter: sourceFilter,
    today_only: todayOnly,
    news_api_enabled: Boolean(Deno.env.get('NEWS_API_KEY')?.trim()),
  }), { headers: corsHeaders })
})
