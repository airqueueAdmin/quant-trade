import streamlit as st
import requests
import plotly.graph_objects as go
import os

BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")

st.set_page_config(layout="wide", page_title="AI 시장 분석")

st.title("🤖 AI 시장 분석")
st.write("최신 뉴스를 기반으로, AI가 특정 주식에 대한 시장의 감정을 분석해 드립니다.")

# --- Step 1: 분석할 주식 선택 ---
st.header("단계 1: 분석할 주식 선택")
st.write("AI가 분석할 주식의 티커를 입력하세요.")

with st.form("ai_analysis_form"):
    ticker_sentiment = st.text_input("주식 티커 (종목 코드)", "AAPL", help="분석하고 싶은 주식의 티커를 입력하세요. (예: AAPL, GOOGL, MSFT)")

    # Gemini 모델 선택 드롭다운 제거
    # gemini_model_name = st.selectbox(...)

    submitted_step1_ai = st.form_submit_button("AI 분석 실행")

if submitted_step1_ai:
    st.session_state['ticker_sentiment'] = ticker_sentiment
    st.session_state['step_ai'] = 2 # 다음 단계로 이동
    # 새로운 티커 분석 시 이전의 캐시된 결과 삭제
    if 'sentiment_results' in st.session_state:
        del st.session_state['sentiment_results']

if 'step_ai' not in st.session_state:
    st.session_state['step_ai'] = 1

if st.session_state['step_ai'] >= 2:
    st.header("단계 2: AI 분석 결과")
    st.write(f"'{st.session_state['ticker_sentiment']}'에 대한 AI 분석 결과입니다.")

    # 세션 상태에 결과가 없거나 티커가 일치하지 않는 경우 새로 요청
    if 'sentiment_results' not in st.session_state:
        with st.spinner('최신 뉴스를 수집하고 AI로 분석 중입니다... (최대 1분 소요)'):
            try:
                # model_name 쿼리 파라미터 전달 제거
                response = requests.get(
                    f"{BACKEND_URL}/sentiment/{st.session_state['ticker_sentiment']}"
                )
                response.raise_for_status()
                st.session_state['sentiment_results'] = response.json()
            except requests.exceptions.RequestException as e:
                st.error(f"백엔드 서버 연결에 실패했습니다: {e}")
            except Exception as e:
                st.error(f"오류가 발생했습니다: {e}")

    if 'sentiment_results' in st.session_state:
        sentiment_results = st.session_state['sentiment_results']
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
