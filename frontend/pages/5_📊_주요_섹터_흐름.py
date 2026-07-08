import os

import pandas as pd
import plotly.express as px
import requests
import streamlit as st

from ga import inject_google_analytics
from market_utils import MARKET_OPTIONS, market_display_name
from ui_helpers import inject_stage_banner_styles, render_stage_banner

BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")
METRIC_OPTIONS = {
    "1일 수익률": "1일",
    "1주 수익률": "1주",
    "1개월 수익률": "1개월",
    "3개월 수익률": "3개월",
    "추세 점수": "추세 점수",
}
RISING_TREND_LABELS = {"강한 상승 추세", "상승 우위"}

st.set_page_config(layout="wide", page_title="주요 섹터 흐름")
inject_google_analytics(os.getenv("GA_MEASUREMENT_ID") or os.getenv("GA_TAG_ID"), "sector_flow")
inject_stage_banner_styles()

st.markdown(
    """
    <style>
    .sector-card {
        border: 1px solid rgba(120, 120, 120, 0.25);
        border-radius: 14px;
        padding: 1rem;
        background: rgba(255, 255, 255, 0.02);
        min-height: 150px;
    }
    .sector-card h4 {
        margin: 0 0 0.35rem 0;
        font-size: 0.95rem;
        color: inherit;
        opacity: 0.72;
    }
    .sector-card strong {
        display: block;
        font-size: 1.15rem;
        margin-bottom: 0.35rem;
        color: inherit;
    }
    .sector-card p {
        margin: 0.15rem 0;
        line-height: 1.4;
        color: inherit;
    }
    </style>
    """,
    unsafe_allow_html=True,
)


@st.cache_data(ttl=900, show_spinner=False)
def get_sector_snapshot(market: str) -> dict:
    response = requests.get(
        f"{BACKEND_URL}/market/sectors",
        params={"market": market},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


@st.cache_data(ttl=900, show_spinner=False)
def get_quote_snapshot(ticker: str, market: str, krx_exchange: str = "auto") -> dict:
    response = requests.get(
        f"{BACKEND_URL}/quote/{ticker}",
        params={"market": market, "krx_exchange": krx_exchange},
        timeout=20,
    )
    response.raise_for_status()
    return response.json()


def format_pct(value: float | None) -> str:
    if value is None:
        return "-"
    return f"{value:+.1f}%"


def format_as_of_date(value: str | None) -> str:
    if not value:
        return "-"
    return str(value).split("T", 1)[0]


def quote_snapshot_or_none(ticker: str, market: str, krx_exchange: str = "auto") -> dict | None:
    try:
        return get_quote_snapshot(ticker, market, krx_exchange)
    except requests.exceptions.RequestException:
        return None


def trend_position_label(flag: bool) -> str:
    return "위" if flag else "아래"


def component_text(components: list[dict]) -> str:
    if not components:
        return "-"
    return ", ".join(f"{item['name']}({item['ticker']})" for item in components)


def render_sector_card(column, title: str, sector: dict) -> None:
    column.markdown(
        f"""
        <div class="sector-card">
            <h4>{title}</h4>
            <strong>{sector['name']}</strong>
            <p>{sector['trend_label']}</p>
            <p>1개월 {format_pct(sector.get('return_21d_pct'))} / 3개월 {format_pct(sector.get('return_63d_pct'))}</p>
            <p>20일선 {trend_position_label(bool(sector.get('above_20dma')))} / 60일선 {trend_position_label(bool(sector.get('above_60dma')))}</p>
        </div>
        """,
        unsafe_allow_html=True,
    )


def build_rising_stock_candidates(sectors: list[dict], market: str) -> list[dict]:
    candidates: list[dict] = []
    for sector_rank, sector in enumerate(sectors):
        if sector.get("trend_label") not in RISING_TREND_LABELS:
            continue
        for component_rank, component in enumerate(sector.get("components", [])[:3]):
            component_market = "krx" if component.get("krx_exchange") else market
            component_exchange = component.get("krx_exchange", "auto")
            quote = quote_snapshot_or_none(component["ticker"], component_market, component_exchange)
            change_pct = float((quote or {}).get("change_pct") or 0.0)
            candidate_score = (
                float(sector.get("trend_score") or 0.0) * 4
                + float(sector.get("return_21d_pct") or 0.0) * 1.2
                + float(sector.get("return_5d_pct") or 0.0) * 1.8
                + change_pct * 1.4
                + max(0, 6 - component_rank * 2)
                + max(0, 4 - sector_rank)
            )
            candidates.append(
                {
                    "ticker": component["ticker"],
                    "name": component["name"],
                    "market": component_market,
                    "krx_exchange": component_exchange,
                    "sector_name": sector["name"],
                    "sector_trend_label": sector["trend_label"],
                    "sector_trend_score": float(sector.get("trend_score") or 0.0),
                    "sector_return_21d_pct": float(sector.get("return_21d_pct") or 0.0),
                    "change_pct": change_pct,
                    "close": (quote or {}).get("close"),
                    "as_of": (quote or {}).get("as_of"),
                    "score": candidate_score,
                }
            )

    deduped: dict[str, dict] = {}
    for item in sorted(candidates, key=lambda row: row["score"], reverse=True):
        if item["ticker"] not in deduped:
            deduped[item["ticker"]] = item
    return list(deduped.values())[:3]


def render_stock_pick_card(column, rank: int, stock: dict) -> None:
    price_text = "-"
    if stock.get("close") is not None:
        if stock.get("market") == "krx":
            price_text = f"{float(stock['close']):,.0f}원"
        else:
            price_text = f"${float(stock['close']):,.2f}"
    column.markdown(
        f"""
        <div class="sector-card">
            <h4>추천 종목 {rank}</h4>
            <strong>{stock['name']} ({stock['ticker']})</strong>
            <p>{stock['sector_name']} / {stock['sector_trend_label']}</p>
            <p>최근 종가 {price_text} / 전일 {format_pct(stock.get('change_pct'))}</p>
            <p>섹터 1개월 {format_pct(stock.get('sector_return_21d_pct'))} / 추세 점수 {stock.get('sector_trend_score', 0):+.1f}</p>
        </div>
        """,
        unsafe_allow_html=True,
    )


def build_sector_frame(sectors: list[dict]) -> pd.DataFrame:
    rows = []
    for item in sectors:
        rows.append(
            {
                "섹터": item["name"],
                "현재 흐름": item["trend_label"],
                "1일": item.get("return_1d_pct"),
                "1주": item.get("return_5d_pct"),
                "1개월": item.get("return_21d_pct"),
                "3개월": item.get("return_63d_pct"),
                "20일선": "위" if item.get("above_20dma") else "아래",
                "60일선": "위" if item.get("above_60dma") else "아래",
                "추세 점수": item.get("trend_score"),
                "구성": component_text(item.get("components", [])),
                "기준": item.get("proxy_label", "-"),
                "설명": item.get("note", "-"),
            }
        )
    return pd.DataFrame(rows)


st.title("📊 주요 섹터 흐름")
render_stage_banner("1단계", "시장에서 강한 흐름 찾기", "종가베팅은 종목보다 먼저 시장 흐름을 보는 게 쉬워서, 초보자는 여기서 출발하는 편이 좋습니다.")
st.write("종가베팅 전에 오늘 시장에서 끝까지 강했던 섹터를 먼저 추리는 **1차 흐름 확인 서포트 시스템**입니다. 최근 수익률과 추세 기준으로 어디에 자금이 남았는지 빠르게 확인할 수 있습니다.")
st.info("처음 보는 사람은 여기서 출발하면 됩니다. 어떤 종목을 볼지 모르겠다면, 먼저 어느 섹터에 돈이 붙었는지부터 확인하세요.")

control_col1, control_col2 = st.columns([1.2, 1])
with control_col1:
    market = st.radio(
        "확인할 시장",
        list(MARKET_OPTIONS.keys()),
        format_func=market_display_name,
        horizontal=True,
    )
with control_col2:
    if st.button("데이터 새로고침", use_container_width=True):
        get_sector_snapshot.clear()
        st.rerun()

st.caption(
    "미국은 대표 섹터 ETF 기준, 국내는 대표 종목 3개를 같은 비중으로 묶은 바스켓 기준입니다."
)

try:
    with st.spinner("섹터 흐름을 불러오는 중입니다..."):
        snapshot = get_sector_snapshot(market)
except requests.exceptions.RequestException as exc:
    st.error(f"백엔드 서버 연결에 실패했습니다: {exc}")
    if getattr(exc, "response", None) is not None:
        try:
            st.error(exc.response.json().get("detail", ""))
        except Exception:
            pass
    st.stop()
except Exception as exc:
    st.error(f"섹터 데이터를 불러오지 못했습니다: {exc}")
    st.stop()

sectors = snapshot.get("sectors", [])
leaders = snapshot.get("leaders", [])
laggards = snapshot.get("laggards", [])

st.caption(
    f"기준 시점: {format_as_of_date(snapshot.get('as_of'))}"
)
if snapshot.get("snapshot_status"):
    st.caption(f"데이터 성격: {snapshot.get('snapshot_status')}")
if snapshot.get("intraday_estimate"):
    st.warning("장중에는 당일 진행 중인 데이터를 잠정 반영합니다. 마감 전에는 순위와 수익률이 바뀔 수 있습니다.")
st.info(snapshot.get("summary", "요약 정보를 불러오지 못했습니다."))

leader_cols = st.columns(3)
for index, sector in enumerate(leaders[:3]):
    render_sector_card(leader_cols[index], f"상대 강세 {index + 1}", sector)

stock_picks = build_rising_stock_candidates(sectors, market)
st.subheader("상승 추세 기준 추천 3종목")
st.caption("강한 섹터 안에서 대표성, 최근 흐름, 섹터 추세를 같이 반영해 우선 확인할 종목 3개를 추렸습니다.")
if stock_picks:
    pick_cols = st.columns(3)
    for index, stock in enumerate(stock_picks):
        render_stock_pick_card(pick_cols[index], index + 1, stock)
else:
    st.info("뚜렷한 상승 추세 섹터가 부족해 추천 종목을 추리지 못했습니다.")

if laggards:
    weak_col1, weak_col2 = st.columns(2)
    render_sector_card(weak_col1, "약한 섹터 1", laggards[0])
    if len(laggards) > 1:
        render_sector_card(weak_col2, "약한 섹터 2", laggards[1])

frame = build_sector_frame(sectors)

chart_label = st.selectbox("차트 기준", list(METRIC_OPTIONS.keys()), index=2)
chart_column = METRIC_OPTIONS[chart_label]
chart_frame = frame[["섹터", chart_column]].rename(columns={chart_column: chart_label}).sort_values(by=chart_label, ascending=True)

chart = px.bar(
    chart_frame,
    x=chart_label,
    y="섹터",
    orientation="h",
    color=chart_label,
    color_continuous_scale="RdYlGn",
    title=f"{market_display_name(market)} 섹터별 {chart_label}",
)
chart.update_layout(height=520, coloraxis_showscale=False)
chart.update_traces(texttemplate="%{x:.1f}", textposition="outside")
st.plotly_chart(chart, use_container_width=True)

styled_frame = frame.copy()
for column in ["1일", "1주", "1개월", "3개월", "추세 점수"]:
    styled_frame[column] = styled_frame[column].map(lambda value: "-" if pd.isna(value) else f"{value:+.1f}")

st.subheader("섹터 비교 표")
st.dataframe(styled_frame, use_container_width=True, hide_index=True)

with st.expander("해석 기준"):
    st.markdown(
        """
        - `1개월`, `3개월` 수익률이 높고 20일선과 60일선 위에 있으면 상대적으로 강한 섹터로 봅니다.
        - `추세 점수`는 1일, 1주, 1개월, 3개월 수익률을 가중합한 값입니다.
        - 국내 섹터는 ETF가 아니라 대표 종목 바스켓 기준이라, 실제 업종 전체와 완전히 같지는 않습니다.
        """
    )
