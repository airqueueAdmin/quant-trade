import streamlit as st
import streamlit.components.v1 as components
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from ga import inject_google_analytics
from ui_helpers import inject_stage_banner_styles, render_home_stage_flow, render_stage_banner

st.set_page_config(
    page_title="홈",
    page_icon="🚀",
    layout="wide"
)

inject_google_analytics(os.getenv("GA_MEASUREMENT_ID") or os.getenv("GA_TAG_ID"), "home")
inject_stage_banner_styles()


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
        components.html(
        f"""
        <div style="border:1px solid rgba(27,84,186,0.18); background:linear-gradient(135deg, rgba(232,242,255,0.92), rgba(245,249,255,0.98)); border-radius:16px; padding:0.8rem 0.85rem; margin:0; box-sizing:border-box;">
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

st.title("🚀 홈")
st.sidebar.success("왼쪽 메뉴를 선택하세요.")
render_krx_countdown()

st.header("이 앱은 무엇을 할 수 있나요?")
st.write("""
    이 서비스는 **종가베팅 준비**를 중심으로 설계되어 있습니다.
    오늘 장 마감까지 살아남은 수급이 내일도 이어질 가능성이 있는지 확인하고,
    섹터 흐름, 뉴스, 전략 검증, 모의 대응까지 한 흐름으로 이어서 볼 수 있게 만들었습니다.
""")

render_home_stage_flow(
    [
        ("주요 섹터 흐름", "오늘 시장에서 끝까지 강했던 섹터를 먼저 찾습니다."),
        ("AI 시장 분석", "뉴스와 재료가 내일까지 이어질지 확인합니다."),
        ("종가 베팅", "후보를 최종 압축하고 종가베팅 적합도를 봅니다."),
        ("모의 투자", "다음 날 대응을 어떻게 할지 연습합니다."),
        ("투자 전략 시뮬레이션", "필요하면 과거 데이터로 아이디어를 검증합니다."),
    ]
)

st.subheader("🎯 종가 베팅")
render_stage_banner("핵심 판단", "최종 후보 압축", "섹터, 뉴스, 종가 구조를 한 번에 묶어 내일 이어질 가능성이 있는 후보를 추립니다.")
st.write("""
    - 이 서비스의 중심 메뉴입니다. 오늘 끝까지 살아남은 수급이 내일도 이어질 가능성을 자동 점검합니다.
    - 최근 종가 구조, AI 뉴스 점수, 섹터 문맥을 함께 묶어 종가베팅 후보를 압축합니다.
    - 실제 매매 기능은 없고, **후보 선별과 복기**에 집중합니다.
    - **👈 왼쪽 사이드바에서 '종가 베팅' 메뉴를 선택하여 확인하세요!**
""")

st.subheader("📊 주요 섹터 흐름")
render_stage_banner("1단계", "시장에서 강한 흐름 찾기", "어떤 종목을 볼지 모르겠다면 먼저 어느 섹터에 돈이 남았는지부터 확인합니다.")
st.write("""
    - 종가베팅 전 가장 먼저 확인하는 **1차 서포트 시스템**입니다. 오늘 시장에서 끝까지 강했던 섹터를 빠르게 추립니다.
    - 미국은 섹터 ETF 기준, 국내는 대표 종목 바스켓 기준으로 현재 흐름을 정리합니다.
    - **👈 왼쪽 사이드바에서 '주요 섹터 흐름' 메뉴를 선택하여 확인하세요!**
""")

st.subheader("🤖 AI 시장 분석")
render_stage_banner("2단계", "재료와 뉴스 해석", "움직인 이유가 내일까지도 남을지 빠르게 읽는 메뉴입니다.")
st.write("""
    - 종가베팅 후보 종목에 붙은 뉴스와 시장 심리를 빠르게 요약하는 **재료 해석 서포트 시스템**입니다.
    - 미국주식은 영문 뉴스, 국내주식은 한글 뉴스 기준으로 분석을 시도합니다.
    - 내일도 다시 읽힐 재료인지 판단할 때 보조 도구로 쓰기 좋습니다.
    - **👈 왼쪽 사이드바에서 'AI 시장 분석' 메뉴를 선택하여 시작하세요!**
""")

st.subheader("🧪 모의 투자")
render_stage_banner("4단계", "다음 날 대응 연습", "후보를 정한 뒤 실제 돈을 넣기 전에 어떻게 대응할지 점검합니다.")
st.write("""
    - 종가 기준으로 후보를 잡은 뒤, 다음 날 대응을 가정해서 연습하는 **대응 점검 서포트 시스템**입니다.
    - 현재가, 예수금, 보유 종목, 평가손익, 거래내역을 보며 종가 매매 아이디어를 복기할 수 있습니다.
    - **👈 왼쪽 사이드바에서 '모의 투자' 메뉴를 선택하여 시작하세요!**
""")

st.subheader("📈 투자 전략 시뮬레이션")
render_stage_banner("보조 검증", "과거 데이터로 검토", "지금 떠오른 아이디어가 과거에도 어느 정도 통했는지 백업 차원에서 확인합니다.")
st.write("""
    - 종가베팅 아이디어를 과거 데이터로 검증해보는 **전략 검증 백업 시스템**입니다.
    - **이동평균, RSI, 볼린저 밴드** 전략을 통해 단기 아이디어가 과거에 어떤 성과를 냈는지 테스트합니다.
    - **👈 왼쪽 사이드바에서 '투자 전략 시뮬레이션' 메뉴를 선택하여 시작하세요!**
""")
