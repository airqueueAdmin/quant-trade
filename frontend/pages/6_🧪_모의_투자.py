import os

import pandas as pd
import requests
import streamlit as st

from ga import inject_google_analytics
from market_utils import get_common_krx_companies, search_krx_companies

BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")
DEFAULT_ACCOUNT_ID = "paper-demo"

st.set_page_config(layout="wide", page_title="모의 투자")
inject_google_analytics(os.getenv("GA_MEASUREMENT_ID") or os.getenv("GA_TAG_ID"), "paper_trading")

st.markdown(
    """
    <style>
    .paper-card {
        border: 1px solid rgba(120, 120, 120, 0.25);
        border-radius: 14px;
        padding: 0.95rem 1rem;
        background: rgba(255, 255, 255, 0.02);
        min-height: 110px;
    }
    .paper-card-label {
        font-size: 0.92rem;
        color: inherit;
        opacity: 0.74;
        margin-bottom: 0.3rem;
    }
    .paper-card-value {
        font-size: 1.18rem;
        font-weight: 700;
        color: inherit;
        line-height: 1.35;
    }
    </style>
    """,
    unsafe_allow_html=True,
)


def format_krw(amount: float) -> str:
    return f"{float(amount):,.0f}원"


def format_pct(value: float) -> str:
    return f"{value:+.2f}%"


def format_date(value: str | None) -> str:
    if not value:
        return "-"
    return str(value).split("T", 1)[0]


def render_card(column, label: str, value: str) -> None:
    column.markdown(
        f"""
        <div class="paper-card">
            <div class="paper-card-label">{label}</div>
            <div class="paper-card-value">{value}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


@st.cache_data(ttl=10, show_spinner=False)
def get_paper_state(account_id: str) -> dict:
    response = requests.get(
        f"{BACKEND_URL}/paper-trading/state",
        params={"account_id": account_id},
        timeout=20,
    )
    response.raise_for_status()
    return response.json()


@st.cache_data(ttl=300, show_spinner=False)
def get_quote(ticker: str, krx_exchange: str = "auto") -> dict:
    response = requests.get(
        f"{BACKEND_URL}/quote/{ticker}",
        params={"market": "krx", "krx_exchange": krx_exchange},
        timeout=20,
    )
    response.raise_for_status()
    return response.json()


def get_selected_quote(ticker: str, krx_exchange: str) -> dict | None:
    if not ticker:
        return None
    try:
        return get_quote(ticker, krx_exchange=krx_exchange)
    except requests.exceptions.RequestException as exc:
        st.error(f"현재가를 불러오지 못했습니다: {exc}")
        if getattr(exc, "response", None) is not None:
            try:
                st.error(exc.response.json().get("detail", ""))
            except Exception:
                pass
        return None


def get_quote_silently(ticker: str, krx_exchange: str) -> dict | None:
    if not ticker:
        return None
    try:
        return get_quote(ticker, krx_exchange=krx_exchange)
    except requests.exceptions.RequestException:
        return None


def submit_order(account_id: str, ticker: str, company_name: str, krx_exchange: str, side: str, shares: int) -> None:
    response = requests.post(
        f"{BACKEND_URL}/paper-trading/order",
        json={
            "account_id": account_id,
            "ticker": ticker,
            "company_name": company_name,
            "krx_exchange": krx_exchange,
            "side": side,
            "shares": shares,
        },
        timeout=20,
    )
    response.raise_for_status()


def reset_account(account_id: str) -> None:
    response = requests.post(
        f"{BACKEND_URL}/paper-trading/reset",
        json={"account_id": account_id},
        timeout=20,
    )
    response.raise_for_status()


def build_holdings_frame(holdings: list[dict]) -> pd.DataFrame:
    rows = []
    for holding in holdings:
        quote = get_quote_silently(holding["ticker"], holding.get("krx_exchange", "auto"))
        if not quote:
            continue

        shares = int(holding["shares"])
        avg_price = float(holding["avg_price"])
        current_price = float(quote["close"])
        market_value = current_price * shares
        cost_basis = avg_price * shares
        pnl_amount = market_value - cost_basis
        pnl_pct = ((current_price / avg_price) - 1) * 100 if avg_price else 0.0

        rows.append(
            {
                "종목": holding.get("company_name") or holding["ticker"],
                "티커": holding["ticker"],
                "거래소": str(holding.get("krx_exchange", "auto")).upper(),
                "보유수량": shares,
                "평균단가": avg_price,
                "현재가": current_price,
                "평가금액": market_value,
                "평가손익": pnl_amount,
                "수익률": pnl_pct,
                "기준일": format_date(quote.get("as_of")),
            }
        )
    return pd.DataFrame(rows)


def build_trades_frame(trades: list[dict]) -> pd.DataFrame:
    rows = []
    for trade in trades:
        rows.append(
            {
                "일시": str(trade.get("traded_at", "-")).replace("T", " ").replace("+00:00", ""),
                "구분": "매수" if trade.get("side") == "buy" else "매도",
                "종목": trade.get("company_name") or trade.get("ticker"),
                "티커": trade.get("ticker"),
                "거래소": str(trade.get("krx_exchange", "auto")).upper(),
                "단가": float(trade.get("price", 0)),
                "수량": int(trade.get("shares", 0)),
                "거래금액": float(trade.get("amount_krw", 0)),
            }
        )
    return pd.DataFrame(rows)


if "paper_account_id" not in st.session_state:
    st.session_state.paper_account_id = DEFAULT_ACCOUNT_ID

st.title("🧪 모의 투자")
st.caption("국내주식 전용 모의투자 메뉴입니다. 데이터는 Supabase에 저장되며, 같은 계좌 ID를 쓰면 다른 브라우저에서도 이어서 볼 수 있습니다.")

top_col1, top_col2 = st.columns([1.4, 1])
with top_col1:
    account_id = st.text_input(
        "계좌 ID",
        value=st.session_state.paper_account_id,
        help="영문, 숫자, -, _ 만 사용합니다. 같은 ID를 쓰면 같은 모의계좌를 이어서 사용합니다.",
    ).strip()
    st.session_state.paper_account_id = account_id or DEFAULT_ACCOUNT_ID
with top_col2:
    if st.button("모의 계좌 초기화", use_container_width=True):
        try:
            reset_account(st.session_state.paper_account_id)
            get_paper_state.clear()
            get_quote.clear()
            st.success("모의 계좌를 초기화했습니다.")
            st.rerun()
        except requests.exceptions.RequestException as exc:
            st.error(f"모의 계좌 초기화에 실패했습니다: {exc}")
            if getattr(exc, "response", None) is not None:
                try:
                    st.error(exc.response.json().get("detail", ""))
                except Exception:
                    pass

try:
    paper_state = get_paper_state(st.session_state.paper_account_id)
except requests.exceptions.RequestException as exc:
    st.error(f"모의투자 상태를 불러오지 못했습니다: {exc}")
    if getattr(exc, "response", None) is not None:
        try:
            st.error(exc.response.json().get("detail", ""))
        except Exception:
            pass
    st.stop()

selector_col, summary_col = st.columns([1.2, 1])

with selector_col:
    quick_pick_options = get_common_krx_companies()
    selected_quick_pick = st.selectbox(
        "대표 국내 종목 빠른 선택",
        ["직접 검색"] + [item["display_name"] for item in quick_pick_options],
        key="paper_quick_pick",
    )

    selected_company = None
    if selected_quick_pick != "직접 검색":
        selected_company = next(item for item in quick_pick_options if item["display_name"] == selected_quick_pick)

    search_query = st.text_input(
        "국내 종목명 검색",
        key="paper_search_query",
        help="회사명이나 6자리 종목코드를 입력하세요. 예: 삼성전자, 005930",
    )
    if search_query.strip():
        search_results = search_krx_companies(search_query, limit=20)
        if search_results:
            selected_display_name = st.selectbox(
                "검색 결과",
                [item["display_name"] for item in search_results],
                key="paper_search_result",
            )
            selected_company = next(item for item in search_results if item["display_name"] == selected_display_name)
        else:
            st.caption("검색 결과가 없습니다.")

    if not selected_company:
        selected_company = quick_pick_options[0]

    st.session_state.paper_selected_ticker = selected_company["ticker"]
    st.session_state.paper_selected_exchange = selected_company["krx_exchange"]
    st.caption(
        f"선택 종목: {selected_company['name']} / 코드: {selected_company['ticker']} / "
        f"시장: {selected_company['krx_exchange'].upper()}"
    )

holdings_frame = build_holdings_frame(paper_state.get("holdings", []))
cash_krw = float(paper_state.get("cash_krw", 0))
seed_cash_krw = float(paper_state.get("seed_cash_krw", 0))
holdings_value = float(holdings_frame["평가금액"].sum()) if not holdings_frame.empty else 0.0
total_assets = cash_krw + holdings_value
total_pnl = total_assets - seed_cash_krw
total_return_pct = (total_pnl / seed_cash_krw) * 100 if seed_cash_krw else 0.0

with summary_col:
    s1, s2 = st.columns(2)
    s3, s4 = st.columns(2)
    render_card(s1, "예수금", format_krw(cash_krw))
    render_card(s2, "보유 평가금액", format_krw(holdings_value))
    render_card(s3, "총 자산", format_krw(total_assets))
    render_card(s4, "누적 수익률", format_pct(total_return_pct))

quote = get_selected_quote(
    st.session_state.paper_selected_ticker,
    st.session_state.paper_selected_exchange,
)

if quote:
    st.subheader("현재 선택 종목")
    q1, q2, q3, q4 = st.columns(4)
    render_card(q1, "종목", f"{quote.get('company_name') or quote['ticker']} ({quote['ticker']})")
    render_card(q2, "현재가", format_krw(quote["close"]))
    render_card(q3, "전일 대비", f"{format_krw(quote['change_amount'])} / {format_pct(quote['change_pct'])}")
    render_card(q4, "기준일", format_date(quote.get("as_of")))

    order_col1, order_col2 = st.columns([1.1, 1])
    with order_col1:
        st.subheader("모의 주문")
        max_buyable_shares = int(cash_krw // float(quote["close"])) if float(quote["close"]) > 0 else 0
        current_holding = next((item for item in paper_state.get("holdings", []) if item["ticker"] == quote["ticker"]), None)
        owned_shares = int(current_holding.get("shares", 0)) if current_holding else 0

        with st.form("paper_trade_form"):
            trade_side = st.radio("주문 구분", ["매수", "매도"], horizontal=True)
            trade_shares = st.number_input("주문 수량 (주)", min_value=1, value=1, step=1, format="%d")
            estimated_amount = float(trade_shares) * float(quote["close"])
            st.caption(
                f"예상 주문금액: {format_krw(estimated_amount)} | "
                f"매수 가능 최대: {max_buyable_shares}주 | 보유 수량: {owned_shares}주"
            )
            submitted = st.form_submit_button("주문 반영")

        if submitted:
            try:
                submit_order(
                    account_id=st.session_state.paper_account_id,
                    ticker=quote["ticker"],
                    company_name=quote.get("company_name") or quote["ticker"],
                    krx_exchange=quote.get("krx_exchange", "auto"),
                    side="buy" if trade_side == "매수" else "sell",
                    shares=int(trade_shares),
                )
                get_paper_state.clear()
                get_quote.clear()
                st.success(f"{trade_side} 주문을 모의 반영했습니다.")
                st.rerun()
            except requests.exceptions.RequestException as exc:
                st.error(f"주문 반영에 실패했습니다: {exc}")
                if getattr(exc, "response", None) is not None:
                    try:
                        st.error(exc.response.json().get("detail", ""))
                    except Exception:
                        pass

    with order_col2:
        st.subheader("사용 안내")
        st.markdown(
            """
            - 국내주식만 지원합니다.
            - 현재가는 최근 종가 기준입니다.
            - 수수료, 세금, 슬리피지는 아직 반영하지 않습니다.
            - Supabase에 저장되므로 같은 계좌 ID로 다시 접속하면 이어서 볼 수 있습니다.
            """
        )

st.subheader("보유 종목")
if holdings_frame.empty:
    st.info("아직 보유 중인 종목이 없습니다.")
else:
    display_holdings = holdings_frame.copy()
    for column in ["평균단가", "현재가", "평가금액", "평가손익"]:
        display_holdings[column] = display_holdings[column].map(format_krw)
    display_holdings["수익률"] = display_holdings["수익률"].map(format_pct)
    st.dataframe(display_holdings.sort_values(by="평가금액", ascending=False), use_container_width=True, hide_index=True)

st.subheader("거래 내역")
trades_frame = build_trades_frame(paper_state.get("trades", []))
if trades_frame.empty:
    st.info("아직 반영된 모의 주문이 없습니다.")
else:
    trades_frame["단가"] = trades_frame["단가"].map(format_krw)
    trades_frame["거래금액"] = trades_frame["거래금액"].map(format_krw)
    st.dataframe(trades_frame, use_container_width=True, hide_index=True)
