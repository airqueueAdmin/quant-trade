from __future__ import annotations

from datetime import datetime, timedelta
from html import escape
import os
from zoneinfo import ZoneInfo

import requests
import streamlit as st

from ga import inject_google_analytics
from ui_helpers import inject_stage_banner_styles


BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")
MARKET_OPTIONS = {
    "krx": "국내 증시",
    "us": "미국 증시",
}

st.set_page_config(
    page_title="한눈투자 | 오늘의 시장 브리핑",
    page_icon="📊",
    layout="wide",
)

inject_google_analytics(os.getenv("GA_MEASUREMENT_ID") or os.getenv("GA_TAG_ID"), "home")
inject_stage_banner_styles()


def inject_home_styles() -> None:
    st.markdown(
        """
        <style>
        .block-container {
            max-width: 1180px;
            padding-top: 2.3rem;
            padding-bottom: 4rem;
        }
        .home-kicker {
            margin: 0 0 0.55rem;
            color: #3973d6;
            font-size: 0.78rem;
            font-weight: 800;
            letter-spacing: 0.12em;
        }
        .home-title {
            max-width: 780px;
            margin: 0;
            color: #102a43;
            font-size: clamp(2rem, 5vw, 3.6rem);
            line-height: 1.08;
            letter-spacing: -0.055em;
        }
        .home-title em {
            color: #3973d6;
            font-style: normal;
        }
        .home-subtitle {
            max-width: 690px;
            margin: 1rem 0 1.7rem;
            color: #5c7083;
            font-size: 1.02rem;
            line-height: 1.75;
            word-break: keep-all;
        }
        .market-pulse {
            position: relative;
            overflow: hidden;
            min-height: 290px;
            padding: 2rem 2.1rem;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 28px;
            background:
                radial-gradient(circle at 88% 15%, rgba(77, 137, 255, 0.34), transparent 34%),
                radial-gradient(circle at 72% 110%, rgba(74, 222, 128, 0.12), transparent 31%),
                linear-gradient(145deg, #0d1729 0%, #172a4b 58%, #1d3867 100%);
            box-shadow: 0 24px 55px rgba(25, 54, 101, 0.2);
            color: #ffffff;
        }
        .market-pulse::after {
            position: absolute;
            right: -48px;
            bottom: -58px;
            width: 210px;
            height: 210px;
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 999px;
            content: "";
        }
        .market-pulse__topline {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 1rem;
        }
        .market-pulse__eyebrow {
            display: inline-flex;
            align-items: center;
            gap: 0.45rem;
            color: #a9c9ff;
            font-size: 0.76rem;
            font-weight: 850;
            letter-spacing: 0.1em;
        }
        .market-pulse__dot {
            width: 0.52rem;
            height: 0.52rem;
            border-radius: 999px;
            background: #62e6a7;
            box-shadow: 0 0 0 0 rgba(98, 230, 167, 0.45);
            animation: market-pulse-dot 1.8s infinite;
        }
        @keyframes market-pulse-dot {
            70% { box-shadow: 0 0 0 9px rgba(98, 230, 167, 0); }
            100% { box-shadow: 0 0 0 0 rgba(98, 230, 167, 0); }
        }
        .market-pulse__status {
            padding: 0.38rem 0.68rem;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.08);
            color: rgba(255, 255, 255, 0.72);
            font-size: 0.72rem;
            white-space: nowrap;
        }
        .market-pulse h2 {
            max-width: 680px;
            margin: 1.55rem 0 0;
            font-size: clamp(1.65rem, 4vw, 2.55rem);
            line-height: 1.22;
            letter-spacing: -0.045em;
            word-break: keep-all;
        }
        .market-pulse__summary {
            max-width: 690px;
            margin: 0.9rem 0 0;
            color: rgba(255, 255, 255, 0.7);
            font-size: 0.94rem;
            line-height: 1.7;
            word-break: keep-all;
        }
        .market-pulse__footer {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem 1rem;
            margin-top: 1.55rem;
            color: rgba(255, 255, 255, 0.5);
            font-size: 0.74rem;
        }
        .market-pulse__footer strong { color: #ffffff; }
        .mover-card {
            min-height: 152px;
            padding: 1.1rem 1.15rem;
            border: 1px solid rgba(16, 42, 67, 0.08);
            border-radius: 20px;
            background: rgba(255, 255, 255, 0.88);
            box-shadow: 0 10px 30px rgba(34, 62, 93, 0.07);
        }
        .mover-card__topline {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 0.65rem;
            margin-bottom: 0.9rem;
        }
        .mover-card__rank {
            color: #6b7c8f;
            font-size: 0.76rem;
            font-weight: 800;
        }
        .mover-card__change {
            font-size: 1rem;
            font-weight: 850;
        }
        .mover-card--up .mover-card__change { color: #e34b59; }
        .mover-card--down .mover-card__change { color: #3973d6; }
        .mover-card strong {
            display: block;
            overflow: hidden;
            color: #102a43;
            font-size: 1.05rem;
            line-height: 1.35;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .mover-card p {
            margin: 0.35rem 0 0;
            color: #6b7c8f;
            font-size: 0.78rem;
        }
        .mover-card small {
            display: block;
            margin-top: 0.8rem;
            color: #8da0b2;
            font-size: 0.72rem;
        }
        .return-hook {
            display: grid;
            grid-template-columns: auto minmax(0, 1fr);
            gap: 0.9rem;
            align-items: center;
            margin: 1.1rem 0 0;
            padding: 1rem 1.15rem;
            border: 1px solid rgba(57, 115, 214, 0.13);
            border-radius: 18px;
            background: linear-gradient(135deg, #edf5ff 0%, #ffffff 100%);
        }
        .return-hook__icon {
            display: grid;
            width: 2.5rem;
            height: 2.5rem;
            place-items: center;
            border-radius: 13px;
            background: #3973d6;
            color: #ffffff;
            font-size: 0.76rem;
            font-weight: 900;
        }
        .return-hook strong {
            display: block;
            color: #102a43;
            font-size: 0.92rem;
        }
        .return-hook span:last-child {
            display: block;
            margin-top: 0.16rem;
            color: #63788c;
            font-size: 0.78rem;
            line-height: 1.5;
        }
        .journey-card {
            min-height: 174px;
            padding: 1.2rem;
            border: 1px solid rgba(16, 42, 67, 0.08);
            border-radius: 20px;
            background: #ffffff;
        }
        .journey-card__number {
            display: inline-grid;
            width: 2rem;
            height: 2rem;
            place-items: center;
            border-radius: 10px;
            background: #eaf2ff;
            color: #3973d6;
            font-size: 0.78rem;
            font-weight: 850;
        }
        .journey-card strong {
            display: block;
            margin-top: 0.95rem;
            color: #102a43;
            font-size: 1rem;
        }
        .journey-card p {
            margin: 0.4rem 0 0;
            color: #63788c;
            font-size: 0.82rem;
            line-height: 1.6;
            word-break: keep-all;
        }
        @media (max-width: 640px) {
            .block-container { padding-top: 1.4rem; }
            .home-title { font-size: 1.95rem !important; line-height: 1.13; }
            .market-pulse { min-height: 0; padding: 1.4rem; border-radius: 22px; }
            .market-pulse__topline { display: grid; justify-content: start; gap: 0.65rem; }
            .market-pulse__status { justify-self: start; }
            .mover-card { min-height: 0; }
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


@st.cache_data(ttl=300, show_spinner=False)
def get_market_movers(market: str) -> dict:
    response = requests.get(
        f"{BACKEND_URL}/market/movers",
        params={"market": market, "limit": 3},
        timeout=20,
    )
    response.raise_for_status()
    return response.json()


def next_krx_close(now: datetime) -> tuple[datetime, str]:
    market_close_today = now.replace(hour=15, minute=30, second=0, microsecond=0)
    if now.weekday() < 5 and now < market_close_today:
        return market_close_today, "국내 증시 마감까지"

    next_day = now + timedelta(days=1)
    while next_day.weekday() >= 5:
        next_day += timedelta(days=1)
    return next_day.replace(hour=15, minute=30, second=0, microsecond=0), "다음 국내 증시 마감까지"


def render_krx_countdown() -> None:
    now = datetime.now(ZoneInfo("Asia/Seoul"))
    target_time, label = next_krx_close(now)
    target_iso = target_time.isoformat()
    with st.sidebar:
        st.iframe(
            f"""
            <div style="border:1px solid rgba(27,84,186,0.18); background:linear-gradient(135deg, rgba(232,242,255,0.92), rgba(245,249,255,0.98)); border-radius:16px; padding:0.8rem 0.85rem; margin:0; box-sizing:border-box; font-family:Arial,sans-serif;">
                <div style="font-size:0.82rem; font-weight:700; color:#1b54ba; margin-bottom:0.35rem;">국내 증시 타이머</div>
                <div style="font-size:0.95rem; font-weight:700; color:#102a43; margin-bottom:0.3rem;">{label}</div>
                <div id="krx-countdown-value" style="font-size:1.45rem; font-weight:800; color:#0f172a; letter-spacing:-0.03em;">계산 중...</div>
                <div style="font-size:0.82rem; color:#486581; margin-top:0.35rem;">평일 오후 3시 30분 마감</div>
            </div>
            <script>
            const targetTime = new Date("{target_iso}").getTime();
            const countdownNode = document.getElementById("krx-countdown-value");
            function renderCountdown() {{
                if (!countdownNode) return;
                const now = new Date().getTime();
                const diff = Math.max(0, targetTime - now);
                const hours = Math.floor(diff / (1000 * 60 * 60));
                const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((diff % (1000 * 60)) / 1000);
                countdownNode.innerText = `${{hours}}시간 ${{String(minutes).padStart(2, "0")}}분 ${{String(seconds).padStart(2, "0")}}초`;
            }}
            renderCountdown();
            setInterval(renderCountdown, 1000);
            </script>
            """,
            height=140,
        )


def format_pct(value: float | int | None) -> str:
    return f"{float(value or 0):+.2f}%"


def format_price(item: dict) -> str:
    price = float(item.get("price") or 0)
    if item.get("currency") == "KRW":
        return f"{price:,.0f}원"
    return f"${price:,.2f}"


def format_as_of(value: str | None) -> str:
    if not value:
        return "기준 시각 확인 중"
    raw = str(value)
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return parsed.strftime("%m월 %d일 %H:%M 기준")
    except ValueError:
        return f"{raw.split('T', 1)[0]} 기준"


def build_market_brief(snapshot: dict) -> dict:
    gainers = snapshot.get("gainers") or []
    losers = snapshot.get("losers") or []
    top_gainer = gainers[0] if gainers else None
    top_loser = losers[0] if losers else None

    if top_gainer and top_loser:
        up_change = abs(float(top_gainer.get("change_pct") or 0))
        down_change = abs(float(top_loser.get("change_pct") or 0))
        combined_range = up_change + down_change
        if max(up_change, down_change) >= 20:
            label = "상위 종목 변동성 매우 큼"
        elif max(up_change, down_change) >= 10:
            label = "상위 종목 변동성 확대"
        else:
            label = "상·하위 종목 온도 차 확인"
        return {
            "headline": f"{top_gainer.get('name', top_gainer.get('ticker', '-'))} {format_pct(top_gainer.get('change_pct'))}, 오늘 움직임 1위",
            "summary": (
                f"상승 상위 {top_gainer.get('name', '-')}와 하락 상위 {top_loser.get('name', '-')}의 "
                f"등락 폭 합은 {combined_range:.1f}%p입니다. 시장 전체 방향으로 단정하기보다 "
                "두 종목의 뉴스와 소속 섹터가 내일까지 이어지는지 확인해보세요."
            ),
            "label": label,
            "focus": top_gainer,
        }

    focus = top_gainer or top_loser
    if focus:
        return {
            "headline": f"{focus.get('name', focus.get('ticker', '-'))} {format_pct(focus.get('change_pct'))}, 지금 가장 큰 움직임",
            "summary": "조건에 맞는 상위 변동 종목을 먼저 확인했습니다. 뉴스 재료와 섹터 흐름을 함께 보면 단기 등락을 더 입체적으로 해석할 수 있습니다.",
            "label": "최근 거래일 변동 종목",
            "focus": focus,
        }

    return {
        "headline": "오늘의 시장 데이터를 준비하고 있어요",
        "summary": "조건에 맞는 급등락 종목이 아직 없습니다. 잠시 후 새로고침하거나 섹터 흐름부터 확인해보세요.",
        "label": "업데이트 대기",
        "focus": None,
    }


def render_market_pulse(snapshot: dict, market: str) -> dict:
    brief = build_market_brief(snapshot)
    status = snapshot.get("snapshot_status") or "최근 거래일 기준"
    stale_label = " · 이전 데이터" if snapshot.get("is_stale") and "이전 데이터" not in status else ""
    st.markdown(
        f"""
        <section class="market-pulse">
            <div class="market-pulse__topline">
                <span class="market-pulse__eyebrow"><i class="market-pulse__dot"></i> MARKET PULSE · {escape(MARKET_OPTIONS[market])}</span>
                <span class="market-pulse__status">{escape(str(brief['label']))}</span>
            </div>
            <h2>{escape(str(brief['headline']))}</h2>
            <p class="market-pulse__summary">{escape(str(brief['summary']))}</p>
            <div class="market-pulse__footer">
                <span><strong>{escape(format_as_of(snapshot.get('as_of')))}</strong></span>
                <span>{escape(str(status))}{escape(stale_label)}</span>
                <span>5분 간격 데이터 갱신</span>
            </div>
        </section>
        """,
        unsafe_allow_html=True,
    )
    return brief


def render_mover_card(column, item: dict, rank: int, tone: str) -> None:
    direction_label = "상승" if tone == "up" else "하락"
    column.markdown(
        f"""
        <article class="mover-card mover-card--{tone}">
            <div class="mover-card__topline">
                <span class="mover-card__rank">{direction_label} {rank}위</span>
                <span class="mover-card__change">{escape(format_pct(item.get('change_pct')))}</span>
            </div>
            <strong>{escape(str(item.get('name') or item.get('ticker') or '-'))}</strong>
            <p>{escape(str(item.get('ticker') or '-'))} · {escape(format_price(item))}</p>
            <small>{escape(str(item.get('exchange') or MARKET_OPTIONS.get(item.get('market'), '-')))}</small>
        </article>
        """,
        unsafe_allow_html=True,
    )


def open_ai_analysis(item: dict) -> None:
    market = str(item.get("market") or "krx")
    st.session_state["market_input_ai"] = market
    st.session_state["ticker_ai_market"] = market
    st.session_state["ticker_input_ai"] = str(item.get("ticker") or "")
    st.session_state["krx_exchange_input_ai"] = str(item.get("krx_exchange") or "auto")
    st.session_state["step_ai"] = 1
    st.switch_page("pages/2_🤖_AI_시장_분석.py")


def render_market_section() -> None:
    header_col, refresh_col = st.columns([5, 1])
    with header_col:
        st.subheader("지금 가장 많이 움직인 종목")
        st.caption("시가총액과 거래량 조건을 통과한 종목 중 최근 거래일 등락 상위입니다.")
    with refresh_col:
        if st.button("새로고침", use_container_width=True):
            get_market_movers.clear()
            st.rerun()

    market = st.radio(
        "확인할 시장",
        list(MARKET_OPTIONS.keys()),
        format_func=lambda value: MARKET_OPTIONS[value],
        horizontal=True,
        label_visibility="collapsed",
    )

    try:
        with st.spinner(f"{MARKET_OPTIONS[market]} 흐름을 불러오는 중입니다..."):
            snapshot = get_market_movers(market)
    except requests.exceptions.RequestException as exc:
        st.warning("실시간 시장 데이터를 잠시 불러오지 못했습니다. 분석 기능은 계속 이용할 수 있어요.")
        if st.button("시장 데이터 다시 불러오기", type="primary"):
            get_market_movers.clear()
            st.rerun()
        st.caption(f"연결 상태: {exc}")
        return

    brief = render_market_pulse(snapshot, market)
    gainers = (snapshot.get("gainers") or [])[:3]
    losers = (snapshot.get("losers") or [])[:3]

    st.markdown("#### 오늘의 상승·하락 레이더")
    tabs = st.tabs(["상승 상위", "하락 상위"])
    for tab, items, tone in zip(tabs, (gainers, losers), ("up", "down")):
        with tab:
            if not items:
                st.info("조건에 맞는 종목이 아직 없습니다.")
                continue
            columns = st.columns(len(items))
            for index, (column, item) in enumerate(zip(columns, items), start=1):
                render_mover_card(column, item, index, tone)

    focus = brief.get("focus")
    action_col1, action_col2, action_col3 = st.columns([1.2, 1, 1])
    with action_col1:
        if focus and st.button(
            f"{focus.get('name', focus.get('ticker', '1위 종목'))} AI 뉴스 분석",
            type="primary",
            use_container_width=True,
        ):
            open_ai_analysis(focus)
    with action_col2:
        if st.button("주도 섹터 확인", use_container_width=True):
            st.switch_page("pages/5_📊_주요_섹터_흐름.py")
    with action_col3:
        if st.button("종가 후보 압축", use_container_width=True):
            st.switch_page("pages/6_🎯_종가_베팅.py")

    st.markdown(
        """
        <div class="return-hook">
            <span class="return-hook__icon">D+1</span>
            <span>
                <strong>내일 다시 오면 주도주가 자동으로 바뀝니다</strong>
                <span>장 마감 뒤 새 순위로 오늘의 움직임과 비교해보세요. 매일 같은 시각에 보면 수급의 연속성이 더 잘 보입니다.</span>
            </span>
        </div>
        """,
        unsafe_allow_html=True,
    )
    st.caption(snapshot.get("universe_note") or "시장 데이터는 투자 참고용이며 매수·매도 추천이 아닙니다.")


def render_investment_journey() -> None:
    st.markdown("### 오늘은 이 순서로 3분만 확인하세요")
    st.caption("많이 움직인 종목을 발견한 뒤, 이유와 지속 가능성을 차례로 좁혀갑니다.")
    columns = st.columns(3)
    items = [
        ("01", "시장 움직임 발견", "급등락 레이더에서 오늘 투자자의 시선이 모인 종목을 찾습니다."),
        ("02", "뉴스와 섹터 확인", "AI 뉴스 분석과 섹터 흐름으로 움직인 이유를 교차 확인합니다."),
        ("03", "내일 대응 연습", "종가 후보를 압축하고 모의투자로 손실 시나리오까지 점검합니다."),
    ]
    for column, (number, title, description) in zip(columns, items):
        column.markdown(
            f"""
            <article class="journey-card">
                <span class="journey-card__number">{number}</span>
                <strong>{escape(title)}</strong>
                <p>{escape(description)}</p>
            </article>
            """,
            unsafe_allow_html=True,
        )

    start_col, practice_col = st.columns(2)
    with start_col:
        if st.button("AI 시장 분석 시작", type="primary", use_container_width=True):
            st.switch_page("pages/2_🤖_AI_시장_분석.py")
    with practice_col:
        if st.button("모의투자로 대응 연습", use_container_width=True):
            st.switch_page("pages/6_🧪_모의_투자.py")


inject_home_styles()
render_krx_countdown()
st.sidebar.success("오늘 시장부터 확인해보세요.")

st.markdown('<p class="home-kicker">DAILY MARKET BRIEFING</p>', unsafe_allow_html=True)
st.markdown(
    '<h1 class="home-title">복잡한 시장을<br><em>한눈에, 다음 행동까지.</em></h1>',
    unsafe_allow_html=True,
)
st.markdown(
    '<p class="home-subtitle">오늘 많이 움직인 종목을 먼저 보고, 뉴스·섹터·종가 흐름을 이어서 확인하세요. 숫자만 나열하지 않고 “그래서 무엇을 더 봐야 하는지”까지 연결합니다.</p>',
    unsafe_allow_html=True,
)

render_market_section()
st.divider()
render_investment_journey()

st.info("이 서비스는 투자 판단을 돕는 정보 도구이며, 제공되는 순위와 분석은 수익을 보장하거나 특정 종목의 매매를 권유하지 않습니다.")
