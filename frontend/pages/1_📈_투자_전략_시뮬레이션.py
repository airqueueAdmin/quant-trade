import os
from datetime import datetime, timedelta

import pandas as pd
import plotly.express as px
import requests
import streamlit as st

from fx_utils import get_usdkrw_rate
from ga import inject_google_analytics
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
from ui_helpers import inject_stage_banner_styles, render_stage_banner

BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")
FX_RATE = get_usdkrw_rate()
DEFAULT_END_DATE = datetime.now().date()
DEFAULT_START_DATE = DEFAULT_END_DATE - timedelta(days=365)
PARAMETER_LABELS = {
    "short_window": "단기 평균 기간",
    "long_window": "장기 평균 기간",
    "window": "계산 기간",
    "oversold_threshold": "과매도 기준선",
    "overbought_threshold": "과매수 기준선",
    "num_std_dev": "표준편차 배수",
}
METRIC_LABELS = {
    "sharpe_ratio": "샤프 지수",
    "total_return_pct": "총수익률(%)",
    "cagr_pct": "CAGR(%)",
    "sortino_ratio": "소르티노 지수",
    "final_total_value": "최종 자산",
    "max_drawdown_pct": "최대 낙폭(%)",
    "annual_volatility_pct": "연환산 변동성(%)",
    "total_trades": "총 거래 횟수",
    "win_rate": "승률(%)",
    "average_profit_pct": "평균 수익률(%)",
    "profit_factor": "프로핏 팩터",
}
STRATEGY_KEY_BY_LABEL = {
    "이동평균": "moving_average",
    "RSI": "rsi",
    "볼린저 밴드": "bollinger_bands",
}
STRATEGY_LABEL_BY_KEY = {value: key for key, value in STRATEGY_KEY_BY_LABEL.items()}
RUN_TYPE_BY_MODE = {
    "일반 백테스트": "backtest",
    "전략 최적화": "optimization",
}
MODE_BY_RUN_TYPE = {value: key for key, value in RUN_TYPE_BY_MODE.items()}


def label_parameter(param_name: str) -> str:
    return PARAMETER_LABELS.get(param_name, param_name)


def label_metric(metric_name: str) -> str:
    return METRIC_LABELS.get(metric_name, metric_name)


def format_best_params(best_params: dict) -> pd.DataFrame:
    if not best_params:
        return pd.DataFrame(columns=["파라미터", "값"])
    return pd.DataFrame(
        [{"파라미터": label_parameter(key), "값": value} for key, value in best_params.items()]
    )


def format_optimization_results(all_optimization_results: list[dict]) -> pd.DataFrame:
    rows = [{**item["params"], **item["metrics"]} for item in all_optimization_results]
    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    return df.rename(
        columns={
            column: label_parameter(column) if column in PARAMETER_LABELS else label_metric(column)
            for column in df.columns
        }
    )


def friendly_request_error(exc: requests.exceptions.RequestException, ticker: str) -> str:
    response = getattr(exc, "response", None)
    if response is None:
        return "백엔드 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요."

    detail = ""
    try:
        detail = str(response.json().get("detail", "")).strip()
    except Exception:
        detail = ""

    if response.status_code == 404:
        return f"'{ticker}' 종목을 찾지 못했습니다. 티커나 종목코드를 다시 확인하세요."
    if response.status_code == 400:
        return detail or "입력값이 올바르지 않습니다. 날짜와 파라미터를 다시 확인하세요."
    if response.status_code >= 500:
        return detail or "데이터를 불러오는 중 문제가 발생했습니다. 잠시 후 다시 시도하세요."
    return detail or "요청을 처리하지 못했습니다. 입력값을 다시 확인하세요."


def friendly_storage_error(exc: requests.exceptions.RequestException) -> str:
    response = getattr(exc, "response", None)
    if response is None:
        return "저장 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요."

    detail = ""
    try:
        detail = str(response.json().get("detail", "")).strip()
    except Exception:
        detail = ""

    if response.status_code == 401:
        return "저장 세션이 만료되어 다시 연결 중입니다. 한 번 더 시도하세요."
    if response.status_code == 404:
        return detail or "저장한 결과를 찾지 못했습니다."
    if response.status_code == 503 and "Supabase" in detail:
        return "백테스트 저장 기능은 Supabase 연결 후 사용할 수 있습니다."
    if response.status_code >= 500:
        return detail or "저장 기능을 잠시 사용할 수 없습니다."
    return detail or "저장 요청을 처리하지 못했습니다."


def default_saved_name(display_payload: dict) -> str:
    context = display_payload.get("context", {})
    base_name = (
        display_payload.get("results", {}).get("company_name")
        or context.get("resolved_ticker")
        or context.get("ticker")
        or "백테스트"
    )
    return f"{base_name} {context.get('strategy', '')} {context.get('mode', '')}".strip()


def ensure_backtest_session(force_refresh: bool = False) -> str:
    if not force_refresh and st.session_state.get("backtest_session_token"):
        return st.session_state["backtest_session_token"]

    response = requests.post(f"{BACKEND_URL}/session/bootstrap", timeout=10)
    response.raise_for_status()
    payload = response.json()
    st.session_state["backtest_session_token"] = payload["session_token"]
    st.session_state["backtest_account_id"] = payload.get("account_id")
    return st.session_state["backtest_session_token"]


def session_api_request(
    method: str,
    path: str,
    *,
    params: dict | None = None,
    json_payload: dict | None = None,
) -> dict:
    for attempt in range(2):
        token = ensure_backtest_session(force_refresh=attempt == 1)
        response = requests.request(
            method,
            f"{BACKEND_URL}{path}",
            headers={"X-App-Session": token},
            params=params,
            json=json_payload,
            timeout=20,
        )
        if response.status_code == 401 and attempt == 0:
            st.session_state.pop("backtest_session_token", None)
            continue
        response.raise_for_status()
        if not response.content:
            return {}
        return response.json()
    return {}


def set_backtest_display(display_payload: dict) -> None:
    st.session_state["backtest_display"] = display_payload
    st.session_state["backtest_save_name"] = default_saved_name(display_payload)

    context = display_payload.get("context", {})
    results = display_payload.get("results", {})
    st.session_state["last_run_mode"] = context.get("mode")
    st.session_state["ticker_backtest"] = context.get("ticker")
    st.session_state["market_backtest"] = context.get("market")
    st.session_state["krx_exchange_backtest"] = context.get("krx_exchange")
    st.session_state["last_run_strategy"] = context.get("strategy")
    st.session_state["initial_capital"] = float(context.get("initial_capital") or 0)
    st.session_state["last_backtest_context"] = context
    if context.get("mode") == "일반 백테스트":
        st.session_state["backtest_results"] = results
    else:
        st.session_state["backtest_results"] = None


def build_display_payload(
    mode: str,
    strategy: str,
    metric_to_optimize: str | None,
    request_payload: dict,
    results: dict,
) -> dict:
    context = {
        "ticker": request_payload.get("ticker"),
        "market": request_payload.get("market"),
        "krx_exchange": request_payload.get("krx_exchange"),
        "resolved_ticker": results.get("resolved_ticker", request_payload.get("ticker")),
        "strategy": strategy,
        "mode": mode,
        "start_date": request_payload.get("start_date"),
        "end_date": request_payload.get("end_date"),
        "initial_capital": float(request_payload.get("initial_capital") or 0),
        "order_type": request_payload.get("order_type"),
        "fixed_amount": (
            float(request_payload["fixed_amount"])
            if request_payload.get("fixed_amount") is not None
            else None
        ),
        "executed_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    return {
        "mode": mode,
        "strategy": strategy,
        "metric_to_optimize": metric_to_optimize,
        "request_payload": request_payload,
        "results": results,
        "context": context,
        "saved_backtest": None,
    }


def build_display_payload_from_saved(saved_item: dict) -> dict:
    request_payload = saved_item.get("request_payload", {}) or {}
    result_payload = saved_item.get("result_payload", {}) or {}
    run_type = saved_item.get("run_type", "backtest")
    strategy_key = saved_item.get("strategy_key", "moving_average")
    metric_to_optimize = (
        saved_item.get("metric_to_optimize")
        or request_payload.get("metric_to_optimize")
        or result_payload.get("metric_optimized")
    )
    return {
        "mode": MODE_BY_RUN_TYPE.get(run_type, "일반 백테스트"),
        "strategy": STRATEGY_LABEL_BY_KEY.get(strategy_key, saved_item.get("strategy_name", "이동평균")),
        "metric_to_optimize": metric_to_optimize,
        "request_payload": request_payload,
        "results": result_payload,
        "context": {
            "ticker": saved_item.get("ticker"),
            "market": saved_item.get("market"),
            "krx_exchange": saved_item.get("krx_exchange"),
            "resolved_ticker": saved_item.get("resolved_ticker", saved_item.get("ticker")),
            "strategy": STRATEGY_LABEL_BY_KEY.get(strategy_key, saved_item.get("strategy_name", "이동평균")),
            "mode": MODE_BY_RUN_TYPE.get(run_type, "일반 백테스트"),
            "start_date": saved_item.get("start_date"),
            "end_date": saved_item.get("end_date"),
            "initial_capital": float(saved_item.get("initial_capital") or 0),
            "order_type": saved_item.get("order_type"),
            "fixed_amount": (
                float(saved_item["fixed_amount"])
                if saved_item.get("fixed_amount") is not None
                else None
            ),
            "executed_at": saved_item.get("created_at"),
        },
        "saved_backtest": {
            "id": saved_item.get("id"),
            "save_name": saved_item.get("save_name"),
            "created_at": saved_item.get("created_at"),
            "company_name": saved_item.get("company_name"),
        },
    }


def save_current_backtest(display_payload: dict, save_name: str) -> dict:
    context = display_payload["context"]
    results = display_payload["results"]
    return session_api_request(
        "POST",
        "/backtest/saved",
        json_payload={
            "save_name": save_name.strip() or None,
            "run_type": RUN_TYPE_BY_MODE[display_payload["mode"]],
            "strategy_key": STRATEGY_KEY_BY_LABEL[display_payload["strategy"]],
            "ticker": context["ticker"],
            "resolved_ticker": context.get("resolved_ticker"),
            "company_name": results.get("company_name"),
            "market": context["market"],
            "krx_exchange": context["krx_exchange"],
            "start_date": context["start_date"],
            "end_date": context["end_date"],
            "initial_capital": context["initial_capital"],
            "order_type": context["order_type"],
            "fixed_amount": context["fixed_amount"],
            "metric_to_optimize": display_payload.get("metric_to_optimize"),
            "request_payload": display_payload["request_payload"],
            "result_payload": results,
        },
    )


def refresh_saved_backtests() -> list[dict]:
    payload = session_api_request("GET", "/backtest/saved")
    items = payload.get("items", [])
    st.session_state["saved_backtests"] = items
    return items


def load_saved_backtest(saved_backtest_id: int) -> dict:
    payload = session_api_request("GET", f"/backtest/saved/{saved_backtest_id}")
    return payload.get("item", {})


def delete_saved_backtest(saved_backtest_id: int) -> None:
    session_api_request("DELETE", f"/backtest/saved/{saved_backtest_id}")


def build_saved_backtest_label(item: dict) -> str:
    performance_summary = item.get("performance_summary", {}) or {}
    metric_text = ""
    if item.get("run_type") == "optimization":
        metric_name = label_metric(performance_summary.get("metric_optimized") or "")
        metric_value = performance_summary.get("best_metric_value")
        if metric_name and metric_value is not None:
            metric_text = f" / 최적 {metric_name} {float(metric_value):.2f}"
    else:
        total_return = performance_summary.get("total_return_pct")
        if total_return is not None:
            metric_text = f" / 총수익률 {float(total_return):.2f}%"

    target = item.get("company_name") or item.get("resolved_ticker") or item.get("ticker")
    return (
        f"{item.get('save_name', '저장 결과')} | {target} | "
        f"{item.get('strategy_name', '')} | {item.get('created_at', '')}{metric_text}"
    )


def render_general_backtest_results(display_payload: dict) -> None:
    results = display_payload["results"]
    context = display_payload["context"]
    strategy = display_payload["strategy"]

    st.header(f"📊 '{strategy}' 전략 시뮬레이션 결과")
    st.caption(
        f"대상 시장: {market_display_name(results.get('market', context.get('market', 'us')))} | "
        f"입력 종목: {results.get('ticker', context.get('ticker', '-'))} | "
        f"실제 조회 심볼: {results.get('resolved_ticker', context.get('resolved_ticker', '-'))}"
    )

    metrics = results.get("performance_metrics", {})
    benchmark_metrics = results.get("benchmark_metrics", {})
    comparison_metrics = results.get("comparison_metrics", {})

    st.subheader("📈 주요 성과 지표")
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("총수익률", f"{metrics.get('total_return_pct', 0):.2f}%")
    col2.metric("샤프 지수", f"{metrics.get('sharpe_ratio', 0):.2f}")
    col3.metric("최대 낙폭", f"{metrics.get('max_drawdown_pct', 0):.2f}%")
    col4.metric(
        "최종 자산",
        format_market_amount(
            metrics.get("final_total_value", 0),
            results.get("market", context.get("market", "us")),
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
        portfolio_df["Date"] = pd.to_datetime(portfolio_df["Date"])
        plot_df = portfolio_df[["Date", "total_value"]].copy()
        plot_df["series"] = "전략"
        if not benchmark_df.empty:
            benchmark_df["Date"] = pd.to_datetime(benchmark_df["Date"])
            benchmark_plot_df = benchmark_df[["Date", "total_value"]].copy()
            benchmark_plot_df["series"] = "단순 보유"
            plot_df = pd.concat([plot_df, benchmark_plot_df], ignore_index=True)
        fig = px.line(plot_df, x="Date", y="total_value", color="series", title="나의 자산은 어떻게 변했을까?")
        st.plotly_chart(fig, use_container_width=True)

    st.subheader("📋 상세 거래 내역")
    with st.expander("시뮬레이션은 어떻게 작동하나요? (거래 기준)"):
        st.info(
            """
            - 전략은 각 날짜의 종가까지 포함한 데이터를 보고 `매수(1)` 또는 `매도(-1)` 신호를 만듭니다.
            - 실제 주문 체결가는 `신호가 나온 다음 거래일의 시가(Open)`로 가정합니다.
            - `전액 매수/매도`는 매수 신호가 나오면 남은 현금으로 최대한 사고, 매도 신호가 나오면 보유 수량을 전부 팝니다.
            - `고정 금액 분할 매수`는 매수 신호마다 지정한 금액 한도 안에서만 매수하고, 매도 신호가 나오면 역시 전량 매도합니다.
            - 수수료는 기본적으로 거래당 `0.1%`를 반영합니다.
            - 포트폴리오 가치는 매일 `현금 + 보유 주식의 당일 종가 기준 평가금액`으로 계산합니다.
            - 비교용 `단순 보유`는 시작일 첫 거래일 시가에 최대한 매수한 뒤 종료일까지 계속 보유하는 방식입니다.
            """
        )

    trades_df = pd.DataFrame(results.get("trades", []))
    if not trades_df.empty:
        trades_df["Date"] = pd.to_datetime(trades_df["Date"]).dt.strftime("%Y-%m-%d %H:%M:%S")
        st.dataframe(trades_df, use_container_width=True)


def render_optimization_results(display_payload: dict) -> None:
    results = display_payload["results"]
    strategy = display_payload["strategy"]
    metric_to_optimize = display_payload.get("metric_to_optimize") or "sharpe_ratio"

    st.header(f"✨ '{strategy}' 전략 최적화 결과")
    best_params = results.get("best_params", {})
    best_metric_value = results.get("best_metric_value", 0)
    metric_optimized = results.get("metric_optimized", "")
    metric_label = label_metric(metric_optimized or metric_to_optimize)

    st.subheader(f"🏆 최적 파라미터 (기준: {metric_label})")
    st.write(f"**최적 {metric_label}**: {float(best_metric_value):.2f}")
    best_params_df = format_best_params(best_params)
    if not best_params_df.empty:
        st.dataframe(best_params_df, use_container_width=True, hide_index=True)
    else:
        st.info("표시할 최적 파라미터가 없습니다.")

    st.subheader("🔍 모든 최적화 결과")
    all_optimization_results = results.get("all_optimization_results", [])
    if all_optimization_results:
        df_results = format_optimization_results(all_optimization_results)
        sort_column = label_metric(metric_to_optimize)
        if sort_column in df_results.columns:
            df_results = df_results.sort_values(by=sort_column, ascending=False)
        st.dataframe(df_results, use_container_width=True)
    else:
        st.info("최적화 결과가 없습니다.")


def render_saved_backtest_panel(display_payload: dict | None) -> None:
    if display_payload:
        st.subheader("💾 결과 저장")
        save_name = st.text_input(
            "저장 이름",
            key="backtest_save_name",
            help="같은 종목을 여러 버전으로 저장할 수 있도록 알아보기 쉬운 이름을 적어두면 편합니다.",
        )
        if st.button("현재 결과 저장", use_container_width=True):
            try:
                saved_item = save_current_backtest(display_payload, save_name)
                st.session_state["saved_backtest_message"] = (
                    f"'{saved_item['item'].get('save_name', save_name or '백테스트 결과')}' 결과를 저장했습니다."
                )
                refresh_saved_backtests()
            except requests.exceptions.RequestException as exc:
                st.error(friendly_storage_error(exc))

        if st.session_state.get("saved_backtest_message"):
            st.success(st.session_state["saved_backtest_message"])

    st.subheader("📚 저장한 결과 불러오기")
    if st.button("저장 목록 새로고침", use_container_width=True):
        try:
            refresh_saved_backtests()
        except requests.exceptions.RequestException as exc:
            st.error(friendly_storage_error(exc))

    saved_items = st.session_state.get("saved_backtests", [])
    if not saved_items:
        st.caption("아직 불러온 저장 목록이 없습니다. 저장한 뒤 새로고침하거나, 바로 저장 목록을 불러오세요.")
        return

    saved_options = {build_saved_backtest_label(item): item["id"] for item in saved_items}
    selected_label = st.selectbox("저장 목록", list(saved_options.keys()), key="saved_backtest_selection")
    selected_id = saved_options[selected_label]

    col1, col2 = st.columns(2)
    with col1:
        if st.button("선택 결과 불러오기", use_container_width=True):
            try:
                saved_item = load_saved_backtest(selected_id)
                set_backtest_display(build_display_payload_from_saved(saved_item))
                st.rerun()
            except requests.exceptions.RequestException as exc:
                st.error(friendly_storage_error(exc))
    with col2:
        if st.button("선택 결과 삭제", use_container_width=True):
            try:
                delete_saved_backtest(selected_id)
                refresh_saved_backtests()
                st.success("저장한 결과를 삭제했습니다.")
            except requests.exceptions.RequestException as exc:
                st.error(friendly_storage_error(exc))


def render_backtest_display() -> None:
    display_payload = st.session_state.get("backtest_display")
    if not display_payload:
        return

    saved_backtest = display_payload.get("saved_backtest")
    if saved_backtest:
        st.info(
            f"저장한 결과를 불러왔습니다: {saved_backtest.get('save_name', '백테스트 결과')} "
            f"({saved_backtest.get('created_at', '')})"
        )

    if display_payload["mode"] == "일반 백테스트":
        render_general_backtest_results(display_payload)
    else:
        render_optimization_results(display_payload)


st.set_page_config(layout="wide", page_title="투자 전략 시뮬레이션")
inject_google_analytics(os.getenv("GA_MEASUREMENT_ID") or os.getenv("GA_TAG_ID"), "backtesting")
inject_stage_banner_styles()

st.title("📈 투자 전략 시뮬레이션")
render_stage_banner("보조 검증", "과거 데이터로 검토", "지금 떠오른 종가베팅 아이디어가 과거에도 어느 정도 통했는지 백업 차원에서 확인합니다.")
st.write("종가베팅이나 단기 아이디어가 과거 데이터에서 어느 정도 통했는지 검증하는 **전략 검증 백업 시스템**입니다. 시장 해석이 아니라 전략 검증에 초점을 둡니다.")
st.info("이 메뉴는 지금 좋아 보이는 아이디어가 과거에도 비슷하게 통했는지 확인할 때 사용합니다. 처음이라면 먼저 '주요 섹터 흐름'과 'AI 시장 분석'을 본 뒤 넘어오는 편이 이해하기 쉽습니다.")

st.sidebar.header("백테스트 설정")

mode = st.sidebar.radio(
    "모드 선택",
    ["일반 백테스트", "전략 최적화"],
    key="backtest_mode",
    help="일반 백테스트는 단일 파라미터로 시뮬레이션하고, 전략 최적화는 여러 파라미터 조합 중 최적의 조합을 찾아줍니다.",
)
market = st.sidebar.radio(
    "시장",
    list(MARKET_OPTIONS.keys()),
    key="backtest_market",
    format_func=lambda x: MARKET_OPTIONS[x],
    horizontal=True,
)
if st.session_state.get("ticker_backtest_market") != market:
    st.session_state["ticker_backtest_input"] = default_ticker_for_market(market)
    st.session_state["ticker_backtest_market"] = market

krx_exchange = "auto"
selected_company = None
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
        key="backtest_krx_exchange",
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

    if selected_quick_pick != "직접 입력" and selected_company and krx_exchange == "auto":
        krx_exchange = selected_company["krx_exchange"]

ticker_backtest = st.sidebar.text_input(
    ticker_input_label(market),
    key="ticker_backtest_input",
    help=ticker_help_text(market),
)
start_date = st.sidebar.date_input("시작일", DEFAULT_START_DATE, key="backtest_start_date")
end_date = st.sidebar.date_input("종료일", DEFAULT_END_DATE, key="backtest_end_date")
initial_capital = st.sidebar.number_input(
    initial_capital_label(market),
    1000,
    1000000000,
    100000 if market == "us" else 1000000,
    key="backtest_initial_capital",
    format="%d",
    help="시뮬레이션을 시작할 가상의 투자 원금입니다.",
)
order_type = st.sidebar.radio(
    "주문 방식",
    ("all_in", "fixed_amount"),
    key="backtest_order_type",
    format_func=lambda x: "전액 매수/매도" if x == "all_in" else "고정 금액 분할 매수",
    help="매수 신호 발생 시 주문 방식을 선택합니다.",
)
fixed_amount = None
if order_type == "fixed_amount":
    fixed_amount = st.sidebar.number_input(
        fixed_amount_label(market),
        1,
        100000000,
        1000 if market == "us" else 100000,
        key="backtest_fixed_amount",
        format="%d",
    )

strategy = st.sidebar.selectbox("전략 선택", ["이동평균", "RSI", "볼린저 밴드"], key="backtest_strategy")

metric_to_optimize = "sharpe_ratio"
if mode == "전략 최적화":
    metric_to_optimize = st.sidebar.selectbox(
        "최적화 기준 지표",
        ["sharpe_ratio", "total_return_pct"],
        key="backtest_metric_to_optimize",
        format_func=lambda x: "샤프 지수" if x == "sharpe_ratio" else "총수익률",
    )

st.sidebar.divider()

params = {}
endpoint = ""
optimize_endpoint = ""

if strategy == "이동평균":
    with st.sidebar.expander("이동평균 전략이란?"):
        st.info("단기 추세가 장기 추세를 뚫고 올라갈 때 사고, 내려갈 때 파는 전략입니다.")
    if mode == "일반 백테스트":
        params["short_window"] = st.sidebar.number_input("단기 평균 기간 (일)", 1, 200, 20, key="ma_short_window")
        params["long_window"] = st.sidebar.number_input("장기 평균 기간 (일)", 1, 200, 50, key="ma_long_window")
    else:
        st.sidebar.subheader("단기 평균 기간 범위")
        c1, c2, c3 = st.sidebar.columns(3)
        with c1:
            params["short_window_range_start"] = st.number_input("시작", 1, 200, 10, key="ma_s_start")
        with c2:
            params["short_window_range_end"] = st.number_input("끝", 1, 200, 30, key="ma_s_end")
        with c3:
            params["short_window_range_step"] = st.number_input("간격", 1, 20, 5, key="ma_s_step")
        st.sidebar.subheader("장기 평균 기간 범위")
        c4, c5, c6 = st.sidebar.columns(3)
        with c4:
            params["long_window_range_start"] = st.number_input("시작", 1, 200, 40, key="ma_l_start")
        with c5:
            params["long_window_range_end"] = st.number_input("끝", 1, 200, 60, key="ma_l_end")
        with c6:
            params["long_window_range_step"] = st.number_input("간격", 1, 20, 5, key="ma_l_step")
    endpoint = "/backtest/moving_average"
    optimize_endpoint = "/optimize/moving_average"

elif strategy == "RSI":
    with st.sidebar.expander("RSI 전략이란?"):
        st.info("주가가 과도하게 싸졌을 때 사고, 과도하게 비싸졌을 때 파는 전략입니다.")
    if mode == "일반 백테스트":
        params["window"] = st.sidebar.number_input("RSI 계산 기간 (일)", 1, 200, 14, key="rsi_window")
        params["oversold_threshold"] = st.sidebar.slider("과매도 기준선", 0, 100, 30, key="rsi_oversold")
        params["overbought_threshold"] = st.sidebar.slider("과매수 기준선", 0, 100, 70, key="rsi_overbought")
    else:
        st.sidebar.subheader("RSI 계산 기간 범위")
        c1, c2, c3 = st.sidebar.columns(3)
        with c1:
            params["window_range_start"] = st.number_input("시작", 1, 200, 10, key="rsi_w_start")
        with c2:
            params["window_range_end"] = st.number_input("끝", 1, 200, 20, key="rsi_w_end")
        with c3:
            params["window_range_step"] = st.number_input("간격", 1, 20, 2, key="rsi_w_step")
        st.sidebar.subheader("과매도 기준선 범위")
        c4, c5, c6 = st.sidebar.columns(3)
        with c4:
            params["oversold_threshold_range_start"] = st.number_input("시작", 0, 100, 20, key="rsi_os_start")
        with c5:
            params["oversold_threshold_range_end"] = st.number_input("끝", 0, 100, 40, key="rsi_os_end")
        with c6:
            params["oversold_threshold_range_step"] = st.number_input("간격", 1, 20, 5, key="rsi_os_step")
        st.sidebar.subheader("과매수 기준선 범위")
        c7, c8, c9 = st.sidebar.columns(3)
        with c7:
            params["overbought_threshold_range_start"] = st.number_input("시작", 0, 100, 60, key="rsi_ob_start")
        with c8:
            params["overbought_threshold_range_end"] = st.number_input("끝", 0, 100, 80, key="rsi_ob_end")
        with c9:
            params["overbought_threshold_range_step"] = st.number_input("간격", 1, 20, 5, key="rsi_ob_step")
    endpoint = "/backtest/rsi"
    optimize_endpoint = "/optimize/rsi"

else:
    with st.sidebar.expander("볼린저 밴드 전략이란?"):
        st.info("주가가 통계적으로 비정상적인 가격대에 도달했을 때, 다시 정상으로 돌아올 것을 기대하며 반대로 투자하는 전략입니다.")
    if mode == "일반 백테스트":
        params["window"] = st.sidebar.number_input("밴드 계산 기간 (일)", 1, 200, 20, key="bb_window")
        params["num_std_dev"] = st.sidebar.number_input(
            "밴드 넓이 (표준편차 배수)",
            1.0,
            5.0,
            2.0,
            step=0.1,
            key="bb_num_std_dev",
        )
    else:
        st.sidebar.subheader("밴드 계산 기간 범위")
        c1, c2, c3 = st.sidebar.columns(3)
        with c1:
            params["window_range_start"] = st.number_input("시작", 1, 200, 15, key="bb_w_start")
        with c2:
            params["window_range_end"] = st.number_input("끝", 1, 200, 25, key="bb_w_end")
        with c3:
            params["window_range_step"] = st.number_input("간격", 1, 20, 5, key="bb_w_step")
        st.sidebar.subheader("밴드 넓이 (표준편차 배수) 범위")
        c4, c5, c6 = st.sidebar.columns(3)
        with c4:
            params["num_std_dev_range_start"] = st.number_input("시작", 0.5, 5.0, 1.5, step=0.1, key="bb_std_start")
        with c5:
            params["num_std_dev_range_end"] = st.number_input("끝", 0.5, 5.0, 2.5, step=0.1, key="bb_std_end")
        with c6:
            params["num_std_dev_range_step"] = st.number_input("간격", 0.1, 1.0, 0.5, step=0.1, key="bb_std_step")
    endpoint = "/backtest/bollinger_bands"
    optimize_endpoint = "/optimize/bollinger_bands"

if st.sidebar.button("실행", use_container_width=True):
    common_payload = {
        "ticker": ticker_backtest,
        "market": market,
        "krx_exchange": krx_exchange,
        "start_date": start_date.strftime("%Y-%m-%d"),
        "end_date": end_date.strftime("%Y-%m-%d"),
        "initial_capital": float(initial_capital),
        "order_type": order_type,
        "fixed_amount": float(fixed_amount) if fixed_amount is not None else None,
    }

    if mode == "일반 백테스트":
        request_payload = {**common_payload, **params}
        url = f"{BACKEND_URL}{endpoint}"
        spinner_message = "과거 데이터를 기반으로 시뮬레이션을 실행 중입니다..."
        metric_choice = None
    else:
        request_payload = {**common_payload, "metric_to_optimize": metric_to_optimize}
        for key in list(params):
            if "_range_start" in key:
                base_key = key.replace("_range_start", "")
                request_payload[f"{base_key}_range"] = [
                    params[f"{base_key}_range_start"],
                    params[f"{base_key}_range_end"],
                    params[f"{base_key}_range_step"],
                ]
        url = f"{BACKEND_URL}{optimize_endpoint}"
        spinner_message = "모든 파라미터 조합에 대해 최적의 전략을 찾는 중입니다..."
        metric_choice = metric_to_optimize

    with st.spinner(spinner_message):
        try:
            response = requests.post(url, json=request_payload, timeout=60)
            response.raise_for_status()
            results = response.json()
            set_backtest_display(build_display_payload(mode, strategy, metric_choice, request_payload, results))
        except requests.exceptions.RequestException as exc:
            st.error(friendly_request_error(exc, ticker_backtest))
        except Exception as exc:
            st.error(f"오류가 발생했습니다: {exc}")

render_backtest_display()
render_saved_backtest_panel(st.session_state.get("backtest_display"))
