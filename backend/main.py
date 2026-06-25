from __future__ import annotations

from typing import Any, Iterable
import json

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator
import yfinance as yf

from backtester import backtest_buy_and_hold, backtest_strategy
from data_provider import get_stock_data
import gemini_analyzer
import optimizer
from strategies.bollinger_bands import bollinger_bands_strategy
from strategies.moving_average import moving_average_cross_strategy
from strategies.rsi import rsi_strategy

app = FastAPI(title="Quant Trading API")


class BaseBacktestRequest(BaseModel):
    ticker: str = Field(min_length=1, max_length=20)
    start_date: str
    end_date: str
    initial_capital: float = Field(default=100000.0, gt=0)
    order_type: str = Field(default="all_in")
    fixed_amount: float | None = Field(default=None, gt=0)

    @field_validator("ticker")
    @classmethod
    def normalize_ticker(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("order_type")
    @classmethod
    def validate_order_type(cls, value: str) -> str:
        if value not in {"all_in", "fixed_amount"}:
            raise ValueError("order_type must be 'all_in' or 'fixed_amount'")
        return value

    @model_validator(mode="after")
    def validate_fixed_amount(self) -> "BaseBacktestRequest":
        if self.order_type == "fixed_amount" and self.fixed_amount is None:
            raise ValueError("fixed_amount is required when order_type is 'fixed_amount'")
        return self


class MovingAverageBacktestRequest(BaseBacktestRequest):
    short_window: int = Field(ge=1, le=400)
    long_window: int = Field(ge=1, le=400)

    @model_validator(mode="after")
    def validate_windows(self) -> "MovingAverageBacktestRequest":
        if self.short_window >= self.long_window:
            raise ValueError("short_window must be smaller than long_window")
        return self


class RSIBacktestRequest(BaseBacktestRequest):
    window: int = Field(ge=1, le=400)
    oversold_threshold: int = Field(ge=0, le=100)
    overbought_threshold: int = Field(ge=0, le=100)

    @model_validator(mode="after")
    def validate_thresholds(self) -> "RSIBacktestRequest":
        if self.oversold_threshold >= self.overbought_threshold:
            raise ValueError("oversold_threshold must be smaller than overbought_threshold")
        return self


class BollingerBandsBacktestRequest(BaseBacktestRequest):
    window: int = Field(ge=1, le=400)
    num_std_dev: float = Field(gt=0, le=10)


class BaseOptimizationRequest(BaseBacktestRequest):
    metric_to_optimize: str = Field(default="sharpe_ratio")

    @field_validator("metric_to_optimize")
    @classmethod
    def validate_metric(cls, value: str) -> str:
        allowed = {"sharpe_ratio", "total_return_pct", "cagr_pct", "sortino_ratio"}
        if value not in allowed:
            raise ValueError(f"metric_to_optimize must be one of {sorted(allowed)}")
        return value


class MovingAverageOptimizationRequest(BaseOptimizationRequest):
    short_window_range: list[int] = Field(min_length=3, max_length=3)
    long_window_range: list[int] = Field(min_length=3, max_length=3)


class RSIOptimizationRequest(BaseOptimizationRequest):
    window_range: list[int] = Field(min_length=3, max_length=3)
    oversold_threshold_range: list[int] = Field(min_length=3, max_length=3)
    overbought_threshold_range: list[int] = Field(min_length=3, max_length=3)


class BollingerBandsOptimizationRequest(BaseOptimizationRequest):
    window_range: list[int] = Field(min_length=3, max_length=3)
    num_std_dev_range: list[float] = Field(min_length=3, max_length=3)


def ensure_data(ticker: str, start_date: str, end_date: str) -> pd.DataFrame:
    try:
        start_ts = pd.Timestamp(start_date)
        end_ts = pd.Timestamp(end_date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"날짜 형식이 잘못되었습니다: {exc}") from exc

    if start_ts >= end_ts:
        raise HTTPException(status_code=400, detail="시작일은 종료일보다 빨라야 합니다.")

    data = get_stock_data(ticker, start_date, end_date)
    if data.empty:
        raise HTTPException(status_code=404, detail=f"{ticker}의 가격 데이터를 찾을 수 없습니다.")

    required_columns = {"Open", "Close"}
    missing_columns = required_columns.difference(data.columns)
    if missing_columns:
        raise HTTPException(
            status_code=500,
            detail=f"가격 데이터에 필요한 컬럼이 없습니다: {sorted(missing_columns)}",
        )

    cleaned = data.dropna(subset=["Open", "Close"]).copy()
    if len(cleaned) < 2:
        raise HTTPException(status_code=400, detail="백테스트를 하기에 데이터가 충분하지 않습니다.")

    return cleaned


def normalize_value(value: Any) -> Any:
    if isinstance(value, (np.float64, np.float32, float)):
        if np.isinf(value) or np.isnan(value):
            return 0
        return float(value)
    if isinstance(value, (np.int64, np.int32, int)):
        return int(value)
    if isinstance(value, dict):
        return {key: normalize_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [normalize_value(item) for item in value]
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def serialize_portfolio(portfolio: pd.DataFrame) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for date, row in portfolio.reset_index().iterrows():
        row_dict = row.to_dict()
        row_dict["Date"] = row_dict.get("Date", row.iloc[0])
        rows.append(normalize_value(row_dict))
    return rows


def build_param_range(range_values: Iterable[int | float]) -> list[int | float]:
    start, end, step = list(range_values)
    if step <= 0:
        raise HTTPException(status_code=400, detail="파라미터 범위의 간격은 0보다 커야 합니다.")
    if start > end:
        raise HTTPException(status_code=400, detail="파라미터 범위의 시작값은 끝값보다 작거나 같아야 합니다.")

    if any(isinstance(value, float) and not float(value).is_integer() for value in (start, end, step)):
        values = np.arange(float(start), float(end) + (float(step) / 2), float(step))
        return [round(float(value), 10) for value in values]

    return list(range(int(start), int(end) + 1, int(step)))


def build_comparison_metrics(strategy_metrics: dict[str, Any], benchmark_metrics: dict[str, Any]) -> dict[str, Any]:
    return {
        "excess_return_pct": strategy_metrics.get("total_return_pct", 0) - benchmark_metrics.get("total_return_pct", 0),
        "excess_cagr_pct": strategy_metrics.get("cagr_pct", 0) - benchmark_metrics.get("cagr_pct", 0),
        "excess_sharpe_ratio": strategy_metrics.get("sharpe_ratio", 0) - benchmark_metrics.get("sharpe_ratio", 0),
        "drawdown_gap_pct": strategy_metrics.get("max_drawdown_pct", 0) - benchmark_metrics.get("max_drawdown_pct", 0),
    }


def run_backtest(
    strategy_func,
    request: BaseBacktestRequest,
    strategy_params: dict[str, Any],
) -> dict[str, Any]:
    data = ensure_data(request.ticker, request.start_date, request.end_date)
    signals = strategy_func(data.copy(), **strategy_params)
    portfolio_history, trades, performance_metrics = backtest_strategy(
        signals,
        initial_capital=request.initial_capital,
        order_type=request.order_type,
        fixed_amount=request.fixed_amount or request.initial_capital,
    )
    benchmark_portfolio, benchmark_metrics = backtest_buy_and_hold(
        data.copy(),
        initial_capital=request.initial_capital,
    )
    comparison_metrics = build_comparison_metrics(performance_metrics, benchmark_metrics)

    return normalize_value(
        {
            "ticker": request.ticker,
            "strategy_params": strategy_params,
            "performance_metrics": performance_metrics,
            "benchmark_metrics": benchmark_metrics,
            "comparison_metrics": comparison_metrics,
            "portfolio_history": serialize_portfolio(portfolio_history),
            "benchmark_history": serialize_portfolio(benchmark_portfolio),
            "trades": trades,
        }
    )


def run_optimization(
    strategy_name: str,
    request: BaseOptimizationRequest,
    param_grid: dict[str, list[int | float]],
) -> dict[str, Any]:
    data = ensure_data(request.ticker, request.start_date, request.end_date)
    results = optimizer.grid_search_optimizer(
        strategy_name=strategy_name,
        data=data,
        initial_capital=request.initial_capital,
        param_grid=param_grid,
        metric_to_optimize=request.metric_to_optimize,
        order_type=request.order_type,
        fixed_amount=request.fixed_amount or request.initial_capital,
    )
    return normalize_value(results)


@app.get("/")
def root() -> dict[str, str]:
    return {"message": "Quant Trading API is running."}


@app.get("/stock/{ticker}")
def stock_data(ticker: str, start_date: str, end_date: str) -> dict[str, Any]:
    data = ensure_data(ticker.strip().upper(), start_date, end_date)
    return {
        "ticker": ticker.strip().upper(),
        "rows": serialize_portfolio(data),
    }


@app.get("/fx/usdkrw")
def usdkrw_rate() -> dict[str, Any]:
    data = yf.download("KRW=X", period="5d", interval="1d", auto_adjust=True, progress=False)
    if isinstance(data.columns, pd.MultiIndex):
        data.columns = data.columns.get_level_values(0)
    close_series = data.get("Close")
    if close_series is None or close_series.dropna().empty:
        raise HTTPException(status_code=503, detail="환율 데이터를 가져오지 못했습니다.")

    as_of = close_series.dropna().index[-1]
    rate = float(close_series.dropna().iloc[-1])
    return normalize_value({"rate": rate, "as_of": as_of, "source": "yfinance:KRW=X"})


@app.get("/sentiment/{ticker}")
def sentiment_analysis(ticker: str) -> dict[str, Any]:
    normalized_ticker = ticker.strip().upper()
    articles = list(gemini_analyzer.get_news(normalized_ticker))
    if not articles:
        return {
            "ticker": normalized_ticker,
            "sentiment_score": 50,
            "summary": "분석할 최신 뉴스를 찾지 못했거나 API 키가 설정되지 않았습니다.",
            "articles": [],
        }

    try:
        result_json = gemini_analyzer.analyze_sentiment_with_gemini(json.dumps(articles, ensure_ascii=False))
        result = json.loads(result_json)
    except Exception as exc:
        result = {
            "sentiment_score": 50,
            "summary": f"AI 분석을 완료하지 못해 중립 점수로 대체했습니다. 사유: {exc}",
            "articles": articles,
        }

    result["ticker"] = normalized_ticker
    result["articles"] = result.get("articles", articles)
    return normalize_value(result)


@app.post("/backtest/moving_average")
def moving_average_backtest(request: MovingAverageBacktestRequest) -> dict[str, Any]:
    return run_backtest(
        moving_average_cross_strategy,
        request,
        {"short_window": request.short_window, "long_window": request.long_window},
    )


@app.post("/backtest/rsi")
def rsi_backtest(request: RSIBacktestRequest) -> dict[str, Any]:
    return run_backtest(
        rsi_strategy,
        request,
        {
            "window": request.window,
            "oversold_threshold": request.oversold_threshold,
            "overbought_threshold": request.overbought_threshold,
        },
    )


@app.post("/backtest/bollinger_bands")
def bollinger_bands_backtest(request: BollingerBandsBacktestRequest) -> dict[str, Any]:
    return run_backtest(
        bollinger_bands_strategy,
        request,
        {"window": request.window, "num_std_dev": request.num_std_dev},
    )


@app.post("/optimize/moving_average")
def optimize_moving_average(request: MovingAverageOptimizationRequest) -> dict[str, Any]:
    return run_optimization(
        "moving_average",
        request,
        {
            "short_window": build_param_range(request.short_window_range),
            "long_window": build_param_range(request.long_window_range),
        },
    )


@app.post("/optimize/rsi")
def optimize_rsi(request: RSIOptimizationRequest) -> dict[str, Any]:
    return run_optimization(
        "rsi",
        request,
        {
            "window": build_param_range(request.window_range),
            "oversold_threshold": build_param_range(request.oversold_threshold_range),
            "overbought_threshold": build_param_range(request.overbought_threshold_range),
        },
    )


@app.post("/optimize/bollinger_bands")
def optimize_bollinger_bands(request: BollingerBandsOptimizationRequest) -> dict[str, Any]:
    return run_optimization(
        "bollinger_bands",
        request,
        {
            "window": build_param_range(request.window_range),
            "num_std_dev": build_param_range(request.num_std_dev_range),
        },
    )
