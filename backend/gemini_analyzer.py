import os
import requests
from dotenv import load_dotenv
import google.generativeai as genai
import json

load_dotenv()

# --- API Key Configuration ---
try:
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
    NEWS_API_KEY = os.getenv("NEWS_API_KEY")
    if not GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY가 .env 파일에 설정되지 않았습니다.")
    if not NEWS_API_KEY:
        raise ValueError("NEWS_API_KEY가 .env 파일에 설정되지 않았습니다.")

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel('gemini-1.0-pro')
except Exception as e:
    print(f"API 설정 중 오류 발생: {e}")
    model = None

def get_news(ticker: str, language: str = 'en', page_size: int = 10):
    """
    [수정] NewsAPI를 사용하여 특정 종목에 대한 최신 뉴스를 가져옵니다.
    """
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

        # Gemini 분석에 필요한 정보만 추출하여 반환
        return [{"title": a["title"], "url": a["url"]} for a in articles]
    except requests.exceptions.RequestException as e:
        print(f"An error occurred while fetching news from NewsAPI: {e}")
        return []

def analyze_sentiment_with_gemini(articles: list):
    """
    Gemini API를 사용하여 뉴스 기사 목록의 시장 감성을 분석합니다.
    """
    if not model:
        raise ConnectionError("Gemini API가 올바르게 설정되지 않았습니다.")

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
    try:
        response = model.generate_content(prompt)
        json_text = response.text.strip().replace('```json', '').replace('```', '').strip()
        result = json.loads(json_text)
        result['articles'] = articles
        return result
    except Exception as e:
        print(f"Gemini 감성 분석 중 오류 발생: {e}")
        return {
            "sentiment_score": 50,
            "summary": f"감성 분석 중 오류가 발생했습니다: {e}",
            "articles": articles
        }
