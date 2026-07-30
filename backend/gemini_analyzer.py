import os
import requests
from dotenv import load_dotenv
import json
from email.utils import parsedate_to_datetime
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from zoneinfo import ZoneInfo
from xml.etree import ElementTree

from pydantic import BaseModel, Field

try:
    from google import genai
except ImportError:
    genai = None

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
NEWS_API_KEY = os.getenv("NEWS_API_KEY")
PREFERRED_GEMINI_MODELS = (
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-2.5-flash",
)
PRESS_RELEASE_SOURCE_TOKENS = {
    "accesswire",
    "business wire",
    "businesswire",
    "ein presswire",
    "einnews",
    "globenewswire",
    "newsfile",
    "pr newswire",
    "prnewswire",
}

if not GEMINI_API_KEY:
    print("경고: GEMINI_API_KEY가 .env 파일에 설정되지 않았습니다.")
if not NEWS_API_KEY:
    print("경고: NEWS_API_KEY가 .env 파일에 설정되지 않았습니다.")
if genai is None:
    print("경고: google-genai 패키지가 설치되지 않았습니다.")

client = genai.Client(api_key=GEMINI_API_KEY) if genai and GEMINI_API_KEY else None
KST = ZoneInfo("Asia/Seoul")
POSITIVE_NEWS_TERMS = (
    "사상 최대",
    "최대 실적",
    "호실적",
    "깜짝 실적",
    "상향",
    "성장",
    "증가",
    "확대",
    "수주",
    "공급 계약",
    "협력",
    "파트너십",
    "양산",
    "승인",
    "반등",
    "목표가 상향",
    "목표주가 상향",
    "목표가 올",
    "목표주가 올",
    "record",
    "beats",
    "beat estimates",
    "growth",
    "raises",
    "raised",
    "partnership",
    "supply deal",
    "expands",
    "profit rises",
)
NEGATIVE_NEWS_TERMS = (
    "급락",
    "하락",
    "우려",
    "위험",
    "리스크",
    "부진",
    "감소",
    "하향",
    "규제",
    "제재",
    "경쟁 심화",
    "매도",
    "적자",
    "조사",
    "차질",
    "소송",
    "반토막",
    "약세",
    "어닝 미스",
    "plunge",
    "slump",
    "falls",
    "falling",
    "drop",
    "concern",
    "risk",
    "downgrade",
    "decline",
    "lawsuit",
    "delay",
    "weak",
)


class ArticleSentimentResult(BaseModel):
    title: str
    sentiment: Literal["positive", "negative", "neutral"]
    reason: str


class SentimentAnalysisResult(BaseModel):
    sentiment_score: int = Field(ge=0, le=100)
    summary: str
    investment_implications: str
    article_sentiments: list[ArticleSentimentResult] = Field(default_factory=list)


@lru_cache(maxsize=32)
def get_news(query: str, language: str = 'en', page_size: int = 10, period_days: int = 7):
    """
    NewsAPI를 사용하여 최신 뉴스를 가져오고, 결과를 캐싱합니다.
    """
    if not NEWS_API_KEY:
        return tuple()

    from_timestamp = (
        datetime.now(timezone.utc) - timedelta(days=max(1, int(period_days)))
    ).replace(microsecond=0).isoformat()
    try:
        response = requests.get(
            "https://newsapi.org/v2/everything",
            params={
                "q": query,
                "language": language,
                "sortBy": "publishedAt",
                "searchIn": "title,description",
                "from": from_timestamp,
                "pageSize": page_size,
                "apiKey": NEWS_API_KEY,
            },
            timeout=10,
        )
        response.raise_for_status()
        data = response.json()
        articles = data.get("articles", [])
        normalized_articles = []
        for article in articles:
            title = str(article.get("title") or "").strip()
            url = str(article.get("url") or "").strip()
            if not title or not url:
                continue
            normalized_articles.append(
                {
                    "title": title,
                    "url": url,
                    "source_name": str((article.get("source") or {}).get("name") or "").strip() or None,
                    "published_at": str(article.get("publishedAt") or "").strip() or None,
                }
            )
        return tuple(normalized_articles)
    except requests.exceptions.RequestException:
        return tuple()


@lru_cache(maxsize=32)
def get_google_news_rss(
    query: str,
    language: str = "ko",
    page_size: int = 10,
    period_days: int = 1,
):
    locale = "ko" if language == "ko" else "en-US"
    country = "KR" if language == "ko" else "US"
    ceid = f"{country}:{'ko' if language == 'ko' else 'en'}"
    try:
        response = requests.get(
            "https://news.google.com/rss/search",
            params={
                "q": f"{query} when:{max(1, int(period_days))}d",
                "hl": locale,
                "gl": country,
                "ceid": ceid,
            },
            headers={"User-Agent": "Mozilla/5.0 (compatible; QuantInvestor/1.0)"},
            timeout=10,
        )
        response.raise_for_status()
        root = ElementTree.fromstring(response.content)
    except (requests.RequestException, ElementTree.ParseError):
        return tuple()

    normalized_articles: list[dict] = []
    for item in root.findall("./channel/item"):
        title = str(item.findtext("title") or "").strip()
        url = str(item.findtext("link") or "").strip()
        source_name = str(item.findtext("source") or "").strip() or None
        published_at = None
        raw_published_at = str(item.findtext("pubDate") or "").strip()
        if raw_published_at:
            try:
                parsed = parsedate_to_datetime(raw_published_at)
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=timezone.utc)
                published_at = parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
            except (TypeError, ValueError):
                published_at = None

        if not title or not url:
            continue
        normalized_articles.append(
            {
                "title": title,
                "url": url,
                "source_name": source_name,
                "published_at": published_at,
            }
        )
        if len(normalized_articles) >= page_size:
            break
    return tuple(normalized_articles)


def normalize_article_title(title: str) -> str:
    return " ".join(str(title).strip().lower().split())


def canonicalize_article_url(url: str) -> str:
    parsed = urlsplit(str(url).strip())
    filtered_query = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if not key.lower().startswith("utm_")
    ]
    return urlunsplit((parsed.scheme, parsed.netloc.lower(), parsed.path, urlencode(filtered_query), ""))


def published_at_sort_key(article: dict) -> str:
    return str(article.get("published_at") or "")


def is_press_release_source(article: dict) -> bool:
    source_name = str(article.get("source_name") or "").lower()
    article_url = str(article.get("url") or "").lower()
    combined = f"{source_name} {article_url}"
    return any(token in combined for token in PRESS_RELEASE_SOURCE_TOKENS)


def deduplicate_articles(articles: list[dict]) -> list[dict]:
    deduplicated: list[dict] = []
    seen_urls: set[str] = set()
    seen_titles: set[str] = set()

    for article in sorted(articles, key=published_at_sort_key, reverse=True):
        canonical_url = canonicalize_article_url(article.get("url") or "")
        normalized_title = normalize_article_title(article.get("title") or "")
        if canonical_url and canonical_url in seen_urls:
            continue
        if normalized_title and normalized_title in seen_titles:
            continue

        copied = dict(article)
        copied["url"] = canonical_url or article.get("url")
        deduplicated.append(copied)
        if canonical_url:
            seen_urls.add(canonical_url)
        if normalized_title:
            seen_titles.add(normalized_title)

    return deduplicated


def filter_articles_by_source(articles: list[dict], source_filter: str) -> list[dict]:
    if source_filter == "exclude_press_release":
        return [article for article in articles if not is_press_release_source(article)]
    return articles


def parse_published_at(value: str | None) -> datetime | None:
    normalized = str(value or "").strip()
    if not normalized:
        return None
    try:
        parsed = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def filter_articles_for_kst_date(
    articles: list[dict],
    target_date: date | None = None,
) -> list[dict]:
    selected_date = target_date or datetime.now(KST).date()
    return [
        article
        for article in articles
        if (published_at := parse_published_at(article.get("published_at")))
        and published_at.astimezone(KST).date() == selected_date
    ]


def get_news_candidates(
    company_name: str | None,
    ticker: str,
    market: str,
    page_size: int = 10,
    period_days: int = 7,
    source_filter: str = "all",
    today_only: bool = False,
) -> tuple[tuple[dict, ...], list[dict[str, str]]]:
    queries: list[tuple[str, str]] = []
    normalized_ticker = str(ticker).strip().upper()
    normalized_name = str(company_name).strip() if company_name else ""

    if normalized_name:
        queries.append((normalized_name, "ko" if market == "krx" else "en"))
        queries.append((normalized_name, "en"))
        queries.append((f'"{normalized_name}"', "ko" if market == "krx" else "en"))

    if normalized_ticker:
        queries.append((normalized_ticker, "ko" if market == "krx" else "en"))
        queries.append((f"{normalized_name} {normalized_ticker}".strip(), "ko" if market == "krx" else "en"))

    seen: set[tuple[str, str]] = set()
    attempted: list[dict[str, str]] = []
    collected_articles: list[dict] = []
    for query, language in queries:
        key = (query, language)
        if key in seen:
            continue
        seen.add(key)
        attempted.append({"query": query, "language": language})
        articles = get_news(query, language=language, page_size=page_size, period_days=period_days)
        collected_articles.extend(list(articles))

    if normalized_name:
        rss_language = "ko" if market == "krx" else "en"
        attempted.append(
            {
                "query": normalized_name,
                "language": rss_language,
                "source": "google_news_rss",
            }
        )
        collected_articles.extend(
            get_google_news_rss(
                normalized_name,
                language=rss_language,
                page_size=page_size,
                period_days=period_days,
            )
        )

    filtered_articles = filter_articles_by_source(
        deduplicate_articles(collected_articles),
        source_filter=source_filter,
    )
    if today_only:
        filtered_articles = filter_articles_for_kst_date(filtered_articles)
    filtered_articles = sorted(filtered_articles, key=published_at_sort_key, reverse=True)[:page_size]
    return tuple(filtered_articles), attempted


def fallback_article_sentiment(title: str) -> dict[str, str]:
    normalized_title = " ".join(str(title).lower().split())
    positive_hits = [term for term in POSITIVE_NEWS_TERMS if term in normalized_title]
    negative_hits = [term for term in NEGATIVE_NEWS_TERMS if term in normalized_title]

    if len(positive_hits) > len(negative_hits):
        return {
            "sentiment": "positive",
            "reason": "제목의 실적·성장·계약 관련 긍정 표현을 반영했어요.",
        }
    if len(negative_hits) > len(positive_hits):
        return {
            "sentiment": "negative",
            "reason": "제목의 하락·우려·위험 관련 부정 표현을 반영했어요.",
        }
    return {
        "sentiment": "neutral",
        "reason": "제목만으로 투자 방향을 단정하기 어려운 소식이에요.",
    }


def attach_article_sentiments(
    articles: list[dict] | tuple[dict, ...],
    classifications: list[dict] | None,
) -> list[dict]:
    classification_by_title = {
        normalize_article_title(item.get("title") or ""): item
        for item in classifications or []
        if item.get("title")
    }
    enriched_articles: list[dict] = []

    for article in articles:
        copied = dict(article)
        classification = classification_by_title.get(
            normalize_article_title(copied.get("title") or "")
        )
        if classification:
            sentiment = str(classification.get("sentiment") or "neutral").lower()
            if sentiment not in {"positive", "negative", "neutral"}:
                sentiment = "neutral"
            copied["sentiment"] = sentiment
            copied["sentiment_reason"] = (
                str(classification.get("reason") or "").strip()
                or fallback_article_sentiment(copied.get("title") or "")["reason"]
            )
        else:
            fallback = fallback_article_sentiment(copied.get("title") or "")
            copied["sentiment"] = fallback["sentiment"]
            copied["sentiment_reason"] = fallback["reason"]
        enriched_articles.append(copied)

    return enriched_articles

@lru_cache(maxsize=32)
def analyze_sentiment_with_gemini(articles_json: str):
    """
    무료 플랜에서 비교적 여유 있게 쓸 수 있는 stable Gemini 모델을 우선순위대로 시도합니다.
    """
    articles = json.loads(articles_json)

    if not client:
        raise ConnectionError("Gemini API 또는 google-genai 패키지가 설정되지 않았습니다.")

    if not articles:
        return json.dumps(
            {
                "sentiment_score": 50,
                "summary": "분석할 뉴스를 찾을 수 없습니다.",
                "investment_implications": "참고할 뉴스가 없어 투자 시사점을 분리할 수 없습니다.",
                "article_sentiments": [],
                "articles": [],
            }
        )

    prompt_articles = "\n".join(
        [
            (
                f"- 제목: {article['title']} | "
                f"출처: {article.get('source_name') or '-'} | "
                f"시각: {article.get('published_at') or '-'}"
            )
            for article in articles
        ]
    )
    prompt = f"""
        Analyze the market sentiment for the following news headlines about a stock.
        Based on the headlines, provide a sentiment score from 0 (very negative) to 100 (very positive).
        Also, provide:
        1. a brief, neutral summary of the key news themes in Korean (2-3 sentences)
        2. a separate Korean field called "investment_implications" that explains what investors should watch next in 1-2 sentences without giving direct buy/sell orders.
        3. an "article_sentiments" array classifying every headline as "positive", "negative", or "neutral".
           Each item must contain the exact original "title", a "sentiment", and a brief Korean "reason".
           Classify from an investor-impact perspective, acknowledge mixed effects as neutral, and never invent facts beyond the headline.
        The final output must be a JSON object with four keys: "sentiment_score", "summary", "investment_implications", "article_sentiments".

        News Headlines:
        {prompt_articles}
    """

    errors = []
    for model_name in PREFERRED_GEMINI_MODELS:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config={
                    "response_mime_type": "application/json",
                    "response_schema": SentimentAnalysisResult,
                    "temperature": 0.2,
                    "max_output_tokens": 1400,
                },
            )

            parsed = response.parsed
            if parsed is None:
                raise ValueError("모델이 구조화된 JSON 응답을 반환하지 않았습니다.")

            result = parsed.model_dump()
            result["articles"] = articles
            result["model_used"] = model_name
            return json.dumps(result)
        except Exception as e:
            errors.append(f"{model_name}: {e}")
            print(f"Gemini fallback: {model_name} 호출 실패 - {e}")

    return json.dumps({
        "sentiment_score": 50,
        "summary": "사용 가능한 stable Gemini 모델 호출이 모두 실패했습니다.",
        "investment_implications": "모델 호출 실패로 투자 시사점을 분리하지 못했습니다.",
        "article_sentiments": [],
        "articles": articles,
        "model_attempts": list(PREFERRED_GEMINI_MODELS),
        "errors": errors,
    })
