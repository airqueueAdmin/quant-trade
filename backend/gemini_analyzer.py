import os
import requests
from dotenv import load_dotenv
import json
from functools import lru_cache
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

if not GEMINI_API_KEY:
    print("경고: GEMINI_API_KEY가 .env 파일에 설정되지 않았습니다.")
if not NEWS_API_KEY:
    print("경고: NEWS_API_KEY가 .env 파일에 설정되지 않았습니다.")
if genai is None:
    print("경고: google-genai 패키지가 설치되지 않았습니다.")

client = genai.Client(api_key=GEMINI_API_KEY) if genai and GEMINI_API_KEY else None


class SentimentAnalysisResult(BaseModel):
    sentiment_score: int = Field(ge=0, le=100)
    summary: str


@lru_cache(maxsize=32)
def get_news(ticker: str, language: str = 'en', page_size: int = 10):
    """
    NewsAPI를 사용하여 최신 뉴스를 가져오고, 결과를 캐싱합니다.
    """
    if not NEWS_API_KEY:
        return tuple()
    # ... (이하 get_news 함수 내용은 이전과 동일)
    url = (
        'https://newsapi.org/v2/everything?'
        f'q={ticker}&'
        f'language={language}&'
        'sortBy=publishedAt&'
        f'pageSize={page_size}&'
        f'apiKey={NEWS_API_KEY}'
    )
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()
        articles = data.get("articles", [])
        return tuple({"title": a["title"], "url": a["url"]} for a in articles)
    except requests.exceptions.RequestException:
        return tuple()

@lru_cache(maxsize=32)
def analyze_sentiment_with_gemini(articles_json: str):
    """
    무료 플랜에서 비교적 여유 있게 쓸 수 있는 stable Gemini 모델을 우선순위대로 시도합니다.
    """
    articles = json.loads(articles_json)

    if not client:
        raise ConnectionError("Gemini API 또는 google-genai 패키지가 설정되지 않았습니다.")

    if not articles:
        return json.dumps({"sentiment_score": 50, "summary": "분석할 뉴스를 찾을 수 없습니다.", "articles": []})

    prompt_articles = "\n".join([f"- {article['title']}" for article in articles])
    prompt = f"""
        Analyze the market sentiment for the following news headlines about a stock.
        Based on the headlines, provide a sentiment score from 0 (very negative) to 100 (very positive).
        Also, provide a brief, neutral summary of the key news themes in Korean (2-3 sentences).
        The final output must be a JSON object with two keys: "sentiment_score", "summary".

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
                    "max_output_tokens": 300,
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
        "articles": articles,
        "model_attempts": list(PREFERRED_GEMINI_MODELS),
        "errors": errors,
    })
