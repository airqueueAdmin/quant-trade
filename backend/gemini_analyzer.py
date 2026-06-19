import os
import requests
from dotenv import load_dotenv
import google.generativeai as genai
import json
from functools import lru_cache

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
NEWS_API_KEY = os.getenv("NEWS_API_KEY")

if not GEMINI_API_KEY:
    print("경고: GEMINI_API_KEY가 .env 파일에 설정되지 않았습니다.")
if not NEWS_API_KEY:
    print("경고: NEWS_API_KEY가 .env 파일에 설정되지 않았습니다.")

try:
    if GEMINI_API_KEY:
        genai.configure(api_key=GEMINI_API_KEY)
except Exception as e:
    print(f"Gemini API 구성 중 오류 발생: {e}")

PREFERRED_GEMINI_MODELS = ['gemini-1.5-flash-latest', 'gemini-1.0-pro']

@lru_cache(maxsize=32)
def get_news(ticker: str, language: str = 'en', page_size: int = 10):
    """
    NewsAPI를 사용하여 최신 뉴스를 가져오고, 결과를 캐싱합니다.
    """
    if not NEWS_API_KEY:
        return tuple()

    print(f"Attempting to fetch news for {ticker} from NewsAPI...")
    url = (
        'https://newsapi.org/v2/everything?'
        f'q={ticker}&'
        f'language={language}&'
        'sortBy=publishedAt&'
        f'pageSize={page_size}&'
        f'apiKey={NEWS_API_KEY}'
    )
    try:
        response = requests.get(url)
        response.raise_for_status()
        data = response.json()
        articles = data.get("articles", [])

        if not articles:
            print("NewsAPI returned an empty list.")
        else:
            print(f"Successfully fetched {len(articles)} articles from NewsAPI.")

        return tuple({"title": a["title"], "url": a["url"]} for a in articles)
    except requests.exceptions.RequestException as e:
        print(f"An error occurred while fetching news from NewsAPI: {e}")
        return tuple()

@lru_cache(maxsize=32)
def analyze_sentiment_with_gemini(articles_json: str): # 인자를 JSON 문자열로 받음
    """
    [성능 개선] Gemini API를 사용하여 감성 분석을 수행하고, 결과를 캐싱합니다.
    articles_json은 캐시를 위해 JSON 문자열이어야 합니다.
    """
    articles = json.loads(articles_json) # JSON 문자열을 파이썬 객체로 변환

    if not GEMINI_API_KEY:
        raise ConnectionError("Gemini API 키가 설정되지 않았습니다.")

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

        Example JSON output:
        {{
          "sentiment_score": 75,
          "summary": "애플이 새로운 AI 기능을 발표하며 주가가 상승했으며, 차세대 아이폰에 대한 기대감이 커지고 있습니다."
        }}
    """

    last_error = None
    for model_name in PREFERRED_GEMINI_MODELS:
        try:
            print(f"Trying Gemini model: {model_name}")
            model_instance = genai.GenerativeModel(model_name)
            response = model_instance.generate_content(prompt)
            json_text = response.text.strip().replace('```json', '').replace('```', '').strip()

            result = json.loads(json_text)
            result['articles'] = articles
            print(f"Successfully used Gemini model: {model_name}")
            return json.dumps(result)
        except Exception as e:
            last_error = e
            print(f"Gemini 모델 '{model_name}' 사용 중 오류 발생: {e}. 다음 모델을 시도합니다.")
            continue

    print(f"모든 Gemini 모델 시도 실패. 마지막 오류: {last_error}")
    result = {
        "sentiment_score": 50,
        "summary": f"모든 Gemini 모델 시도 실패. 마지막 오류: {last_error}",
        "articles": articles
    }
    return json.dumps(result)
