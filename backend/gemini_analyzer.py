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

@lru_cache(maxsize=1) # 사용 가능한 모델 목록은 한 번만 조회하면 되므로 캐시 크기를 1로 설정
def get_available_generative_model():
    """
    [자가 진단] 현재 API 키로 사용 가능한 'generateContent' 지원 모델 중 첫 번째 모델을 찾아 반환합니다.
    """
    if not GEMINI_API_KEY:
        return None, "Gemini API 키가 설정되지 않았습니다."

    try:
        for m in genai.list_models():
            if 'generateContent' in m.supported_generation_methods:
                print(f"✅ 사용 가능한 모델 찾음: {m.name}")
                return m.name, None
        return None, "사용 가능한 'generateContent' 지원 모델을 찾을 수 없습니다."
    except Exception as e:
        return None, f"모델 목록 조회 중 오류 발생: {e}"

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
        response = requests.get(url)
        response.raise_for_status()
        data = response.json()
        articles = data.get("articles", [])
        return tuple({"title": a["title"], "url": a["url"]} for a in articles)
    except requests.exceptions.RequestException:
        return tuple()

@lru_cache(maxsize=32)
def analyze_sentiment_with_gemini(articles_json: str):
    """
    [최종 수정] 시스템이 자동으로 찾은 모델을 사용하여 감성 분석을 수행합니다.
    """
    articles = json.loads(articles_json)

    if not GEMINI_API_KEY:
        raise ConnectionError("Gemini API 키가 설정되지 않았습니다.")

    if not articles:
        return json.dumps({"sentiment_score": 50, "summary": "분석할 뉴스를 찾을 수 없습니다.", "articles": []})

    model_name, error_msg = get_available_generative_model()
    if error_msg:
        return json.dumps({"sentiment_score": 50, "summary": f"AI 모델 로딩 실패: {error_msg}", "articles": articles})

    prompt_articles = "\n".join([f"- {article['title']}" for article in articles])
    prompt = f"""
        Analyze the market sentiment for the following news headlines about a stock.
        Based on the headlines, provide a sentiment score from 0 (very negative) to 100 (very positive).
        Also, provide a brief, neutral summary of the key news themes in Korean (2-3 sentences).
        The final output must be a JSON object with two keys: "sentiment_score", "summary".

        News Headlines:
        {prompt_articles}
    """

    try:
        model_instance = genai.GenerativeModel(model_name)
        response = model_instance.generate_content(prompt)
        json_text = response.text.strip().replace('```json', '').replace('```', '').strip()

        result = json.loads(json_text)
        result['articles'] = articles
        return json.dumps(result)
    except Exception as e:
        return json.dumps({
            "sentiment_score": 50,
            "summary": f"감성 분석 중 오류가 발생했습니다: {e}",
            "articles": articles
        })
