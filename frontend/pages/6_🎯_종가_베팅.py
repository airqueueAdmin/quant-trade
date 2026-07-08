import os
from datetime import date, timedelta

import plotly.graph_objects as go
import requests
import streamlit as st

from ga import inject_google_analytics
from market_utils import (
    KRX_EXCHANGE_OPTIONS,
    MARKET_OPTIONS,
    default_ticker_for_market,
    get_common_krx_companies,
    market_display_name,
    search_krx_companies,
    ticker_help_text,
    ticker_input_label,
)
from ui_helpers import inject_stage_banner_styles, render_stage_banner

BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")

QUICK_SCENARIOS = [
    "섹터가 하루 종일 강했고 종가까지 눌림이 적음",
    "장중 눌림 뒤 거래대금이 다시 붙으며 종가 회복",
    "뉴스 한 번으로 급등했지만 종가까지 매도 물량이 계속 나옴",
    "고가 돌파는 했지만 종가가 중간 이하에서 끝남",
]

SCENARIO_MODIFIERS = {
    QUICK_SCENARIOS[0]: 4,
    QUICK_SCENARIOS[1]: 2,
    QUICK_SCENARIOS[2]: -4,
    QUICK_SCENARIOS[3]: -6,
}

INITIAL_SCORES = {
    "sector_strength": 0,
    "close_strength": 0,
    "volume_persistence": 0,
    "leader_status": 0,
    "news_follow_through": 0,
    "tomorrow_catalyst": 0,
    "risk_control": 0,
}

def clamp_score(value: float) -> int:
    return max(0, min(100, round(value)))


def format_pct(value: float | None) -> str:
    if value is None:
        return "-"
    return f"{value:+.2f}%"


def format_price_change(value: float | None, market: str) -> str:
    if value is None:
        return "-"
    if market == "krx":
        return f"{value:+,.0f}원"
    return f"{value:+,.2f}$"


def format_as_of_date(value: str | None) -> str:
    if not value:
        return "-"
    return str(value).split("T", 1)[0]


def find_sector_match(snapshot: dict, ticker: str) -> dict | None:
    normalized = ticker.strip().upper()
    for sector in snapshot.get("sectors", []):
        for component in sector.get("components", []):
            if str(component.get("ticker", "")).strip().upper() == normalized:
                return sector
    return None


def derive_sector_strength(sector: dict | None, snapshot: dict | None) -> int:
    if not sector or not snapshot:
        return 50
    leaders = {item["key"] for item in snapshot.get("leaders", [])}
    laggards = {item["key"] for item in snapshot.get("laggards", [])}
    leader_boost = 14 if sector["key"] in leaders else 0
    laggard_penalty = 18 if sector["key"] in laggards else 0
    return clamp_score(
        52
        + float(sector.get("return_1d_pct") or 0) * 3
        + float(sector.get("return_5d_pct") or 0) * 1.2
        + float(sector.get("trend_score") or 0) * 1.5
        + leader_boost
        - laggard_penalty
    )


def derive_leader_status(sector: dict | None, snapshot: dict | None, ticker: str) -> int:
    if not sector or not snapshot:
        return 45
    normalized = ticker.strip().upper()
    components = sector.get("components", [])
    index = next(
        (idx for idx, item in enumerate(components) if str(item.get("ticker", "")).strip().upper() == normalized),
        -1,
    )
    component_boost = 18 if index == 0 else max(4, 12 - index * 2) if index > 0 else 0
    leader_boost = 12 if sector["key"] in {item["key"] for item in snapshot.get("leaders", [])} else 0
    return clamp_score(48 + component_boost + leader_boost + float(sector.get("trend_score") or 0) * 1.2)


def derive_close_strength(quote: dict | None) -> int:
    if not quote:
        return 55
    return clamp_score(55 + float(quote.get("change_pct") or 0) * 4)


def derive_close_strength_from_rows(rows: list[dict]) -> int:
    if len(rows) < 2:
        return 55
    latest = rows[-1]
    latest_close = float(latest.get("Close") or 0)
    latest_open = float(latest.get("Open") or latest_close)
    latest_high = float(latest.get("High") or latest_close)
    latest_low = float(latest.get("Low") or latest_close)
    previous_close = float(rows[-2].get("Close") or latest_close)
    day_range = max(latest_high - latest_low, 0.000001)
    close_position = ((latest_close - latest_low) / day_range) * 100
    body_strength = ((latest_close - latest_open) / max(latest_open, 0.000001)) * 100
    change_pct = ((latest_close / max(previous_close, 0.000001)) - 1) * 100
    return clamp_score(20 + close_position * 0.55 + body_strength * 4 + change_pct * 3)


def derive_volume_persistence(sector: dict | None, quote: dict | None, rows: list[dict]) -> int:
    if not sector and not quote and not rows:
        return 52
    volume_score = 0.0
    if len(rows) >= 21:
        latest_volume = float(rows[-1].get("Volume") or 0)
        previous_volumes = [float(row.get("Volume") or 0) for row in rows[-21:-1]]
        avg_volume = sum(previous_volumes) / max(len(previous_volumes), 1)
        if avg_volume > 0:
            volume_ratio = latest_volume / avg_volume
            volume_score = min(30.0, volume_ratio * 12)
    return clamp_score(
        50
        + float((quote or {}).get("change_pct") or 0) * 2.5
        + float((sector or {}).get("trend_score") or 0) * 1.8
        + float((sector or {}).get("return_1d_pct") or 0) * 2
        + volume_score
    )


def derive_news_follow_through(sentiment: dict | None) -> int:
    if not sentiment:
        return 50
    return clamp_score(float(sentiment.get("sentiment_score") or 50))


def derive_tomorrow_catalyst(sentiment: dict | None) -> int:
    if not sentiment:
        return 48
    article_boost = min(12, len(sentiment.get("articles", [])) * 3)
    api_boost = 6 if sentiment.get("news_api_enabled", True) else 0
    return clamp_score(float(sentiment.get("sentiment_score") or 50) * 0.65 + article_boost + api_boost)


def derive_risk_control(quote: dict | None, sector: dict | None, sentiment: dict | None, rows: list[dict]) -> int:
    if not quote and not sector and not sentiment and not rows:
        return 50
    close_location_bonus = 0.0
    pullback_risk_penalty = 0.0
    if len(rows) >= 20:
        closes = [float(row.get("Close") or 0) for row in rows[-20:]]
        highs = [float(row.get("High") or 0) for row in rows[-20:]]
        latest_close = closes[-1]
        twenty_day_high = max(highs) if highs else latest_close
        if twenty_day_high > 0:
            close_location_bonus = (latest_close / twenty_day_high) * 18
        latest_high = highs[-1]
        latest_low = float(rows[-1].get("Low") or latest_close)
        latest_open = float(rows[-1].get("Open") or latest_close)
        candle_range_pct = ((latest_high - latest_low) / max(latest_close, 0.000001)) * 100
        if latest_close < latest_open:
            pullback_risk_penalty += 8
        pullback_risk_penalty += min(12, candle_range_pct * 1.5)
    return clamp_score(
        48
        + float((quote or {}).get("change_pct") or 0) * 1.5
        + float((sector or {}).get("trend_score") or 0) * 1.1
        + (float((sentiment or {}).get("sentiment_score") or 50) - 50) * 0.3
        + close_location_bonus
        - pullback_risk_penalty
    )


def derive_market_close_scenario(rows: list[dict], sentiment: dict | None) -> str:
    if len(rows) < 2:
        return QUICK_SCENARIOS[1]

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
    avg_volume = sum(previous_volumes) / len(previous_volumes) if previous_volumes else 0
    volume_ratio = latest_volume / avg_volume if avg_volume > 0 else 1.0
    sentiment_score = float((sentiment or {}).get("sentiment_score") or 50)

    if close_position >= 0.8 and body_return_pct >= 0 and day_return_pct >= 1:
        return QUICK_SCENARIOS[0]
    if close_position >= 0.58 and body_return_pct >= -0.5 and volume_ratio >= 1.1:
        return QUICK_SCENARIOS[1]
    if day_return_pct >= 2 and close_position < 0.45 and sentiment_score >= 55:
        return QUICK_SCENARIOS[2]
    return QUICK_SCENARIOS[3]


def derive_risk_flags(
    rows: list[dict],
    sector: dict | None,
    sentiment: dict | None,
    scenario: str,
    scores: dict[str, int],
) -> list[str]:
    flags: list[str] = []

    if scenario == QUICK_SCENARIOS[2]:
        flags.append("뉴스 영향으로 급등했지만 종가까지 매도 물량이 남아 있을 가능성이 있습니다.")
    if scenario == QUICK_SCENARIOS[3]:
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
                if volume_ratio < 0.9 and scores["volume_persistence"] < 60:
                    flags.append("거래량이 평소보다 크게 늘지 않아 수급 지속성 신호가 약합니다.")

    if sector and scores["leader_status"] < 55:
        flags.append(f"{sector.get('name', '해당')} 섹터 안에서는 대장주보다 후발주에 가까워 보입니다.")

    if sentiment:
        if float(sentiment.get("sentiment_score") or 50) < 45:
            flags.append("뉴스와 시장 심리가 약해서 내일 재료가 다시 이어질 가능성이 높지 않습니다.")
        if not sentiment.get("news_api_enabled", True):
            flags.append("최신 뉴스 수집 범위가 좁아 재료 지속성 판단 신뢰도가 낮을 수 있습니다.")
    else:
        flags.append("뉴스 재료 확인이 충분하지 않아 내일 연결성 판단이 제한적입니다.")

    if scores["risk_control"] < 50:
        flags.append("손절 기준을 잡기 쉬운 구조로 보기 어려워 대응 난도가 높을 수 있습니다.")

    deduped: list[str] = []
    for item in flags:
        if item not in deduped:
            deduped.append(item)
    return deduped[:5]


def total_score(values: dict[str, int], scenario: str) -> int:
    return clamp_score(
        values["sector_strength"] * 0.20
        + values["close_strength"] * 0.24
        + values["volume_persistence"] * 0.20
        + values["leader_status"] * 0.16
        + values["news_follow_through"] * 0.10
        + values["tomorrow_catalyst"] * 0.05
        + values["risk_control"] * 0.05
        + SCENARIO_MODIFIERS.get(scenario, 0)
    )


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
        return "후보군 상단입니다. 내일 시가 이후 지지와 눌림 반응까지 같이 볼 가치가 있습니다."
    if score >= 60:
        return "관심 유지 구간입니다. 자동 보정값을 그대로 믿기보다 동시호가 체감을 추가 확인하세요."
    if score >= 45:
        return "복기 후보 정도로 보는 편이 낫습니다. 억지 진입보다 관찰이 우선입니다."
    return "오늘 살아남은 수급으로 보기 어렵습니다. 다른 후보를 우선 검토하는 편이 맞습니다."


def score_reason(score: int) -> str:
    if score >= 76:
        return "자동 판정상 종가까지 수급이 남아 있을 가능성이 상대적으로 높게 잡혔습니다."
    if score >= 60:
        return "핵심 지표는 나쁘지 않지만, 다음 날 연결성은 아직 확신 구간이 아닙니다."
    if score >= 45:
        return "좋은 지표와 나쁜 지표가 섞여 있어서 종가베팅보다는 관찰 쪽에 가깝습니다."
    return "현재 데이터만 보면 수급 지속성보다 소멸 가능성이 더 크게 보입니다."


def recent_stock_window() -> tuple[str, str]:
    end_date = date.today() + timedelta(days=1)
    start_date = end_date - timedelta(days=90)
    return start_date.isoformat(), end_date.isoformat()


@st.cache_data(ttl=900, show_spinner=False)
def load_quote(ticker: str, market: str, krx_exchange: str) -> dict:
    response = requests.get(
        f"{BACKEND_URL}/quote/{ticker}",
        params={"market": market, "krx_exchange": krx_exchange},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


@st.cache_data(ttl=900, show_spinner=False)
def load_sentiment(ticker: str, market: str, krx_exchange: str) -> dict:
    response = requests.get(
        f"{BACKEND_URL}/sentiment/{ticker}",
        params={"market": market, "krx_exchange": krx_exchange},
        timeout=60,
    )
    response.raise_for_status()
    return response.json()


@st.cache_data(ttl=900, show_spinner=False)
def load_sector_snapshot(market: str) -> dict:
    response = requests.get(
        f"{BACKEND_URL}/market/sectors",
        params={"market": market},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


@st.cache_data(ttl=900, show_spinner=False)
def load_stock_rows(ticker: str, market: str, krx_exchange: str) -> list[dict]:
    start_date, end_date = recent_stock_window()
    response = requests.get(
        f"{BACKEND_URL}/stock/{ticker}",
        params={
            "market": market,
            "krx_exchange": krx_exchange,
            "start_date": start_date,
            "end_date": end_date,
        },
        timeout=30,
    )
    response.raise_for_status()
    return response.json().get("rows", [])


st.set_page_config(layout="wide", page_title="종가 베팅")
inject_google_analytics(os.getenv("GA_MEASUREMENT_ID") or os.getenv("GA_TAG_ID"), "closing_bet")
inject_stage_banner_styles()

st.title("🎯 종가 베팅")
render_stage_banner("핵심 판단", "최종 후보 압축", "섹터, 뉴스, 종가 구조를 함께 보고 내일 이어질 가능성이 있는 후보를 최종적으로 좁히는 메뉴입니다.")
st.write("오늘 끝까지 살아남은 수급이 내일도 이어질 확률에 베팅하는 단기 전략을 점검하는 보조 메뉴입니다. 실제 매매 기능은 없고, 후보 압축과 복기에 집중합니다.")
st.info("이 메뉴는 최종 후보를 고르는 자리입니다. 먼저 '주요 섹터 흐름'과 'AI 시장 분석'을 보고 들어오면 왜 이 점수가 나왔는지 더 쉽게 이해할 수 있습니다.")

if "closing_bet_market" not in st.session_state:
    st.session_state.closing_bet_market = "krx"
if "closing_bet_ticker_market" not in st.session_state:
    st.session_state.closing_bet_ticker_market = "krx"
if "closing_bet_ticker" not in st.session_state:
    st.session_state.closing_bet_ticker = default_ticker_for_market("krx")
if "closing_bet_scores" not in st.session_state:
    st.session_state.closing_bet_scores = INITIAL_SCORES.copy()
if "closing_bet_scenario" not in st.session_state:
    st.session_state.closing_bet_scenario = QUICK_SCENARIOS[1]

market = st.radio(
    "시장",
    list(MARKET_OPTIONS.keys()),
    format_func=market_display_name,
    horizontal=True,
    key="closing_bet_market",
)
if st.session_state.get("closing_bet_ticker_market") != market:
    st.session_state.closing_bet_ticker = default_ticker_for_market(market)
    st.session_state.closing_bet_ticker_market = market
    st.session_state.closing_bet_quote = None
    st.session_state.closing_bet_sentiment = None
    st.session_state.closing_bet_snapshot = None
    st.session_state.closing_bet_sector = None
    st.session_state.closing_bet_rows = []
    st.session_state.closing_bet_scores = INITIAL_SCORES.copy()
    st.session_state.closing_bet_scenario = QUICK_SCENARIOS[1]

krx_exchange = "auto"
if market == "krx":
    quick_pick_options = get_common_krx_companies()
    selected_quick_pick = st.selectbox(
        "대표 국내 종목 빠른 선택",
        ["직접 입력"] + [item["display_name"] for item in quick_pick_options],
        key="closing_bet_quick_pick",
        help="드롭다운을 열고 종목명을 타이핑하면 빠르게 찾을 수 있습니다.",
    )
    if selected_quick_pick != "직접 입력":
        selected_company = next(item for item in quick_pick_options if item["display_name"] == selected_quick_pick)
        st.session_state.closing_bet_ticker = selected_company["ticker"]

    krx_exchange = st.selectbox(
        "국내 거래소",
        list(KRX_EXCHANGE_OPTIONS.keys()),
        format_func=lambda x: KRX_EXCHANGE_OPTIONS[x],
        key="closing_bet_exchange",
    )
    ticker_search_query = st.text_input(
        "국내 종목명 검색",
        key="closing_bet_search",
        help="회사명이나 6자리 종목코드를 입력하세요.",
    )
    if ticker_search_query.strip():
        try:
            ticker_search_results = search_krx_companies(ticker_search_query, limit=20)
        except requests.exceptions.RequestException:
            ticker_search_results = []
        if ticker_search_results:
            selected_display_name = st.selectbox(
                "검색 결과",
                [item["display_name"] for item in ticker_search_results],
                key="closing_bet_search_result",
            )
            selected_company = next(
                item for item in ticker_search_results if item["display_name"] == selected_display_name
            )
            st.session_state.closing_bet_ticker = selected_company["ticker"]
            st.caption(
                f"선택 종목: {selected_company['name']} / 코드: {selected_company['ticker']} / 시장: {selected_company['krx_exchange'].upper()}"
            )
            if krx_exchange == "auto":
                krx_exchange = selected_company["krx_exchange"]

st.text_input(
    f"{ticker_input_label(market)} 입력",
    key="closing_bet_ticker",
    help=ticker_help_text(market),
)

col1, col2 = st.columns([1.2, 1])
with col1:
    if st.button("AI + 섹터 기반 자동 보정", use_container_width=True):
        ticker = st.session_state.closing_bet_ticker.strip().upper() if market == "us" else st.session_state.closing_bet_ticker.strip()
        if not ticker:
            st.error("종목을 입력한 뒤 다시 시도하세요.")
        else:
            try:
                with st.spinner("종가베팅 보조 데이터를 불러오는 중입니다..."):
                    quote = load_quote(ticker, market, krx_exchange)
                    sentiment = load_sentiment(ticker, market, krx_exchange)
                    snapshot = load_sector_snapshot(market)
                    stock_rows = load_stock_rows(ticker, market, krx_exchange)
                matched_sector = find_sector_match(snapshot, quote.get("resolved_ticker", ticker))
                st.session_state.closing_bet_quote = quote
                st.session_state.closing_bet_sentiment = sentiment
                st.session_state.closing_bet_snapshot = snapshot
                st.session_state.closing_bet_sector = matched_sector
                st.session_state.closing_bet_rows = stock_rows
                st.session_state.closing_bet_scenario = derive_market_close_scenario(stock_rows, sentiment)
                st.session_state.closing_bet_scores = {
                    "sector_strength": derive_sector_strength(matched_sector, snapshot),
                    "close_strength": derive_close_strength_from_rows(stock_rows) if stock_rows else derive_close_strength(quote),
                    "volume_persistence": derive_volume_persistence(matched_sector, quote, stock_rows),
                    "leader_status": derive_leader_status(matched_sector, snapshot, quote.get("resolved_ticker", ticker)),
                    "news_follow_through": derive_news_follow_through(sentiment),
                    "tomorrow_catalyst": derive_tomorrow_catalyst(sentiment),
                    "risk_control": derive_risk_control(quote, matched_sector, sentiment, stock_rows),
                }
                st.success("자동 판정값을 반영했습니다. 이 메뉴는 수동 점수 조정 없이 자동 근거를 보여줍니다.")
            except requests.exceptions.RequestException as exc:
                st.error(f"백엔드 서버 연결에 실패했습니다: {exc}")
                if getattr(exc, "response", None) is not None:
                    try:
                        st.error(exc.response.json().get("detail", ""))
                    except Exception:
                        pass

with col2:
    if st.button("보조 데이터 새로고침", use_container_width=True):
        load_quote.clear()
        load_sentiment.clear()
        load_sector_snapshot.clear()
        load_stock_rows.clear()
        st.rerun()

quote = st.session_state.get("closing_bet_quote")
sentiment = st.session_state.get("closing_bet_sentiment")
snapshot = st.session_state.get("closing_bet_snapshot")
matched_sector = st.session_state.get("closing_bet_sector")
stock_rows = st.session_state.get("closing_bet_rows", [])
scores = st.session_state.closing_bet_scores
scenario = st.session_state.get("closing_bet_scenario", QUICK_SCENARIOS[1])
has_analysis = quote is not None or sentiment is not None or snapshot is not None or bool(stock_rows)
final_score = total_score(scores, scenario) if has_analysis else 0
risk_flags = derive_risk_flags(stock_rows, matched_sector, sentiment, scenario, scores)

score_col1, score_col2 = st.columns([1, 1.1])
with score_col1:
    gauge = go.Figure(
        go.Indicator(
            mode="gauge+number",
            value=final_score,
            domain={"x": [0, 1], "y": [0, 1]},
            title={"text": "종가베팅 점수", "font": {"size": 24}},
            gauge={
                "axis": {"range": [0, 100]},
                "steps": [
                    {"range": [0, 45], "color": "#f8d7da"},
                    {"range": [45, 60], "color": "#fff3cd"},
                    {"range": [60, 76], "color": "#d1ecf1"},
                    {"range": [76, 100], "color": "#d4edda"},
                ],
            },
        )
    )
    gauge.update_layout(height=280, margin=dict(l=20, r=20, t=60, b=20))
    st.plotly_chart(gauge, use_container_width=True)

with score_col2:
    st.subheader(score_label(final_score))
    st.write(score_action(final_score))
    st.info(
        f"서비스가 판단한 오늘 장 마감 구조: {scenario}\n\n"
        "종가베팅은 '왜 올랐는가'보다 '그 강함이 종가까지 유지됐는가'를 더 중요하게 봅니다."
    )
    st.caption(score_reason(final_score))

if quote or sentiment or matched_sector:
    info_cols = st.columns(3)
    with info_cols[0]:
        if quote:
            st.metric(
                "최근 종가 변화율",
                format_pct(quote.get("change_pct")),
                delta=format_price_change(quote.get("change_amount"), market),
            )
            st.caption(
                f"{quote.get('company_name') or quote.get('resolved_ticker')} / 기준일 {format_as_of_date(quote.get('as_of'))}"
            )
    with info_cols[1]:
        if matched_sector:
            st.metric("매칭 섹터", matched_sector.get("name", "-"), delta=matched_sector.get("trend_label", "-"))
            st.caption(
                f"1일 {format_pct(matched_sector.get('return_1d_pct'))} / 1주 {format_pct(matched_sector.get('return_5d_pct'))}"
            )
    with info_cols[2]:
        if sentiment:
            st.metric("AI 뉴스 점수", sentiment.get("sentiment_score", 50), delta=f"기사 {len(sentiment.get('articles', []))}건")
            st.caption("최신 뉴스 흐름을 종가베팅 관점에서 보조 지표로 반영합니다.")

st.subheader("자동 점검 항목")
st.write("현재 불러온 데이터 기준으로 자동 판정한 결과만 보여줍니다.")

diagnostic_rows = [
    {
        "항목": "섹터 강도",
        "점수": scores["sector_strength"],
        "근거": "섹터 1일/1주 수익률과 추세 점수, 강세 섹터 포함 여부를 반영합니다.",
    },
    {
        "항목": "종가 강도",
        "점수": scores["close_strength"],
        "근거": "당일 종가가 고가/저가 범위 어디에서 끝났는지와 몸통 강도를 반영합니다.",
    },
    {
        "항목": "거래대금 지속성",
        "점수": scores["volume_persistence"],
        "근거": "최근 20일 평균 대비 거래량과 종가 변화율, 섹터 추세를 같이 반영합니다.",
    },
    {
        "항목": "대장주 여부",
        "점수": scores["leader_status"],
        "근거": "해당 종목이 섹터 대표 바스켓에서 얼마나 앞쪽에 있는지 반영합니다.",
    },
    {
        "항목": "재료 지속성",
        "점수": scores["news_follow_through"],
        "근거": "AI 뉴스 감성 점수를 그대로 반영합니다.",
    },
    {
        "항목": "내일 이벤트 연결",
        "점수": scores["tomorrow_catalyst"],
        "근거": "AI 감성 점수와 기사 수를 기반으로 다음 날 재점화 가능성을 추정합니다.",
    },
    {
        "항목": "리스크 통제 가능성",
        "점수": scores["risk_control"],
        "근거": "20일 고점 대비 위치, 당일 캔들 범위, 종가 방향성을 합쳐 손절 구조를 추정합니다.",
    },
    {
        "항목": "장 마감 구조 보정",
        "점수": SCENARIO_MODIFIERS.get(scenario, 0),
        "근거": "당일 종가 위치, 몸통 강도, 거래량 비율, 뉴스 점수를 바탕으로 서비스가 자동 판정합니다.",
    },
]

st.dataframe(diagnostic_rows, use_container_width=True, hide_index=True)

if sentiment:
    st.subheader("AI 요약 반영")
    st.write(sentiment.get("summary", "요약 정보를 가져오지 못했습니다."))

if matched_sector and snapshot:
    st.subheader("섹터 문맥")
    st.write(snapshot.get("summary", "시장 요약 정보를 가져오지 못했습니다."))
    st.dataframe(
        [
            {
                "섹터": matched_sector.get("name"),
                "추세": matched_sector.get("trend_label"),
                "1일": format_pct(matched_sector.get("return_1d_pct")),
                "1주": format_pct(matched_sector.get("return_5d_pct")),
                "1개월": format_pct(matched_sector.get("return_21d_pct")),
                "3개월": format_pct(matched_sector.get("return_63d_pct")),
            }
        ],
        use_container_width=True,
        hide_index=True,
    )

with st.expander("제외 신호"):
    if risk_flags:
        for item in risk_flags:
            st.markdown(f"- {item}")
    else:
        st.markdown("- 현재 자동 판정 기준에서는 뚜렷한 제외 신호가 강하게 잡히지 않았습니다.")

with st.expander("체크 순서"):
    st.markdown(
        """
        1. 섹터와 대장주가 같이 강한지 먼저 봅니다.
        2. 종가가 고가 부근인지, 동시호가에서 살아남았는지 확인합니다.
        3. 내일 다시 소화될 재료가 있는지 확인합니다.
        4. 틀렸을 때 빨리 접을 기준이 없다면 점수가 높아도 제외합니다.
        """
    )

st.caption("이 메뉴는 실제 매매 기능이 아니라 후보 압축과 복기를 위한 판단 보조 메뉴입니다.")
