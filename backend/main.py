from fastapi import FastAPI
from pydantic import BaseModel
from data_provider import get_stock_data
from strategies.moving_average import moving_average_cross_strategy
from strategies.rsi import rsi_strategy
from strategies.bollinger_bands import bollinger_bands_strategy
from backtester import backtest_strategy
import gemini_analyzer

app = FastAPI()

class BacktestRequestBase(BaseModel):
    ticker: str
    start_date: str
    end_date: str
    initial_capital: float = 100000.0

class MovingAverageRequest(BacktestRequestBase):
    short_window: int
    long_window: int

class RsiRequest(BacktestRequestBase):
    window: int = 14
    oversold_threshold: int = 30
    overbought_threshold: int = 70

class BollingerBandsRequest(BacktestRequestBase):
    window: int = 20
    num_std_dev: int = 2

def run_backtest(strategy_func, data, initial_capital, **kwargs):
    signals = strategy_func(data, **kwargs)
    portfolio, trades, metrics = backtest_strategy(signals, initial_capital)
    return {
        "performance_metrics": metrics,
        "portfolio_history": portfolio.reset_index().to_dict('records'),
        "trades": trades
    }

@app.get("/")
def read_root():
    return {"message": "Welcome to the Quant Trading API"}

@app.get("/sentiment/{ticker}")
def get_sentiment(ticker: str):
    articles = gemini_analyzer.get_news(ticker)
    sentiment_result = gemini_analyzer.analyze_sentiment_with_gemini(articles)
    return sentiment_result

@app.post("/backtest/moving_average")
def run_moving_average_backtest(request: MovingAverageRequest):
    data = get_stock_data(request.ticker, request.start_date, request.end_date)
    if data.empty:
        return {"error": "No data found for the given ticker and date range."}

    return run_backtest(
        moving_average_cross_strategy,
        data,
        request.initial_capital,
        short_window=request.short_window,
        long_window=request.long_window
    )

@app.post("/backtest/rsi")
def run_rsi_backtest(request: RsiRequest):
    data = get_stock_data(request.ticker, request.start_date, request.end_date)
    if data.empty:
        return {"error": "No data found for the given ticker and date range."}

    return run_backtest(
        rsi_strategy,
        data,
        request.initial_capital,
        window=request.window,
        oversold_threshold=request.oversold_threshold,
        overbought_threshold=request.overbought_threshold
    )

@app.post("/backtest/bollinger_bands")
def run_bollinger_bands_backtest(request: BollingerBandsRequest):
    data = get_stock_data(request.ticker, request.start_date, request.end_date)
    if data.empty:
        return {"error": "No data found for the given ticker and date range."}

    return run_backtest(
        bollinger_bands_strategy,
        data,
        request.initial_capital,
        window=request.window,
        num_std_dev=request.num_std_dev
    )
