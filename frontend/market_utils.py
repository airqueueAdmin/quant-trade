from __future__ import annotations

import os

import requests
import streamlit as st

from fx_utils import format_currency_pair

MARKET_OPTIONS = {
    "us": "미국주식",
    "krx": "국내주식",
}

KRX_EXCHANGE_OPTIONS = {
    "auto": "자동 판별",
    "kospi": "KOSPI",
    "kosdaq": "KOSDAQ",
}
COMMON_KRX_COMPANIES = [
    {"name": "삼성전자", "ticker": "005930", "krx_exchange": "kospi"},
    {"name": "SK하이닉스", "ticker": "000660", "krx_exchange": "kospi"},
    {"name": "LG에너지솔루션", "ticker": "373220", "krx_exchange": "kospi"},
    {"name": "삼성바이오로직스", "ticker": "207940", "krx_exchange": "kospi"},
    {"name": "현대차", "ticker": "005380", "krx_exchange": "kospi"},
    {"name": "기아", "ticker": "000270", "krx_exchange": "kospi"},
    {"name": "셀트리온", "ticker": "068270", "krx_exchange": "kospi"},
    {"name": "NAVER", "ticker": "035420", "krx_exchange": "kospi"},
    {"name": "카카오", "ticker": "035720", "krx_exchange": "kospi"},
    {"name": "KB금융", "ticker": "105560", "krx_exchange": "kospi"},
    {"name": "신한지주", "ticker": "055550", "krx_exchange": "kospi"},
    {"name": "하나금융지주", "ticker": "086790", "krx_exchange": "kospi"},
    {"name": "메리츠금융지주", "ticker": "138040", "krx_exchange": "kospi"},
    {"name": "POSCO홀딩스", "ticker": "005490", "krx_exchange": "kospi"},
    {"name": "삼성SDI", "ticker": "006400", "krx_exchange": "kospi"},
    {"name": "LG화학", "ticker": "051910", "krx_exchange": "kospi"},
    {"name": "삼성물산", "ticker": "028260", "krx_exchange": "kospi"},
    {"name": "현대모비스", "ticker": "012330", "krx_exchange": "kospi"},
    {"name": "크래프톤", "ticker": "259960", "krx_exchange": "kospi"},
    {"name": "삼성전자우", "ticker": "005935", "krx_exchange": "kospi"},
    {"name": "한화에어로스페이스", "ticker": "012450", "krx_exchange": "kospi"},
    {"name": "두산에너빌리티", "ticker": "034020", "krx_exchange": "kospi"},
    {"name": "한국전력", "ticker": "015760", "krx_exchange": "kospi"},
    {"name": "KT", "ticker": "030200", "krx_exchange": "kospi"},
    {"name": "LG전자", "ticker": "066570", "krx_exchange": "kospi"},
    {"name": "포스코퓨처엠", "ticker": "003670", "krx_exchange": "kospi"},
    {"name": "알테오젠", "ticker": "196170", "krx_exchange": "kosdaq"},
    {"name": "에코프로비엠", "ticker": "247540", "krx_exchange": "kosdaq"},
    {"name": "에코프로", "ticker": "086520", "krx_exchange": "kosdaq"},
    {"name": "HLB", "ticker": "028300", "krx_exchange": "kosdaq"},
    {"name": "레인보우로보틱스", "ticker": "277810", "krx_exchange": "kosdaq"},
    {"name": "삼천당제약", "ticker": "000250", "krx_exchange": "kosdaq"},
    {"name": "JYP Ent.", "ticker": "035900", "krx_exchange": "kosdaq"},
    {"name": "클래시스", "ticker": "214150", "krx_exchange": "kosdaq"},
    {"name": "HPSP", "ticker": "403870", "krx_exchange": "kosdaq"},
    {"name": "파크시스템스", "ticker": "140860", "krx_exchange": "kosdaq"},
]


def market_display_name(market: str) -> str:
    return MARKET_OPTIONS.get(market, market.upper())


def ticker_input_label(market: str) -> str:
    return "주식 티커" if market == "us" else "종목 코드"


def ticker_help_text(market: str) -> str:
    if market == "krx":
        return "국내주식은 6자리 종목코드를 입력하세요. 예: 005930, 000660"
    return "미국주식 티커를 입력하세요. 예: AAPL, GOOGL, MSFT"


def default_ticker_for_market(market: str) -> str:
    return "005930" if market == "krx" else "AAPL"


def initial_capital_label(market: str) -> str:
    return "초기 투자금 (KRW)" if market == "krx" else "초기 투자금 ($)"


def fixed_amount_label(market: str) -> str:
    return "1회 매수 금액 (KRW)" if market == "krx" else "1회 매수 금액 (USD)"


def price_label(market: str) -> str:
    return "예상 매수가 (KRW)" if market == "krx" else "예상 매수가 (USD)"


def format_market_amount(amount: float, market: str, fx_rate: float | None = None) -> str:
    if market == "krx":
        return f"KRW {float(amount):,.0f}"
    return format_currency_pair(float(amount), fx_rate)


def _with_display_name(items: list[dict]) -> list[dict]:
    normalized = []
    for item in items:
        normalized.append(
            {
                **item,
                "display_name": item.get(
                    "display_name",
                    f"{item['name']} ({item['ticker']}, {item['krx_exchange'].upper()})",
                ),
            }
        )
    return normalized


def get_common_krx_companies() -> list[dict]:
    return _with_display_name(COMMON_KRX_COMPANIES)


def search_local_krx_companies(query: str, limit: int = 20) -> list[dict]:
    normalized_query = str(query).strip().lower()
    if not normalized_query:
        return get_common_krx_companies()[:limit]

    matched = []
    for item in get_common_krx_companies():
        name = item["name"].lower()
        ticker = item["ticker"]
        if name.startswith(normalized_query) or ticker.startswith(normalized_query):
            rank = 1
        elif normalized_query in name or normalized_query in ticker:
            rank = 2
        else:
            continue
        matched.append((rank, item))

    matched.sort(key=lambda pair: (pair[0], pair[1]["name"], pair[1]["ticker"]))
    return [item for _, item in matched[:limit]]


@st.cache_data(ttl=3600, show_spinner=False)
def search_krx_companies(query: str, limit: int = 20) -> list[dict]:
    normalized_query = str(query).strip()
    if not normalized_query:
        return get_common_krx_companies()[:limit]

    backend_url = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")
    try:
        response = requests.get(
            f"{backend_url}/stocks/krx/search",
            params={"q": normalized_query, "limit": limit},
            timeout=10,
        )
        response.raise_for_status()
        results = response.json().get("results", [])
        if results:
            return _with_display_name(results)
    except requests.exceptions.RequestException:
        pass
    return search_local_krx_companies(normalized_query, limit=limit)
