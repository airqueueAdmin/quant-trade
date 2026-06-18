import streamlit as st
import requests
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import os

# 환경 변수에서 백엔드 URL을 읽어오고, 없을 경우 로컬 주소를 기본값으로 사용합니다.
BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")

st.set_page_config(layout="wide", page_title="Quant Backtester")

st.title("나만의 투자 전략 시뮬레이터")
with st.expander("🤔 이 앱은 무엇인가요?"):
    st.write("""
        이 앱은 여러분이 생각하는 투자 전략이 과거에 어땠을지 시뮬레이션(백테스트)해볼 수 있는 도구입니다.
        '만약 내가 이 방법으로 투자를 했다면 과연 돈을 벌었을까?' 하는 궁금증을 해결해 보세요!
    """)

st.sidebar.title("설정")

st.sidebar.header("🤖 AI 시장 감성 분석")
ticker_sentiment = st.sidebar.text_input("주식 티커 (감성 분석용)", "AAPL", help="분석하고 싶은 주식의 티커를 입력하세요.")
if st.sidebar.button("시장 감성 분석 실행"):
    with st.spinner('최신 뉴스를 수집하고 AI로 분석 중입니다... (최대 1분 소요)'):
        try:
            response = requests.get(f"{BACKEND_URL}/sentiment/{ticker_sentiment}")
            response.raise_for_status()
            sentiment_results = response.json()

            st.header(f"'{ticker_sentiment}' 시장 감성 분석 결과")
            score = sentiment_results.get('sentiment_score', 50)

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
        except Exception as e:
            st.error(f"오류가 발생했습니다: {e}")

st.sidebar.divider()

st.sidebar.header("📈 투자 전략 백테스트")
ticker_backtest = st.sidebar.text_input("주식 티커 (백테스트용)", "AAPL", help="백테스트를 실행할 주식의 티커를 입력하세요.")
start_date = st.sidebar.date_input("시작일", pd.to_datetime("2023-01-01"))
end_date = st.sidebar.date_input("종료일", pd.to_datetime("2023-12-31"))
initial_capital = st.sidebar.number_input("초기 투자금 ($)", 1000, 1000000, 100000, help="시뮬레이션을 시작할 가상의 투자 원금입니다.")
strategy = st.sidebar.selectbox("전략 선택", ["이동평균", "RSI", "볼린저 밴드"])

params = {}
if strategy == "이동평균":
    params['short_window'] = st.sidebar.number_input("단기 평균 기간 (일)", 1, 200, 20)
    params['long_window'] = st.sidebar.number_input("장기 평균 기간 (일)", 1, 200, 50)
    endpoint = "/backtest/moving_average"
elif strategy == "RSI":
    params['window'] = st.sidebar.number_input("RSI 계산 기간 (일)", 1, 200, 14)
    params['oversold_threshold'] = st.sidebar.slider("과매도 기준선", 0, 100, 30)
    params['overbought_threshold'] = st.sidebar.slider("과매수 기준선", 0, 100, 70)
    endpoint = "/backtest/rsi"
elif strategy == "볼린저 밴드":
    params['window'] = st.sidebar.number_input("밴드 계산 기간 (일)", 1, 200, 20)
    params['num_std_dev'] = st.sidebar.number_input("밴드 넓이 (표준편차 배수)", 1, 5, 2)
    endpoint = "/backtest/bollinger_bands"

if st.sidebar.button("백테스트 실행"):
    request_payload = {
        "ticker": ticker_backtest,
        "start_date": start_date.strftime("%Y-%m-%d"),
        "end_date": end_date.strftime("%Y-%m-%d"),
        "initial_capital": initial_capital,
        **params
    }
    with st.spinner('과거 데이터를 기반으로 시뮬레이션을 실행 중입니다...'):
        try:
            response = requests.post(f"{BACKEND_URL}{endpoint}", json=request_payload)
            response.raise_for_status()
            results = response.json()

            st.header(f"📊 '{strategy}' 전략 시뮬레이션 결과")
            st.subheader("📈 주요 성과 지표")
            metrics = results.get("performance_metrics", {})
            col1, col2, col3, col4, col5 = st.columns(5)
            col1.metric("총수익률", f"{metrics.get('total_return_pct', 0):.2f}%")
            col2.metric("샤프 지수", f"{metrics.get('sharpe_ratio', 0):.2f}")
            col3.metric("최대 낙폭", f"{metrics.get('max_drawdown_pct', 0):.2f}%")
            col4.metric("총 거래 횟수", metrics.get('total_trades', 0))
            col5.metric("최종 자산", f"${metrics.get('final_total_value', 0):,.2f}")

            st.subheader("💰 자산 변화 그래프")
            portfolio_df = pd.DataFrame(results.get("portfolio_history", []))
            if not portfolio_df.empty:
                portfolio_df['Date'] = pd.to_datetime(portfolio_df['Date'])
                fig = px.line(portfolio_df, x='Date', y='total_value', title='나의 자산은 어떻게 변했을까?')
                st.plotly_chart(fig, use_container_width=True)

            st.subheader("📋 상세 거래 내역")
            trades_df = pd.DataFrame(results.get("trades", []))
            if not trades_df.empty:
                st.dataframe(trades_df, use_container_width=True)

        except requests.exceptions.RequestException as e:
            st.error(f"백엔드 서버 연결에 실패했습니다: {e}")
        except Exception as e:
            st.error(f"오류가 발생했습니다: {e}")
