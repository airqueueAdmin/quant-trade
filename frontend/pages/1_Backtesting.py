import streamlit as st
import requests
import pandas as pd
import plotly.express as px
import os

BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")

# 영문 키값들을 알기 쉬운 한글로 매핑하는 용어 사전
TRANSLATION_MAP = {
    # 이동평균 파라미터
    "short_window": "단기 평균선 기간 (일)",
    "long_window": "장기 평균선 기간 (일)",
    # RSI & 볼린저 밴드 파라미터
    "window": "상태/기준선 계산 기간 (일)",
    "oversold_threshold": "매수 기준선 (과매도 점수)",
    "overbought_threshold": "매도 기준선 (과매수 점수)",
    # 볼린저 밴드 파라미터
    "num_std_dev": "통로 넓이 배수 (표준편차)",
    
    # 성과 지표 (Metrics)
    "total_return_pct": "총수익률 (%)",
    "sharpe_ratio": "샤프 지수 (위험 대비 안정성)",
    "max_drawdown_pct": "최대 손실폭 (최악의 구간 낙폭 %)",
    "total_trades": "총 거래 횟수 (회)",
    "final_total_value": "최종 자산 가치 ($)",
    
    # 상세 거래 정보
    "Date": "거래 날짜",
    "Type": "거래 유형",
    "Price": "체결 가격 ($)",
    "Shares": "거래 수량 (주)"
}

st.set_page_config(layout="wide", page_title="투자 전략 시뮬레이션")

st.title("📈 투자 전략 시뮬레이션")
st.write("과거 데이터를 기반으로, 다양한 투자 전략이 어떤 성과를 냈을지 테스트해볼 수 있습니다.")

# --- Step 1: 기본 설정 ---
st.header("단계 1: 기본 설정")
st.write("시뮬레이션에 필요한 주식 정보와 투자 원금을 설정합니다.")

with st.form("basic_settings_form"): # key 인자 제거
    col1, col2 = st.columns(2)
    with col1:
        ticker_backtest = st.text_input("주식 티커 (종목 코드)", "AAPL", help="분석하고 싶은 주식의 티커를 입력하세요. (예: AAPL, GOOGL, MSFT)")
        start_date = st.date_input("시작일", pd.to_datetime("2023-01-01"))
    with col2:
        initial_capital = st.number_input("초기 투자금 ($)", 1000, 10000000, 100000, format="%d", help="시뮬레이션을 시작할 가상의 투자 원금입니다.")
        end_date = st.date_input("종료일", pd.to_datetime("2023-12-31"))

    submitted_step1 = st.form_submit_button("다음 단계로", key="submit_step1")

if submitted_step1:
    st.session_state['ticker_backtest'] = ticker_backtest
    st.session_state['start_date'] = start_date
    st.session_state['end_date'] = end_date
    st.session_state['initial_capital'] = initial_capital
    st.session_state['step'] = 2 # 다음 단계로 이동
    # 기본 설정 변경 시 이전 결과 삭제
    if 'backtest_results' in st.session_state:
        del st.session_state['backtest_results']

if 'step' not in st.session_state:
    st.session_state['step'] = 1

@st.fragment
def render_step_2():
    st.header("단계 2: 전략 선택 및 파라미터 설정")
    st.write("테스트하고 싶은 투자 전략을 선택하고, 세부 파라미터를 설정합니다.")

    mode = st.radio("모드 선택", ["일반 백테스트", "전략 최적화"], help="일반 백테스트는 단일 파라미터로 시뮬레이션하고, 전략 최적화는 여러 파라미터 조합 중 최적의 조합을 찾아줍니다.")
    
    # 모드 변경 시 이전 결과 삭제
    if 'prev_mode' not in st.session_state:
        st.session_state['prev_mode'] = mode
    elif st.session_state['prev_mode'] != mode:
        st.session_state['prev_mode'] = mode
        if 'backtest_results' in st.session_state:
            del st.session_state['backtest_results']

    metric_to_optimize = "sharpe_ratio"
    if mode == "전략 최적화":
        metric_to_optimize = st.selectbox("최적화 기준 지표", ["sharpe_ratio", "total_return_pct"], format_func=lambda x: "샤프 지수" if x == "sharpe_ratio" else "총수익률")

    strategy = st.selectbox("전략 선택", ["이동평균", "RSI", "볼린저 밴드"])

    # 전략 변경 시 이전 결과 삭제
    if 'prev_strategy' not in st.session_state:
        st.session_state['prev_strategy'] = strategy
    elif st.session_state['prev_strategy'] != strategy:
        st.session_state['prev_strategy'] = strategy
        if 'backtest_results' in st.session_state:
            del st.session_state['backtest_results']

    with st.form("strategy_settings_form"): # key 인자 제거
        params = {}
        endpoint = ""
        optimize_endpoint = ""

        if strategy == "이동평균":
            with st.expander("이동평균 전략이란? (자세한 설명 보기)"):
                st.markdown("""
                    📈 **이동평균 전략**은 주가의 '단기적인 흐름(단기 평균선)'과 '장기적인 흐름(장기 평균선)'을 비교하여 매매 시점을 잡는 전략입니다.
                    
                    * **골든크로스 🟢 (사는 타이밍)**
                      단기 평균선이 장기 평균선 위로 올라갈 때로, 최근 주가가 빠르게 오르기 시작했음을 뜻합니다. (상승 추세 시작)
                    * **데드크로스 🔴 (파는 타이밍)**
                      단기 평균선이 장기 평균선 아래로 떨어질 때로, 주가 상승세가 꺾이고 떨어지기 시작했음을 뜻합니다. (하락 추세 시작)
                """)
            
            if mode == "일반 백테스트":
                st.markdown("💡 **단기 평균선이 장기 평균선보다 높아지면 매수하고, 낮아지면 매도합니다.**")
                params['short_window'] = st.number_input(
                    "단기 주가 평균선 계산 기간 (일)", 
                    1, 200, 20, 
                    help="최근 며칠 동안의 주가 흐름을 볼지 결정합니다. 숫자가 작을수록 최근 움직임에 민감하게 반응합니다. (추천: 5일, 20일)"
                )
                params['long_window'] = st.number_input(
                    "장기 주가 평균선 계산 기간 (일)", 
                    1, 200, 50, 
                    help="주가의 전반적인 큰 흐름을 볼지 결정합니다. 단기 기간보다 큰 값을 지정해야 하며, 보통 60일, 120일이 주로 사용됩니다."
                )
                if params['short_window'] >= params['long_window']:
                    st.warning("⚠️ 단기 주가 평균 기간은 장기 주가 평균 기간보다 작아야 정상적인 신호가 발생합니다. (예: 단기 20일 / 장기 50일)")
            else: # 전략 최적화 모드
                st.markdown("🔍 **최적의 자산 수익률을 내는 평균선 조합 범위를 설정하세요.**")
                
                st.subheader("단기 평균선 설정 범위 (추천: 5 ~ 30일)")
                col_s1, col_s2, col_s3 = st.columns(3)
                with col_s1: params['short_window_range_start'] = st.number_input("시작 일수", 1, 200, 10, key="ma_short_start")
                with col_s2: params['short_window_range_end'] = st.number_input("끝 일수", 1, 200, 30, key="ma_short_end")
                with col_s3: params['short_window_range_step'] = st.number_input("탐색 간격 (일)", 1, 20, 5, key="ma_short_step")

                st.subheader("장기 평균선 설정 범위 (추천: 40 ~ 120일)")
                col_l1, col_l2, col_l3 = st.columns(3)
                with col_l1: params['long_window_range_start'] = st.number_input("시작 일수", 1, 200, 40, key="ma_long_start")
                with col_l2: params['long_window_range_end'] = st.number_input("끝 일수", 1, 200, 60, key="ma_long_end")
                with col_l3: params['long_window_range_step'] = st.number_input("탐색 간격 (일)", 1, 20, 5, key="ma_long_step")

            endpoint = "/backtest/moving_average"
            optimize_endpoint = "/optimize/moving_average"

        elif strategy == "RSI":
            with st.expander("RSI 전략이란? (자세한 설명 보기)"):
                st.markdown("""
                    📊 **RSI (상대강도지수)**는 현재 주가가 '과열 상태(비쌈)'인지 '침체 상태(쌈)'인지 0부터 100 사이의 점수로 보여주는 지표입니다.
                    
                    * **과매도 상태 🟢 (사야 할 때)**
                      시장이 주식을 너무 많이 팔아서 '점수가 기준선 이하로 내려간 상태'입니다. 주식이 과도하게 저평가되어 싸졌으므로 삽니다.
                    * **과매수 상태 🔴 (팔아야 할 때)**
                      시장이 주식을 너무 많이 사서 '점수가 기준선 이상으로 올라간 상태'입니다. 주식이 과도하게 고평가되어 비싸졌으므로 팝니다.
                """)
            
            if mode == "일반 백테스트":
                st.markdown("💡 **주가가 지나치게 과도하게 하락하여 싸졌을 때 매수하고, 너무 많이 상승하여 비싸졌을 때 매도합니다.**")
                params['window'] = st.number_input(
                    "상태 측정 기간 (일)", 
                    1, 200, 14, 
                    help="최근 며칠 동안의 주가 변화를 바탕으로 과열 정도를 계산할지 설정합니다. 전 세계적으로 14일이 가장 많이 사용됩니다."
                )
                params['oversold_threshold'] = st.slider(
                    "매수 기준선 (과도하게 싸졌다고 판단할 기준 점수)", 
                    0, 100, 30,
                    help="점수가 이 값 이하로 떨어지면 '충분히 싸다'고 보고 주식을 매수합니다. 값이 작을수록 더 깐깐하게 쌀 때만 삽니다. (추천: 30)"
                )
                params['overbought_threshold'] = st.slider(
                    "매도 기준선 (과도하게 비싸졌다고 판단할 기준 점수)", 
                    0, 100, 70,
                    help="점수가 이 값 이상으로 올라가면 '충분히 비싸다'고 보고 주식을 매도합니다. 값이 클수록 더 깐깐하게 비쌀 때만 팝니다. (추천: 70)"
                )
                if params['oversold_threshold'] >= params['overbought_threshold']:
                    st.warning("⚠️ 매수 기준선은 매도 기준선보다 낮아야 거래 신호가 정상적으로 발생합니다.")
            else: # 전략 최적화 모드
                st.markdown("🔍 **최적의 자산 수익률을 내는 과열/침체 기준 범위를 설정하세요.**")
                
                st.subheader("상태 측정 기간 범위 (추천: 10 ~ 20일)")
                col_w1, col_w2, col_w3 = st.columns(3)
                with col_w1: params['window_range_start'] = st.number_input("시작 일수", 1, 200, 10, key="rsi_win_start")
                with col_w2: params['window_range_end'] = st.number_input("끝 일수", 1, 200, 20, key="rsi_win_end")
                with col_w3: params['window_range_step'] = st.number_input("탐색 간격 (일)", 1, 20, 2, key="rsi_win_step")

                st.subheader("매수 기준선 범위 (추천: 20 ~ 40 점)")
                col_os1, col_os2, col_os3 = st.columns(3)
                with col_os1: params['oversold_threshold_range_start'] = st.number_input("시작 점수", 0, 100, 20, key="rsi_os_start")
                with col_os2: params['oversold_threshold_range_end'] = st.number_input("끝 점수", 0, 100, 40, key="rsi_os_end")
                with col_os3: params['oversold_threshold_range_step'] = st.number_input("탐색 간격 (점수)", 1, 20, 5, key="rsi_os_step")

                st.subheader("매도 기준선 범위 (추천: 60 ~ 80 점)")
                col_ob1, col_ob2, col_ob3 = st.columns(3)
                with col_ob1: params['overbought_threshold_range_start'] = st.number_input("시작 점수", 0, 100, 60, key="rsi_ob_start")
                with col_ob2: params['overbought_threshold_range_end'] = st.number_input("끝 점수", 0, 100, 80, key="rsi_ob_end")
                with col_ob3: params['overbought_threshold_range_step'] = st.number_input("탐색 간격 (점수)", 1, 20, 5, key="rsi_ob_step")

            endpoint = "/backtest/rsi"
            optimize_endpoint = "/optimize/rsi"

        elif strategy == "볼린저 밴드":
            with st.expander("볼린저 밴드 전략이란? (자세한 설명 보기)"):
                st.markdown("""
                    📈 **볼린저 밴드**는 최근 주가 변동을 기반으로 **주가가 움직이는 위아래 통로(가격 밴드)**를 그리는 기법입니다. 주가의 95%는 이 통로 안에서만 움직인다는 통계학적 규칙을 씁니다.
                    
                    * **하단 선 터치 🟢 (사는 타이밍)**
                      주가가 아래쪽 통로 바깥으로 떨어지면 '통계적으로 비정상적으로 많이 내렸다'고 판단해 주식을 매수합니다.
                    * **상단 선 터치 🔴 (파는 타이밍)**
                      주가가 위쪽 통로 바깥으로 뚫고 올라가면 '통계적으로 비정상적으로 많이 올랐다'고 판단해 주식을 매도합니다.
                """)
            
            if mode == "일반 백테스트":
                st.markdown("💡 **주가가 통로의 밑바닥에 도달하면 사고, 천장에 도달하면 팝니다.**")
                params['window'] = st.number_input(
                    "통로 기준선 계산 기간 (일)", 
                    1, 200, 20, 
                    help="통로의 중심축이 될 이동평균선 계산 일수입니다. 일반적으로 20일이 가장 추천됩니다."
                )
                params['num_std_dev'] = st.number_input(
                    "통로의 상하폭 배수 (민감도)", 
                    1.0, 5.0, 2.0, step=0.1,
                    help="숫자가 클수록 가격 통로가 넓어집니다. 통로가 넓어지면 확실하게 폭락/폭등했을 때만 거래하므로 안전한 매매가 가능합니다. (추천: 2.0)"
                )
            else: # 전략 최적화 모드
                st.markdown("🔍 **최적의 자산 수익률을 내는 통로 넓이 범위를 설정하세요.**")
                
                st.subheader("통로 기준선 계산 기간 범위 (추천: 15 ~ 25일)")
                col_w1, col_w2, col_w3 = st.columns(3)
                with col_w1: params['window_range_start'] = st.number_input("시작 일수", 1, 200, 15, key="bb_win_start")
                with col_w2: params['window_range_end'] = st.number_input("끝 일수", 1, 200, 25, key="bb_win_end")
                with col_w3: params['window_range_step'] = st.number_input("탐색 간격 (일)", 1, 20, 5, key="bb_win_step")

                st.subheader("통로의 상하폭 배수 범위 (추천: 1.5 ~ 2.5배)")
                col_s1, col_s2, col_s3 = st.columns(3)
                with col_s1: params['num_std_dev_range_start'] = st.number_input("시작 배수", 0.5, 5.0, 1.5, step=0.1, key="bb_std_start")
                with col_s2: params['num_std_dev_range_end'] = st.number_input("끝 배수", 0.5, 5.0, 2.5, step=0.1, key="bb_std_end")
                with col_s3: params['num_std_dev_range_step'] = st.number_input("탐색 간격 (배수)", 0.1, 1.0, 0.5, step=0.1, key="bb_std_step")

            endpoint = "/backtest/bollinger_bands"
            optimize_endpoint = "/optimize/bollinger_bands"

        submitted_step2 = st.form_submit_button("실행", key="submit_step2")

    if submitted_step2:
        common_payload = {
            "ticker": st.session_state['ticker_backtest'],
            "start_date": st.session_state['start_date'].strftime("%Y-%m-%d"),
            "end_date": st.session_state['end_date'].strftime("%Y-%m-%d"),
            "initial_capital": st.session_state['initial_capital'],
        }

        if mode == "일반 백테스트":
            request_payload = {**common_payload, **params}
            url = f"{BACKEND_URL}{endpoint}"
            spinner_message = '과거 데이터를 기반으로 시뮬레이션을 실행 중입니다...'
        else: # 전략 최적화 모드
            request_payload = {
                **common_payload,
                "metric_to_optimize": metric_to_optimize
            }
            for key, value in params.items():
                if '_range_start' in key:
                    base_key = key.replace('_range_start', '')
                    request_payload[f"{base_key}_range"] = [
                        params[f"{base_key}_range_start"],
                        params[f"{base_key}_range_end"],
                        params[f"{base_key}_range_step"]
                    ]
            url = f"{BACKEND_URL}{optimize_endpoint}"
            spinner_message = '모든 파라미터 조합에 대해 최적의 전략을 찾는 중입니다... (시간이 오래 걸릴 수 있습니다)'

        with st.spinner(spinner_message):
            try:
                response = requests.post(url, json=request_payload)
                response.raise_for_status()
                st.session_state['backtest_results'] = response.json()
                st.session_state['last_run_mode'] = mode
                st.session_state['last_run_strategy'] = strategy
            except requests.exceptions.RequestException as e:
                st.error(f"백엔드 서버 연결에 실패했습니다: {e}")
                if 'backtest_results' in st.session_state:
                    del st.session_state['backtest_results']
            except Exception as e:
                st.error(f"오류가 발생했습니다: {e}")
                if 'backtest_results' in st.session_state:
                    del st.session_state['backtest_results']

    # 기 수행된 결과가 세션 상태에 있으면 출력
    if 'backtest_results' in st.session_state:
        results = st.session_state['backtest_results']
        run_mode = st.session_state.get('last_run_mode', mode)
        run_strategy = st.session_state.get('last_run_strategy', strategy)

        if run_mode == "일반 백테스트":
            st.header(f"📊 '{run_strategy}' 전략 시뮬레이션 결과")
            st.subheader("📈 주요 성과 지표")
            with st.expander("지표 설명 보기"):
                st.info("""
                    - **총수익률 (%):** 투자 원금 대비 얼마나 벌었는지 보여줍니다.
                    - **샤프 지수:** 위험 대비 수익성을 나타냅니다. 숫자가 높을수록 '감수한 위험에 비해 보상이 컸다'는 의미입니다. (보통 1 이상이면 좋다고 평가합니다.)
                    - **최대 낙폭 (%):** 투자 기간 중 가장 크게 손실을 본 구간의 하락률입니다. 이 전략의 '최악의 순간'을 보여줍니다.
                    - **총 거래 횟수:** 시뮬레이션 기간 동안 주식을 사고 판 횟수입니다.
                    - **최종 자산:** 투자 원금이 시뮬레이션 후 얼마가 되었는지 보여줍니다.
                """)
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
                chart_data = portfolio_df.set_index('Date')[['total_value']]
                st.line_chart(chart_data)

            st.subheader("📋 상세 거래 내역")
            with st.expander("시뮬레이션은 어떻게 작동하나요? (거래 기준)"):
                st.info("""
                    - **거래 타이밍:** 모든 거래는 투자 전략에 따라 **매수 또는 매도 신호가 발생한 날의 다음 날 아침(시가)**에 이루어집니다.
                    - **거래 가격:** 거래는 **다음 날의 시가(Open Price)**를 기준으로 체결됩니다.
                    - **거래 수량:**
                        - **매수 시:** 현재 보유한 현금을 모두 사용하여 살 수 있는 최대 수량의 주식을 매수합니다. (All-in)
                        - **매도 시:** 보유하고 있는 모든 주식을 매도합니다. (All-out)
                    - **수수료:** 모든 거래에는 0.1%의 수수료가 적용됩니다.
                """)
            trades_df = pd.DataFrame(results.get("trades", []))
            if not trades_df.empty:
                # 거래 유형 한글화 (BUY -> 매수, SELL -> 매도)
                trades_df['Type'] = trades_df['Type'].map({'BUY': '매수', 'SELL': '매도'}).fillna(trades_df['Type'])
                
                # 날짜 포맷 정리
                trades_df['Date'] = pd.to_datetime(trades_df['Date']).dt.strftime('%Y-%m-%d')
                
                # 컬럼 한글화
                trades_df_friendly = trades_df.rename(columns={
                    'Date': TRANSLATION_MAP['Date'],
                    'Type': TRANSLATION_MAP['Type'],
                    'Price': TRANSLATION_MAP['Price'],
                    'Shares': TRANSLATION_MAP['Shares']
                })
                st.dataframe(trades_df_friendly, use_container_width=True)
        else: # 전략 최적화 결과 표시
            st.header(f"✨ '{run_strategy}' 전략 최적화 결과")
            best_params = results.get("best_params", {})
            best_metric_value = results.get("best_metric_value", 0)
            metric_optimized = results.get("metric_optimized", "")

            # 사용자 선택한 메트릭 텍스트 표시
            metric_label = "샤프 지수" if metric_optimized == "sharpe_ratio" else "총수익률"
            st.subheader(f"🏆 최적의 설정 조합 (기준: {metric_label})")
            if metric_optimized == "total_return_pct":
                st.write(f"📈 **최적 {metric_label}**: **{best_metric_value:.2f}%**")
            else:
                st.write(f"🛡️ **최적 {metric_label}**: **{best_metric_value:.2f}**")
            
            st.markdown("**🎯 추천 매매 조건 설정:**")
            for key, val in best_params.items():
                friendly_name = TRANSLATION_MAP.get(key, key)
                st.markdown(f"- **{friendly_name}**: `{val}`")

            st.subheader("🔍 테스트한 모든 전략 설정 조합 결과")
            all_optimization_results = results.get("all_optimization_results", [])
            if all_optimization_results:
                df_results = pd.DataFrame([
                    {**item['params'], **item['metrics']} for item in all_optimization_results
                ])
                # 정렬
                sort_col = metric_optimized if metric_optimized in df_results.columns else df_results.columns[0]
                df_results = df_results.sort_values(by=sort_col, ascending=False)
                
                # 컬럼명을 한글로 변경
                renamed_cols = {col: TRANSLATION_MAP.get(col, col) for col in df_results.columns}
                df_results_friendly = df_results.rename(columns=renamed_cols)
                
                st.dataframe(df_results_friendly, use_container_width=True)
            else:
                st.info("최적화 결과가 없습니다.")

if st.session_state['step'] >= 2:
    render_step_2()
