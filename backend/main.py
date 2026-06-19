from fastapi import FastAPI, Response, HTTPException
from pydantic import BaseModel, Field
from typing import Dict, Any, List
import numpy as np
import json

from data_provider import get_stock_data
from strategies.moving_average import moving_average_cross_strategy
from strategies.rsi import rsi_strategy
from strategies.bollinger_bands import bollinger_bands_strategy
from backtester import backtest_strategy
import gemini_analyzer
import optimizer

app = FastAPI()

# ... (Pydantic 모델 정의는 이전과 동일)

def run_backtest(strategy_func, data, initial_capital, **kwargs):
    # ... (이전과 동일)
    pass

@app.head("/")
async def head_root():
    return Response(status_code=200)

@app.get("/")
def read_root():
    return {"message": "Welcome to the Quant Trading API"}

@app.get("/sentiment/{ticker}")
def get_sentiment(ticker: str):
    articles = gemini_analyzer.get_news(ticker)
    articles_json = json.dumps(list(articles))
    # [최종 수정] 인자 없이 호출
    sentiment_result_str = gemini_analyzer.analyze_sentiment_with_gemini(articles_json)
    return json.loads(sentiment_result_str)

# ... (이하 백테스트 및 최적화 엔드포인트는 이전과 동일)
