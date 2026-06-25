import math

import streamlit as st
from fx_utils import get_usdkrw_rate, format_currency_pair, format_krw_value

FX_RATE = get_usdkrw_rate()

st.set_page_config(layout="wide", page_title="소액투자 ETF 가이드")


def estimate_shares(budget, price):
    if budget <= 0 or price <= 0:
        return 0
    return math.floor(budget / price)


st.title("📗 소액투자 ETF 가이드")
st.caption("이 페이지는 교육용 안내입니다. 특정 ETF 매수 추천이 아니라, 소액으로 시작하는 초보자가 ETF를 어떻게 활용할지 이해하도록 돕는 목적입니다.")
if FX_RATE:
    st.caption(f"환율 기준: 1 USD = {FX_RATE['rate']:,.2f} KRW")

st.warning("""
먼저 전제:
- 처음 시작은 `개별 급등주`보다 `넓게 분산된 ETF`가 일반적으로 단순합니다.
- `레버리지 ETF`, `인버스 ETF`, `테마 ETF`는 초보자의 첫 ETF로 권하지 않습니다.
- 미국 상장 ETF를 살 경우 환율, 세금, 분배금, 브로커 지원 여부를 같이 확인해야 합니다.
""")

tab1, tab2, tab3, tab4, tab5 = st.tabs([
    "1. 왜 ETF인가",
    "2. 시작용 ETF 예시",
    "3. 예산별 시작법",
    "4. 적립식 접근",
    "5. 초보자 금지 목록",
])

with tab1:
    st.subheader("소액투자 초보자에게 ETF가 자주 추천되는 이유")
    st.markdown("""
    1. **한 번에 여러 종목에 분산**
       한 회사에 몰빵하는 대신, ETF 하나로 수백~수천 종목에 나눠 담는 구조를 만들 수 있습니다.
    2. **판단 난이도가 낮음**
       "어느 한 종목이 대박 날까?"보다 "미국 전체 시장에 오래 투자할까?"가 초보자에게 더 단순합니다.
    3. **실수 확률 감소**
       뉴스 한 건, 루머 한 건에 크게 흔들릴 가능성이 개별주보다 낮은 편입니다.
    4. **적립식 투자에 잘 맞음**
       매달 일정 금액을 넣는 방식과 궁합이 좋습니다.
    """)

    st.info("""
    Investor.gov는 시장가 주문과 지정가 주문의 차이를 설명하고, 분산투자의 중요성을 반복해서 안내합니다.
    초보자에게 ETF가 자주 추천되는 핵심 이유도 결국 `한 번에 넓게 분산`하기 쉽다는 점입니다.
    """)

with tab2:
    st.subheader("초보자 시작용으로 자주 거론되는 ETF 예시")
    st.caption("아래는 이해하기 쉬운 예시입니다. 반드시 본인 계좌, 세금, 환전 구조에 맞는지 확인하세요.")

    col1, col2, col3 = st.columns(3)

    with col1:
        st.markdown("""
        ### `SCHB`
        **미국 전체 시장형**

        - Schwab U.S. Broad Market ETF
        - Dow Jones U.S. Broad Stock Market Index 추종
        - 총보수 `0.030%`
        - 약 `2,409`개 보유종목
        - 예시 주가: `USD 28.88 / 약 KRW 40,000`

        이런 사람에게 적합:
        - "미국 전체 시장에 넓게 투자하고 싶다"
        - "소액이라 1주 가격도 너무 비싸지 않았으면 좋겠다"
        - "첫 ETF는 최대한 단순했으면 좋겠다"
        """)

    with col2:
        st.markdown("""
        ### `IVV`
        **미국 대형주 대표지수형**

        - iShares Core S&P 500 ETF
        - S&P 500 Index 추종
        - 총보수 `0.03%`
        - 약 `504`개 보유종목
        - 예시 주가: `USD 747.78 / 약 KRW 1,030,000`

        이런 사람에게 적합:
        - "미국 대표 대형주 중심으로 가고 싶다"
        - "가장 많이 알려진 대표지수형 ETF가 편하다"
        - "애플, 마이크로소프트 같은 대형주 비중이 높은 구조가 괜찮다"
        """)

    with col3:
        st.markdown("""
        ### `SGOV`
        **초단기 미국 국채형**

        - iShares 0-3 Month Treasury Bond ETF
        - 0~3개월 미국 국채 중심
        - 총보수 `0.09%`
        - 30일 SEC 수익률 `3.55%` (2026-06-18 기준)
        - 예시 주가: `USD 100.60 / 약 KRW 139,000`

        이런 사람에게 적합:
        - "주식이 아직 무섭다"
        - "당장 투자금 전부를 주식에 넣고 싶지는 않다"
        - "대기자금/단기자금 보관용이 필요하다"
        """)

    st.success("""
    초보자용 단순 해석:
    - `성장 중심 1개만`: SCHB 또는 IVV 같은 broad/core equity ETF
    - `아직 무섭다`: SGOV 같은 초단기 국채 ETF로 일부 대기
    - 처음부터 복잡하게 5~10개 ETF를 섞기보다, 이해 가능한 1~2개로 시작하는 편이 낫습니다.
    """)

with tab3:
    st.subheader("예산별 시작법")
    monthly_budget = st.number_input("매달 투자 가능한 금액", min_value=0.0, value=100.0, step=10.0)
    supports_fractional = st.toggle("내 증권사는 소수점 매수(fractional shares)를 지원함", value=True)

    if monthly_budget < 50:
        st.warning("월 투자금이 아주 작다면, 수수료와 환전 비용 비중이 커질 수 있습니다. 빈도를 줄이거나 금액을 모아서 집행하는 방식도 검토하세요.")

    st.markdown("""
    #### 매우 단순한 시작 예시
    - **월 50~100달러**
      소수점 매수가 되면 broad-market ETF 1개를 정해 적립식으로 시작
    - **월 100~300달러**
      1개 ETF 적립 또는 `주식 ETF + 현금성 ETF(SGOV)` 2개 조합 가능
    - **월 300달러 이상**
      1개 broad-market ETF 비중을 키우거나, 이후 국제 분산을 추가 검토
    """)

    st.subheader("1주 가격 때문에 고민될 때")
    schb_price = 28.88
    ivv_price = 747.78
    sgov_price = 100.60

    budget_col1, budget_col2, budget_col3 = st.columns(3)
    budget_col1.metric("SCHB 예시 가능 수량", f"{estimate_shares(monthly_budget, schb_price)}주")
    budget_col2.metric("IVV 예시 가능 수량", f"{estimate_shares(monthly_budget, ivv_price)}주")
    budget_col3.metric("SGOV 예시 가능 수량", f"{estimate_shares(monthly_budget, sgov_price)}주")

    if not supports_fractional:
        st.info("""
        소수점 매수가 안 되면, 1주 가격이 낮은 ETF가 시작에 더 편할 수 있습니다.
        이런 점 때문에 broad-market ETF 중에서도 상대적으로 주당 가격이 낮은 상품이 소액투자자에게 실무적으로 유리할 때가 있습니다.
        """)
    else:
        st.info("""
        소수점 매수가 되면 1주 가격 부담이 크게 줄어듭니다.
        이 경우에는 주가 자체보다 `무엇에 투자하는 ETF인지`, `보수가 낮은지`, `내가 오래 들고 갈 수 있는지`를 더 중요하게 보세요.
        """)

    if FX_RATE:
        st.caption(
            "위 가격은 공식 상품 페이지의 2026-06-22 기준 값이며, 현재 환율로 환산한 원화는 "
            f"1 USD = {FX_RATE['rate']:,.2f} KRW를 사용했습니다."
        )
    else:
        st.caption("위 가격은 공식 상품 페이지의 2026-06-22 기준 값으로, 실제 가격은 계속 변합니다.")

with tab4:
    st.subheader("적립식 접근이 초보자에게 잘 맞는 이유")
    st.markdown("""
    - 한 번에 큰돈을 넣는 부담을 줄입니다.
    - 가격이 오를 때도 사고, 내릴 때도 사면서 평균 진입단가를 분산합니다.
    - 감정 매매를 줄이는 데 도움이 됩니다.
    """)

    total_budget = st.number_input("6개월 동안 투자할 총 금액", min_value=0.0, value=600.0, step=50.0)
    months = st.slider("몇 개월로 나눌지", min_value=3, max_value=12, value=6)
    per_month = total_budget / months if months else 0

    c1, c2 = st.columns(2)
    c1.metric("월 적립 금액", format_currency_pair(per_month, FX_RATE["rate"] if FX_RATE else None))
    c2.metric("적립 개월 수", f"{months}개월")

    st.markdown("""
    #### 초보자용 기본 루틴
    1. 한 ETF를 정한다.
    2. 투자 날짜를 정한다. 예: 매월 5일.
    3. 금액을 정한다. 예: 매월 100달러.
    4. 급등/급락 뉴스가 있어도 원칙을 쉽게 바꾸지 않는다.
    5. 6개월~12개월 뒤에만 구조를 재검토한다.
    """)

with tab5:
    st.subheader("초보자가 첫 ETF로 피하는 게 좋은 것")
    st.markdown("""
    - **레버리지 ETF**
      수익과 손실이 모두 확대됩니다. 장기 보유용 첫 ETF로는 부적합합니다.
    - **인버스 ETF**
      시장 하락에 베팅하는 구조라, 초보자가 오래 들고 가기 어렵습니다.
    - **너무 좁은 테마 ETF**
      AI, 반도체, 우주, 로봇 같은 테마는 매력적으로 보이지만 변동성이 큽니다.
    - **무슨 자산인지 설명 못 하는 ETF**
      구조를 이해 못 하면 하락장에서 버티기 어렵습니다.
    """)

    st.error("""
    첫 ETF를 고를 때 가장 흔한 실수:
    - 수익률만 보고 선택
    - 보수는 안 보고 선택
    - 분산이 넓은지 안 보고 선택
    - '이름이 멋있어서' 또는 '요즘 유행이라서' 선택
    """)

    st.subheader("초보자용 결론")
    st.markdown("""
    - 첫 ETF는 보통 `넓게 분산된 low-cost core ETF`가 더 적합합니다.
    - 처음부터 완벽한 포트폴리오를 만들려고 하기보다, `이해 가능한 ETF 1개`로 시작하는 편이 낫습니다.
    - 실전 주문 자체가 어렵다면, 먼저 `실전 매매 가이드` 메뉴에서 주문 방식과 금액 계산법을 확인하세요.
    """)

with st.expander("출처 및 기준일 보기"):
    st.markdown("""
    - Investor.gov `Market Order`:
      https://www.investor.gov/introduction-investing/investing-basics/glossary/market-order
    - Investor.gov `Diversification`:
      https://www.investor.gov/introduction-investing/investing-basics/glossary/diversification
    - Schwab Asset Management `SCHB`:
      https://www.schwabassetmanagement.com/products/schb
    - iShares `IVV`:
      https://www.ishares.com/us/products/239726/ishares-core-sp-500-etf
    - iShares `SGOV`:
      https://www.ishares.com/us/products/314116/ishares-0-3-month-treasury-bond-etf

    참고:
    - SCHB, IVV, SGOV의 예시 수치와 가격은 페이지에 표시된 2026-06-18~2026-06-22 기준 값을 사용했습니다.
    - 실제 가격, 보수, 수익률, 세금 조건은 바뀔 수 있으므로 주문 직전 반드시 공식 페이지와 본인 증권사 화면에서 다시 확인해야 합니다.
    """)
