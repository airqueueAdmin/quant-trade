import math

import os
import pandas as pd
import streamlit as st
from fx_utils import get_usdkrw_rate, format_currency_pair
from ga import inject_google_analytics
from market_utils import format_market_amount, market_display_name

FX_RATE = get_usdkrw_rate()
DEFAULT_PLAN_RULES = {
    "caution_sharpe_min": 0.8,
    "caution_max_drawdown_pct": 20.0,
    "caution_volatility_pct": 30.0,
    "ready_sharpe_min": 1.2,
    "ready_sortino_min": 1.5,
    "ready_max_drawdown_pct": 12.0,
    "ready_volatility_pct": 20.0,
}

st.set_page_config(layout="wide", page_title="실전 매매 가이드")
inject_google_analytics(os.getenv("GA_MEASUREMENT_ID") or os.getenv("GA_TAG_ID"), "trade_guide")

st.title("🧭 실전 매매 가이드")
st.warning("이 메뉴는 현재 잠시 비활성화되어 있습니다.")
st.info("서비스가 종가베팅 중심으로 재정렬되면서, 이 메뉴는 현재 흐름과 맞지 않아 잠시 막아둔 상태입니다. 사이드바에는 남아 있지만 지금은 선택해도 내용을 제공하지 않습니다.")
st.stop()

if FX_RATE:
    st.caption(f"환율 기준: 1 USD = {FX_RATE['rate']:,.2f} KRW")

st.markdown(
    """
    <style>
    .compact-metric-card {
        border: 1px solid rgba(120, 120, 120, 0.25);
        border-radius: 14px;
        padding: 0.9rem 1rem;
        background: rgba(255, 255, 255, 0.02);
        min-height: 110px;
    }
    .compact-metric-label {
        font-size: 0.9rem;
        color: inherit;
        opacity: 0.75;
        margin-bottom: 0.35rem;
    }
    .compact-metric-value {
        font-size: 1.15rem;
        line-height: 1.35;
        font-weight: 700;
        word-break: break-word;
        color: inherit;
    }
    </style>
    """,
    unsafe_allow_html=True,
)


def render_compact_metric(label: str, value: str, column) -> None:
    column.markdown(
        f"""
        <div class="compact-metric-card">
            <div class="compact-metric-label">{label}</div>
            <div class="compact-metric-value">{value}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def classify_position_plan(metrics, comparison_metrics, rules):
    excess_return = comparison_metrics.get("excess_return_pct", 0.0)
    sharpe_ratio = metrics.get("sharpe_ratio", 0.0)
    sortino_ratio = metrics.get("sortino_ratio", 0.0)
    max_drawdown_pct = abs(metrics.get("max_drawdown_pct", 0.0))
    annual_volatility_pct = metrics.get("annual_volatility_pct", 0.0)

    if (
        excess_return <= 0
        or sharpe_ratio < rules["caution_sharpe_min"]
        or max_drawdown_pct >= rules["caution_max_drawdown_pct"]
        or annual_volatility_pct >= rules["caution_volatility_pct"]
    ):
        return {
            "label": "대기",
            "single_order_pct": 3,
            "max_position_pct": 8,
            "split_count": 4,
            "review_loss_pct": 5,
            "reason": "최근 백테스트 기준으로 단순 보유보다 뚜렷하게 낫지 않거나, 흔들림이 큽니다.",
            "summary": "지금은 큰 진입보다 재검토가 먼저입니다.",
            "status": "caution",
        }

    if (
        excess_return > 0
        and sharpe_ratio >= rules["ready_sharpe_min"]
        and sortino_ratio >= rules["ready_sortino_min"]
        and max_drawdown_pct <= rules["ready_max_drawdown_pct"]
        and annual_volatility_pct <= rules["ready_volatility_pct"]
    ):
        return {
            "label": "소액 시작 가능",
            "single_order_pct": 7,
            "max_position_pct": 15,
            "split_count": 3,
            "review_loss_pct": 7,
            "reason": "최근 백테스트 기준으로 수익성과 흔들림의 균형이 비교적 안정적입니다.",
            "summary": "그래도 첫 주문은 작게 시작하는 구간입니다.",
            "status": "ready",
        }

    return {
        "label": "테스트 후 확대",
        "single_order_pct": 5,
        "max_position_pct": 10,
        "split_count": 3,
        "review_loss_pct": 6,
        "reason": "백테스트는 나쁘지 않지만 아직 바로 크게 들어갈 정도로 단순하지 않습니다.",
        "summary": "작게 시작하고 실제 체결과 손실 반응을 확인해야 합니다.",
        "status": "watch",
    }


def dollars_to_shares(amount, price, fee_rate):
    if amount <= 0 or price <= 0:
        return 0
    return math.floor(amount / (price * (1 + fee_rate)))


def market_money_unit(market: str) -> str:
    return "원" if market == "krx" else "달러"


def amount_label(label: str, market: str) -> str:
    return f"{label} ({market_money_unit(market)})"


def market_amount_input(
    label: str,
    market: str,
    *,
    us_value: float,
    krx_value: float,
    us_step: float,
    krx_step: float,
    min_value: float = 0.0,
    key: str | None = None,
):
    return st.number_input(
        amount_label(label, market),
        min_value=min_value,
        value=us_value if market == "us" else krx_value,
        step=us_step if market == "us" else krx_step,
        format="%.0f",
        key=key,
    )


def format_order_type(order_type, fixed_amount):
    if order_type == "fixed_amount" and fixed_amount:
        return f"고정 금액 분할 매수 (1회 {format_currency_pair(fixed_amount, FX_RATE['rate'] if FX_RATE else None)})"
    if order_type == "fixed_amount":
        return "고정 금액 분할 매수"
    return "전액 매수/매도"


def render_plan_status(plan):
    message = (
        f"현재 단계: {plan['label']}\n\n"
        f"{plan['summary']}\n\n"
        f"근거: {plan['reason']}"
    )
    if plan["status"] == "caution":
        st.error(message)
    elif plan["status"] == "ready":
        st.success(message)
    else:
        st.warning(message)


def render_step_cards(items):
    columns = st.columns(len(items))
    for column, item in zip(columns, items):
        column.markdown(
            f"""
            ### {item['step']}
            **{item['title']}**

            {item['body']}
            """
        )


def render_quick_start(backtest_results, backtest_context, backtest_market):
    st.subheader("오늘 바로 따라가는 주문 흐름")
    st.caption("처음 온 사람은 이 탭만 먼저 따라가면 됩니다. 아래 순서대로 입력하면 오늘 주문 크기와 다음 행동이 바로 정리됩니다.")

    render_step_cards(
        [
            {"step": "1", "title": "시장 고르기", "body": "미국주식인지 국내주식인지 먼저 정합니다."},
            {"step": "2", "title": "주문 예산 정하기", "body": "이번 1회 주문에 쓸 금액만 따로 잡습니다."},
            {"step": "3", "title": "주문 방식 고르기", "body": "급하지 않으면 지정가를 먼저 봅니다."},
            {"step": "4", "title": "최종 점검", "body": "손절 기준과 남는 현금을 확인한 뒤 주문합니다."},
        ]
    )

    quick_market = st.radio("이번에 주문할 시장", ["us", "krx"], format_func=market_display_name, horizontal=True, key="quick_market")
    quick_budget = market_amount_input(
        "이번 1회 주문 예산",
        quick_market,
        us_value=200.0,
        krx_value=200000.0,
        us_step=10.0,
        krx_step=10000.0,
        key="quick_budget",
    )
    quick_price = market_amount_input(
        "예상 매수가",
        quick_market,
        us_value=95.0,
        krx_value=70000.0,
        us_step=1.0,
        krx_step=100.0,
        min_value=1.0,
        key="quick_price",
    )
    quick_fee_pct = st.number_input(
        "예상 수수료 (%)",
        min_value=0.0,
        value=0.10,
        step=0.01,
        key="quick_fee_pct",
    )
    quick_order_style = st.radio(
        "주문 방식",
        ["limit", "market"],
        format_func=lambda x: "지정가" if x == "limit" else "시장가",
        horizontal=True,
        key="quick_order_style",
    )
    quick_split_count = st.select_slider("몇 번에 나눠서 살지", options=[1, 2, 3, 4, 5], value=3, key="quick_split_count")

    quick_fee_rate = quick_fee_pct / 100
    quick_shares = dollars_to_shares(quick_budget, quick_price, quick_fee_rate)
    quick_total = quick_shares * quick_price * (1 + quick_fee_rate)
    quick_cash_left = quick_budget - quick_total
    quick_split_budget = quick_budget / quick_split_count if quick_split_count else quick_budget
    quick_split_shares = dollars_to_shares(quick_split_budget, quick_price, quick_fee_rate)

    metric1, metric2, metric3, metric4 = st.columns(4)
    render_compact_metric("가능 수량", f"{quick_shares}주", metric1)
    render_compact_metric("예상 주문금액", format_market_amount(quick_total, quick_market, FX_RATE["rate"] if FX_RATE else None), metric2)
    render_compact_metric("남는 현금", format_market_amount(quick_cash_left, quick_market, FX_RATE["rate"] if FX_RATE else None), metric3)
    render_compact_metric("분할 1회 수량", f"{quick_split_shares}주", metric4)

    next_action_message = "오늘은 소액 지정가부터 검토하는 흐름이 무난합니다." if quick_order_style == "limit" else "시장가를 쓰려면 거래량과 호가 차이를 먼저 확인하세요."
    st.info(next_action_message)

    final_check_col, action_col = st.columns([1.2, 1])
    with final_check_col:
        st.subheader("주문 직전 체크")
        quick_checks = [
            "이번 주문 금액이 생활비/비상금과 분리되어 있다.",
            "왜 사는지 한 줄로 설명할 수 있다.",
            "손실 시 다시 볼 기준(-5% ~ -10% 등)을 정했다.",
            "한 번에 몰빵하지 않고 나눠서 살 계획이 있다.",
        ]
        checked_count = 0
        for index, item in enumerate(quick_checks):
            if st.checkbox(item, key=f"quick_check_{index}"):
                checked_count += 1
        st.caption(f"체크 완료: {checked_count}/{len(quick_checks)}")

    with action_col:
        st.subheader("오늘의 액션")
        if checked_count == len(quick_checks):
            st.success("주문 전 최소 기준은 통과했습니다.")
        else:
            st.warning("체크리스트를 모두 확인한 뒤 주문하는 편이 좋습니다.")

        st.markdown(
            f"""
            - 추천 주문 방식: **{"지정가" if quick_order_style == "limit" else "시장가"}**
            - 1회 예산: **{format_market_amount(quick_budget, quick_market, FX_RATE["rate"] if FX_RATE else None)}**
            - 분할 횟수: **{quick_split_count}회**
            - 1회 분할 예산: **{format_market_amount(quick_split_budget, quick_market, FX_RATE["rate"] if FX_RATE else None)}**
            """
        )

        if backtest_results and backtest_context.get("mode") == "일반 백테스트":
            st.caption(
                f"최근 백테스트 연결 가능: {market_display_name(backtest_market)} "
                f"{backtest_context.get('ticker', '-')}"
            )
            st.write("더 정교한 주문 한도는 아래 `백테스트 연동` 탭에서 계산할 수 있습니다.")
        else:
            st.write("아직 백테스트 결과가 없으면, 먼저 소액으로 시작하고 이후 백테스트 연동 탭을 사용하는 흐름이 좋습니다.")


def render_glossary():
    with st.expander("용어 설명"):
        st.markdown("""
        - **백테스트**: 과거 가격으로 전략을 돌려본 결과
        - **초과수익률**: 전략 수익률 - 단순 보유 수익률
        - **최대 낙폭**: 중간에 가장 크게 빠진 구간의 하락률
        - **연환산 변동성**: 수익률 흔들림을 1년 기준으로 환산한 값
        - **1회 주문 한도**: 첫 주문 또는 추가 주문 1번에 쓰는 상한 금액
        - **최대 보유 한도**: 한 종목에 최대로 묶어둘 총 금액
        - **재검토 손실 기준**: 손실이 이 수준에 오면 추가 매수보다 전략 점검을 먼저 해야 하는 기준
        """)


def render_plan_rule_table(rules):
    table = pd.DataFrame(
        [
            {
                "단계": "대기",
                "판정 기준": "아래 항목 중 하나라도 해당",
                "세부 기준": (
                    f"초과수익률 0% 이하, 샤프 {rules['caution_sharpe_min']:.2f} 미만, "
                    f"최대 낙폭 {rules['caution_max_drawdown_pct']:.1f}% 이상, "
                    f"연환산 변동성 {rules['caution_volatility_pct']:.1f}% 이상"
                ),
            },
            {
                "단계": "소액 시작 가능",
                "판정 기준": "아래 항목을 모두 만족",
                "세부 기준": (
                    "초과수익률 0% 초과, "
                    f"샤프 {rules['ready_sharpe_min']:.2f} 이상, "
                    f"소르티노 {rules['ready_sortino_min']:.2f} 이상, "
                    f"최대 낙폭 {rules['ready_max_drawdown_pct']:.1f}% 이하, "
                    f"연환산 변동성 {rules['ready_volatility_pct']:.1f}% 이하"
                ),
            },
            {
                "단계": "테스트 후 확대",
                "판정 기준": "위 두 단계 사이",
                "세부 기준": "완전히 나쁘지는 않지만 아직 큰 진입을 정당화할 정도로 단순하지 않은 상태",
            },
        ]
    )
    st.dataframe(table, use_container_width=True, hide_index=True)


def render_plan_rule_controls(default_rules):
    with st.expander("판정 기준 조정"):
        st.caption("이 탭에서만 임시로 적용됩니다. 값을 바꾸면 아래 단계와 주문 한도가 즉시 다시 계산됩니다.")
        c1, c2, c3 = st.columns(3)
        caution_sharpe_min = c1.number_input(
            "대기 기준 샤프 하한",
            min_value=0.0,
            max_value=5.0,
            value=float(default_rules["caution_sharpe_min"]),
            step=0.1,
            key="rule_caution_sharpe_min",
        )
        caution_max_drawdown_pct = c2.number_input(
            "대기 기준 최대 낙폭(%)",
            min_value=1.0,
            max_value=100.0,
            value=float(default_rules["caution_max_drawdown_pct"]),
            step=1.0,
            key="rule_caution_max_drawdown_pct",
        )
        caution_volatility_pct = c3.number_input(
            "대기 기준 변동성(%)",
            min_value=1.0,
            max_value=100.0,
            value=float(default_rules["caution_volatility_pct"]),
            step=1.0,
            key="rule_caution_volatility_pct",
        )

        c4, c5, c6, c7 = st.columns(4)
        ready_sharpe_min = c4.number_input(
            "시작 기준 샤프 하한",
            min_value=0.0,
            max_value=5.0,
            value=float(default_rules["ready_sharpe_min"]),
            step=0.1,
            key="rule_ready_sharpe_min",
        )
        ready_sortino_min = c5.number_input(
            "시작 기준 소르티노 하한",
            min_value=0.0,
            max_value=10.0,
            value=float(default_rules["ready_sortino_min"]),
            step=0.1,
            key="rule_ready_sortino_min",
        )
        ready_max_drawdown_pct = c6.number_input(
            "시작 기준 최대 낙폭(%)",
            min_value=1.0,
            max_value=100.0,
            value=float(default_rules["ready_max_drawdown_pct"]),
            step=1.0,
            key="rule_ready_max_drawdown_pct",
        )
        ready_volatility_pct = c7.number_input(
            "시작 기준 변동성(%)",
            min_value=1.0,
            max_value=100.0,
            value=float(default_rules["ready_volatility_pct"]),
            step=1.0,
            key="rule_ready_volatility_pct",
        )

        rules = {
            "caution_sharpe_min": caution_sharpe_min,
            "caution_max_drawdown_pct": caution_max_drawdown_pct,
            "caution_volatility_pct": caution_volatility_pct,
            "ready_sharpe_min": ready_sharpe_min,
            "ready_sortino_min": ready_sortino_min,
            "ready_max_drawdown_pct": ready_max_drawdown_pct,
            "ready_volatility_pct": ready_volatility_pct,
        }

        if rules["ready_sharpe_min"] < rules["caution_sharpe_min"]:
            st.warning("`소액 시작 가능`의 샤프 기준은 `대기` 기준보다 같거나 높게 두는 편이 자연스럽습니다.")
        if rules["ready_max_drawdown_pct"] > rules["caution_max_drawdown_pct"]:
            st.warning("`소액 시작 가능`의 최대 낙폭 기준은 `대기` 기준보다 같거나 낮게 두는 편이 자연스럽습니다.")
        if rules["ready_volatility_pct"] > rules["caution_volatility_pct"]:
            st.warning("`소액 시작 가능`의 변동성 기준은 `대기` 기준보다 같거나 낮게 두는 편이 자연스럽습니다.")

        return rules

st.title("🧭 초보자를 위한 실전 매매 가이드")
st.caption("이 페이지는 교육용 안내입니다. 특정 종목 매수 추천이 아니라, 실제 주문 전에 확인해야 할 절차와 판단 기준을 정리한 것입니다.")
st.info("""
권장 사용 순서:
1. `0. 빠른 시작`에서 오늘 주문 흐름을 먼저 정리
2. `4. 금액 계산`에서 수량과 예산 확인
3. 백테스트를 돌렸다면 `7. 백테스트 연동`에서 주문 한도 다시 점검
""")

st.warning("""
초보자 원칙:
- 처음에는 `현금계좌`만 사용하세요.
- `레버리지`, `신용거래`, `공매도`, `옵션`, `선물`, `코인 선물`은 이 페이지의 대상이 아닙니다.
- 한 번에 큰 금액을 넣기보다, 이해 가능한 금액으로 작게 시작하세요.
""")

backtest_results = st.session_state.get("backtest_results")
last_run_mode = st.session_state.get("last_run_mode")
backtest_context = st.session_state.get("last_backtest_context", {})
ticker = st.session_state.get("ticker_backtest")
strategy = st.session_state.get("last_run_strategy")
backtest_market = backtest_context.get("market", st.session_state.get("market_backtest", "us"))

tab0, tab1, tab2, tab3, tab4, tab5, tab6, tab7 = st.tabs([
    "0. 빠른 시작",
    "1. 준비",
    "2. 종목 확인",
    "3. 주문 방식",
    "4. 금액 계산",
    "5. 백테스트 읽기",
    "6. 실수 방지",
    "7. 백테스트 연동",
])

with tab0:
    render_quick_start(backtest_results, backtest_context, backtest_market)

with tab1:
    st.subheader("매수 전에 먼저 정해야 할 5가지")
    st.markdown("""
    1. **왜 사는가**
       배당, 장기 성장, 단기 반등, 퀀트 전략 추종 중 하나로 이유를 한 줄로 적어두세요.
    2. **얼마를 넣을 것인가**
       생활비, 비상금, 카드값과 분리된 돈만 사용하세요.
    3. **언제까지 볼 것인가**
       하루, 몇 주, 1년 이상처럼 보유 기간 가정을 먼저 정해야 합니다.
    4. **얼마 손실 나면 멈출 것인가**
       예: -7%, -10%, 또는 전략 훼손 시 전량 정리.
    5. **한 종목에 얼마까지 넣을 것인가**
       초보자는 보통 전체 투자금의 10~20% 이내부터 시작하는 편이 안전합니다.
    """)

    st.info("""
    주문을 넣기 전에 최소한 아래 정보는 알고 있어야 합니다.
    - 회사가 무엇을 파는지
    - 최근 실적 또는 성장 스토리
    - 너무 비싼 가격에 추격 매수하는 건 아닌지
    - 이번 매수가 실패했을 때 어디서 인정하고 나올지
    """)

with tab2:
    st.subheader("초보자가 종목을 고를 때 보는 순서")
    st.markdown("""
    1. **이해 가능한 종목만 고르기**
       내가 무슨 사업인지 설명 못 하는 종목은 일단 보류.
    2. **거래량이 너무 적은 종목 피하기**
       거래가 적으면 주문이 불리한 가격에 체결되기 쉽습니다.
    3. **실적/뉴스/차트 3가지를 같이 보기**
       뉴스만 보고 사지 말고, 가격 흐름과 실적도 같이 봐야 합니다.
    4. **한 번에 1개 이유로만 사지 않기**
       "유명해서", "유튜브에서 봐서", "오늘 급등해서"는 매수 이유로 약합니다.
    """)

    st.subheader("이 앱을 종목 선별에 쓰는 법")
    st.markdown("""
    - **투자 전략 시뮬레이션**: 과거에 전략이 어떤 성과를 냈는지 확인
    - **AI 시장 분석**: 최근 뉴스 분위기가 과열인지 냉각인지 확인
    - **매매 가이드**: 실제 주문 전에 금액, 주문 방식, 리스크 점검
    """)

    st.error("""
    초보자에게 특히 위험한 경우:
    - 실적 발표 직전인데 이유 없이 들어가는 경우
    - 하루에 10% 이상 급등한 종목을 FOMO로 따라가는 경우
    - 손절 기준 없이 "언젠가 오르겠지"로 버티는 경우
    """)

with tab3:
    st.subheader("실제 주문은 이렇게 넣습니다")
    st.markdown("""
    1. **티커 확인**
       예: `AAPL`, `MSFT`, `005930`, `000660`. 비슷한 티커/종목코드 오입력 주의.
    2. **수량 또는 금액 확인**
       몇 주를 살지, 얼마만큼만 살지 먼저 정합니다.
    3. **주문 방식 선택**
       초보자는 보통 `지정가`를 먼저 검토하는 편이 좋습니다.
    4. **장중인지 확인**
       프리마켓/애프터마켓은 가격 변동이 더 거칠 수 있습니다.
    5. **수수료와 환전 여부 확인**
       해외주식이면 환율과 환전 수수료도 봐야 합니다.
    6. **최종 확인 후 주문**
       종목, 가격, 수량, 총액, 계좌 유형을 다시 확인합니다.
    """)

    col1, col2 = st.columns(2)
    with col1:
        st.subheader("시장가 주문")
        st.write("""
        - 장점: 보통 바로 체결됩니다.
        - 단점: 내가 본 가격과 실제 체결 가격이 달라질 수 있습니다.
        - 적합: 거래량이 충분하고, 체결 속도가 가격보다 더 중요할 때.
        """)
    with col2:
        st.subheader("지정가 주문")
        st.write("""
        - 장점: 내가 정한 가격 이하로만 매수하게 설정할 수 있습니다.
        - 단점: 가격이 안 오면 체결이 안 될 수 있습니다.
        - 적합: 초보자가 가격 통제를 하고 싶을 때.
        """)

    st.info("""
    초보자 추천:
    - 급하지 않으면 `지정가`
    - 호가 차이가 작고 거래량이 많을 때만 `시장가` 고려
    - `스탑 주문`은 작동 원리를 충분히 이해한 뒤 사용
    """)

    st.subheader("첫 매수 예시")
    st.markdown("""
    예시:
    - 투자 가능 금액: 1,000달러
    - 한 종목 최대 비중: 20%
    - 이번 1회 주문 한도: 200달러
    - 현재 주가: 95달러
    - 주문 방식: 94달러 지정가 2주

    이렇게 하면 한 번의 실수로 전체 자금이 크게 흔들리는 걸 막을 수 있습니다.
    """)

with tab4:
    st.subheader("매수 가능 수량 계산기")
    calculator_market = st.radio("계산할 시장", ["us", "krx"], format_func=market_display_name, horizontal=True)
    budget = market_amount_input(
        "이번 주문에 쓸 금액",
        calculator_market,
        us_value=200.0,
        krx_value=200000.0,
        us_step=10.0,
        krx_step=10000.0,
    )
    price = market_amount_input(
        "현재 또는 지정가",
        calculator_market,
        us_value=95.0,
        krx_value=70000.0,
        us_step=1.0,
        krx_step=100.0,
        min_value=1.0,
    )
    fee_pct = st.number_input("수수료 비율 (%)", min_value=0.0, value=0.10, step=0.01)

    fee_rate = fee_pct / 100
    max_shares = math.floor(budget / (price * (1 + fee_rate))) if price > 0 else 0
    estimated_total = max_shares * price * (1 + fee_rate)
    estimated_cash_left = budget - estimated_total

    c1, c2, c3 = st.columns(3)
    render_compact_metric("매수 가능 수량", f"{max_shares}주", c1)
    render_compact_metric("예상 총 주문금액", format_market_amount(estimated_total, calculator_market, FX_RATE["rate"] if FX_RATE else None), c2)
    render_compact_metric("남는 현금", format_market_amount(estimated_cash_left, calculator_market, FX_RATE["rate"] if FX_RATE else None), c3)

    st.subheader("분할매수 기준 예시")
    total_budget = market_amount_input(
        "전체 투자 예정 금액",
        calculator_market,
        us_value=1000.0,
        krx_value=1000000.0,
        us_step=50.0,
        krx_step=50000.0,
    )
    split_count = st.selectbox("몇 번에 나눌지", [2, 3, 4, 5], index=1)
    per_order = total_budget / split_count if split_count else 0
    st.write(f"한 번당 약 `{format_market_amount(per_order, calculator_market, FX_RATE['rate'] if FX_RATE else None)}`씩 나눠서 매수하는 방식으로 사용할 수 있습니다.")

    st.caption("분할매수는 손실을 막아주지는 않지만, 한 번에 진입하는 부담을 줄이는 데 도움이 됩니다.")

with tab5:
    st.subheader("백테스트 결과를 실전에서 읽는 법")
    st.markdown("""
    - **총수익률**: 많이 벌었는지 보여주지만 이것만 보면 안 됩니다.
    - **최대 낙폭(MDD)**: 중간에 얼마나 크게 깨질 수 있는지 보여줍니다.
    - **샤프 / 소르티노**: 수익을 얼마나 덜 흔들리게 냈는지 봅니다.
    - **승률**: 높다고 무조건 좋은 전략은 아닙니다. 손실 1번이 너무 크면 승률이 높아도 나쁠 수 있습니다.
    - **프로핏 팩터**: 이익 총합이 손실 총합보다 얼마나 큰지 보여줍니다.
    - **단순 보유 비교**: 전략이 그냥 들고 있었을 때보다 나은지 판단하는 기준입니다.
    """)

    st.success("""
    초보자 해석 기준 예시:
    - 총수익률이 높아도 MDD가 너무 크면 실전에 버티기 어렵습니다.
    - 단순 보유보다 못한데 거래만 많다면 전략을 다시 봐야 합니다.
    - 승률보다 손익비와 MDD를 더 중요하게 보세요.
    """)

    st.subheader("실전 연결 체크")
    st.markdown("""
    백테스트 결과가 좋아도 바로 실전 풀사이즈로 들어가면 안 됩니다.
    1. 소액으로 먼저 2~4주 관찰
    2. 실제 체결 가격과 앱 가정 차이 확인
    3. 수수료, 환율, 슬리피지 반영
    4. 내가 손절 규칙을 실제로 지킬 수 있는지 확인
    """)

with tab6:
    st.subheader("초보자가 가장 많이 하는 실수")
    st.markdown("""
    - **한 번에 몰빵**
      좋은 종목이어도 진입 타이밍이 나쁘면 계좌가 크게 흔들립니다.
    - **손절 기준 없음**
      '버티면 오르겠지'는 전략이 아니라 희망입니다.
    - **뉴스만 보고 진입**
      실적, 가격, 거래량을 같이 보지 않으면 판단이 한쪽으로 치우칩니다.
    - **수익 났을 때는 너무 빨리 팔고, 손실 났을 때는 너무 오래 버팀**
      감정 매매의 전형입니다.
    - **너무 자주 매매**
      수수료, 세금, 실수 확률이 모두 올라갑니다.
    """)

    st.subheader("주문 전 최종 체크리스트")
    checklist = [
        "이 종목을 왜 사는지 한 줄로 설명할 수 있다.",
        "이번 주문 금액이 전체 자산에서 감당 가능한 수준이다.",
        "시장가/지정가 차이를 알고 있다.",
        "손절 또는 재검토 기준을 정했다.",
        "이번 매수 후에도 현금이 남는다.",
        "뉴스만 보고 충동적으로 들어가는 상황이 아니다.",
    ]
    for item in checklist:
        st.checkbox(item, value=False)

    st.info("""
    마지막 원칙:
    - 이해 안 되는 종목은 사지 않기
    - 큰돈 넣기 전에 작은돈으로 검증하기
    - 앱 결과는 참고자료이지 보장 수익이 아님을 항상 기억하기
    """)

with tab7:
    st.subheader("백테스트 연동 주문 가이드")
    st.caption("최근 `일반 백테스트` 결과를 읽어 주문 한도와 진입 강도를 계산합니다. 자동매매가 아니라, 실전 주문 크기를 제한하는 가드레일입니다.")

    if not backtest_results or last_run_mode != "일반 백테스트":
        st.info("""
        아직 읽을 백테스트 결과가 없습니다.

        사용 순서:
        1. `투자 전략 시뮬레이션` 메뉴로 이동
        2. `일반 백테스트` 실행
        3. 다시 이 탭으로 돌아오기
        """)
    else:
        metrics = backtest_results.get("performance_metrics", {})
        benchmark_metrics = backtest_results.get("benchmark_metrics", {})
        comparison_metrics = backtest_results.get("comparison_metrics", {})
        render_glossary()
        st.subheader("판정 기준")
        plan_rules = render_plan_rule_controls(DEFAULT_PLAN_RULES)
        render_plan_rule_table(plan_rules)
        plan = classify_position_plan(metrics, comparison_metrics, plan_rules)

        st.subheader("지금 읽는 백테스트")
        info1, info2, info3 = st.columns(3)
        info1.metric("종목", ticker or "-")
        info2.metric("전략", strategy or "-")
        info3.metric("실행 모드", backtest_context.get("mode", last_run_mode))
        st.caption(f"시장: {market_display_name(backtest_market)} | 조회 심볼: {backtest_context.get('resolved_ticker', ticker or '-')}")

        st.caption(
            f"기간: {backtest_context.get('start_date', '-')} ~ {backtest_context.get('end_date', '-')} | "
            f"주문 방식: {format_order_type(backtest_context.get('order_type'), backtest_context.get('fixed_amount'))} | "
            f"실행 시각: {backtest_context.get('executed_at', '알 수 없음')}"
        )

        st.subheader("현재 단계")
        render_plan_status(plan)

        st.subheader("이번 판단에 사용한 숫자")
        stat1, stat2, stat3, stat4 = st.columns(4)
        stat1.metric("전략 수익률", f"{metrics.get('total_return_pct', 0):.2f}%")
        stat2.metric("단순 보유 수익률", f"{benchmark_metrics.get('total_return_pct', 0):.2f}%")
        stat3.metric("초과수익률", f"{comparison_metrics.get('excess_return_pct', 0):.2f}%")
        stat4.metric("최대 낙폭", f"{metrics.get('max_drawdown_pct', 0):.2f}%")

        stat5, stat6, stat7, stat8 = st.columns(4)
        stat5.metric("샤프 지수", f"{metrics.get('sharpe_ratio', 0):.2f}")
        stat6.metric("소르티노 지수", f"{metrics.get('sortino_ratio', 0):.2f}")
        stat7.metric("연환산 변동성", f"{metrics.get('annual_volatility_pct', 0):.2f}%")
        stat8.metric("총 거래 횟수", f"{metrics.get('total_trades', 0)}회")

        st.subheader("주문 한도 계산")
        guide_capital = market_amount_input(
            "이 전략에 배정할 총 자금",
            backtest_market,
            us_value=float(st.session_state.get("initial_capital", 1000.0)),
            krx_value=float(st.session_state.get("initial_capital", 1000000.0)),
            us_step=100.0,
            krx_step=100000.0,
            key="guide_capital",
        )
        guide_price = market_amount_input(
            "예상 매수가 (현재가 또는 지정가)",
            backtest_market,
            us_value=95.0,
            krx_value=70000.0,
            us_step=1.0,
            krx_step=100.0,
            min_value=1.0,
            key="guide_price",
        )
        guide_fee_pct = st.number_input(
            "예상 수수료 (%)",
            min_value=0.0,
            value=0.10,
            step=0.01,
            key="guide_fee_pct",
        )

        fee_rate = guide_fee_pct / 100
        single_order_amount = guide_capital * (plan["single_order_pct"] / 100)
        max_position_amount = guide_capital * (plan["max_position_pct"] / 100)
        split_order_amount = max_position_amount / plan["split_count"] if plan["split_count"] else 0

        single_order_shares = dollars_to_shares(single_order_amount, guide_price, fee_rate)
        split_order_shares = dollars_to_shares(split_order_amount, guide_price, fee_rate)
        max_position_shares = dollars_to_shares(max_position_amount, guide_price, fee_rate)

        col1, col2, col3 = st.columns(3)
        col1.metric("1회 주문 한도", format_market_amount(single_order_amount, backtest_market, FX_RATE["rate"] if FX_RATE else None))
        col2.metric("최대 보유 한도", format_market_amount(max_position_amount, backtest_market, FX_RATE["rate"] if FX_RATE else None))
        col3.metric("분할 횟수", f"{plan['split_count']}회")

        col4, col5, col6 = st.columns(3)
        col4.metric("1회 주문 수량", f"{single_order_shares}주")
        col5.metric("분할 1회 수량", f"{split_order_shares}주")
        col6.metric("최대 보유 수량", f"{max_position_shares}주")

        st.subheader("이 숫자를 어떻게 쓰는가")
        st.markdown(f"""
        1. 첫 주문은 **1회 주문 한도** 안에서만 넣습니다.
        2. 잘 맞아도 한 종목 총 보유 금액은 **최대 보유 한도**를 넘기지 않습니다.
        3. 추가 진입이 필요하면 한 번에 몰아서 사지 말고 **{plan['split_count']}회 이상**으로 나눕니다.
        4. 매수 뒤 손실이 **-{plan['review_loss_pct']}%** 근처로 가면 추가 매수보다 전략 점검을 먼저 합니다.
        """)

        st.subheader("간단 해석")
        if comparison_metrics.get("excess_return_pct", 0) <= 0:
            st.write("""
            이 백테스트만 보면 전략이 단순 보유보다 낫다고 보기 어렵습니다.
            지금 필요한 건 주문 확대가 아니라 기간을 늘려 다시 돌려보거나, 전략 조건을 다시 점검하는 일입니다.
            """)
        else:
            st.write("""
            단순 보유보다 나은 결과가 나왔더라도 바로 큰 금액을 넣을 근거는 아닙니다.
            다만 작은 금액으로 시작해서 실제 체결, 수수료, 심리적 부담까지 확인해볼 근거는 됩니다.
            """)

        st.info("""
        이 탭은 `최근 일반 백테스트 결과`를 읽어 주문 크기를 거칠게 제한해주는 보조 도구입니다.
        예측기가 아니라 가드레일이므로, 결과가 좋아 보여도 첫 주문은 작게 시작하는 쪽이 맞습니다.
        """)
