from __future__ import annotations

from datetime import datetime, time
from functools import lru_cache
import io
from pathlib import Path
import re
import time as time_module
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd
import requests
import yfinance as yf

SUPPORTED_MARKETS = {"us", "krx"}
SUPPORTED_KRX_EXCHANGES = {"auto", "kospi", "kosdaq"}
KRX_SUFFIX_BY_EXCHANGE = {
    "kospi": ".KS",
    "kosdaq": ".KQ",
}
KIND_CORP_LIST_URL = "https://kind.krx.co.kr/corpgeneral/corpList.do"
KRX_CACHE_DIR = Path(__file__).resolve().parent / ".cache"
KRX_CACHE_FILE = KRX_CACHE_DIR / "krx_listing.csv"
YF_HISTORY_CACHE_DIR = KRX_CACHE_DIR / "yf_history"
DEFAULT_REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
    ),
    "Referer": "https://kind.krx.co.kr/corpgeneral/corpList.do?method=loadInitPage",
}


class MarketDataProviderError(RuntimeError):
    pass


class MarketDataRateLimitError(MarketDataProviderError):
    pass
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


def normalize_market(value: str | None) -> str:
    normalized = (value or "us").strip().lower()
    if normalized not in SUPPORTED_MARKETS:
        raise ValueError(f"market must be one of {sorted(SUPPORTED_MARKETS)}")
    return normalized


def normalize_krx_exchange(value: str | None) -> str:
    normalized = (value or "auto").strip().lower()
    if normalized not in SUPPORTED_KRX_EXCHANGES:
        raise ValueError(f"krx_exchange must be one of {sorted(SUPPORTED_KRX_EXCHANGES)}")
    return normalized


def normalize_ticker_input(value: str) -> str:
    return value.strip().upper()


def build_symbol_candidates(ticker: str, market: str = "us", krx_exchange: str = "auto") -> list[str]:
    normalized_market = normalize_market(market)
    normalized_exchange = normalize_krx_exchange(krx_exchange)
    normalized_ticker = normalize_ticker_input(ticker)

    if normalized_market == "us":
        return [normalized_ticker]

    if normalized_ticker.endswith((".KS", ".KQ")):
        return [normalized_ticker]

    digit_code = re.sub(r"\D", "", normalized_ticker)
    if re.fullmatch(r"\d{6}", digit_code):
        if normalized_exchange == "auto":
            return [f"{digit_code}.KS", f"{digit_code}.KQ"]
        return [f"{digit_code}{KRX_SUFFIX_BY_EXCHANGE[normalized_exchange]}"]

    return [normalized_ticker]


def extract_market_from_symbol(symbol: str, fallback_market: str = "us") -> str:
    if symbol.endswith((".KS", ".KQ")):
        return "krx"
    return normalize_market(fallback_market)


def extract_krx_exchange_from_symbol(symbol: str, fallback_exchange: str = "auto") -> str:
    if symbol.endswith(".KS"):
        return "kospi"
    if symbol.endswith(".KQ"):
        return "kosdaq"
    return normalize_krx_exchange(fallback_exchange)


def _download_krx_listing(market_type: str, exchange: str) -> pd.DataFrame:
    session = requests.Session()
    session.headers.update(DEFAULT_REQUEST_HEADERS)
    response = session.get(
        KIND_CORP_LIST_URL,
        params={"method": "download", "marketType": market_type},
        timeout=15,
    )
    response.raise_for_status()

    tables = pd.read_html(io.StringIO(response.text))
    if not tables:
        raise ValueError("KRX 종목 목록을 가져오지 못했습니다.")

    listing = tables[0].copy()
    if "회사명" not in listing.columns or "종목코드" not in listing.columns:
        raise ValueError("KRX 종목 목록 형식이 예상과 다릅니다.")

    listing["회사명"] = listing["회사명"].astype(str).str.strip()
    listing["종목코드"] = listing["종목코드"].astype(str).str.zfill(6)
    listing["krx_exchange"] = exchange
    listing["display_name"] = listing["회사명"] + " (" + listing["종목코드"] + ", " + listing["krx_exchange"].str.upper() + ")"
    return listing[["회사명", "종목코드", "krx_exchange", "display_name"]]


@lru_cache(maxsize=1)
def get_krx_listing() -> pd.DataFrame:
    try:
        kospi = _download_krx_listing("stockMkt", "kospi")
        kosdaq = _download_krx_listing("kosdaqMkt", "kosdaq")
        listing = pd.concat([kospi, kosdaq], ignore_index=True)
        KRX_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        listing.to_csv(KRX_CACHE_FILE, index=False, encoding="utf-8-sig")
        return listing
    except Exception:
        if KRX_CACHE_FILE.exists():
            cached = pd.read_csv(KRX_CACHE_FILE, dtype={"종목코드": str})
            cached["종목코드"] = cached["종목코드"].astype(str).str.zfill(6)
            return cached
        return pd.DataFrame(columns=["회사명", "종목코드", "krx_exchange", "display_name"])


def search_krx_stocks(query: str, limit: int = 20) -> list[dict[str, str]]:
    normalized_query = str(query).strip().lower()
    if not normalized_query:
        return []

    listing = get_krx_listing().copy()
    names = listing["회사명"].str.lower()
    tickers = listing["종목코드"].astype(str)
    starts_with_name = names.str.startswith(normalized_query)
    contains_name = names.str.contains(normalized_query, na=False)
    starts_with_code = tickers.str.startswith(normalized_query)
    contains_code = tickers.str.contains(normalized_query, na=False)

    ranked = listing.loc[starts_with_name | contains_name | starts_with_code | contains_code].copy()
    if ranked.empty:
        return []

    ranked["match_rank"] = 3
    ranked.loc[contains_name | contains_code, "match_rank"] = 2
    ranked.loc[starts_with_name | starts_with_code, "match_rank"] = 1
    ranked = ranked.sort_values(by=["match_rank", "회사명", "종목코드"]).head(limit)

    return [
        {
            "name": row["회사명"],
            "ticker": row["종목코드"],
            "krx_exchange": row["krx_exchange"],
            "display_name": row["display_name"],
        }
        for _, row in ranked.iterrows()
    ]


def get_krx_stock_by_ticker(ticker: str) -> dict[str, str] | None:
    normalized_ticker = re.sub(r"\D", "", normalize_ticker_input(ticker))
    if not re.fullmatch(r"\d{6}", normalized_ticker):
        return None

    try:
        listing = get_krx_listing().copy()
    except Exception:
        return None
    matched = listing.loc[listing["종목코드"] == normalized_ticker]
    if matched.empty:
        return None

    row = matched.iloc[0]
    return {
        "name": row["회사명"],
        "ticker": row["종목코드"],
        "krx_exchange": row["krx_exchange"],
        "display_name": row["display_name"],
    }


def is_yfinance_rate_limit_error(error: Exception) -> bool:
    message = f"{type(error).__name__}: {error}".lower()
    return "ratelimit" in message or "rate limited" in message or "too many requests" in message


def build_history_cache_path(symbol: str) -> Path:
    normalized_symbol = re.sub(r"[^A-Za-z0-9._-]+", "_", symbol.strip().upper()) or "UNKNOWN"
    return YF_HISTORY_CACHE_DIR / f"{normalized_symbol}.csv"


def load_cached_history(symbol: str) -> pd.DataFrame:
    cache_path = build_history_cache_path(symbol)
    if not cache_path.exists():
        return pd.DataFrame()

    try:
        cached = pd.read_csv(cache_path, index_col=0, parse_dates=[0])
    except Exception:
        return pd.DataFrame()

    if cached.empty:
        return pd.DataFrame()

    cached.index = pd.to_datetime(cached.index)
    cached = cached.sort_index()
    cached.index.name = "Date"
    return cached


def normalize_history_index(frame: pd.DataFrame) -> pd.DataFrame:
    normalized = frame.copy()
    normalized.index = pd.to_datetime(normalized.index)
    if getattr(normalized.index, "tz", None) is not None:
        normalized.index = normalized.index.tz_localize(None)
    normalized.index.name = "Date"
    return normalized


def persist_cached_history(symbol: str, raw_data: pd.DataFrame) -> None:
    if raw_data.empty:
        return

    cache_path = build_history_cache_path(symbol)
    YF_HISTORY_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    frame_to_save = normalize_history_index(raw_data)

    existing = load_cached_history(symbol)
    if not existing.empty:
        merged = pd.concat([existing, frame_to_save])
        merged = merged[~merged.index.duplicated(keep="last")].sort_index()
    else:
        merged = frame_to_save.sort_index()
    merged.to_csv(cache_path, encoding="utf-8")


def slice_history_window(frame: pd.DataFrame, start_date: str, end_date: str) -> pd.DataFrame:
    if frame.empty:
        return pd.DataFrame()

    sliced = normalize_history_index(frame)
    start_ts = pd.Timestamp(start_date)
    end_ts = pd.Timestamp(end_date)
    sliced = sliced.loc[(sliced.index >= start_ts) & (sliced.index < end_ts)].copy()
    if sliced.empty:
        return pd.DataFrame()
    sliced.index.name = "Date"
    return sliced


def load_cached_history_window(symbol: str, start_date: str, end_date: str) -> pd.DataFrame:
    cached = load_cached_history(symbol)
    if cached.empty:
        return pd.DataFrame()

    sliced = slice_history_window(cached, start_date, end_date)
    if sliced.empty:
        return pd.DataFrame()
    sliced.attrs["data_source"] = "yfinance_cache"
    return sliced


def _download_symbol(symbol: str, start_date: str, end_date: str) -> pd.DataFrame:
    cached_fallback = load_cached_history_window(symbol, start_date, end_date)
    last_error: Exception | None = None

    for attempt in range(2):
        try:
            raw_data = yf.download(
                symbol,
                start=start_date,
                end=end_date,
                auto_adjust=True,
                progress=False,
            )
        except Exception as error:
            last_error = error
            if is_yfinance_rate_limit_error(error) and attempt == 0:
                time_module.sleep(1.0)
                continue
            if not cached_fallback.empty:
                return cached_fallback.copy()
            if is_yfinance_rate_limit_error(error):
                raise MarketDataRateLimitError(f"Yahoo Finance rate limit for {symbol}") from error
            raise

        if isinstance(raw_data.columns, pd.MultiIndex):
            raw_data.columns = raw_data.columns.get_level_values(0)

        if not raw_data.empty:
            persist_cached_history(symbol, raw_data)
            return raw_data.copy()

        try:
            history_data = yf.Ticker(symbol).history(
                start=start_date,
                end=end_date,
                auto_adjust=True,
            )
        except Exception as error:
            last_error = error
            if is_yfinance_rate_limit_error(error) and attempt == 0:
                time_module.sleep(1.0)
                continue
            if not cached_fallback.empty:
                return cached_fallback.copy()
            if is_yfinance_rate_limit_error(error):
                raise MarketDataRateLimitError(f"Yahoo Finance rate limit for {symbol}") from error
            history_data = pd.DataFrame()

        if isinstance(history_data.columns, pd.MultiIndex):
            history_data.columns = history_data.columns.get_level_values(0)

        if not history_data.empty:
            persist_cached_history(symbol, history_data)
            return history_data.copy()

        if not cached_fallback.empty:
            return cached_fallback.copy()

    if not cached_fallback.empty:
        return cached_fallback.copy()
    if last_error and is_yfinance_rate_limit_error(last_error):
        raise MarketDataRateLimitError(f"Yahoo Finance rate limit for {symbol}") from last_error
    return pd.DataFrame()


def resolve_market_data_cache_bucket(market: str) -> str:
    normalized_market = normalize_market(market)
    timezone = MARKET_TIMEZONES[normalized_market]
    market_now = datetime.now(timezone)
    market_open = datetime.combine(market_now.date(), MARKET_OPEN_TIMES[normalized_market], tzinfo=timezone)
    market_close = datetime.combine(market_now.date(), MARKET_CLOSE_TIMES[normalized_market], tzinfo=timezone)

    if market_now < market_open:
        return f"preopen-{normalized_market}-{market_now.date().isoformat()}"
    if market_open <= market_now < market_close:
        return f"intraday-{normalized_market}-{market_now.strftime('%Y-%m-%d-%H-%M')}"

    minutes_after_close = int((market_now - market_close).total_seconds() // 60)
    if 0 <= minutes_after_close < 10:
        return f"close-window-{normalized_market}-{market_now.strftime('%Y-%m-%d-%H-%M')}"
    return f"postclose-{normalized_market}-{market_now.date().isoformat()}"


@lru_cache(maxsize=512)
def _get_stock_data_cached(
    ticker: str,
    start_date: str,
    end_date: str,
    market: str = "us",
    krx_exchange: str = "auto",
    cache_bucket: str = "",
) -> pd.DataFrame:
    candidates = build_symbol_candidates(ticker, market=market, krx_exchange=krx_exchange)
    last_frame = pd.DataFrame()

    for candidate in candidates:
        raw_data = _download_symbol(candidate, start_date, end_date)
        last_frame = raw_data
        if raw_data.empty:
            continue

        raw_data.attrs["resolved_ticker"] = candidate
        raw_data.attrs["market"] = extract_market_from_symbol(candidate, fallback_market=market)
        raw_data.attrs["krx_exchange"] = extract_krx_exchange_from_symbol(candidate, fallback_exchange=krx_exchange)
        return raw_data.copy()

    last_frame.attrs["resolved_ticker"] = candidates[0] if candidates else normalize_ticker_input(ticker)
    last_frame.attrs["market"] = normalize_market(market)
    last_frame.attrs["krx_exchange"] = normalize_krx_exchange(krx_exchange)
    return last_frame.copy()


def get_stock_data(
    ticker: str,
    start_date: str,
    end_date: str,
    market: str = "us",
    krx_exchange: str = "auto",
) -> pd.DataFrame:
    """
    yfinance로부터 주식 데이터를 가져옵니다.
    국내주식은 6자리 종목코드를 받아 KOSPI/KOSDAQ 심볼로 자동 보정합니다.
    장중/장마감 직후에는 cache bucket을 짧게 잡아 누적수익률과 최근 종가 갱신이 늦지 않게 합니다.
    """
    cache_bucket = resolve_market_data_cache_bucket(market)
    return _get_stock_data_cached(
        ticker,
        start_date,
        end_date,
        market=market,
        krx_exchange=krx_exchange,
        cache_bucket=cache_bucket,
    )


@lru_cache(maxsize=64)
def get_symbol_profile(ticker: str, market: str = "us", krx_exchange: str = "auto") -> dict[str, Any]:
    candidates = build_symbol_candidates(ticker, market=market, krx_exchange=krx_exchange)

    if normalize_market(market) == "krx":
        try:
            local_krx = get_krx_stock_by_ticker(ticker)
        except Exception:
            local_krx = None
        if local_krx:
            return {
                "ticker": normalize_ticker_input(ticker),
                "resolved_ticker": local_krx["ticker"],
                "name": local_krx["name"],
                "market": "krx",
                "krx_exchange": local_krx["krx_exchange"],
            }

    for candidate in candidates:
        try:
            info = yf.Ticker(candidate).get_info()
        except Exception:
            info = {}

        name = (
            info.get("shortName")
            or info.get("longName")
            or info.get("displayName")
            or info.get("name")
        )
        if not name:
            continue

        resolved_market = extract_market_from_symbol(candidate, fallback_market=market)
        resolved_exchange = extract_krx_exchange_from_symbol(candidate, fallback_exchange=krx_exchange)
        return {
            "ticker": normalize_ticker_input(ticker),
            "resolved_ticker": candidate,
            "name": str(name),
            "market": resolved_market,
            "krx_exchange": resolved_exchange,
        }

    return {
        "ticker": normalize_ticker_input(ticker),
        "resolved_ticker": candidates[0] if candidates else normalize_ticker_input(ticker),
        "name": None,
        "market": normalize_market(market),
        "krx_exchange": normalize_krx_exchange(krx_exchange),
    }
