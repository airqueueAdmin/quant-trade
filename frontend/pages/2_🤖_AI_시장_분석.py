import streamlit as st
import requests
import plotly.graph_objects as go
import os
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
PERIOD_OPTIONS = {
    3: "최근 3일",
    7: "최근 7일",
    14: "최근 14일",
    30: "최근 30일",
}
SOURCE_FILTER_OPTIONS = {
    "all": "전체",
    "exclude_press_release": "보도자료 제외",
}

st.set_page_config(layout="wide", page_title="AI 시장 분석")
inject_google_analytics(os.getenv("GA_MEASUREMENT_ID") or os.getenv("GA_TAG_ID"), "ai_analysis")
inject_stage_banner_styles()

st.title("🤖 AI 시장 분석")
render_stage_banner("2단계", "재료와 뉴스 해석", "움직인 이유가 단발성인지, 내일까지도 이어질지 빠르게 읽는 메뉴입니다.")
st.write("종가베팅 후보 종목에 붙은 뉴스와 시장 심리를 빠르게 요약하는 **재료 해석 서포트 시스템**입니다. 내일까지 재료가 이어질지 판단할 때 보조 지표로 쓰기 좋습니다.")
st.info("쉽게 말해 '이 종목이 왜 움직였는지'와 '그 이유가 내일까지도 남아 있을지'를 빠르게 읽는 메뉴입니다.")

# --- Initialize session state ---
if 'step_ai' not in st.session_state:
    st.session_state.step_ai = 1

# --- Step 1: 분석할 주식 선택 ---
if st.session_state.step_ai == 1:
    st.header("단계 1: 분석할 주식 선택")
    st.write("AI가 분석할 주식의 시장을 고르고, 국내주식이면 종목명 검색 또는 종목코드 입력으로 선택하세요.")

    market = st.radio("시장", list(MARKET_OPTIONS.keys()), format_func=lambda x: MARKET_OPTIONS[x], horizontal=True, key="market_input_ai")
    if st.session_state.get("ticker_ai_market") != market:
        st.session_state["ticker_input_ai"] = default_ticker_for_market(market)
        st.session_state["ticker_ai_market"] = market

    krx_exchange = "auto"
    if market == "krx":
        quick_pick_options = get_common_krx_companies()
        selected_quick_pick = st.selectbox(
            "대표 국내 종목 빠른 선택",
            ["직접 입력"] + [item["display_name"] for item in quick_pick_options],
            key="ticker_quick_pick_ai",
            help="드롭다운을 열고 종목명을 타이핑하면 빠르게 찾을 수 있습니다.",
        )
        if selected_quick_pick != "직접 입력":
            selected_company = next(item for item in quick_pick_options if item["display_name"] == selected_quick_pick)
            st.session_state["ticker_input_ai"] = selected_company["ticker"]

        krx_exchange = st.selectbox(
            "국내 거래소",
            list(KRX_EXCHANGE_OPTIONS.keys()),
            format_func=lambda x: KRX_EXCHANGE_OPTIONS[x],
            key="krx_exchange_input_ai",
            help="모를 때는 자동 판별을 사용하세요.",
        )
        ticker_search_query = st.text_input(
            "국내 종목명 검색",
            key="ticker_search_ai",
            help="회사명이나 6자리 종목코드를 입력하세요. 예: 삼성전자, 005930",
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
                    key="ticker_search_result_ai",
                )
                selected_company = next(
                    item for item in ticker_search_results if item["display_name"] == selected_display_name
                )
                st.session_state["ticker_input_ai"] = selected_company["ticker"]
                st.caption(
                    f"선택 종목: {selected_company['name']} / 코드: {selected_company['ticker']} / "
                    f"시장: {selected_company['krx_exchange'].upper()}"
                )
                if krx_exchange == "auto":
                    krx_exchange = selected_company["krx_exchange"]
            else:
                st.caption("검색 결과가 없습니다.")
        if selected_quick_pick != "직접 입력" and krx_exchange == "auto":
            krx_exchange = selected_company["krx_exchange"]
    else:
        st.session_state["krx_exchange_input_ai"] = "auto"

    st.text_input(
        f"{ticker_input_label(market)} 입력",
        key="ticker_input_ai",
        help=ticker_help_text(market),
    )
    period_days = st.selectbox(
        "분석 기간",
        list(PERIOD_OPTIONS.keys()),
        index=1,
        key="sentiment_period_days_input",
        format_func=lambda value: PERIOD_OPTIONS[value],
        help="최근 며칠 동안의 뉴스를 기준으로 요약할지 선택합니다.",
    )
    source_filter = st.selectbox(
        "소스 필터",
        list(SOURCE_FILTER_OPTIONS.keys()),
        key="sentiment_source_filter_input",
        format_func=lambda value: SOURCE_FILTER_OPTIONS[value],
        help="보도자료성 기사까지 포함할지 선택합니다.",
    )
    if st.button("AI 분석 실행"):
        st.session_state.ticker_sentiment = st.session_state.ticker_input_ai
        st.session_state.market_sentiment = st.session_state.market_input_ai
        st.session_state.krx_exchange_sentiment = krx_exchange
        st.session_state.sentiment_period_days = period_days
        st.session_state.sentiment_source_filter = source_filter
        st.session_state.step_ai = 2
        st.rerun()

# --- Step 2 and Results ---
if st.session_state.step_ai >= 2:
    st.header("단계 2: AI 분석 결과")
    st.write(
        f"{market_display_name(st.session_state.get('market_sentiment', 'us'))} "
        f"'{st.session_state['ticker_sentiment']}'에 대한 AI 분석 결과입니다."
    )

    with st.spinner('최신 뉴스를 수집하고 AI로 분석 중입니다... (최대 1분 소요)'):
        try:
            response = requests.get(
                f"{BACKEND_URL}/sentiment/{st.session_state['ticker_sentiment']}",
                params={
                    "market": st.session_state.get("market_sentiment", "us"),
                    "krx_exchange": st.session_state.get("krx_exchange_sentiment", "auto"),
                    "period_days": st.session_state.get("sentiment_period_days", 7),
                    "source_filter": st.session_state.get("sentiment_source_filter", "all"),
                },
            )
            response.raise_for_status()
            sentiment_results = response.json()

            score = sentiment_results.get('sentiment_score', 50)
            company_name = sentiment_results.get("company_name")
            resolved_ticker = sentiment_results.get("resolved_ticker", st.session_state["ticker_sentiment"])
            news_api_enabled = sentiment_results.get("news_api_enabled", True)
            attempted_queries = sentiment_results.get("attempted_queries", [])
            period_days = sentiment_results.get("period_days", st.session_state.get("sentiment_period_days", 7))
            source_filter_label = sentiment_results.get(
                "source_filter_label",
                SOURCE_FILTER_OPTIONS.get(st.session_state.get("sentiment_source_filter", "all"), "전체"),
            )

            if company_name:
                st.caption(f"분석 대상: {company_name} ({resolved_ticker})")
            else:
                st.caption(f"분석 대상 심볼: {resolved_ticker}")
            st.caption(f"분석 기준: 최근 {period_days}일 / 소스 필터: {source_filter_label}")

            if not news_api_enabled:
                st.warning("백엔드에 `NEWS_API_KEY`가 설정되지 않아 최신 뉴스 수집을 할 수 없습니다.")

            fig = go.Figure(go.Indicator(
                mode = "gauge+number", value = score,
                domain = {'x': [0, 1], 'y': [0, 1]},
                title = {'text': "감성 점수", 'font': {'size': 24}},
                gauge = {
                    'axis': {'range': [0, 100]},
                    'steps' : [{'range': [0, 40], 'color': "red"}, {'range': [40, 60], 'color': "orange"}, {'range': [60, 100], 'color': "green"}],
                }))
            st.plotly_chart(fig, use_container_width=True)

            st.subheader("📝 AI 요약")
            st.write(sentiment_results.get('summary', '요약 정보를 가져올 수 없습니다.'))

            st.subheader("🎯 투자 시사점")
            st.write(sentiment_results.get("investment_implications", "투자 시사점을 가져오지 못했습니다."))

            st.subheader("📰 관련 뉴스 목록")
            for article in sentiment_results.get('articles', []):
                source_name = article.get("source_name") or "출처 미상"
                published_at = article.get("published_at") or "-"
                st.markdown(f"- [{article['title']}]({article['url']})")
                st.caption(f"{source_name} / {published_at}")

            if attempted_queries:
                with st.expander("뉴스 검색 쿼리 보기"):
                    for item in attempted_queries:
                        st.write(f"- `{item.get('query', '')}` / 언어 `{item.get('language', '')}`")

        except requests.exceptions.RequestException as e:
            st.error(f"백엔드 서버 연결에 실패했습니다: {e}")
            if getattr(e, "response", None) is not None:
                try:
                    st.error(e.response.json().get("detail", ""))
                except Exception:
                    pass
        except Exception as e:
            st.error(f"오류가 발생했습니다: {e}")
