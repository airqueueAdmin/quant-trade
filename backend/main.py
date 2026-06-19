from fastapi import FastAPI, Response, HTTPException
from pydantic import BaseModel, Field
from typing import Dict, Any, List, Optional
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

class OptimizationRequestBase(BaseModel):
    ticker: str
    start_date: str
    end_date: str
    initial_capital: float = 100000.0
    metric_to_optimize: str = "sharpe_ratio"

class MovingAverageOptimizeRequest(OptimizationRequestBase):
    short_window_range: List[int] = Field(..., min_length=3, max_length=3, description="[start, end, step] for short_window")
    long_window_range: List[int] = Field(..., min_length=3, max_length=3, description="[start, end, step] for long_window")

class RsiOptimizeRequest(OptimizationRequestBase):
    window_range: List[int] = Field(..., min_length=3, max_length=3, description="[start, end, step] for RSI window")
    oversold_threshold_range: List[int] = Field(..., min_length=3, max_length=3, description="[start, end, step] for oversold_threshold")
    overbought_threshold_range: List[int] = Field(..., min_length=3, max_length=3, description="[start, end, step] for overbought_threshold")

class BollingerBandsOptimizeRequest(OptimizationRequestBase):
    window_range: List[int] = Field(..., min_length=3, max_length=3, description="[start, end, step] for window")
    num_std_dev_range: List[float] = Field(..., min_length=3, max_length=3, description="[start, end, step] for num_std_dev")


def run_backtest(strategy_func, data, initial_capital, **kwargs):
    signals = strategy_func(data, **kwargs)
    portfolio, trades, metrics = backtest_strategy(signals, initial_capital)
    return {
        "performance_metrics": metrics,
        "portfolio_history": portfolio.reset_index().to_dict('records'),
        "trades": trades
    }

@app.head("/")
async def head_root():
    return Response(status_code=200)

@app.get("/")
def read_root():
    return {"message": "Welcome to the Quant Trading API"}

@app.get("/sentiment/{ticker}")
def get_sentiment(ticker: str):
    articles = gemini_analyzer.get_news(ticker)
    # 튜플을 JSON 문자열로 변환하여 캐시 가능한 인자로 전달
    articles_json = json.dumps(list(articles))
    sentiment_result_str = gemini_analyzer.analyze_sentiment_with_gemini(articles_json)
    return json.loads(sentiment_result_str)

@app.post("/backtest/moving_average")
def run_moving_average_backtest(request: MovingAverageRequest):
    data = get_stock_data(request.ticker, request.start_date, request.end_date)
    if data.empty:
        raise HTTPException(status_code=404, detail="No data found for the given ticker and date range.")

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
        raise HTTPException(status_code=404, detail="No data found for the given ticker and date range.")

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
        raise HTTPException(status_code=404, detail="No data found for the given ticker and date range.")

    return run_backtest(
        bollinger_bands_strategy,
        data,
        request.initial_capital,
        window=request.window,
        num_std_dev=request.num_std_dev
    )

@app.post("/optimize/moving_average")
def optimize_moving_average(request: MovingAverageOptimizeRequest):
    data = get_stock_data(request.ticker, request.start_date, request.end_date)
    if data.empty:
        raise HTTPException(status_code=404, detail="No data found for the given ticker and date range.")

    param_grid = {
        "short_window": list(range(request.short_window_range[0], request.short_window_range[1] + 1, request.short_window_range[2])),
        "long_window": list(range(request.long_window_range[0], request.long_window_range[1] + 1, request.long_window_range[2])),
    }

    optimization_results = optimizer.grid_search_optimizer(
        strategy_name="moving_average",
        data=data,
        initial_capital=request.initial_capital,
        param_grid=param_grid,
        metric_to_optimize=request.metric_to_optimize
    )
    return optimization_results

@app.post("/optimize/rsi")
def optimize_rsi(request: RsiOptimizeRequest):
    data = get_stock_data(request.ticker, request.start_date, request.end_date)
    if data.empty:
        raise HTTPException(status_code=404, detail="No data found for the given ticker and date range.")

    param_grid = {
        "window": list(range(request.window_range[0], request.window_range[1] + 1, request.window_range[2])),
        "oversold_threshold": list(range(request.oversold_threshold_range[0], request.oversold_threshold_range[1] + 1, request.oversold_threshold_range[2])),
        "overbought_threshold": list(range(request.overbought_threshold_range[0], request.overbought_threshold_range[1] + 1, request.overbought_threshold_range[2])),
    }

    optimization_results = optimizer.grid_search_optimizer(
        strategy_name="rsi",
        data=data,
        initial_capital=request.initial_capital,
        param_grid=param_grid,
        metric_to_optimize=request.metric_to_optimize
    )
    return optimization_results

@app.post("/optimize/bollinger_bands")
def optimize_bollinger_bands(request: BollingerBandsOptimizeRequest):
    data = get_stock_data(request.ticker, request.start_date, request.end_date)
    if data.empty:
        raise HTTPException(status_code=404, detail="No data found for the given ticker and date range.")

    num_std_dev_values = np.arange(request.num_std_dev_range[0], request.num_std_dev_range[1] + request.num_std_dev_range[2], request.num_std_dev_range[2]).tolist()
    num_std_dev_values = [round(x, 2) for x in num_std_dev_values]

    param_grid = {
        "window": list(range(request.window_range[0], request.window_range[1] + 1, request.window_range[2])),
        "num_std_dev": num_std_dev_values,
    }

    optimization_results = optimizer.grid_search_optimizer(
        strategy_name="bollinger_bands",
        data=data,
        initial_capital=request.initial_capital,
        param_grid=param_grid,
        metric_to_optimize=request.metric_to_optimize
    )
    return optimization_results
