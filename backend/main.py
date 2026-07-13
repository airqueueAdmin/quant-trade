from __future__ import annotations

from datetime import date, datetime, time, timedelta
import base64
import hashlib
import hmac
import logging
import os
import secrets
import smtplib
import ssl
import tempfile
from typing import Any, Iterable
import json
from zoneinfo import ZoneInfo
from email.message import EmailMessage

import numpy as np
import pandas as pd
from fastapi import FastAPI, Header, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator, model_validator
import requests
import yfinance as yf
from dotenv import load_dotenv

from backtester import backtest_buy_and_hold, backtest_strategy
from data_provider import (
    MarketDataRateLimitError,
    coerce_datetime_index,
    get_stock_data,
    get_symbol_profile,
    search_krx_stocks,
    normalize_krx_exchange,
    normalize_market,
    normalize_ticker_input,
)
import gemini_analyzer
import optimizer
from strategies.bollinger_bands import bollinger_bands_strategy
from strategies.moving_average import moving_average_cross_strategy
from strategies.rsi import rsi_strategy

load_dotenv()
logger = logging.getLogger("quant.toss")


def normalize_multiline_secret(raw_value: str) -> str:
    normalized = raw_value.strip()
    if len(normalized) >= 2 and normalized[0] == normalized[-1] and normalized[0] in {'"', "'"}:
        normalized = normalized[1:-1].strip()
    return normalized.replace("\\r\\n", "\n").replace("\\n", "\n").replace("\\r", "\n")


def write_secret_pem_file(secret_value: str, filename: str) -> str:
    target_path = os.path.join(tempfile.gettempdir(), filename)
    normalized_secret = normalize_multiline_secret(secret_value)
    with open(target_path, "w", encoding="utf-8") as file_obj:
        file_obj.write(normalized_secret.rstrip() + "\n")
    return target_path


def resolve_secret_file_path(env_var_name: str, fallback_filenames: list[str]) -> str:
    configured_path = (os.getenv(env_var_name) or "").strip()
    pem_env_name = f"{env_var_name}_PEM"
    pem_value = (os.getenv(pem_env_name) or "").strip()
    normalized_configured_path = normalize_multiline_secret(configured_path) if configured_path else ""
    normalized_pem_value = normalize_multiline_secret(pem_value) if pem_value else ""

    if normalized_pem_value.startswith("-----BEGIN "):
        return write_secret_pem_file(normalized_pem_value, fallback_filenames[0])
    if normalized_configured_path.startswith("-----BEGIN "):
        return write_secret_pem_file(normalized_configured_path, fallback_filenames[0])

    candidates: list[str] = []
    if normalized_configured_path:
        candidates.append(normalized_configured_path)
    for filename in fallback_filenames:
        candidates.append(os.path.join("/etc/secrets", filename))
        candidates.append(filename)

    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    return normalized_configured_path


def file_sha256(path: str | None) -> str | None:
    if not path or not os.path.exists(path):
        return None

    digest = hashlib.sha256()
    with open(path, "rb") as file_obj:
        for chunk in iter(lambda: file_obj.read(8192), b""):
            digest.update(chunk)
    return digest.hexdigest()


def certificate_fingerprint_sha256(path: str | None) -> str | None:
    if not path or not os.path.exists(path):
        return None

    with open(path, "r", encoding="utf-8") as file_obj:
        cert_text = file_obj.read().strip()

    if not cert_text:
        return None

    try:
        der_bytes = ssl.PEM_cert_to_DER_cert(cert_text)
    except ValueError:
        return None
    return hashlib.sha256(der_bytes).hexdigest()


def mask_toss_user_key(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if len(normalized) <= 6:
        return f"{normalized}***"
    return f"{normalized[:6]}***"


def infer_toss_recipient_key_type(recipient_key: str) -> str:
    normalized = recipient_key.strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="Toss 발송 식별 키가 비어 있습니다.")
    return "user_key" if normalized.isdigit() else "anonymous_key"


APPS_IN_TOSS_APP_NAME = (os.getenv("APPS_IN_TOSS_APP_NAME") or "glance-invest").strip() or "glance-invest"
DEFAULT_CORS_ORIGINS = [
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    f"https://{APPS_IN_TOSS_APP_NAME}.apps.tossmini.com",
    f"https://{APPS_IN_TOSS_APP_NAME}.private-apps.tossmini.com",
]
DEFAULT_PAPER_SEED_CASH_KRW = 10_000_000.0
SUPABASE_URL = (os.getenv("SUPABASE_URL") or "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
SUPABASE_DB_SCHEMA = os.getenv("SUPABASE_DB_SCHEMA", "public")
CORS_ALLOW_ORIGINS = os.getenv("CORS_ALLOW_ORIGINS", "").strip()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or ""
APP_SESSION_SECRET = os.getenv("APP_SESSION_SECRET") or secrets.token_hex(32)
SMTP_HOST = (os.getenv("SMTP_HOST") or "").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT") or "587")
SMTP_USERNAME = (os.getenv("SMTP_USERNAME") or "").strip()
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD") or ""
SMTP_FROM_EMAIL = (os.getenv("SMTP_FROM_EMAIL") or SMTP_USERNAME or "").strip()
SMTP_USE_TLS = (os.getenv("SMTP_USE_TLS") or "true").strip().lower() not in {"0", "false", "no"}
NOTIFICATION_DISPATCH_TOKEN = (os.getenv("NOTIFICATION_DISPATCH_TOKEN") or "").strip()
APPS_IN_TOSS_CERT_PATH = resolve_secret_file_path(
    "APPS_IN_TOSS_CERT_PATH",
    ["glance-invest-mtls.crt", "glance-invest-mTLS_public.crt"],
)
APPS_IN_TOSS_KEY_PATH = resolve_secret_file_path(
    "APPS_IN_TOSS_KEY_PATH",
    ["glance-invest-mtls.key", "glance-invest-mTLS_private.key"],
)
APPS_IN_TOSS_API_BASE_URL = (
    os.getenv("APPS_IN_TOSS_API_BASE_URL")
    or os.getenv("TOSS_SMART_MESSAGE_BASE_URL")
    or "https://apps-in-toss-api.toss.im"
).rstrip("/")
TOSS_SMART_MESSAGE_BASE_URL = APPS_IN_TOSS_API_BASE_URL
TOSS_SMART_MESSAGE_TEMPLATE_CODE = (os.getenv("TOSS_SMART_MESSAGE_TEMPLATE_CODE") or "glance-invest-reminder").strip() or "glance-invest-reminder"
TOSS_LOGIN_GENERATE_TOKEN_URL = (
    os.getenv("TOSS_LOGIN_GENERATE_TOKEN_URL")
    or f"{APPS_IN_TOSS_API_BASE_URL}/api-partner/v1/apps-in-toss/user/oauth2/generate-token"
).strip()
TOSS_LOGIN_ME_URL = (
    os.getenv("TOSS_LOGIN_ME_URL")
    or f"{APPS_IN_TOSS_API_BASE_URL}/api-partner/v1/apps-in-toss/user/oauth2/login-me"
).strip()
APPS_IN_TOSS_CERT_SHA256 = file_sha256(APPS_IN_TOSS_CERT_PATH)
APPS_IN_TOSS_CERT_FINGERPRINT_SHA256 = certificate_fingerprint_sha256(APPS_IN_TOSS_CERT_PATH)
MARKET_TIMEZONES = {
    "krx": ZoneInfo("Asia/Seoul"),
    "us": ZoneInfo("America/New_York"),
}
MARKET_OPEN_TIMES = {
    "krx": time(hour=9, minute=0),
    "us": time(hour=9, minute=30),
}
MARKET_CLOSE_TIMES = {
    "krx": time(hour=15, minute=30),
    "us": time(hour=16, minute=0),
}
CLOSING_BET_QUICK_SCENARIOS = [
    "섹터가 하루 종일 강했고 종가까지 눌림이 적음",
    "장중 눌림 뒤 거래대금이 다시 붙으며 종가 회복",
    "뉴스 한 번으로 급등했지만 종가까지 매도 물량이 계속 나옴",
    "고가 돌파는 했지만 종가가 중간 이하에서 끝남",
]
CLOSING_BET_SCENARIO_MODIFIERS = {
    CLOSING_BET_QUICK_SCENARIOS[0]: 4,
    CLOSING_BET_QUICK_SCENARIOS[1]: 2,
    CLOSING_BET_QUICK_SCENARIOS[2]: -4,
    CLOSING_BET_QUICK_SCENARIOS[3]: -6,
}
BACKTEST_STRATEGY_LABELS = {
    "moving_average": "이동평균",
    "rsi": "RSI",
    "bollinger_bands": "볼린저 밴드",
}
BACKTEST_RUN_TYPE_LABELS = {
    "backtest": "일반 백테스트",
    "optimization": "전략 최적화",
}
SENTIMENT_SOURCE_FILTER_LABELS = {
    "all": "전체",
    "exclude_press_release": "보도자료 제외",
}


def parse_allowed_origins(raw_value: str) -> list[str]:
    if not raw_value:
        return DEFAULT_CORS_ORIGINS
    origins = [item.strip() for item in raw_value.split(",") if item.strip()]
    if not origins:
        return DEFAULT_CORS_ORIGINS
    merged: list[str] = []
    for origin in [*origins, *DEFAULT_CORS_ORIGINS]:
        if origin not in merged:
            merged.append(origin)
    return merged


app = FastAPI(title="Quant Trading API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=parse_allowed_origins(CORS_ALLOW_ORIGINS),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

US_SECTOR_UNIVERSE = [
    {"key": "technology", "name": "기술", "proxy": "XLK", "components": [{"ticker": "XLK", "name": "Technology Select Sector SPDR Fund"}], "note": "미국 대형 기술주 ETF"},
    {"key": "semiconductors", "name": "반도체", "proxy": "SOXX", "components": [{"ticker": "SOXX", "name": "iShares Semiconductor ETF"}], "note": "미국 반도체 ETF"},
    {"key": "communication", "name": "커뮤니케이션", "proxy": "XLC", "components": [{"ticker": "XLC", "name": "Communication Services Select Sector SPDR Fund"}], "note": "미국 커뮤니케이션 ETF"},
    {"key": "consumer_discretionary", "name": "소비재", "proxy": "XLY", "components": [{"ticker": "XLY", "name": "Consumer Discretionary Select Sector SPDR Fund"}], "note": "미국 경기민감 소비 ETF"},
    {"key": "financials", "name": "금융", "proxy": "XLF", "components": [{"ticker": "XLF", "name": "Financial Select Sector SPDR Fund"}], "note": "미국 금융 ETF"},
    {"key": "industrials", "name": "산업재", "proxy": "XLI", "components": [{"ticker": "XLI", "name": "Industrial Select Sector SPDR Fund"}], "note": "미국 산업재 ETF"},
    {"key": "healthcare", "name": "헬스케어", "proxy": "XLV", "components": [{"ticker": "XLV", "name": "Health Care Select Sector SPDR Fund"}], "note": "미국 헬스케어 ETF"},
    {"key": "energy", "name": "에너지", "proxy": "XLE", "components": [{"ticker": "XLE", "name": "Energy Select Sector SPDR Fund"}], "note": "미국 에너지 ETF"},
    {"key": "utilities", "name": "유틸리티", "proxy": "XLU", "components": [{"ticker": "XLU", "name": "Utilities Select Sector SPDR Fund"}], "note": "미국 유틸리티 ETF"},
    {"key": "real_estate", "name": "리츠/부동산", "proxy": "XLRE", "components": [{"ticker": "XLRE", "name": "Real Estate Select Sector SPDR Fund"}], "note": "미국 부동산 ETF"},
    {"key": "materials", "name": "소재", "proxy": "XLB", "components": [{"ticker": "XLB", "name": "Materials Select Sector SPDR Fund"}], "note": "미국 소재 ETF"},
]

KRX_SECTOR_UNIVERSE = [
    {
        "key": "semiconductors",
        "name": "반도체",
        "components": [
            {"ticker": "005930", "name": "삼성전자", "krx_exchange": "kospi"},
            {"ticker": "000660", "name": "SK하이닉스", "krx_exchange": "kospi"},
            {"ticker": "042700", "name": "한미반도체", "krx_exchange": "kospi"},
        ],
        "note": "국내 대표 반도체 3종목 평균",
    },
    {
        "key": "secondary_battery",
        "name": "2차전지",
        "components": [
            {"ticker": "373220", "name": "LG에너지솔루션", "krx_exchange": "kospi"},
            {"ticker": "006400", "name": "삼성SDI", "krx_exchange": "kospi"},
            {"ticker": "003670", "name": "포스코퓨처엠", "krx_exchange": "kospi"},
        ],
        "note": "국내 대표 2차전지 3종목 평균",
    },
    {
        "key": "autos",
        "name": "자동차",
        "components": [
            {"ticker": "005380", "name": "현대차", "krx_exchange": "kospi"},
            {"ticker": "000270", "name": "기아", "krx_exchange": "kospi"},
            {"ticker": "012330", "name": "현대모비스", "krx_exchange": "kospi"},
        ],
        "note": "국내 대표 자동차 3종목 평균",
    },
    {
        "key": "bio",
        "name": "바이오",
        "components": [
            {"ticker": "207940", "name": "삼성바이오로직스", "krx_exchange": "kospi"},
            {"ticker": "068270", "name": "셀트리온", "krx_exchange": "kospi"},
            {"ticker": "196170", "name": "알테오젠", "krx_exchange": "kosdaq"},
        ],
        "note": "국내 대표 바이오 3종목 평균",
    },
    {
        "key": "internet_platform",
        "name": "인터넷/플랫폼",
        "components": [
            {"ticker": "035420", "name": "NAVER", "krx_exchange": "kospi"},
            {"ticker": "035720", "name": "카카오", "krx_exchange": "kospi"},
            {"ticker": "251270", "name": "넷마블", "krx_exchange": "kospi"},
        ],
        "note": "국내 플랫폼/콘텐츠 대표주 평균",
    },
    {
        "key": "defense",
        "name": "방산",
        "components": [
            {"ticker": "012450", "name": "한화에어로스페이스", "krx_exchange": "kospi"},
            {"ticker": "047810", "name": "한국항공우주", "krx_exchange": "kospi"},
            {"ticker": "079550", "name": "LIG넥스원", "krx_exchange": "kospi"},
        ],
        "note": "국내 대표 방산 3종목 평균",
    },
    {
        "key": "financials",
        "name": "금융",
        "components": [
            {"ticker": "105560", "name": "KB금융", "krx_exchange": "kospi"},
            {"ticker": "055550", "name": "신한지주", "krx_exchange": "kospi"},
            {"ticker": "086790", "name": "하나금융지주", "krx_exchange": "kospi"},
        ],
        "note": "국내 대표 금융지주 3종목 평균",
    },
]


class BaseBacktestRequest(BaseModel):
    ticker: str = Field(min_length=1, max_length=32)
    market: str = Field(default="us")
    krx_exchange: str = Field(default="auto")
    start_date: str
    end_date: str
    initial_capital: float = Field(default=100000.0, gt=0)
    order_type: str = Field(default="all_in")
    fixed_amount: float | None = Field(default=None, gt=0)

    @field_validator("ticker")
    @classmethod
    def normalize_ticker(cls, value: str) -> str:
        return normalize_ticker_input(value)

    @field_validator("market")
    @classmethod
    def validate_market(cls, value: str) -> str:
        return normalize_market(value)

    @field_validator("krx_exchange")
    @classmethod
    def validate_krx_exchange(cls, value: str) -> str:
        return normalize_krx_exchange(value)

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


class PaperTradingAccountRequest(BaseModel):
    account_id: str | None = Field(default=None, min_length=3, max_length=64)

    @field_validator("account_id")
    @classmethod
    def validate_account_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return normalize_paper_account_id(value)


class SavedBacktestRequest(PaperTradingAccountRequest):
    save_name: str | None = Field(default=None, max_length=120)
    run_type: str = Field(default="backtest")
    strategy_key: str = Field(min_length=3, max_length=32)
    ticker: str = Field(min_length=1, max_length=32)
    resolved_ticker: str | None = Field(default=None, max_length=32)
    company_name: str | None = Field(default=None, max_length=128)
    market: str = Field(default="us")
    krx_exchange: str = Field(default="auto")
    start_date: str
    end_date: str
    initial_capital: float = Field(default=100000.0, gt=0)
    order_type: str = Field(default="all_in")
    fixed_amount: float | None = Field(default=None, gt=0)
    metric_to_optimize: str | None = Field(default=None, max_length=64)
    request_payload: dict[str, Any] = Field(default_factory=dict)
    result_payload: dict[str, Any] = Field(default_factory=dict)

    @field_validator("save_name")
    @classmethod
    def normalize_save_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("run_type")
    @classmethod
    def validate_run_type(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in BACKTEST_RUN_TYPE_LABELS:
            raise ValueError(f"run_type must be one of {sorted(BACKTEST_RUN_TYPE_LABELS)}")
        return normalized

    @field_validator("strategy_key")
    @classmethod
    def validate_strategy_key(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in BACKTEST_STRATEGY_LABELS:
            raise ValueError(f"strategy_key must be one of {sorted(BACKTEST_STRATEGY_LABELS)}")
        return normalized

    @field_validator("ticker")
    @classmethod
    def normalize_ticker(cls, value: str) -> str:
        return normalize_ticker_input(value)

    @field_validator("resolved_ticker")
    @classmethod
    def normalize_resolved_ticker(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return normalize_ticker_input(value)

    @field_validator("market")
    @classmethod
    def validate_market(cls, value: str) -> str:
        return normalize_market(value)

    @field_validator("krx_exchange")
    @classmethod
    def validate_krx_exchange(cls, value: str) -> str:
        return normalize_krx_exchange(value)

    @field_validator("order_type")
    @classmethod
    def validate_order_type(cls, value: str) -> str:
        if value not in {"all_in", "fixed_amount"}:
            raise ValueError("order_type must be 'all_in' or 'fixed_amount'")
        return value

    @model_validator(mode="after")
    def validate_request(self) -> "SavedBacktestRequest":
        if self.order_type == "fixed_amount" and self.fixed_amount is None:
            raise ValueError("fixed_amount is required when order_type is 'fixed_amount'")

        try:
            start_ts = pd.Timestamp(self.start_date)
            end_ts = pd.Timestamp(self.end_date)
        except ValueError as exc:
            raise ValueError(f"날짜 형식이 잘못되었습니다: {exc}") from exc

        if start_ts >= end_ts:
            raise ValueError("start_date must be earlier than end_date")
        return self


class PaperTradingOrderRequest(PaperTradingAccountRequest):
    ticker: str = Field(min_length=1, max_length=32)
    krx_exchange: str = Field(default="auto")
    side: str = Field(min_length=2, max_length=4)
    shares: int = Field(ge=1, le=1_000_000)
    company_name: str | None = Field(default=None, max_length=128)

    @field_validator("ticker")
    @classmethod
    def normalize_ticker(cls, value: str) -> str:
        return normalize_ticker_input(value)

    @field_validator("krx_exchange")
    @classmethod
    def validate_krx_exchange(cls, value: str) -> str:
        return normalize_krx_exchange(value)

    @field_validator("side")
    @classmethod
    def validate_side(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"buy", "sell"}:
            raise ValueError("side must be 'buy' or 'sell'")
        return normalized


class ClosingBetEvaluationRequest(BaseModel):
    ticker: str = Field(min_length=1, max_length=32)
    market: str = Field(default="krx")
    krx_exchange: str = Field(default="auto")

    @field_validator("market")
    @classmethod
    def validate_market(cls, value: str) -> str:
        return normalize_market(value)

    @field_validator("krx_exchange")
    @classmethod
    def validate_krx_exchange(cls, value: str) -> str:
        return normalize_krx_exchange(value)

    @model_validator(mode="after")
    def normalize_market_ticker(self) -> "ClosingBetEvaluationRequest":
        self.ticker = normalize_market_ticker_input(self.ticker, self.market)
        return self


class ClosingBetNotificationRequest(PaperTradingAccountRequest):
    ticker: str = Field(min_length=1, max_length=32)
    market: str = Field(default="krx")
    krx_exchange: str = Field(default="auto")
    channel: str = Field(min_length=4, max_length=16)
    destination: str = Field(min_length=3, max_length=200)
    toss_user_key: str | None = Field(default=None, min_length=8, max_length=256)
    threshold_score: int = Field(default=0, ge=0, le=100)
    active: bool = Field(default=True)

    @field_validator("market")
    @classmethod
    def validate_notification_market(cls, value: str) -> str:
        return normalize_market(value)

    @field_validator("krx_exchange")
    @classmethod
    def validate_notification_krx_exchange(cls, value: str) -> str:
        return normalize_krx_exchange(value)

    @field_validator("channel")
    @classmethod
    def validate_notification_channel(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"email", "toss_inapp"}:
            raise ValueError("channel must be 'email' or 'toss_inapp'")
        return normalized

    @field_validator("destination")
    @classmethod
    def validate_destination(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("destination is required")
        return normalized

    @field_validator("toss_user_key")
    @classmethod
    def validate_toss_user_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @model_validator(mode="after")
    def normalize_market_ticker(self) -> "ClosingBetNotificationRequest":
        self.ticker = normalize_market_ticker_input(self.ticker, self.market)
        return self


class ClosingBetNotificationDispatchRequest(BaseModel):
    market: str | None = Field(default=None)
    limit: int = Field(default=100, ge=1, le=500)
    notification_id: int | None = Field(default=None, ge=1)
    force: bool = Field(default=False)

    @field_validator("market")
    @classmethod
    def validate_optional_market(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        return normalize_market(value)


class ClosingBetNotificationTestRequest(PaperTradingAccountRequest):
    channel: str = Field(min_length=4, max_length=16)
    destination: str = Field(min_length=3, max_length=200)
    toss_user_key: str | None = Field(default=None, min_length=8, max_length=256)
    deployment_id: str | None = Field(default=None, min_length=8, max_length=64)
    ticker: str = Field(default="005930", min_length=1, max_length=32)
    market: str = Field(default="krx")

    @field_validator("channel")
    @classmethod
    def validate_test_channel(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"email", "toss_inapp"}:
            raise ValueError("channel must be 'email' or 'toss_inapp'")
        return normalized

    @field_validator("destination")
    @classmethod
    def validate_test_destination(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("destination is required")
        return normalized

    @field_validator("toss_user_key")
    @classmethod
    def validate_test_toss_user_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("deployment_id")
    @classmethod
    def validate_test_deployment_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("market")
    @classmethod
    def validate_test_market(cls, value: str) -> str:
        return normalize_market(value)

    @model_validator(mode="after")
    def normalize_market_ticker(self) -> "ClosingBetNotificationTestRequest":
        self.ticker = normalize_market_ticker_input(self.ticker, self.market)
        return self


class TossLoginExchangeRequest(BaseModel):
    authorization_code: str = Field(min_length=8, max_length=4096)
    referrer: str | None = Field(default=None, min_length=3, max_length=16)

    @field_validator("authorization_code")
    @classmethod
    def validate_authorization_code(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("authorization_code is required")
        return normalized

    @field_validator("referrer")
    @classmethod
    def validate_referrer(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().upper()
        if normalized not in {"DEFAULT", "SANDBOX"}:
            raise ValueError("referrer must be 'DEFAULT' or 'SANDBOX'")
        return normalized


def normalize_paper_account_id(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("account_id is required")
    allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")
    if any(char not in allowed for char in normalized):
        raise ValueError("account_id may only contain letters, numbers, hyphen, and underscore")
    return normalized


def normalize_market_ticker_input(value: str, market: str) -> str:
    normalized = normalize_ticker_input(value)
    if normalize_market(market) != "krx":
        return normalized

    if normalized.endswith((".KS", ".KQ")):
        digit_code = "".join(char for char in normalized if char.isdigit())
        if len(digit_code) == 6:
            return digit_code

    digit_code = "".join(char for char in normalized if char.isdigit())
    if len(digit_code) == 6:
        return digit_code

    return normalized


def build_session_account_id() -> str:
    return f"paper-{secrets.token_hex(6)}"


def encode_session_token(account_id: str) -> str:
    payload = account_id.encode("utf-8")
    signature = hmac.new(APP_SESSION_SECRET.encode("utf-8"), payload, hashlib.sha256).digest()
    return f"{base64.urlsafe_b64encode(payload).decode('utf-8').rstrip('=')}.{base64.urlsafe_b64encode(signature).decode('utf-8').rstrip('=')}"


def decode_session_token(token: str) -> str:
    try:
        encoded_payload, encoded_signature = token.split(".", 1)
        payload_bytes = base64.urlsafe_b64decode(f"{encoded_payload}==")
        signature_bytes = base64.urlsafe_b64decode(f"{encoded_signature}==")
    except Exception as exc:
        raise HTTPException(status_code=401, detail="세션 토큰 형식이 올바르지 않습니다.") from exc

    expected_signature = hmac.new(
        APP_SESSION_SECRET.encode("utf-8"),
        payload_bytes,
        hashlib.sha256,
    ).digest()
    if not hmac.compare_digest(signature_bytes, expected_signature):
        raise HTTPException(status_code=401, detail="세션 토큰 검증에 실패했습니다.")

    try:
        account_id = payload_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=401, detail="세션 토큰을 해석할 수 없습니다.") from exc

    return normalize_paper_account_id(account_id)


def resolve_paper_session_token(x_app_session: str | None) -> str:
    normalized = (x_app_session or "").strip()
    if not normalized:
        raise HTTPException(status_code=401, detail="세션 토큰이 필요합니다.")
    return normalized


def resolve_paper_account_id(
    account_id: str | None,
    x_app_session: str | None,
) -> str:
    if x_app_session:
        return decode_session_token(resolve_paper_session_token(x_app_session))
    if account_id:
        return normalize_paper_account_id(account_id)
    raise HTTPException(status_code=401, detail="세션 토큰이 필요합니다.")


def ensure_data(ticker: str, start_date: str, end_date: str, market: str = "us", krx_exchange: str = "auto") -> pd.DataFrame:
    market, krx_exchange = validate_market_params(market, krx_exchange)
    try:
        start_ts = pd.Timestamp(start_date)
        end_ts = pd.Timestamp(end_date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"날짜 형식이 잘못되었습니다: {exc}") from exc

    if start_ts >= end_ts:
        raise HTTPException(status_code=400, detail="시작일은 종료일보다 빨라야 합니다.")

    try:
        data = get_stock_data(ticker, start_date, end_date, market=market, krx_exchange=krx_exchange)
    except MarketDataRateLimitError as exc:
        raise HTTPException(status_code=503, detail="시세 제공사 요청 제한으로 가격 데이터를 잠시 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.") from exc
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
    cleaned.attrs = data.attrs.copy()
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


def validate_market_params(market: str, krx_exchange: str) -> tuple[str, str]:
    try:
        return normalize_market(market), normalize_krx_exchange(krx_exchange)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def validate_sentiment_options(period_days: int, source_filter: str) -> tuple[int, str]:
    if period_days < 1 or period_days > 30:
        raise HTTPException(status_code=400, detail="period_days must be between 1 and 30")

    normalized_source_filter = source_filter.strip().lower()
    if normalized_source_filter not in SENTIMENT_SOURCE_FILTER_LABELS:
        raise HTTPException(
            status_code=400,
            detail=f"source_filter must be one of {sorted(SENTIMENT_SOURCE_FILTER_LABELS)}",
        )
    return period_days, normalized_source_filter


def is_supabase_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


def ensure_supabase_configured() -> None:
    if not is_supabase_configured():
        raise HTTPException(
            status_code=503,
            detail="Supabase가 설정되지 않았습니다. SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 확인하세요.",
        )


def supabase_headers(prefer: str | None = None) -> dict[str, str]:
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    if SUPABASE_DB_SCHEMA:
        headers["Accept-Profile"] = SUPABASE_DB_SCHEMA
        headers["Content-Profile"] = SUPABASE_DB_SCHEMA
    return headers


def extract_supabase_error(response: requests.Response) -> dict[str, Any] | None:
    try:
        payload = response.json()
        if isinstance(payload, dict):
            return payload
    except Exception:
        pass
    return None


def parse_supabase_error(response: requests.Response) -> str:
    payload = extract_supabase_error(response)
    if payload:
        return str(payload.get("message") or payload.get("error_description") or payload.get("hint") or payload)
    return response.text or f"HTTP {response.status_code}"


def extract_response_payload(response: requests.Response) -> Any:
    try:
        return response.json()
    except Exception:
        return None


def parse_external_api_error(response: requests.Response) -> str:
    payload = extract_response_payload(response)
    if isinstance(payload, dict):
        return str(
            payload.get("message")
            or payload.get("error_description")
            or payload.get("reason")
            or payload.get("error")
            or payload
        )
    if payload is not None:
        return str(payload)
    return response.text or f"HTTP {response.status_code}"


def map_supabase_error(response: requests.Response) -> tuple[int, str]:
    detail = parse_supabase_error(response)
    normalized_detail = detail.strip().lower()

    if normalized_detail == "insufficient cash":
        return 400, "예수금이 부족합니다. 주문 수량을 줄이거나 모의 계좌를 초기화하세요."
    if normalized_detail == "insufficient shares":
        return 400, "보유 수량이 부족합니다. 현재 보유 주식 수를 확인하세요."
    if normalized_detail == "invalid side":
        return 400, "주문 구분이 올바르지 않습니다."
    if normalized_detail == "price and shares must be positive":
        return 400, "주문 가격과 수량은 0보다 커야 합니다."

    if response.status_code in {400, 401, 403, 404, 409, 422}:
        return response.status_code, f"Supabase 요청에 실패했습니다: {detail}"

    return 503, f"Supabase 요청에 실패했습니다: {detail}"


def call_supabase(
    method: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    json_payload: Any = None,
    prefer: str | None = None,
) -> Any:
    ensure_supabase_configured()
    url = f"{SUPABASE_URL}{path}"
    response = requests.request(
        method,
        url,
        headers=supabase_headers(prefer=prefer),
        params=params,
        json=json_payload,
        timeout=20,
    )
    if response.status_code >= 400:
        status_code, detail = map_supabase_error(response)
        raise HTTPException(
            status_code=status_code,
            detail=detail,
        )
    if not response.content:
        return None
    try:
        return response.json()
    except ValueError:
        return response.text


def ensure_paper_account(account_id: str) -> dict[str, Any]:
    rows = call_supabase(
        "GET",
        "/rest/v1/paper_trading_accounts",
        params={
            "account_id": f"eq.{account_id}",
            "select": "account_id,cash_krw,seed_cash_krw,updated_at",
            "limit": 1,
        },
    ) or []
    if rows:
        return rows[0]

    created = call_supabase(
        "POST",
        "/rest/v1/paper_trading_accounts",
        params={"on_conflict": "account_id"},
        json_payload=[{"account_id": account_id, "cash_krw": DEFAULT_PAPER_SEED_CASH_KRW, "seed_cash_krw": DEFAULT_PAPER_SEED_CASH_KRW}],
        prefer="resolution=merge-duplicates,return=representation",
    ) or []
    if not created:
        fallback_rows = call_supabase(
            "GET",
            "/rest/v1/paper_trading_accounts",
            params={
                "account_id": f"eq.{account_id}",
                "select": "account_id,cash_krw,seed_cash_krw,updated_at",
                "limit": 1,
            },
        ) or []
        if fallback_rows:
            return fallback_rows[0]
        raise HTTPException(status_code=503, detail="Supabase 계좌를 생성하지 못했습니다.")
    return created[0]


def get_paper_trading_state(account_id: str) -> dict[str, Any]:
    account = ensure_paper_account(account_id)
    holdings = call_supabase(
        "GET",
        "/rest/v1/paper_trading_positions",
        params={
            "account_id": f"eq.{account_id}",
            "select": "ticker,company_name,krx_exchange,shares,avg_price,updated_at",
            "order": "updated_at.desc",
        },
    ) or []
    trades = call_supabase(
        "GET",
        "/rest/v1/paper_trading_trades",
        params={
            "account_id": f"eq.{account_id}",
            "select": "id,side,ticker,company_name,krx_exchange,price,shares,amount_krw,traded_at",
            "order": "traded_at.desc",
            "limit": 200,
        },
    ) or []
    return normalize_value(
        {
            "account_id": account_id,
            "cash_krw": account.get("cash_krw", DEFAULT_PAPER_SEED_CASH_KRW),
            "seed_cash_krw": account.get("seed_cash_krw", DEFAULT_PAPER_SEED_CASH_KRW),
            "holdings": holdings,
            "trades": trades,
            "updated_at": account.get("updated_at"),
        }
    )


def execute_paper_trade(request: PaperTradingOrderRequest) -> dict[str, Any]:
    quote = create_quote_snapshot(request.ticker, market="krx", krx_exchange=request.krx_exchange)
    company_name = request.company_name or quote.get("company_name") or request.ticker
    payload = {
        "p_account_id": request.account_id,
        "p_ticker": request.ticker,
        "p_company_name": company_name,
        "p_krx_exchange": request.krx_exchange,
        "p_side": request.side,
        "p_price": float(quote["close"]),
        "p_shares": int(request.shares),
    }
    result = call_supabase(
        "POST",
        "/rest/v1/rpc/execute_paper_trade",
        json_payload=payload,
        prefer="return=representation",
    )
    return normalize_value({"quote": quote, "result": result})


def reset_paper_trading_account(account_id: str) -> dict[str, Any]:
    result = call_supabase(
        "POST",
        "/rest/v1/rpc/reset_paper_trading_account",
        json_payload={"p_account_id": account_id, "p_seed_cash_krw": DEFAULT_PAPER_SEED_CASH_KRW},
        prefer="return=representation",
    )
    return normalize_value({"account_id": account_id, "result": result})


def build_backtest_performance_summary(result_payload: dict[str, Any], run_type: str) -> dict[str, Any]:
    normalized_run_type = run_type.strip().lower()
    if normalized_run_type == "optimization":
        return normalize_value(
            {
                "best_metric_value": result_payload.get("best_metric_value", 0),
                "metric_optimized": result_payload.get("metric_optimized"),
                "best_params": result_payload.get("best_params", {}),
                "result_count": len(result_payload.get("all_optimization_results") or []),
            }
        )

    metrics = result_payload.get("performance_metrics", {}) or {}
    benchmark_metrics = result_payload.get("benchmark_metrics", {}) or {}
    comparison_metrics = result_payload.get("comparison_metrics", {}) or {}
    return normalize_value(
        {
            "total_return_pct": metrics.get("total_return_pct", 0),
            "sharpe_ratio": metrics.get("sharpe_ratio", 0),
            "max_drawdown_pct": metrics.get("max_drawdown_pct", 0),
            "cagr_pct": metrics.get("cagr_pct", 0),
            "final_total_value": metrics.get("final_total_value", 0),
            "total_trades": metrics.get("total_trades", 0),
            "benchmark_total_return_pct": benchmark_metrics.get("total_return_pct", 0),
            "excess_return_pct": comparison_metrics.get("excess_return_pct", 0),
        }
    )


def build_saved_backtest_name(request: SavedBacktestRequest) -> str:
    if request.save_name:
        return request.save_name

    base_name = request.company_name or request.resolved_ticker or request.ticker
    strategy_label = BACKTEST_STRATEGY_LABELS[request.strategy_key]
    run_type_label = BACKTEST_RUN_TYPE_LABELS[request.run_type]
    return f"{base_name} {strategy_label} {run_type_label}"


def list_saved_backtests(account_id: str) -> list[dict[str, Any]]:
    rows = call_supabase(
        "GET",
        "/rest/v1/saved_backtests",
        params={
            "account_id": f"eq.{account_id}",
            "select": (
                "id,save_name,run_type,strategy_key,strategy_name,ticker,resolved_ticker,"
                "company_name,market,krx_exchange,start_date,end_date,initial_capital,"
                "order_type,fixed_amount,metric_to_optimize,performance_summary,created_at,updated_at"
            ),
            "order": "updated_at.desc",
            "limit": 50,
        },
    ) or []
    return normalize_value(rows)


def get_saved_backtest(account_id: str, saved_backtest_id: int) -> dict[str, Any]:
    rows = call_supabase(
        "GET",
        "/rest/v1/saved_backtests",
        params={
            "account_id": f"eq.{account_id}",
            "id": f"eq.{saved_backtest_id}",
            "select": (
                "id,save_name,run_type,strategy_key,strategy_name,ticker,resolved_ticker,"
                "company_name,market,krx_exchange,start_date,end_date,initial_capital,"
                "order_type,fixed_amount,metric_to_optimize,request_payload,result_payload,"
                "performance_summary,created_at,updated_at"
            ),
            "limit": 1,
        },
    ) or []
    if not rows:
        raise HTTPException(status_code=404, detail="저장한 백테스트 결과를 찾지 못했습니다.")
    return normalize_value(rows[0])


def save_backtest_run(request: SavedBacktestRequest) -> dict[str, Any]:
    ensure_paper_account(request.account_id)
    performance_summary = build_backtest_performance_summary(request.result_payload, request.run_type)
    payload = {
        "account_id": request.account_id,
        "save_name": build_saved_backtest_name(request),
        "run_type": request.run_type,
        "strategy_key": request.strategy_key,
        "strategy_name": BACKTEST_STRATEGY_LABELS[request.strategy_key],
        "ticker": request.ticker,
        "resolved_ticker": request.resolved_ticker or request.ticker,
        "company_name": request.company_name,
        "market": request.market,
        "krx_exchange": request.krx_exchange,
        "start_date": request.start_date,
        "end_date": request.end_date,
        "initial_capital": request.initial_capital,
        "order_type": request.order_type,
        "fixed_amount": request.fixed_amount,
        "metric_to_optimize": request.metric_to_optimize,
        "request_payload": normalize_value(request.request_payload),
        "result_payload": normalize_value(request.result_payload),
        "performance_summary": performance_summary,
    }
    rows = call_supabase(
        "POST",
        "/rest/v1/saved_backtests",
        json_payload=[payload],
        prefer="return=representation",
    ) or []
    if not rows:
        raise HTTPException(status_code=503, detail="백테스트 결과를 저장하지 못했습니다.")
    return normalize_value(rows[0])


def delete_saved_backtest(account_id: str, saved_backtest_id: int) -> dict[str, Any]:
    get_saved_backtest(account_id, saved_backtest_id)
    call_supabase(
        "DELETE",
        "/rest/v1/saved_backtests",
        params={
            "account_id": f"eq.{account_id}",
            "id": f"eq.{saved_backtest_id}",
        },
    )
    return {"deleted": True, "id": saved_backtest_id}


def create_sentiment_snapshot(
    ticker: str,
    market: str = "us",
    krx_exchange: str = "auto",
    period_days: int = 7,
    source_filter: str = "all",
) -> dict[str, Any]:
    normalized_ticker = normalize_ticker_input(ticker)
    normalized_market, normalized_exchange = validate_market_params(market, krx_exchange)
    period_days, normalized_source_filter = validate_sentiment_options(period_days, source_filter)
    profile = get_symbol_profile(normalized_ticker, market=normalized_market, krx_exchange=normalized_exchange)
    articles, attempted_queries = gemini_analyzer.get_news_candidates(
        company_name=profile.get("name"),
        ticker=profile.get("resolved_ticker", normalized_ticker),
        market=profile.get("market", normalized_market),
        period_days=period_days,
        source_filter=normalized_source_filter,
    )
    if not articles:
        if not gemini_analyzer.NEWS_API_KEY:
            summary = "백엔드에 NEWS_API_KEY가 설정되지 않았습니다."
        else:
            summary = (
                f"최근 {period_days}일 기준으로 뉴스 검색 결과가 없습니다. "
                "회사명과 종목코드로 여러 번 재시도했지만 최신 뉴스를 찾지 못했습니다."
            )
        return normalize_value(
            {
                "ticker": normalized_ticker,
                "resolved_ticker": profile.get("resolved_ticker", normalized_ticker),
                "market": profile.get("market", normalized_market),
                "krx_exchange": profile.get("krx_exchange", normalized_exchange),
                "company_name": profile.get("name"),
                "sentiment_score": 50,
                "summary": summary,
                "investment_implications": "참고할 뉴스가 충분하지 않아 투자 시사점을 따로 분리하지 못했습니다.",
                "articles": [],
                "attempted_queries": attempted_queries,
                "period_days": period_days,
                "source_filter": normalized_source_filter,
                "source_filter_label": SENTIMENT_SOURCE_FILTER_LABELS[normalized_source_filter],
                "news_api_enabled": bool(gemini_analyzer.NEWS_API_KEY),
            }
        )

    try:
        result_json = gemini_analyzer.analyze_sentiment_with_gemini(json.dumps(articles, ensure_ascii=False))
        result = json.loads(result_json)
    except Exception as exc:
        result = {
            "sentiment_score": 50,
            "summary": f"AI 분석을 완료하지 못해 중립 점수로 대체했습니다. 사유: {exc}",
            "investment_implications": "AI 요약이 실패해 투자 시사점을 분리하지 못했습니다.",
            "articles": articles,
        }

    result["ticker"] = normalized_ticker
    result["resolved_ticker"] = profile.get("resolved_ticker", normalized_ticker)
    result["market"] = profile.get("market", normalized_market)
    result["krx_exchange"] = profile.get("krx_exchange", normalized_exchange)
    result["company_name"] = profile.get("name")
    result["articles"] = result.get("articles", articles)
    result["attempted_queries"] = attempted_queries
    result["period_days"] = period_days
    result["source_filter"] = normalized_source_filter
    result["source_filter_label"] = SENTIMENT_SOURCE_FILTER_LABELS[normalized_source_filter]
    result["news_api_enabled"] = bool(gemini_analyzer.NEWS_API_KEY)
    return normalize_value(result)


def closing_bet_recent_stock_window(market: str) -> tuple[str, str]:
    cutoff_date = resolve_sector_snapshot_cutoff_date(market)
    end_date = cutoff_date + timedelta(days=1)
    start_date = end_date - timedelta(days=90)
    return start_date.isoformat(), end_date.isoformat()


def clamp_metric(value: float, minimum: int = 0, maximum: int = 100) -> int:
    return max(minimum, min(maximum, round(value)))


def derive_close_strength_from_rows(rows: list[dict[str, Any]]) -> int:
    if len(rows) < 2:
        return 55
    latest = rows[-1]
    previous = rows[-2]
    latest_close = float(latest.get("Close") or 0)
    latest_open = float(latest.get("Open") or latest_close)
    latest_high = float(latest.get("High") or latest_close)
    latest_low = float(latest.get("Low") or latest_close)
    previous_close = float(previous.get("Close") or latest_close)
    day_range = max(latest_high - latest_low, 0.000001)
    close_position = ((latest_close - latest_low) / day_range) * 100
    body_strength = ((latest_close / max(latest_open, 0.000001)) - 1) * 100
    change_pct = ((latest_close / max(previous_close, 0.000001)) - 1) * 100
    return clamp_metric(20 + close_position * 0.55 + body_strength * 4 + change_pct * 3)


def derive_volume_persistence(match: dict[str, Any] | None, quote: dict[str, Any] | None, rows: list[dict[str, Any]]) -> int:
    if not match and not quote and not rows:
        return 52

    volume_score = 0.0
    if len(rows) >= 21:
        latest_volume = float(rows[-1].get("Volume") or 0)
        previous_volumes = [float(row.get("Volume") or 0) for row in rows[-21:-1]]
        avg_volume = sum(previous_volumes) / max(len(previous_volumes), 1)
        if avg_volume > 0:
            volume_ratio = latest_volume / avg_volume
            volume_score = min(30.0, volume_ratio * 12)

    return clamp_metric(
        50
        + float((quote or {}).get("change_pct") or 0) * 2.5
        + float((match or {}).get("trend_score") or 0) * 1.8
        + float((match or {}).get("return_1d_pct") or 0) * 2
        + volume_score
    )


def derive_news_follow_through(sentiment: dict[str, Any] | None) -> int:
    if not sentiment:
        return 50
    return clamp_metric(float(sentiment.get("sentiment_score") or 50))


def derive_tomorrow_catalyst(sentiment: dict[str, Any] | None) -> int:
    if not sentiment:
        return 48
    article_boost = min(12, len(sentiment.get("articles") or []) * 3)
    api_boost = 6 if sentiment.get("news_api_enabled") else 0
    return clamp_metric(float(sentiment.get("sentiment_score") or 50) * 0.65 + article_boost + api_boost)


def derive_risk_control(
    quote: dict[str, Any] | None,
    match: dict[str, Any] | None,
    sentiment: dict[str, Any] | None,
    rows: list[dict[str, Any]],
) -> int:
    if not quote and not match and not sentiment and not rows:
        return 50

    close_location_bonus = 0.0
    pullback_penalty = 0.0
    if len(rows) >= 20:
        recent_rows = rows[-20:]
        closes = [float(row.get("Close") or 0) for row in recent_rows]
        highs = [float(row.get("High") or 0) for row in recent_rows]
        latest_close = closes[-1]
        twenty_day_high = max(highs) if highs else latest_close
        if twenty_day_high > 0:
            close_location_bonus = (latest_close / twenty_day_high) * 18

        latest = recent_rows[-1]
        latest_high = float(latest.get("High") or latest_close)
        latest_low = float(latest.get("Low") or latest_close)
        latest_open = float(latest.get("Open") or latest_close)
        candle_range_pct = ((latest_high - latest_low) / max(latest_close, 0.000001)) * 100
        if latest_close < latest_open:
            pullback_penalty += 8
        pullback_penalty += min(12.0, candle_range_pct * 1.5)

    return clamp_metric(
        48
        + float((quote or {}).get("change_pct") or 0) * 1.5
        + float((match or {}).get("trend_score") or 0) * 1.1
        + (float((sentiment or {}).get("sentiment_score") or 50) - 50) * 0.3
        + close_location_bonus
        - pullback_penalty
    )


def derive_market_close_scenario(rows: list[dict[str, Any]], sentiment: dict[str, Any] | None) -> str:
    if len(rows) < 2:
        return CLOSING_BET_QUICK_SCENARIOS[1]

    latest = rows[-1]
    previous = rows[-2]
    latest_open = float(latest.get("Open") or 0)
    latest_high = float(latest.get("High") or 0)
    latest_low = float(latest.get("Low") or 0)
    latest_close = float(latest.get("Close") or 0)
    previous_close = float(previous.get("Close") or latest_close)
    latest_volume = float(latest.get("Volume") or 0)
    day_range = max(latest_high - latest_low, 0.000001)
    close_position = (latest_close - latest_low) / day_range
    body_return_pct = ((latest_close / max(latest_open, 0.000001)) - 1) * 100
    day_return_pct = ((latest_close / max(previous_close, 0.000001)) - 1) * 100
    previous_volumes = [float(row.get("Volume") or 0) for row in rows[-21:-1]] if len(rows) >= 21 else []
    avg_volume = sum(previous_volumes) / max(len(previous_volumes), 1)
    volume_ratio = latest_volume / avg_volume if avg_volume > 0 else 1
    sentiment_score = float((sentiment or {}).get("sentiment_score") or 50)

    if close_position >= 0.8 and body_return_pct >= 0 and day_return_pct >= 1:
        return CLOSING_BET_QUICK_SCENARIOS[0]
    if close_position >= 0.58 and body_return_pct >= -0.5 and volume_ratio >= 1.1:
        return CLOSING_BET_QUICK_SCENARIOS[1]
    if day_return_pct >= 2 and close_position < 0.45 and sentiment_score >= 55:
        return CLOSING_BET_QUICK_SCENARIOS[2]
    return CLOSING_BET_QUICK_SCENARIOS[3]


def derive_risk_flags(
    rows: list[dict[str, Any]],
    match: dict[str, Any] | None,
    sentiment: dict[str, Any] | None,
    scenario: str,
    scores: dict[str, int],
) -> list[str]:
    flags: list[str] = []
    if scenario == CLOSING_BET_QUICK_SCENARIOS[2]:
        flags.append("뉴스 영향으로 급등했지만 종가까지 매도 물량이 남아 있을 가능성이 있습니다.")
    if scenario == CLOSING_BET_QUICK_SCENARIOS[3]:
        flags.append("고가 대비 종가 위치가 낮아 장 마감까지 힘이 유지됐다고 보기 어렵습니다.")

    if len(rows) >= 2:
        latest = rows[-1]
        latest_open = float(latest.get("Open") or 0)
        latest_high = float(latest.get("High") or 0)
        latest_low = float(latest.get("Low") or 0)
        latest_close = float(latest.get("Close") or 0)
        latest_volume = float(latest.get("Volume") or 0)
        day_range = max(latest_high - latest_low, 0.000001)
        close_position = (latest_close - latest_low) / day_range
        upper_wick_ratio = (latest_high - max(latest_open, latest_close)) / day_range
        if close_position < 0.45 or upper_wick_ratio > 0.45:
            flags.append("윗꼬리 또는 종가 밀림이 커서 종가베팅 관점에서는 방어력이 약해 보입니다.")
        if len(rows) >= 21:
            previous_volumes = [float(row.get("Volume") or 0) for row in rows[-21:-1]]
            avg_volume = sum(previous_volumes) / max(len(previous_volumes), 1)
            if avg_volume > 0:
                volume_ratio = latest_volume / avg_volume
                if volume_ratio < 0.9 and scores.get("volume_persistence", 52) < 60:
                    flags.append("거래량이 평소보다 크게 늘지 않아 수급 지속성 신호가 약합니다.")

    if match and scores.get("leader_status", 45) < 55:
        flags.append(f"{match.get('name', '해당')} 섹터 안에서는 대장주보다 후발주에 가까워 보입니다.")

    if sentiment:
        if float(sentiment.get("sentiment_score") or 50) < 45:
            flags.append("뉴스와 시장 심리가 약해서 내일 재료가 다시 이어질 가능성이 높지 않습니다.")
        if not sentiment.get("news_api_enabled"):
            flags.append("최신 뉴스 수집 범위가 좁아 재료 지속성 판단 신뢰도가 낮을 수 있습니다.")
    else:
        flags.append("뉴스 재료 확인이 충분하지 않아 내일 연결성 판단이 제한적입니다.")

    if scores.get("risk_control", 50) < 50:
        flags.append("손절 기준을 잡기 쉬운 구조로 보기 어려워 대응 난도가 높을 수 있습니다.")

    deduped = list(dict.fromkeys(flags))
    return deduped[:5]


def score_label(score: int) -> str:
    if score >= 76:
        return "내일 이어질 가능성이 상대적으로 높음"
    if score >= 60:
        return "관심 후보지만 장 막판 구조를 더 확인해야 함"
    if score >= 45:
        return "애매함, 억지 진입보다 관찰 우선"
    return "종가베팅보다 제외가 유리한 구간"


def score_action(score: int) -> str:
    if score >= 76:
        return "후보군 상단. 내일 갭상승보다 시가 이후 지지 여부까지 같이 준비합니다."
    if score >= 60:
        return "관심 유지 구간입니다. 주요 지표는 나쁘지 않지만 확신 구간은 아닙니다."
    if score >= 45:
        return "복기 후보 정도로 보는 편이 낫습니다. 억지 진입보다 관찰이 우선입니다."
    return "오늘 살아남은 수급으로 보기 어렵습니다. 다른 후보를 우선 검토하는 편이 맞습니다."


def evaluate_closing_bet(ticker: str, market: str = "krx", krx_exchange: str = "auto") -> dict[str, Any]:
    normalized_ticker = normalize_market_ticker_input(ticker, market)
    normalized_market, normalized_exchange = validate_market_params(market, krx_exchange)
    start_date, end_date = closing_bet_recent_stock_window(normalized_market)
    stock_data = ensure_data(normalized_ticker, start_date, end_date, market=normalized_market, krx_exchange=normalized_exchange)
    rows = serialize_portfolio(stock_data)
    quote = create_quote_snapshot(normalized_ticker, market=normalized_market, krx_exchange=normalized_exchange)
    sentiment = create_sentiment_snapshot(normalized_ticker, market=normalized_market, krx_exchange=normalized_exchange)
    sector_snapshot = create_sector_snapshot(normalized_market)
    resolved_ticker = quote.get("resolved_ticker", normalized_ticker)
    resolved_sector = None
    for sector in sector_snapshot.get("sectors", []):
        for component in sector.get("components", []):
            if component.get("ticker", "").strip().upper() == str(resolved_ticker).strip().upper():
                resolved_sector = sector
                break
        if resolved_sector:
            break

    sector_index = -1
    if resolved_sector:
        for index, item in enumerate(sector_snapshot.get("sectors", [])):
            if item.get("key") == resolved_sector.get("key"):
                sector_index = index
                break
    leader_boost = 14 if resolved_sector and any(item.get("key") == resolved_sector.get("key") for item in sector_snapshot.get("leaders", [])) else 0
    laggard_penalty = 18 if resolved_sector and any(item.get("key") == resolved_sector.get("key") for item in sector_snapshot.get("laggards", [])) else 0
    ranking_boost = max(0, 18 - sector_index * 2) if sector_index >= 0 else 0
    sector_strength = clamp_metric(
        52
        + float((resolved_sector or {}).get("return_1d_pct") or 0) * 3
        + float((resolved_sector or {}).get("return_5d_pct") or 0) * 1.2
        + float((resolved_sector or {}).get("trend_score") or 0) * 1.5
        + leader_boost
        + ranking_boost
        - laggard_penalty
    ) if resolved_sector else 50

    component_index = -1
    if resolved_sector:
        components = resolved_sector.get("components") or []
        for index, item in enumerate(components):
            if item.get("ticker", "").strip().upper() == str(resolved_ticker).strip().upper():
                component_index = index
                break
    component_boost = 18 if component_index == 0 else max(4, 12 - component_index * 2) if component_index > 0 else 0
    resolved_sector_leader_boost = 12 if resolved_sector and any(item.get("key") == resolved_sector.get("key") for item in sector_snapshot.get("leaders", [])) else 0
    leader_status = clamp_metric(48 + component_boost + resolved_sector_leader_boost + float((resolved_sector or {}).get("trend_score") or 0) * 1.2) if resolved_sector else 45

    scores = {
        "sector_strength": sector_strength,
        "close_strength": derive_close_strength_from_rows(rows) if rows else clamp_metric(55 + float(quote.get("change_pct") or 0) * 4),
        "volume_persistence": derive_volume_persistence(resolved_sector, quote, rows),
        "leader_status": leader_status,
        "news_follow_through": derive_news_follow_through(sentiment),
        "tomorrow_catalyst": derive_tomorrow_catalyst(sentiment),
        "risk_control": derive_risk_control(quote, resolved_sector, sentiment, rows),
    }
    scenario = derive_market_close_scenario(rows, sentiment)
    total_score = clamp_metric(
        scores["sector_strength"] * 0.2
        + scores["close_strength"] * 0.24
        + scores["volume_persistence"] * 0.2
        + scores["leader_status"] * 0.16
        + scores["news_follow_through"] * 0.1
        + scores["tomorrow_catalyst"] * 0.05
        + scores["risk_control"] * 0.05
        + CLOSING_BET_SCENARIO_MODIFIERS[scenario]
    )
    signal_date = str((rows[-1].get("Date") or quote.get("as_of") or "")).split("T", 1)[0]
    risk_flags = derive_risk_flags(rows, resolved_sector, sentiment, scenario, scores)

    return normalize_value(
        {
            "ticker": normalized_ticker,
            "resolved_ticker": resolved_ticker,
            "market": normalized_market,
            "krx_exchange": normalized_exchange,
            "company_name": quote.get("company_name") or sentiment.get("company_name"),
            "signal_date": signal_date,
            "quote": quote,
            "sentiment": sentiment,
            "sector_snapshot": sector_snapshot,
            "resolved_sector": resolved_sector,
            "scores": scores,
            "scenario": scenario,
            "scenario_modifier": CLOSING_BET_SCENARIO_MODIFIERS[scenario],
            "total_score": total_score,
            "score_label": score_label(total_score),
            "score_action": score_action(total_score),
            "risk_flags": risk_flags,
        }
    )


def is_email_configured() -> bool:
    return bool(SMTP_HOST and SMTP_FROM_EMAIL)


def is_toss_login_configured() -> bool:
    return bool(APPS_IN_TOSS_CERT_PATH and APPS_IN_TOSS_KEY_PATH)


def is_toss_smart_message_configured() -> bool:
    return bool(APPS_IN_TOSS_CERT_PATH and APPS_IN_TOSS_KEY_PATH and TOSS_SMART_MESSAGE_TEMPLATE_CODE)


def get_toss_login_diagnostics() -> dict[str, Any]:
    return {
        "configured": is_toss_login_configured(),
        "base_url": APPS_IN_TOSS_API_BASE_URL or None,
        "generate_token_url": TOSS_LOGIN_GENERATE_TOKEN_URL or None,
        "me_url": TOSS_LOGIN_ME_URL or None,
        "cert_path_set": bool(APPS_IN_TOSS_CERT_PATH),
        "key_path_set": bool(APPS_IN_TOSS_KEY_PATH),
        "cert_file_exists": bool(APPS_IN_TOSS_CERT_PATH) and os.path.exists(APPS_IN_TOSS_CERT_PATH),
        "key_file_exists": bool(APPS_IN_TOSS_KEY_PATH) and os.path.exists(APPS_IN_TOSS_KEY_PATH),
    }


def get_toss_smart_message_diagnostics() -> dict[str, Any]:
    def safe_dir_listing(path: str) -> list[str]:
        try:
            return sorted(os.listdir(path))[:20]
        except Exception:
            return []

    return {
        "configured": is_toss_smart_message_configured(),
        "app_name": APPS_IN_TOSS_APP_NAME or None,
        "cert_path_set": bool(APPS_IN_TOSS_CERT_PATH),
        "key_path_set": bool(APPS_IN_TOSS_KEY_PATH),
        "cert_env_set": bool((os.getenv("APPS_IN_TOSS_CERT_PATH") or "").strip()),
        "key_env_set": bool((os.getenv("APPS_IN_TOSS_KEY_PATH") or "").strip()),
        "cert_pem_env_set": bool((os.getenv("APPS_IN_TOSS_CERT_PATH_PEM") or "").strip()),
        "key_pem_env_set": bool((os.getenv("APPS_IN_TOSS_KEY_PATH_PEM") or "").strip()),
        "template_code_set": bool(TOSS_SMART_MESSAGE_TEMPLATE_CODE),
        "cert_file_exists": bool(APPS_IN_TOSS_CERT_PATH) and os.path.exists(APPS_IN_TOSS_CERT_PATH),
        "key_file_exists": bool(APPS_IN_TOSS_KEY_PATH) and os.path.exists(APPS_IN_TOSS_KEY_PATH),
        "cert_path_basename": os.path.basename(APPS_IN_TOSS_CERT_PATH) if APPS_IN_TOSS_CERT_PATH else None,
        "key_path_basename": os.path.basename(APPS_IN_TOSS_KEY_PATH) if APPS_IN_TOSS_KEY_PATH else None,
        "template_code": TOSS_SMART_MESSAGE_TEMPLATE_CODE or None,
        "cert_sha256": APPS_IN_TOSS_CERT_SHA256,
        "cert_fingerprint_sha256": APPS_IN_TOSS_CERT_FINGERPRINT_SHA256,
        "cwd": os.getcwd(),
        "secrets_dir_exists": os.path.isdir("/etc/secrets"),
        "secrets_dir_files": safe_dir_listing("/etc/secrets"),
        "cwd_files": safe_dir_listing(os.getcwd()),
    }


def format_toss_smart_message_failure_detail(error: dict[str, Any]) -> str:
    error_code = str(error.get("errorCode") or "UNKNOWN")
    reason = str(error.get("reason") or "요청에 실패했습니다.")
    detail = f"Toss 스마트 발송 실패: {error_code} / {reason}"
    if error_code == "4010":
        detail = (
            f"{detail} "
            f"(app={APPS_IN_TOSS_APP_NAME}, template={TOSS_SMART_MESSAGE_TEMPLATE_CODE}; "
            "확인: Toss 앱 안에서 연 배포본인지, 알림 동의 템플릿과 발송 템플릿이 같은지, "
            "최신 Toss 로그인 userKey 또는 anonKey를 저장했는지, 현재 mTLS 인증서가 이 앱에 연결된 인증서인지)"
        )
    return detail


def exchange_toss_login_authorization_code(authorization_code: str, referrer: str | None = None) -> dict[str, Any]:
    if not is_toss_login_configured():
        raise HTTPException(status_code=503, detail="Apps in Toss mTLS 인증서 설정이 없어 userKey를 조회할 수 없습니다.")

    if not TOSS_LOGIN_GENERATE_TOKEN_URL:
        raise HTTPException(status_code=503, detail="토스 로그인 토큰 발급 URL 설정이 없어 userKey를 조회할 수 없습니다.")

    payload = {
        "authorizationCode": authorization_code,
        "referrer": referrer or "DEFAULT",
    }

    response = requests.post(
        TOSS_LOGIN_GENERATE_TOKEN_URL,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        json=payload,
        cert=(APPS_IN_TOSS_CERT_PATH, APPS_IN_TOSS_KEY_PATH),
        timeout=20,
    )
    if response.status_code >= 400:
        detail = parse_external_api_error(response)
        raise HTTPException(status_code=503, detail=f"토스 로그인 토큰 교환에 실패했습니다: {detail}")

    result = extract_response_payload(response)
    if not isinstance(result, dict):
        raise HTTPException(status_code=503, detail="토스 로그인 토큰 응답을 해석하지 못했습니다.")
    if result.get("resultType") == "FAIL":
        error = result.get("error") or {}
        raise HTTPException(
            status_code=503,
            detail=f"토스 로그인 토큰 교환 실패: {error.get('errorCode', 'UNKNOWN')} / {error.get('reason', '요청에 실패했습니다.')}",
        )
    return result


def fetch_toss_login_user_key(access_token: str) -> dict[str, Any]:
    response = requests.get(
        TOSS_LOGIN_ME_URL,
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {access_token}",
        },
        cert=(APPS_IN_TOSS_CERT_PATH, APPS_IN_TOSS_KEY_PATH),
        timeout=20,
    )
    if response.status_code >= 400:
        detail = parse_external_api_error(response)
        raise HTTPException(status_code=503, detail=f"토스 로그인 사용자 조회에 실패했습니다: {detail}")

    result = extract_response_payload(response)
    if not isinstance(result, dict):
        raise HTTPException(status_code=503, detail="토스 로그인 사용자 조회 응답을 해석하지 못했습니다.")
    if result.get("resultType") == "FAIL":
        error = result.get("error") or {}
        raise HTTPException(
            status_code=503,
            detail=f"토스 로그인 사용자 조회 실패: {error.get('errorCode', 'UNKNOWN')} / {error.get('reason', '요청에 실패했습니다.')}",
        )

    success = result.get("success") or {}
    user_key = success.get("userKey")
    if user_key in {None, ""}:
        raise HTTPException(status_code=503, detail="토스 로그인 사용자 조회 응답에 userKey가 없습니다.")

    scope = str(success.get("scope") or "")
    scope_list = [item.strip() for item in scope.split(",") if item and item.strip()]
    return {
        "user_key": str(user_key),
        "scope": scope,
        "scope_list": scope_list,
    }


def extract_toss_access_token(token_result: dict[str, Any]) -> str:
    candidates = [
        token_result,
        token_result.get("success") or {},
        (token_result.get("data") or {}) if isinstance(token_result.get("data"), dict) else {},
    ]
    success = token_result.get("success") or {}
    if isinstance(success, dict):
        data = success.get("data")
        if isinstance(data, dict):
            candidates.append(data)

    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        value = candidate.get("access_token") or candidate.get("accessToken")
        if value:
            return str(value)
    return ""


def resolve_toss_login_user_key(authorization_code: str, referrer: str | None = None) -> dict[str, Any]:
    token_result = exchange_toss_login_authorization_code(authorization_code, referrer)
    access_token = extract_toss_access_token(token_result)
    if not access_token:
        top_level_keys = ", ".join(sorted(str(key) for key in token_result.keys())) if isinstance(token_result, dict) else "-"
        success_keys = "-"
        if isinstance(token_result, dict) and isinstance(token_result.get("success"), dict):
            success_keys = ", ".join(sorted(str(key) for key in token_result["success"].keys()))
        raise HTTPException(
            status_code=503,
            detail=(
                "토스 로그인 토큰 응답에 access token이 없습니다. "
                f"top-level keys: [{top_level_keys}] / success keys: [{success_keys}]"
            ),
        )

    user_result = fetch_toss_login_user_key(access_token)
    return {
        **user_result,
        "referrer": referrer or "DEFAULT",
    }


def build_toss_smart_message_context(evaluation: dict[str, Any]) -> dict[str, Any]:
    return {
        "ticker": str(evaluation.get("resolved_ticker") or evaluation.get("ticker") or ""),
        "companyName": str(evaluation.get("company_name") or evaluation.get("resolved_ticker") or evaluation.get("ticker") or ""),
        "score": str(evaluation.get("total_score") or ""),
        "signalDate": str(evaluation.get("signal_date") or ""),
        "market": str(evaluation.get("market") or ""),
        "marketName": sector_market_name(str(evaluation.get("market") or "krx")),
        "scenario": str(evaluation.get("scenario") or ""),
        "scoreLabel": str(evaluation.get("score_label") or ""),
    }


def log_toss_smart_message_event(event: str, **payload: Any) -> None:
    logger.warning("toss_smart_message %s", json.dumps({"event": event, **payload}, ensure_ascii=False, sort_keys=True))


def build_toss_message_recipient_header(recipient_key_type: str, recipient_key: str) -> dict[str, str]:
    if recipient_key_type == "user_key":
        return {"x-user-key": recipient_key}
    if recipient_key_type == "anonymous_key":
        return {"x-anon-key": recipient_key}
    raise HTTPException(status_code=400, detail="지원하지 않는 Toss 발송 식별자 타입입니다.")


def call_toss_smart_message_api(
    path: str,
    *,
    recipient_key: str,
    recipient_key_type: str = "user_key",
    payload: dict[str, Any],
) -> dict[str, Any]:
    if not is_toss_smart_message_configured():
        raise HTTPException(status_code=503, detail="스마트 발송 연동 설정이 없어 Toss 메시지를 보낼 수 없습니다.")

    masked_recipient_key = mask_toss_user_key(recipient_key)
    template_set_code = str(payload.get("templateSetCode") or "")
    deployment_id = str(payload.get("deploymentId") or "") or None
    log_toss_smart_message_event(
        "request",
        app_name=APPS_IN_TOSS_APP_NAME,
        path=path,
        template_set_code=template_set_code,
        deployment_id=deployment_id,
        recipient_key_type=recipient_key_type,
        masked_recipient_key=masked_recipient_key,
        cert_sha256=APPS_IN_TOSS_CERT_SHA256,
        cert_fingerprint_sha256=APPS_IN_TOSS_CERT_FINGERPRINT_SHA256,
    )

    response = requests.post(
        f"{TOSS_SMART_MESSAGE_BASE_URL}{path}",
        headers={
            "Content-Type": "application/json",
            **build_toss_message_recipient_header(recipient_key_type, recipient_key),
        },
        json=payload,
        cert=(APPS_IN_TOSS_CERT_PATH, APPS_IN_TOSS_KEY_PATH),
        timeout=20,
    )

    if response.status_code >= 400:
        detail = response.text
        try:
            detail = str(response.json())
        except Exception:
            pass
        log_toss_smart_message_event(
            "http_error",
            app_name=APPS_IN_TOSS_APP_NAME,
            path=path,
            template_set_code=template_set_code,
            deployment_id=deployment_id,
            recipient_key_type=recipient_key_type,
            masked_recipient_key=masked_recipient_key,
            cert_sha256=APPS_IN_TOSS_CERT_SHA256,
            cert_fingerprint_sha256=APPS_IN_TOSS_CERT_FINGERPRINT_SHA256,
            status_code=response.status_code,
            response_detail=detail[:500],
        )
        raise HTTPException(status_code=503, detail=f"Toss 스마트 발송 요청에 실패했습니다: {detail}")

    try:
        result = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=503, detail="Toss 스마트 발송 응답을 해석하지 못했습니다.") from exc

    if result.get("resultType") == "FAIL":
        error = result.get("error") or {}
        log_toss_smart_message_event(
            "result_fail",
            app_name=APPS_IN_TOSS_APP_NAME,
            path=path,
            template_set_code=template_set_code,
            deployment_id=deployment_id,
            recipient_key_type=recipient_key_type,
            masked_recipient_key=masked_recipient_key,
            cert_sha256=APPS_IN_TOSS_CERT_SHA256,
            cert_fingerprint_sha256=APPS_IN_TOSS_CERT_FINGERPRINT_SHA256,
            error_code=error.get("errorCode"),
            reason=error.get("reason"),
        )
        raise HTTPException(
            status_code=503,
            detail=format_toss_smart_message_failure_detail(error),
        )
    log_toss_smart_message_event(
        "result_success",
        app_name=APPS_IN_TOSS_APP_NAME,
        path=path,
        template_set_code=template_set_code,
        deployment_id=deployment_id,
        recipient_key_type=recipient_key_type,
        masked_recipient_key=masked_recipient_key,
        cert_sha256=APPS_IN_TOSS_CERT_SHA256,
        cert_fingerprint_sha256=APPS_IN_TOSS_CERT_FINGERPRINT_SHA256,
        result_type=result.get("resultType"),
    )
    return result


def send_email_notification(destination: str, subject: str, message: str) -> None:
    if not is_email_configured():
        raise HTTPException(status_code=503, detail="SMTP 설정이 없어 이메일 알림을 보낼 수 없습니다.")
    email = EmailMessage()
    email["From"] = SMTP_FROM_EMAIL
    email["To"] = destination
    email["Subject"] = subject
    email.set_content(message)

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as server:
        if SMTP_USE_TLS:
            server.starttls()
        if SMTP_USERNAME:
            server.login(SMTP_USERNAME, SMTP_PASSWORD)
        server.send_message(email)


def create_toss_inapp_alert_event(
    account_id: str,
    destination: str,
    subject: str,
    message: str,
    payload: dict[str, Any],
    notification_id: int | None = None,
) -> dict[str, Any]:
    if not is_supabase_configured():
        return {
            "account_id": account_id,
            "notification_id": notification_id,
            "delivered_channel": "toss_inapp",
            "title": subject,
            "message": f"{destination}\n{message}" if destination else message,
            "ticker": payload.get("resolved_ticker") or payload.get("ticker") or "-",
            "market": payload.get("market") or "krx",
            "signal_date": payload.get("signal_date"),
            "total_score": payload.get("total_score"),
            "created_at": datetime.utcnow().isoformat(),
            "persisted": False,
        }
    rows = call_supabase(
        "POST",
        "/rest/v1/closing_bet_alert_events",
        json_payload=[{
            "account_id": account_id,
            "notification_id": notification_id,
            "delivered_channel": "toss_inapp",
            "title": subject,
            "message": f"{destination}\n{message}" if destination else message,
            "ticker": payload.get("resolved_ticker") or payload.get("ticker") or "-",
            "market": payload.get("market") or "krx",
            "signal_date": payload.get("signal_date"),
            "total_score": payload.get("total_score"),
        }],
        prefer="return=representation",
    ) or []
    if not rows:
        raise HTTPException(status_code=503, detail="토스 인앱 알림을 저장하지 못했습니다.")
    return normalize_value(rows[0])


def send_toss_smart_test_message(
    *,
    account_id: str,
    recipient_key: str,
    deployment_id: str,
    evaluation: dict[str, Any],
    notification_id: int | None = None,
) -> dict[str, Any]:
    subject, message = format_closing_bet_notification_message(evaluation, int(evaluation.get("total_score") or 0))
    recipient_key_type = infer_toss_recipient_key_type(recipient_key)
    result = call_toss_smart_message_api(
        "/api-partner/v1/apps-in-toss/messenger/send-test-message",
        recipient_key=recipient_key,
        recipient_key_type=recipient_key_type,
        payload={
            "templateSetCode": TOSS_SMART_MESSAGE_TEMPLATE_CODE,
            "deploymentId": deployment_id,
            "context": build_toss_smart_message_context(evaluation),
        },
    )
    create_toss_inapp_alert_event(account_id, "TEST", subject, message, evaluation, notification_id)
    return normalize_value(result)


def send_toss_smart_message(
    *,
    account_id: str,
    recipient_key: str,
    evaluation: dict[str, Any],
    notification_id: int | None = None,
) -> dict[str, Any]:
    subject, message = format_closing_bet_notification_message(evaluation, int(evaluation.get("total_score") or 0))
    recipient_key_type = infer_toss_recipient_key_type(recipient_key)
    result = call_toss_smart_message_api(
        "/api-partner/v1/apps-in-toss/messenger/send-message",
        recipient_key=recipient_key,
        recipient_key_type=recipient_key_type,
        payload={
            "templateSetCode": TOSS_SMART_MESSAGE_TEMPLATE_CODE,
            "context": build_toss_smart_message_context(evaluation),
        },
    )
    create_toss_inapp_alert_event(account_id, "LIVE", subject, message, evaluation, notification_id)
    return normalize_value(result)


def send_closing_bet_notification(
    channel: str,
    destination: str,
    subject: str,
    message: str,
    payload: dict[str, Any],
    *,
    account_id: str | None = None,
    notification_id: int | None = None,
    toss_user_key: str | None = None,
) -> None:
    if channel == "email":
        send_email_notification(destination, subject, message)
        return
    if channel == "toss_inapp":
        if not account_id or not toss_user_key:
            raise HTTPException(status_code=400, detail="토스 스마트 발송에는 account_id와 toss_user_key가 필요합니다.")
        send_toss_smart_message(
            account_id=account_id,
            recipient_key=toss_user_key,
            evaluation=payload,
            notification_id=notification_id,
        )
        return
    raise HTTPException(status_code=400, detail="지원하지 않는 알림 채널입니다.")


def format_closing_bet_notification_message(evaluation: dict[str, Any], threshold_score: int) -> tuple[str, str]:
    company = evaluation.get("company_name") or evaluation.get("resolved_ticker") or evaluation.get("ticker")
    subject = f"[한눈투자] 종가베팅 알림 - {company}"
    message = (
        f"{company} 종가베팅 점수 {evaluation.get('total_score')}점이 기준 {threshold_score}점을 넘었습니다.\n"
        f"- 시장: {sector_market_name(evaluation.get('market', 'krx'))}\n"
        f"- 시그널 날짜: {evaluation.get('signal_date')}\n"
        f"- 시나리오: {evaluation.get('scenario')}\n"
        f"- 해석: {evaluation.get('score_label')}\n"
        f"- 행동 가이드: {evaluation.get('score_action')}\n"
        f"- 제외 신호: {', '.join(evaluation.get('risk_flags') or ['없음'])}"
    )
    return subject, message


def ensure_notification_dispatch_token(x_dispatch_token: str | None) -> None:
    if not NOTIFICATION_DISPATCH_TOKEN:
        raise HTTPException(status_code=503, detail="NOTIFICATION_DISPATCH_TOKEN 설정이 없어 배치 발송을 사용할 수 없습니다.")
    if (x_dispatch_token or "").strip() != NOTIFICATION_DISPATCH_TOKEN:
        raise HTTPException(status_code=401, detail="배치 발송 토큰이 올바르지 않습니다.")


def list_closing_bet_notifications(account_id: str) -> list[dict[str, Any]]:
    if not is_supabase_configured():
        return []
    ensure_paper_account(account_id)
    rows = call_supabase(
        "GET",
        "/rest/v1/closing_bet_notifications",
        params={
            "account_id": f"eq.{account_id}",
            "select": "id,account_id,ticker,market,krx_exchange,channel,destination,threshold_score,active,company_name,resolved_ticker,last_score,last_signal_date,last_notified_at,last_evaluated_at,created_at,updated_at",
            "order": "updated_at.desc",
        },
    ) or []
    return normalize_value(rows)


def list_closing_bet_alert_events(account_id: str) -> list[dict[str, Any]]:
    if not is_supabase_configured():
        return []
    ensure_paper_account(account_id)
    rows = call_supabase(
        "GET",
        "/rest/v1/closing_bet_alert_events",
        params={
            "account_id": f"eq.{account_id}",
            "select": "id,notification_id,delivered_channel,title,message,ticker,market,signal_date,total_score,is_read,created_at,read_at",
            "order": "created_at.desc",
            "limit": 50,
        },
    ) or []
    return normalize_value(rows)


def mark_closing_bet_alert_event_read(account_id: str, alert_id: int) -> dict[str, Any]:
    ensure_paper_account(account_id)
    rows = call_supabase(
        "PATCH",
        "/rest/v1/closing_bet_alert_events",
        params={
            "id": f"eq.{alert_id}",
            "account_id": f"eq.{account_id}",
        },
        json_payload={
            "is_read": True,
            "read_at": datetime.utcnow().isoformat(),
        },
        prefer="return=representation",
    ) or []
    if not rows:
        raise HTTPException(status_code=404, detail="알림을 찾지 못했습니다.")
    return normalize_value(rows[0])


def upsert_closing_bet_notification(request: ClosingBetNotificationRequest) -> dict[str, Any]:
    ensure_paper_account(request.account_id or "")
    evaluation = evaluate_closing_bet(request.ticker, request.market, request.krx_exchange)
    payload = [{
        "account_id": request.account_id,
        "ticker": request.ticker,
        "market": request.market,
        "krx_exchange": request.krx_exchange,
        "channel": request.channel,
        "destination": request.destination,
        "threshold_score": request.threshold_score,
        "active": request.active,
        "toss_user_key": request.toss_user_key,
        "company_name": evaluation.get("company_name"),
        "resolved_ticker": evaluation.get("resolved_ticker"),
        "last_score": evaluation.get("total_score"),
        "last_signal_date": evaluation.get("signal_date"),
        "last_evaluated_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }]
    rows = call_supabase(
        "POST",
        "/rest/v1/closing_bet_notifications",
        params={"on_conflict": "account_id,channel,market,ticker,destination"},
        json_payload=payload,
        prefer="resolution=merge-duplicates,return=representation",
    ) or []
    if not rows:
        raise HTTPException(status_code=503, detail="알림 구독을 저장하지 못했습니다.")
    return normalize_value({"subscription": rows[0], "evaluation": evaluation})


def delete_closing_bet_notification(account_id: str, notification_id: int) -> dict[str, Any]:
    ensure_paper_account(account_id)
    call_supabase(
        "DELETE",
        "/rest/v1/closing_bet_notifications",
        params={
            "id": f"eq.{notification_id}",
            "account_id": f"eq.{account_id}",
        },
    )
    return {"deleted": True, "id": notification_id}


def test_closing_bet_notification(request: ClosingBetNotificationTestRequest) -> dict[str, Any]:
    evaluation = evaluate_closing_bet(request.ticker, request.market, "auto")
    if request.channel == "toss_inapp":
        if not request.account_id or not request.toss_user_key or not request.deployment_id:
            raise HTTPException(status_code=400, detail="토스 테스트 발송에는 account_id, toss_user_key, deployment_id가 필요합니다.")
        result = send_toss_smart_test_message(
            account_id=request.account_id,
            recipient_key=request.toss_user_key,
            deployment_id=request.deployment_id,
            evaluation=evaluation,
        )
        return {"sent": True, "channel": request.channel, "destination": request.destination, "result": result}

    subject = f"[한눈투자] {request.market.upper()} 종가베팅 테스트"
    message = (
        f"테스트 알림입니다.\n"
        f"- 채널: {request.channel}\n"
        f"- 종목: {request.ticker}\n"
        f"- 시장: {request.market}\n"
        f"- 발송 시각: {datetime.utcnow().isoformat()}Z"
    )
    send_email_notification(request.destination, subject, message)
    return {"sent": True, "channel": request.channel, "destination": request.destination}


def dispatch_closing_bet_notifications(
    market: str | None = None,
    limit: int = 100,
    notification_id: int | None = None,
    force: bool = False,
) -> dict[str, Any]:
    filters = {
        "active": "eq.true",
        "select": "id,account_id,ticker,market,krx_exchange,channel,destination,threshold_score,last_signal_date,last_notified_at,toss_user_key",
        "order": "updated_at.asc",
        "limit": limit,
    }
    if market:
        filters["market"] = f"eq.{market}"
    if notification_id is not None:
        filters["id"] = f"eq.{notification_id}"

    subscriptions = call_supabase(
        "GET",
        "/rest/v1/closing_bet_notifications",
        params=filters,
    ) or []

    dispatched: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    for item in subscriptions:
        try:
            evaluation = evaluate_closing_bet(item["ticker"], item["market"], item.get("krx_exchange", "auto"))
            score = int(evaluation.get("total_score") or 0)
            signal_date = str(evaluation.get("signal_date") or "")
            threshold_score = int(item.get("threshold_score")) if item.get("threshold_score") is not None else 0
            if force:
                subject, message = format_closing_bet_notification_message(evaluation, threshold_score)
                send_closing_bet_notification(
                    item["channel"],
                    item["destination"],
                    subject,
                    message,
                    evaluation,
                    account_id=item["account_id"],
                    notification_id=item["id"],
                    toss_user_key=item.get("toss_user_key"),
                )
                dispatched.append({"id": item["id"], "score": score, "signal_date": signal_date, "forced": True})
                item["last_notified_at"] = datetime.utcnow().isoformat()
            elif score < threshold_score:
                skipped.append({"id": item["id"], "reason": "threshold_not_met", "score": score})
            elif item.get("last_signal_date") == signal_date and item.get("last_notified_at"):
                skipped.append({"id": item["id"], "reason": "already_notified_for_signal_date", "score": score})
            else:
                subject, message = format_closing_bet_notification_message(evaluation, threshold_score)
                send_closing_bet_notification(
                    item["channel"],
                    item["destination"],
                    subject,
                    message,
                    evaluation,
                    account_id=item["account_id"],
                    notification_id=item["id"],
                    toss_user_key=item.get("toss_user_key"),
                )
                dispatched.append({"id": item["id"], "score": score, "signal_date": signal_date})
                item["last_notified_at"] = datetime.utcnow().isoformat()

            call_supabase(
                "PATCH",
                "/rest/v1/closing_bet_notifications",
                params={"id": f"eq.{item['id']}"},
                json_payload={
                    "company_name": evaluation.get("company_name"),
                    "resolved_ticker": evaluation.get("resolved_ticker"),
                    "last_score": score,
                    "last_signal_date": signal_date,
                    "last_evaluated_at": datetime.utcnow().isoformat(),
                    "updated_at": datetime.utcnow().isoformat(),
                    **({"last_notified_at": item["last_notified_at"]} if item.get("last_notified_at") else {}),
                },
            )
        except Exception as exc:
            failures.append({"id": item.get("id"), "reason": str(exc)})

    return normalize_value(
        {
            "market": market,
            "notification_id": notification_id,
            "force": force,
            "checked": len(subscriptions),
            "sent": len(dispatched),
            "skipped": skipped,
            "failures": failures,
            "dispatched": dispatched,
        }
    )


def build_feature_status() -> dict[str, dict[str, str | bool]]:
    ai_status = "ready"
    ai_reason = "뉴스 수집과 Gemini 분석을 모두 사용할 수 있습니다."
    if not GEMINI_API_KEY and not gemini_analyzer.NEWS_API_KEY:
        ai_status = "limited"
        ai_reason = "GEMINI_API_KEY와 NEWS_API_KEY가 없어 실시간 분석이 제한됩니다."
    elif not GEMINI_API_KEY:
        ai_status = "limited"
        ai_reason = "GEMINI_API_KEY가 없어 뉴스가 있어도 AI 요약을 대체 문구로 처리합니다."
    elif not gemini_analyzer.NEWS_API_KEY:
        ai_status = "limited"
        ai_reason = "NEWS_API_KEY가 없어 최신 뉴스 수집 범위가 제한됩니다."

    paper_status = "ready" if is_supabase_configured() else "limited"
    paper_reason = (
        "Supabase가 연결되어 모의투자 상태와 주문을 저장할 수 있습니다."
        if is_supabase_configured()
        else "SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 없어 모의투자 기능이 동작하지 않습니다."
    )

    return {
        "sector_flow": {
            "status": "ready",
            "summary": "공용 시세 데이터 기반 섹터 흐름 조회가 가능합니다.",
            "available": True,
        },
        "ai_analysis": {
            "status": ai_status,
            "summary": ai_reason,
            "available": True,
        },
        "paper_trading": {
            "status": paper_status,
            "summary": (
                "세션 기반 모의 계정으로 상태와 주문을 이어서 저장할 수 있습니다."
                if is_supabase_configured()
                else paper_reason
            ),
            "available": is_supabase_configured(),
        },
        "strategy_simulation": {
            "status": "ready",
            "summary": (
                "단일 백테스트와 전략 최적화 실행이 가능하고, 세션 기반 결과 저장도 사용할 수 있습니다."
                if is_supabase_configured()
                else "단일 백테스트와 전략 최적화 실행이 가능합니다. 결과 저장은 Supabase 연결 시 활성화됩니다."
            ),
            "available": True,
        },
    }


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


def sector_market_name(market: str) -> str:
    return "국내" if market == "krx" else "미국"


def previous_business_day(target: date) -> date:
    current = target
    while current.weekday() >= 5:
        current -= timedelta(days=1)
    return current


def resolve_sector_snapshot_cutoff_date(market: str, now: datetime | None = None) -> date:
    normalized_market = normalize_market(market)
    timezone = MARKET_TIMEZONES[normalized_market]
    market_now = now.astimezone(timezone) if now else datetime.now(timezone)
    open_time = MARKET_OPEN_TIMES[normalized_market]
    close_time = MARKET_CLOSE_TIMES[normalized_market]
    market_today = market_now.date()

    if market_today.weekday() >= 5:
        return previous_business_day(market_today)

    market_open = datetime.combine(market_today, open_time, tzinfo=timezone)
    market_close = datetime.combine(market_today, close_time, tzinfo=timezone)
    if market_now < market_open:
        return previous_business_day(market_today - timedelta(days=1))

    if market_now >= market_close:
        return market_today

    return market_today


def describe_sector_snapshot_status(market: str, now: datetime | None = None) -> tuple[str, bool]:
    normalized_market = normalize_market(market)
    timezone = MARKET_TIMEZONES[normalized_market]
    market_now = now.astimezone(timezone) if now else datetime.now(timezone)
    market_today = market_now.date()

    if market_today.weekday() >= 5:
        return "휴장일 기준 최근 영업일 확정값", False

    market_open = datetime.combine(market_today, MARKET_OPEN_TIMES[normalized_market], tzinfo=timezone)
    market_close = datetime.combine(market_today, MARKET_CLOSE_TIMES[normalized_market], tzinfo=timezone)
    if market_now < market_open:
        return "장 시작 전 기준 최근 영업일 확정값", False
    if market_now >= market_close:
        return "장 마감 기준 확정값", False
    return "장중 잠정값", True


def trim_series_to_cutoff(series: pd.Series, cutoff_date: date) -> pd.Series:
    if series.empty:
        return series
    normalized = normalize_close_series_index(series)
    return normalized.loc[normalized.index.date <= cutoff_date].copy()


def normalize_close_series_index(series: pd.Series) -> pd.Series:
    normalized = series.copy()
    normalized.index = coerce_datetime_index(normalized.index)
    normalized = normalized[~normalized.index.isna()].copy()
    if normalized.empty:
        return normalized
    normalized = normalized[~normalized.index.duplicated(keep="last")].sort_index()
    normalized.index.name = "Date"
    return normalized


def calculate_return_pct(series: pd.Series, lookback: int) -> float | None:
    clean = series.dropna().astype(float)
    if len(clean) <= lookback:
        return None

    latest = float(clean.iloc[-1])
    reference = float(clean.iloc[-(lookback + 1)])
    if reference == 0:
        return None
    return ((latest / reference) - 1) * 100


def calculate_moving_average(series: pd.Series, window: int) -> float | None:
    clean = series.dropna().astype(float)
    if len(clean) < window:
        return None
    return float(clean.tail(window).mean())


def calculate_trend_score(metrics: dict[str, float | None]) -> float:
    weights = {
        "return_1d_pct": 0.10,
        "return_5d_pct": 0.20,
        "return_21d_pct": 0.30,
        "return_63d_pct": 0.40,
    }
    score = 0.0
    for key, weight in weights.items():
        score += float(metrics.get(key) or 0.0) * weight
    return score


def classify_sector_trend(
    trend_score: float,
    return_21d_pct: float | None,
    return_63d_pct: float | None,
    above_20dma: bool,
    above_60dma: bool,
) -> str:
    month = float(return_21d_pct or 0.0)
    quarter = float(return_63d_pct or 0.0)

    if above_20dma and above_60dma and trend_score >= 8 and month >= 4:
        return "강한 상승 추세"
    if above_20dma and trend_score >= 2 and month >= 0:
        return "상승 우위"
    if month >= 0 or quarter >= 0:
        return "반등/혼조"
    if not above_20dma and not above_60dma and trend_score <= -5:
        return "약세 지속"
    return "조정 구간"


def load_close_series(
    ticker: str,
    start_date: str,
    end_date: str,
    market: str = "us",
    krx_exchange: str = "auto",
    cutoff_date: date | None = None,
) -> pd.Series:
    try:
        data = get_stock_data(
            ticker,
            start_date,
            end_date,
            market=market,
            krx_exchange=krx_exchange,
        )
    except Exception:
        return pd.Series(dtype=float)

    if data.empty or "Close" not in data.columns:
        return pd.Series(dtype=float)

    series = normalize_close_series_index(data["Close"].dropna().astype(float))
    if cutoff_date is not None:
        series = trim_series_to_cutoff(series, cutoff_date)
    return series


def build_equal_weight_basket(component_series: list[pd.Series]) -> pd.Series:
    normalized_series: list[pd.Series] = []
    for index, series in enumerate(component_series):
        clean = normalize_close_series_index(series.dropna().astype(float))
        if len(clean) < 2:
            continue
        normalized = (clean / float(clean.iloc[0])) * 100.0
        normalized.name = f"component_{index}"
        normalized_series.append(normalized)

    if not normalized_series:
        return pd.Series(dtype=float)

    basket = pd.concat(normalized_series, axis=1).sort_index().ffill().mean(axis=1, skipna=True).dropna()
    basket.name = "equal_weight_basket"
    return basket.astype(float)


def build_sector_row(
    key: str,
    name: str,
    note: str,
    proxy_type: str,
    proxy_label: str,
    series: pd.Series,
    components: list[dict[str, Any]],
) -> dict[str, Any] | None:
    clean = series.dropna().astype(float)
    if len(clean) < 22:
        return None

    ma20 = calculate_moving_average(clean, 20)
    ma60 = calculate_moving_average(clean, 60)
    latest = float(clean.iloc[-1])

    metrics: dict[str, float | None] = {
        "return_1d_pct": calculate_return_pct(clean, 1),
        "return_5d_pct": calculate_return_pct(clean, 5),
        "return_21d_pct": calculate_return_pct(clean, 21),
        "return_63d_pct": calculate_return_pct(clean, 63),
    }
    trend_score = calculate_trend_score(metrics)
    above_20dma = bool(ma20 is not None and latest >= ma20)
    above_60dma = bool(ma60 is not None and latest >= ma60)

    return {
        "key": key,
        "name": name,
        "note": note,
        "proxy_type": proxy_type,
        "proxy_label": proxy_label,
        "components": components,
        "component_count": len(components),
        "as_of": clean.index[-1],
        "latest_level": latest,
        "ma20_gap_pct": None if ma20 in {None, 0} else ((latest / ma20) - 1) * 100,
        "ma60_gap_pct": None if ma60 in {None, 0} else ((latest / ma60) - 1) * 100,
        "above_20dma": above_20dma,
        "above_60dma": above_60dma,
        "trend_score": trend_score,
        "trend_label": classify_sector_trend(
            trend_score,
            metrics["return_21d_pct"],
            metrics["return_63d_pct"],
            above_20dma,
            above_60dma,
        ),
        **metrics,
    }


def build_us_sector_rows(start_date: str, end_date: str, cutoff_date: date) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for sector in US_SECTOR_UNIVERSE:
        series = load_close_series(
            sector["proxy"],
            start_date,
            end_date,
            market="us",
            cutoff_date=cutoff_date,
        )
        row = build_sector_row(
            key=sector["key"],
            name=sector["name"],
            note=sector["note"],
            proxy_type="etf",
            proxy_label=sector["proxy"],
            series=series,
            components=sector["components"],
        )
        if row:
            rows.append(row)
    return rows


def build_krx_sector_rows(start_date: str, end_date: str, cutoff_date: date) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for sector in KRX_SECTOR_UNIVERSE:
        component_series: list[pd.Series] = []
        available_components: list[dict[str, Any]] = []
        for component in sector["components"]:
            series = load_close_series(
                component["ticker"],
                start_date,
                end_date,
                market="krx",
                krx_exchange=component["krx_exchange"],
                cutoff_date=cutoff_date,
            )
            if series.empty:
                continue
            component_series.append(series)
            available_components.append(component)

        basket = build_equal_weight_basket(component_series)
        row = build_sector_row(
            key=sector["key"],
            name=sector["name"],
            note=sector["note"],
            proxy_type="basket",
            proxy_label="대표 종목 바스켓",
            series=basket,
            components=available_components,
        )
        if row:
            rows.append(row)
    return rows


def summarize_sector_rows(market: str, rows: list[dict[str, Any]]) -> str:
    if not rows:
        return "섹터 데이터를 불러오지 못했습니다."

    leaders = ", ".join(item["name"] for item in rows[:3])
    laggards = ", ".join(item["name"] for item in rows[-2:][::-1])
    positive_month = sum(1 for item in rows if float(item.get("return_21d_pct") or 0.0) > 0)
    above_20dma = sum(1 for item in rows if item.get("above_20dma"))
    market_name = sector_market_name(market)

    return (
        f"{market_name} 시장에서 최근 1개월 기준 상대적으로 강한 섹터는 {leaders}입니다. "
        f"약한 흐름은 {laggards} 쪽입니다. "
        f"{positive_month}/{len(rows)}개 섹터가 최근 1개월 수익률 플러스이고, "
        f"{above_20dma}/{len(rows)}개 섹터가 20일선 위에 있습니다."
    )


def create_sector_snapshot(market: str) -> dict[str, Any]:
    normalized_market = normalize_market(market)
    cutoff_date = resolve_sector_snapshot_cutoff_date(normalized_market)
    snapshot_status, intraday_estimate = describe_sector_snapshot_status(normalized_market)
    end_date = cutoff_date + timedelta(days=1)
    start_date = end_date - timedelta(days=220)

    if normalized_market == "krx":
        rows = build_krx_sector_rows(start_date.isoformat(), end_date.isoformat(), cutoff_date)
    else:
        rows = build_us_sector_rows(start_date.isoformat(), end_date.isoformat(), cutoff_date)

    if not rows:
        raise HTTPException(status_code=503, detail="섹터 데이터를 가져오지 못했습니다.")

    sorted_rows = sorted(
        rows,
        key=lambda item: (
            float(item.get("trend_score") or 0.0),
            float(item.get("return_21d_pct") or 0.0),
            float(item.get("return_5d_pct") or 0.0),
        ),
        reverse=True,
    )
    as_of = max(item["as_of"] for item in sorted_rows)

    return normalize_value(
        {
            "market": normalized_market,
            "market_name": sector_market_name(normalized_market),
            "as_of": as_of,
            "snapshot_status": snapshot_status,
            "intraday_estimate": intraday_estimate,
            "summary": summarize_sector_rows(normalized_market, sorted_rows),
            "leaders": sorted_rows[:3],
            "laggards": list(reversed(sorted_rows[-3:])),
            "sectors": sorted_rows,
        }
    )


def create_quote_snapshot(ticker: str, market: str = "us", krx_exchange: str = "auto") -> dict[str, Any]:
    normalized_ticker = normalize_ticker_input(ticker)
    normalized_market, normalized_exchange = validate_market_params(market, krx_exchange)

    end_date = date.today() + timedelta(days=1)
    start_date = end_date - timedelta(days=40)
    try:
        data = get_stock_data(
            normalized_ticker,
            start_date.isoformat(),
            end_date.isoformat(),
            market=normalized_market,
            krx_exchange=normalized_exchange,
        )
    except MarketDataRateLimitError as exc:
        raise HTTPException(status_code=503, detail="시세 제공사 요청 제한으로 현재가를 잠시 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.") from exc
    if data.empty or "Close" not in data.columns:
        raise HTTPException(status_code=404, detail=f"{normalized_ticker}의 현재가 데이터를 찾을 수 없습니다.")

    close_series = data["Close"].dropna().astype(float)
    if close_series.empty:
        raise HTTPException(status_code=404, detail=f"{normalized_ticker}의 종가 데이터를 찾을 수 없습니다.")

    latest_close = float(close_series.iloc[-1])
    previous_close = float(close_series.iloc[-2]) if len(close_series) >= 2 else latest_close
    change_amount = latest_close - previous_close
    change_pct = ((latest_close / previous_close) - 1) * 100 if previous_close else 0.0

    profile = get_symbol_profile(
        normalized_ticker,
        market=normalized_market,
        krx_exchange=normalized_exchange,
    )

    return normalize_value(
        {
            "ticker": normalized_ticker,
            "resolved_ticker": data.attrs.get("resolved_ticker", profile.get("resolved_ticker", normalized_ticker)),
            "market": data.attrs.get("market", normalized_market),
            "krx_exchange": data.attrs.get("krx_exchange", normalized_exchange),
            "company_name": profile.get("name"),
            "as_of": close_series.index[-1],
            "close": latest_close,
            "previous_close": previous_close,
            "change_amount": change_amount,
            "change_pct": change_pct,
        }
    )


def run_backtest(
    strategy_func,
    request: BaseBacktestRequest,
    strategy_params: dict[str, Any],
) -> dict[str, Any]:
    data = ensure_data(
        request.ticker,
        request.start_date,
        request.end_date,
        market=request.market,
        krx_exchange=request.krx_exchange,
    )
    resolved_ticker = data.attrs.get("resolved_ticker", request.ticker)
    resolved_market = data.attrs.get("market", request.market)
    resolved_exchange = data.attrs.get("krx_exchange", request.krx_exchange)
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
            "resolved_ticker": resolved_ticker,
            "market": resolved_market,
            "krx_exchange": resolved_exchange,
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
    data = ensure_data(
        request.ticker,
        request.start_date,
        request.end_date,
        market=request.market,
        krx_exchange=request.krx_exchange,
    )
    results = optimizer.grid_search_optimizer(
        strategy_name=strategy_name,
        data=data,
        initial_capital=request.initial_capital,
        param_grid=param_grid,
        metric_to_optimize=request.metric_to_optimize,
        order_type=request.order_type,
        fixed_amount=request.fixed_amount or request.initial_capital,
    )
    results["ticker"] = request.ticker
    results["resolved_ticker"] = data.attrs.get("resolved_ticker", request.ticker)
    results["market"] = data.attrs.get("market", request.market)
    results["krx_exchange"] = data.attrs.get("krx_exchange", request.krx_exchange)
    return normalize_value(results)


@app.get("/")
def root() -> dict[str, str]:
    return {"message": "Quant Trading API is running."}


@app.head("/", include_in_schema=False, status_code=status.HTTP_200_OK)
def root_head() -> Response:
    return Response(status_code=status.HTTP_200_OK)


@app.get("/healthz", include_in_schema=False)
def healthz_get() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/app-config")
def app_config() -> dict[str, Any]:
    return {
        "auth_mode": "session_account",
        "cors_allowed_origins": parse_allowed_origins(CORS_ALLOW_ORIGINS),
        "features": build_feature_status(),
        "toss_login": get_toss_login_diagnostics(),
        "toss_smart_message": get_toss_smart_message_diagnostics(),
    }


@app.post("/toss-login/user-key")
def toss_login_user_key(request: TossLoginExchangeRequest) -> dict[str, Any]:
    return normalize_value(resolve_toss_login_user_key(request.authorization_code, request.referrer))


@app.post("/session/bootstrap")
def session_bootstrap(x_app_session: str | None = Header(default=None, alias="X-App-Session")) -> dict[str, Any]:
    if x_app_session:
        account_id = decode_session_token(resolve_paper_session_token(x_app_session))
    else:
        account_id = build_session_account_id()

    return {
        "auth_mode": "session_account",
        "account_id": account_id,
        "session_token": encode_session_token(account_id),
    }


@app.post("/session/rotate")
def session_rotate() -> dict[str, Any]:
    account_id = build_session_account_id()
    return {
        "auth_mode": "session_account",
        "account_id": account_id,
        "session_token": encode_session_token(account_id),
    }


@app.head("/healthz", include_in_schema=False, status_code=status.HTTP_200_OK)
def healthz_head() -> Response:
    return Response(status_code=status.HTTP_200_OK)


@app.get("/stocks/krx/search")
def krx_stock_search(q: str, limit: int = 20) -> dict[str, Any]:
    query = q.strip()
    if not query:
        return {"query": "", "results": []}
    if limit < 1 or limit > 50:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 50")

    try:
        results = search_krx_stocks(query, limit=limit)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"국내 종목 목록을 불러오지 못했습니다: {exc}") from exc

    return {"query": query, "results": results}


@app.get("/stock/{ticker}")
def stock_data(
    ticker: str,
    start_date: str,
    end_date: str,
    market: str = "us",
    krx_exchange: str = "auto",
) -> dict[str, Any]:
    normalized_ticker = normalize_ticker_input(ticker)
    market, krx_exchange = validate_market_params(market, krx_exchange)
    data = ensure_data(normalized_ticker, start_date, end_date, market=market, krx_exchange=krx_exchange)
    return {
        "ticker": normalized_ticker,
        "resolved_ticker": data.attrs.get("resolved_ticker", normalized_ticker),
        "market": data.attrs.get("market", market),
        "krx_exchange": data.attrs.get("krx_exchange", krx_exchange),
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


@app.get("/market/sectors")
def market_sectors(market: str = "us") -> dict[str, Any]:
    return create_sector_snapshot(market)


@app.get("/quote/{ticker}")
def quote_data(ticker: str, market: str = "us", krx_exchange: str = "auto") -> dict[str, Any]:
    return create_quote_snapshot(ticker, market=market, krx_exchange=krx_exchange)


@app.post("/closing-bet/evaluate")
def closing_bet_evaluate(request: ClosingBetEvaluationRequest) -> dict[str, Any]:
    return evaluate_closing_bet(request.ticker, request.market, request.krx_exchange)


@app.get("/closing-bet/notifications")
def closing_bet_notification_list(
    account_id: str | None = None,
    x_app_session: str | None = Header(default=None, alias="X-App-Session"),
) -> dict[str, Any]:
    normalized_account_id = resolve_paper_account_id(account_id, x_app_session)
    return {"items": list_closing_bet_notifications(normalized_account_id)}


@app.get("/closing-bet/alerts")
def closing_bet_alert_list(
    account_id: str | None = None,
    x_app_session: str | None = Header(default=None, alias="X-App-Session"),
) -> dict[str, Any]:
    normalized_account_id = resolve_paper_account_id(account_id, x_app_session)
    return {"items": list_closing_bet_alert_events(normalized_account_id)}


@app.post("/closing-bet/notifications")
def closing_bet_notification_upsert(
    request: ClosingBetNotificationRequest,
    x_app_session: str | None = Header(default=None, alias="X-App-Session"),
) -> dict[str, Any]:
    request.account_id = resolve_paper_account_id(request.account_id, x_app_session)
    return upsert_closing_bet_notification(request)


@app.delete("/closing-bet/notifications/{notification_id}")
def closing_bet_notification_delete(
    notification_id: int,
    account_id: str | None = None,
    x_app_session: str | None = Header(default=None, alias="X-App-Session"),
) -> dict[str, Any]:
    normalized_account_id = resolve_paper_account_id(account_id, x_app_session)
    return delete_closing_bet_notification(normalized_account_id, notification_id)


@app.post("/closing-bet/alerts/{alert_id}/read")
def closing_bet_alert_mark_read(
    alert_id: int,
    account_id: str | None = None,
    x_app_session: str | None = Header(default=None, alias="X-App-Session"),
) -> dict[str, Any]:
    normalized_account_id = resolve_paper_account_id(account_id, x_app_session)
    return {"item": mark_closing_bet_alert_event_read(normalized_account_id, alert_id)}


@app.post("/closing-bet/notifications/test")
def closing_bet_notification_send_test(
    request: ClosingBetNotificationTestRequest,
    x_app_session: str | None = Header(default=None, alias="X-App-Session"),
) -> dict[str, Any]:
    if request.channel == "toss_inapp":
        request.account_id = resolve_paper_account_id(request.account_id, x_app_session)
    return test_closing_bet_notification(request)


@app.post("/closing-bet/notifications/dispatch")
def closing_bet_notification_dispatch(
    request: ClosingBetNotificationDispatchRequest,
    x_dispatch_token: str | None = Header(default=None, alias="X-Dispatch-Token"),
) -> dict[str, Any]:
    ensure_notification_dispatch_token(x_dispatch_token)
    return dispatch_closing_bet_notifications(
        request.market,
        request.limit,
        notification_id=request.notification_id,
        force=request.force,
    )


@app.get("/backtest/saved")
def saved_backtest_list(
    account_id: str | None = None,
    x_app_session: str | None = Header(default=None, alias="X-App-Session"),
) -> dict[str, Any]:
    normalized_account_id = resolve_paper_account_id(account_id, x_app_session)
    return {"items": list_saved_backtests(normalized_account_id)}


@app.get("/backtest/saved/{saved_backtest_id}")
def saved_backtest_detail(
    saved_backtest_id: int,
    account_id: str | None = None,
    x_app_session: str | None = Header(default=None, alias="X-App-Session"),
) -> dict[str, Any]:
    normalized_account_id = resolve_paper_account_id(account_id, x_app_session)
    return {"item": get_saved_backtest(normalized_account_id, saved_backtest_id)}


@app.post("/backtest/saved")
def saved_backtest_create(
    request: SavedBacktestRequest,
    x_app_session: str | None = Header(default=None, alias="X-App-Session"),
) -> dict[str, Any]:
    request.account_id = resolve_paper_account_id(request.account_id, x_app_session)
    return {"item": save_backtest_run(request)}


@app.delete("/backtest/saved/{saved_backtest_id}")
def saved_backtest_delete(
    saved_backtest_id: int,
    account_id: str | None = None,
    x_app_session: str | None = Header(default=None, alias="X-App-Session"),
) -> dict[str, Any]:
    normalized_account_id = resolve_paper_account_id(account_id, x_app_session)
    return delete_saved_backtest(normalized_account_id, saved_backtest_id)


@app.get("/paper-trading/state")
def paper_trading_state(
    account_id: str | None = None,
    x_app_session: str | None = Header(default=None, alias="X-App-Session"),
) -> dict[str, Any]:
    normalized_account_id = resolve_paper_account_id(account_id, x_app_session)
    return get_paper_trading_state(normalized_account_id)


@app.post("/paper-trading/order")
def paper_trading_order(
    request: PaperTradingOrderRequest,
    x_app_session: str | None = Header(default=None, alias="X-App-Session"),
) -> dict[str, Any]:
    request.account_id = resolve_paper_account_id(request.account_id, x_app_session)
    return execute_paper_trade(request)


@app.post("/paper-trading/reset")
def paper_trading_reset(
    request: PaperTradingAccountRequest,
    x_app_session: str | None = Header(default=None, alias="X-App-Session"),
) -> dict[str, Any]:
    request.account_id = resolve_paper_account_id(request.account_id, x_app_session)
    return reset_paper_trading_account(request.account_id)


@app.get("/sentiment/{ticker}")
def sentiment_analysis(
    ticker: str,
    market: str = "us",
    krx_exchange: str = "auto",
    period_days: int = 7,
    source_filter: str = "all",
) -> dict[str, Any]:
    return create_sentiment_snapshot(
        ticker,
        market=market,
        krx_exchange=krx_exchange,
        period_days=period_days,
        source_filter=source_filter,
    )


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
