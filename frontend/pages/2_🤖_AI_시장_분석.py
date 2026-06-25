import streamlit as st
import requests
import plotly.graph_objects as go
import os
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

BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")

st.set_page_config(layout="wide", page_title="AI 시장 분석")

st.title("🤖 AI 시장 분석")
st.write("최신 뉴스를 기반으로, 미국주식과 국내주식에 대한 시장의 감정을 분석해 드립니다.")

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
    if st.button("AI 분석 실행"):
        st.session_state.ticker_sentiment = st.session_state.ticker_input_ai
        st.session_state.market_sentiment = st.session_state.market_input_ai
        st.session_state.krx_exchange_sentiment = krx_exchange
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
                },
            )
            response.raise_for_status()
            sentiment_results = response.json()

            score = sentiment_results.get('sentiment_score', 50)
            company_name = sentiment_results.get("company_name")
            resolved_ticker = sentiment_results.get("resolved_ticker", st.session_state["ticker_sentiment"])

            if company_name:
                st.caption(f"분석 대상: {company_name} ({resolved_ticker})")
            else:
                st.caption(f"분석 대상 심볼: {resolved_ticker}")

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

            st.subheader("📰 관련 뉴스 목록")
            for article in sentiment_results.get('articles', []):
                st.markdown(f"- [{article['title']}]({article['url']})")

        except requests.exceptions.RequestException as e:
            st.error(f"백엔드 서버 연결에 실패했습니다: {e}")
            if getattr(e, "response", None) is not None:
                try:
                    st.error(e.response.json().get("detail", ""))
                except Exception:
                    pass
        except Exception as e:
            st.error(f"오류가 발생했습니다: {e}")
