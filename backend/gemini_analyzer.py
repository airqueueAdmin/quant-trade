import os
import requests
from dotenv import load_dotenv
import google.generativeai as genai
import json

load_dotenv()

# --- API Key Configuration ---
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
NEWS_API_KEY = os.getenv("NEWS_API_KEY")

if not GEMINI_API_KEY:
    print("경고: GEMINI_API_KEY가 .env 파일에 설정되지 않았습니다. Gemini 기능이 작동하지 않을 수 있습니다.")
if not NEWS_API_KEY:
    print("경고: NEWS_API_KEY가 .env 파일에 설정되지 않았습니다. 뉴스 수집 기능이 작동하지 않을 수 있습니다.")

# Gemini API는 한 번만 설정
try:
    if GEMINI_API_KEY:
        genai.configure(api_key=GEMINI_API_KEY)
    else:
        raise ValueError("GEMINI_API_KEY가 설정되지 않아 Gemini API를 구성할 수 없습니다.")
except Exception as e:
    print(f"Gemini API 구성 중 오류 발생: {e}")

# 기존의 gemini-1.0-pro와 gemini-1.5-flash-latest는 지원 종료 등의 이유로 사용이 불가하거나 비효율적이므로, 
# 현재 활성화되어 있으며 권장되는 최신 Flash 모델들로 대체합니다.
PREFERRED_GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest']


def get_news(ticker: str, language: str = 'en', page_size: int = 10):
    """
    NewsAPI를 사용하여 특정 종목에 대한 최신 뉴스를 가져옵니다.
    """
    if not NEWS_API_KEY:
        print("NEWS_API_KEY가 설정되지 않아 뉴스 수집 기능을 사용할 수 없습니다.")
        return []

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

        return [{"title": a["title"], "url": a["url"]} for a in articles]
    except requests.exceptions.RequestException as e:
        print(f"An error occurred while fetching news from NewsAPI: {e}")
        return []

def analyze_sentiment_with_gemini(articles: list): # model_name 인자 제거
    """
    Gemini API를 사용하여 뉴스 기사 목록의 시장 감성을 분석합니다.
    선호하는 모델 목록을 순회하며 자동 폴백을 시도합니다.
    """
    if not GEMINI_API_KEY:
        raise ConnectionError("Gemini API 키가 설정되지 않았습니다. .env 파일을 확인하세요.")

    if not articles:
        return {"sentiment_score": 50, "summary": "분석할 뉴스를 찾을 수 없습니다.", "articles": []}

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
            return result
        except Exception as e:
            last_error = e
            print(f"Gemini 모델 '{model_name}' 사용 중 오류 발생: {e}. 다음 모델을 시도합니다.")
            continue # 다음 모델 시도

    # 모든 모델이 실패했을 경우
    print(f"모든 Gemini 모델 시도 실패. 마지막 오류: {last_error}")
    return {
        "sentiment_score": 50,
        "summary": f"모든 Gemini 모델 시도 실패. 마지막 오류: {last_error}",
        "articles": articles
    }
