import os
from gnews import GNews
import google.generativeai as genai
from dotenv import load_dotenv
import json

load_dotenv()

try:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY가 .env 파일에 설정되지 않았습니다.")
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel('gemini-1.0-pro')
except Exception as e:
    print(f"Gemini API 설정 중 오류 발생: {e}")
    model = None

def get_news(ticker: str, country: str = 'US', period: str = '7d', max_results: int = 10):
    """
    GNews를 사용하여 특정 종목에 대한 최신 뉴스를 가져옵니다.
    [수정] 클라우드 환경에서의 작동 안정성을 위해 디버깅 로그를 강화합니다.
    """
    print(f"Attempting to fetch news for {ticker}...")
    try:
        google_news = GNews(language='en', country=country, period=period, max_results=max_results)
        news = google_news.get_news(f'{ticker} stock')

        if not news:
            print("GNews returned an empty list. This might be due to network restrictions on Render.")
        else:
            print(f"Successfully fetched {len(news)} articles.")

        return news
    except Exception as e:
        print(f"An error occurred while fetching news with GNews: {e}")
        return []

def analyze_sentiment_with_gemini(articles: list):
    """
    Gemini API를 사용하여 뉴스 기사 목록의 시장 감성을 분석합니다.
    """
    if not model:
        raise ConnectionError("Gemini API가 올바르게 설정되지 않았습니다. API 키를 확인하세요.")

    if not articles:
        return {"sentiment_score": 50, "summary": "분석할 뉴스를 찾을 수 없습니다. (클라우드 환경의 네트워크 제한일 수 있습니다.)", "articles": []}

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
