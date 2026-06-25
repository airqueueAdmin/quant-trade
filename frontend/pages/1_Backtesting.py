import streamlit as st
import requests
import pandas as pd
import plotly.express as px
import os
from datetime import datetime, timedelta
from market_utils import (
    KRX_EXCHANGE_OPTIONS,
    MARKET_OPTIONS,
    default_ticker_for_market,
    fixed_amount_label,
    format_market_amount,
    get_common_krx_companies,
    initial_capital_label,
    market_display_name,
    search_krx_companies,
    ticker_help_text,
    ticker_input_label,
)
from fx_utils import get_usdkrw_rate

BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")
FX_RATE = get_usdkrw_rate()
DEFAULT_END_DATE = datetime.now().date()
DEFAULT_START_DATE = DEFAULT_END_DATE - timedelta(days=365)

st.set_page_config(layout="wide", page_title="투자 전략 시뮬레이션")

st.title("📈 투자 전략 시뮬레이션")
st.write("과거 데이터를 기반으로, 미국주식과 국내주식에 다양한 투자 전략을 적용했을 때 어떤 성과를 냈을지 테스트해볼 수 있습니다.")

# --- Sidebar for All Controls ---
st.sidebar.header("백테스트 설정")

mode = st.sidebar.radio("모드 선택", ["일반 백테스트", "전략 최적화"], help="일반 백테스트는 단일 파라미터로 시뮬레이션하고, 전략 최적화는 여러 파라미터 조합 중 최적의 조합을 찾아줍니다.")

market = st.sidebar.radio("시장", list(MARKET_OPTIONS.keys()), format_func=lambda x: MARKET_OPTIONS[x], horizontal=True)
if st.session_state.get("ticker_backtest_market") != market:
    st.session_state["ticker_backtest_input"] = default_ticker_for_market(market)
    st.session_state["ticker_backtest_market"] = market

krx_exchange = "auto"
if market == "krx":
    quick_pick_options = get_common_krx_companies()
    selected_quick_pick = st.sidebar.selectbox(
        "대표 국내 종목 빠른 선택",
        ["직접 입력"] + [item["display_name"] for item in quick_pick_options],
        key="ticker_quick_pick_backtest",
        help="드롭다운을 열고 종목명을 타이핑하면 빠르게 찾을 수 있습니다.",
    )
    if selected_quick_pick != "직접 입력":
        selected_company = next(item for item in quick_pick_options if item["display_name"] == selected_quick_pick)
        st.session_state["ticker_backtest_input"] = selected_company["ticker"]

    krx_exchange = st.sidebar.selectbox(
        "국내 거래소",
        list(KRX_EXCHANGE_OPTIONS.keys()),
        format_func=lambda x: KRX_EXCHANGE_OPTIONS[x],
        help="6자리 종목코드만 입력하면 자동 판별을 우선 시도합니다.",
    )
    ticker_search_query = st.sidebar.text_input(
        "국내 종목명 검색",
        key="ticker_search_backtest",
        help="회사명이나 6자리 종목코드를 입력하세요. 예: 삼성전자, 005930",
    )
    if ticker_search_query.strip():
        try:
            ticker_search_results = search_krx_companies(ticker_search_query, limit=20)
        except requests.exceptions.RequestException:
            ticker_search_results = []
        if ticker_search_results:
            selected_display_name = st.sidebar.selectbox(
                "검색 결과",
                [item["display_name"] for item in ticker_search_results],
                key="ticker_search_result_backtest",
            )
            selected_company = next(
                item for item in ticker_search_results if item["display_name"] == selected_display_name
            )
            st.session_state["ticker_backtest_input"] = selected_company["ticker"]
            st.sidebar.caption(
                f"선택 종목: {selected_company['name']} / 코드: {selected_company['ticker']} / "
                f"시장: {selected_company['krx_exchange'].upper()}"
            )
            if krx_exchange == "auto":
                krx_exchange = selected_company["krx_exchange"]
        else:
            st.sidebar.caption("검색 결과가 없습니다.")

    if selected_quick_pick != "직접 입력" and krx_exchange == "auto":
        krx_exchange = selected_company["krx_exchange"]

ticker_backtest = st.sidebar.text_input(
    ticker_input_label(market),
    key="ticker_backtest_input",
    help=ticker_help_text(market),
)
start_date = st.sidebar.date_input("시작일", DEFAULT_START_DATE)
end_date = st.sidebar.date_input("종료일", DEFAULT_END_DATE)
initial_capital = st.sidebar.number_input(
    initial_capital_label(market),
    1000,
    1000000000,
    100000 if market == "us" else 1000000,
    format="%d",
    help="시뮬레이션을 시작할 가상의 투자 원금입니다.",
)

order_type = st.sidebar.radio(
    "주문 방식",
    ('all_in', 'fixed_amount'),
    format_func=lambda x: "전액 매수/매도" if x == 'all_in' else "고정 금액 분할 매수",
    help="매수 신호 발생 시 주문 방식을 선택합니다."
)
fixed_amount = None
if order_type == 'fixed_amount':
    fixed_amount = st.sidebar.number_input(
        fixed_amount_label(market),
        1,
        100000000,
        1000 if market == "us" else 100000,
        format="%d",
    )

strategy = st.sidebar.selectbox("전략 선택", ["이동평균", "RSI", "볼린저 밴드"])

metric_to_optimize = "sharpe_ratio"
if mode == "전략 최적화":
    metric_to_optimize = st.sidebar.selectbox("최적화 기준 지표", ["sharpe_ratio", "total_return_pct"], format_func=lambda x: "샤프 지수" if x == "sharpe_ratio" else "총수익률")

st.sidebar.divider()

params = {}
endpoint = ""
optimize_endpoint = ""

if strategy == "이동평균":
    with st.sidebar.expander("이동평균 전략이란?"):
        st.info("단기 추세가 장기 추세를 뚫고 올라갈 때 사고, 내려갈 때 파는 전략입니다.")
    if mode == "일반 백테스트":
        params['short_window'] = st.sidebar.number_input("단기 평균 기간 (일)", 1, 200, 20)
        params['long_window'] = st.sidebar.number_input("장기 평균 기간 (일)", 1, 200, 50)
    else:
        st.sidebar.subheader("단기 평균 기간 범위")
        c1,c2,c3 = st.sidebar.columns(3)
        with c1: params['short_window_range_start'] = st.number_input("시작", 1, 200, 10, key="ma_s_start")
        with c2: params['short_window_range_end'] = st.number_input("끝", 1, 200, 30, key="ma_s_end")
        with c3: params['short_window_range_step'] = st.number_input("간격", 1, 20, 5, key="ma_s_step")
        st.sidebar.subheader("장기 평균 기간 범위")
        c4,c5,c6 = st.sidebar.columns(3)
        with c4: params['long_window_range_start'] = st.number_input("시작", 1, 200, 40, key="ma_l_start")
        with c5: params['long_window_range_end'] = st.number_input("끝", 1, 200, 60, key="ma_l_end")
        with c6: params['long_window_range_step'] = st.number_input("간격", 1, 20, 5, key="ma_l_step")
    endpoint = "/backtest/moving_average"
    optimize_endpoint = "/optimize/moving_average"

elif strategy == "RSI":
    with st.sidebar.expander("RSI 전략이란?"):
        st.info("주가가 과도하게 싸졌을 때 사고, 과도하게 비싸졌을 때 파는 전략입니다.")
    if mode == "일반 백테스트":
        params['window'] = st.sidebar.number_input("RSI 계산 기간 (일)", 1, 200, 14)
        params['oversold_threshold'] = st.sidebar.slider("과매도 기준선", 0, 100, 30)
        params['overbought_threshold'] = st.sidebar.slider("과매수 기준선", 0, 100, 70)
    else:
        st.sidebar.subheader("RSI 계산 기간 범위")
        c1,c2,c3 = st.sidebar.columns(3)
        with c1: params['window_range_start'] = st.number_input("시작", 1, 200, 10, key="rsi_w_start")
        with c2: params['window_range_end'] = st.number_input("끝", 1, 200, 20, key="rsi_w_end")
        with c3: params['window_range_step'] = st.number_input("간격", 1, 20, 2, key="rsi_w_step")
        st.sidebar.subheader("과매도 기준선 범위")
        c4,c5,c6 = st.sidebar.columns(3)
        with c4: params['oversold_threshold_range_start'] = st.number_input("시작", 0, 100, 20, key="rsi_os_start")
        with c5: params['oversold_threshold_range_end'] = st.number_input("끝", 0, 100, 40, key="rsi_os_end")
        with c6: params['oversold_threshold_range_step'] = st.number_input("간격", 1, 20, 5, key="rsi_os_step")
        st.sidebar.subheader("과매수 기준선 범위")
        c7,c8,c9 = st.sidebar.columns(3)
        with c7: params['overbought_threshold_range_start'] = st.number_input("시작", 0, 100, 60, key="rsi_ob_start")
        with c8: params['overbought_threshold_range_end'] = st.number_input("끝", 0, 100, 80, key="rsi_ob_end")
        with c9: params['overbought_threshold_range_step'] = st.number_input("간격", 1, 20, 5, key="rsi_ob_step")
    endpoint = "/backtest/rsi"
    optimize_endpoint = "/optimize/rsi"

elif strategy == "볼린저 밴드":
    with st.sidebar.expander("볼린저 밴드 전략이란?"):
        st.info("주가가 통계적으로 비정상적인 가격대에 도달했을 때, 다시 정상으로 돌아올 것을 기대하며 반대로 투자하는 전략입니다.")
    if mode == "일반 백테스트":
        params['window'] = st.sidebar.number_input("밴드 계산 기간 (일)", 1, 200, 20)
        params['num_std_dev'] = st.sidebar.number_input("밴드 넓이 (표준편차 배수)", 1.0, 5.0, 2.0, step=0.1)
    else:
        st.sidebar.subheader("밴드 계산 기간 범위")
        c1,c2,c3 = st.sidebar.columns(3)
        with c1: params['window_range_start'] = st.number_input("시작", 1, 200, 15, key="bb_w_start")
        with c2: params['window_range_end'] = st.number_input("끝", 1, 200, 25, key="bb_w_end")
        with c3: params['window_range_step'] = st.number_input("간격", 1, 20, 5, key="bb_w_step")
        st.sidebar.subheader("밴드 넓이 (표준편차 배수) 범위")
        c4,c5,c6 = st.sidebar.columns(3)
        with c4: params['num_std_dev_range_start'] = st.number_input("시작", 0.5, 5.0, 1.5, step=0.1, key="bb_std_start")
        with c5: params['num_std_dev_range_end'] = st.number_input("끝", 0.5, 5.0, 2.5, step=0.1, key="bb_std_end")
        with c6: params['num_std_dev_range_step'] = st.number_input("간격", 0.1, 1.0, 0.5, step=0.1, key="bb_std_step")
    endpoint = "/backtest/bollinger_bands"
    optimize_endpoint = "/optimize/bollinger_bands"

if st.sidebar.button("실행"):
    common_payload = {
        "ticker": ticker_backtest,
        "market": market,
        "krx_exchange": krx_exchange,
        "start_date": start_date.strftime("%Y-%m-%d"),
        "end_date": end_date.strftime("%Y-%m-%d"),
        "initial_capital": initial_capital,
        "order_type": order_type,
        "fixed_amount": fixed_amount,
    }

    if mode == "일반 백테스트":
        request_payload = {**common_payload, **params}
        url = f"{BACKEND_URL}{endpoint}"
        spinner_message = '과거 데이터를 기반으로 시뮬레이션을 실행 중입니다...'
    else:
        request_payload = {**common_payload, "metric_to_optimize": metric_to_optimize}
        for key, value in params.items():
            if '_range_start' in key:
                base_key = key.replace('_range_start', '')
                request_payload[f"{base_key}_range"] = [params[f"{base_key}_range_start"], params[f"{base_key}_range_end"], params[f"{base_key}_range_step"]]
        url = f"{BACKEND_URL}{optimize_endpoint}"
        spinner_message = '모든 파라미터 조합에 대해 최적의 전략을 찾는 중입니다...'

    with st.spinner(spinner_message):
        try:
            response = requests.post(url, json=request_payload)
            response.raise_for_status()
            results = response.json()
            st.session_state["last_run_mode"] = mode
            st.session_state["ticker_backtest"] = ticker_backtest
            st.session_state["market_backtest"] = market
            st.session_state["krx_exchange_backtest"] = krx_exchange
            st.session_state["last_run_strategy"] = strategy
            st.session_state["initial_capital"] = float(initial_capital)
            st.session_state["last_backtest_context"] = {
                "ticker": ticker_backtest,
                "market": market,
                "krx_exchange": krx_exchange,
                "resolved_ticker": results.get("resolved_ticker", ticker_backtest),
                "strategy": strategy,
                "mode": mode,
                "start_date": start_date.strftime("%Y-%m-%d"),
                "end_date": end_date.strftime("%Y-%m-%d"),
                "initial_capital": float(initial_capital),
                "order_type": order_type,
                "fixed_amount": float(fixed_amount) if fixed_amount is not None else None,
                "executed_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }

            if mode == "일반 백테스트":
                st.session_state["backtest_results"] = results

                st.header(f"📊 '{strategy}' 전략 시뮬레이션 결과")
                st.caption(
                    f"대상 시장: {market_display_name(results.get('market', market))} | "
                    f"입력 종목: {results.get('ticker', ticker_backtest)} | "
                    f"실제 조회 심볼: {results.get('resolved_ticker', ticker_backtest)}"
                )
                st.subheader("📈 주요 성과 지표")
                metrics = results.get("performance_metrics", {})
                benchmark_metrics = results.get("benchmark_metrics", {})
                comparison_metrics = results.get("comparison_metrics", {})

                col1, col2, col3, col4 = st.columns(4)
                col1.metric("총수익률", f"{metrics.get('total_return_pct', 0):.2f}%")
                col2.metric("샤프 지수", f"{metrics.get('sharpe_ratio', 0):.2f}")
                col3.metric("최대 낙폭", f"{metrics.get('max_drawdown_pct', 0):.2f}%")
                col4.metric(
                    "최종 자산",
                    format_market_amount(
                        metrics.get("final_total_value", 0),
                        results.get("market", market),
                        FX_RATE["rate"] if FX_RATE else None,
                    ),
                )
                st.text(f"총 거래 횟수: {metrics.get('total_trades', 0)}회")

                st.subheader("📌 전략 vs 단순 보유")
                cmp1, cmp2, cmp3, cmp4 = st.columns(4)
                cmp1.metric("전략 CAGR", f"{metrics.get('cagr_pct', 0):.2f}%")
                cmp2.metric("단순 보유 수익률", f"{benchmark_metrics.get('total_return_pct', 0):.2f}%")
                cmp3.metric("초과수익률", f"{comparison_metrics.get('excess_return_pct', 0):.2f}%")
                cmp4.metric("연환산 변동성", f"{metrics.get('annual_volatility_pct', 0):.2f}%")

                st.subheader("💰 자산 변화 그래프")
                portfolio_df = pd.DataFrame(results.get("portfolio_history", []))
                benchmark_df = pd.DataFrame(results.get("benchmark_history", []))
                if not portfolio_df.empty:
                    portfolio_df['Date'] = pd.to_datetime(portfolio_df['Date'])
                    plot_df = portfolio_df[['Date', 'total_value']].copy()
                    plot_df['series'] = '전략'
                    if not benchmark_df.empty:
                        benchmark_df['Date'] = pd.to_datetime(benchmark_df['Date'])
                        benchmark_plot_df = benchmark_df[['Date', 'total_value']].copy()
                        benchmark_plot_df['series'] = '단순 보유'
                        plot_df = pd.concat([plot_df, benchmark_plot_df], ignore_index=True)
                    fig = px.line(plot_df, x='Date', y='total_value', color='series', title='나의 자산은 어떻게 변했을까?')
                    st.plotly_chart(fig, use_container_width=True)

                st.subheader("📋 상세 거래 내역")
                with st.expander("시뮬레이션은 어떻게 작동하나요? (거래 기준)"):
                    st.info("...")
                trades_df = pd.DataFrame(results.get("trades", []))
                if not trades_df.empty:
                    trades_df['Date'] = pd.to_datetime(trades_df['Date']).dt.strftime('%Y-%m-%d %H:%M:%S')
                    st.dataframe(trades_df, use_container_width=True)
            else: # 전략 최적화 결과 표시
                st.header(f"✨ '{strategy}' 전략 최적화 결과")
                best_params = results.get("best_params", {})
                best_metric_value = results.get("best_metric_value", 0)
                metric_optimized = results.get("metric_optimized", "")
                st.subheader(f"🏆 최적 파라미터 (기준: {metric_to_optimize})")
                st.write(f"**최적 {metric_optimized}**: {best_metric_value:.2f}")
                st.json(best_params)
                st.subheader("🔍 모든 최적화 결과")
                all_optimization_results = results.get("all_optimization_results", [])
                if all_optimization_results:
                    df_results = pd.DataFrame([{**item['params'], **item['metrics']} for item in all_optimization_results])
                    st.dataframe(df_results.sort_values(by=metric_to_optimize, ascending=False), use_container_width=True)
                else:
                    st.info("최적화 결과가 없습니다.")
        except requests.exceptions.RequestException as e:
            st.error(f"백엔드 서버 연결에 실패했습니다: {e}")
            if getattr(e, "response", None) is not None:
                try:
                    st.error(e.response.json().get("detail", ""))
                except Exception:
                    pass
        except Exception as e:
            st.error(f"오류가 발생했습니다: {e}")
