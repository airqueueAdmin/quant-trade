# [이름]
Backend / Full-stack Engineer

- Email: [email@example.com]
- Phone: [010-0000-0000]
- GitHub: [GitHub 링크]
- Portfolio: [포트폴리오 링크]

## Summary

투자 데이터 수집, AI 기반 뉴스 해석, 전략 백테스트, 모바일 인앱 UI, 세션/DB 상태 관리까지 한 흐름으로 연결하는 서비스 개발 경험이 있습니다.
`FastAPI`, `React + Vite + TypeScript`, `Supabase Edge Functions`, `PostgreSQL`, `Docker`를 기반으로 투자 보조 서비스 **한눈투자(Glance Invest)** 를 구현했으며, Render 의존도를 줄이기 위해 앱인토스 운영 API를 Supabase로 단계적으로 이전했습니다.

## Tech Skills

- Backend: `Python`, `FastAPI`, `Pydantic`, `Pandas`, `NumPy`, `Requests`
- Frontend: `React`, `TypeScript`, `Vite`, `React Router`, `Streamlit`
- Data / AI: `yfinance`, `NewsAPI`, `Google Gemini`
- Infra / Ops: `Docker`, `Docker Compose`, `Nginx`, `Supabase Edge Functions`, `Supabase Vault`, `pg_cron`
- Domain: 전략 백테스트, 시계열 데이터 처리, 세션 기반 상태 관리, 모바일 인앱 서비스

## Selected Project

### 한눈투자 (Glance Invest)

- 형태: 투자 보조 / 학습형 서비스
- 저장소: `Quant Trading Web App`
- 구조: `Streamlit 웹앱 + React 인앱 프론트엔드 + FastAPI 웹 백엔드 + Supabase Edge/DB`
- 핵심 흐름: `섹터 흐름 확인 -> AI 뉴스 분석 -> 종가베팅 점수화 -> 전략 시뮬레이션 -> 모의투자`

### Project Overview

초보 투자자가 시장 흐름을 해석하고, 아이디어를 검증하고, 실제 주문 전에 대응을 연습할 수 있도록 만든 서비스입니다.
단일 기능 위주의 툴이 아니라, **시장 해석, 전략 검증, 시뮬레이션, 알림** 을 하나의 서비스 흐름으로 묶는 데 초점을 맞췄습니다.

### Key Contributions

- `FastAPI` 기반 공용 백엔드를 구축해 `Streamlit` 웹앱과 `React` 인앱 프론트가 동일한 API를 재사용하도록 설계
- 미국/국내 주식 데이터를 함께 다루기 위해 `ticker normalization`, `KRX 심볼 자동 보정`, `cache fallback` 로직 구현
- 이동평균, `RSI`, 볼린저 밴드 전략에 대해 **백테스트 + Grid Search 최적화** 기능 구현
- `NewsAPI + Gemini` 조합으로 뉴스 수집, 중복 제거, 감성 점수화, 구조화된 한국어 요약 생성 기능 구현
- 종가 강도, 거래량 지속성, 섹터 리더십, 뉴스 후속성 등을 조합한 **종가베팅 점수 엔진** 구현
- `Supabase` 기반 모의투자 계좌, 거래내역, 종가베팅 알림, 저장된 백테스트 결과 영속화 구조 설계
- 앱인토스용 `Supabase Edge Functions` 16개를 구성해 세션·시세·뉴스·섹터·급등락·모의투자·종가베팅·전략 시뮬레이션 API를 Render 없이 운영하도록 단계적 이전
- Deno 기반 `strategy-simulation` 함수에서 이동평균·RSI·볼린저 백테스트와 Grid Search 최적화를 Python 백엔드 결과 형식에 맞춰 재구현
- `X-App-Session` 기반 세션 토큰과 `HMAC-SHA256` 서명 검증으로 데모 계좌 상태를 안전하게 유지
- 토스 인앱 환경을 고려한 `React + Vite + TypeScript` 모바일 전용 프론트엔드 분리 구축

### Technical Details

#### 1. Market Data Layer

- `KIND` 상장사 목록을 수집해 국내 종목 검색 API를 구성하고, 실패 시 로컬 CSV 캐시로 fallback
- `005930 -> 005930.KS / 005930.KQ` 형태의 후보 심볼을 자동 생성해 `KOSPI/KOSDAQ` 입력 부담을 낮춤
- `yfinance.download()` 와 `Ticker().history()` 를 순차 시도하고, 요청 제한 시 캐시 데이터로 복구
- 장전 / 장중 / 장마감 직후를 구분하는 cache bucket 전략으로 시세 캐시를 과도하게 오래 유지하지 않도록 설계

#### 2. Backtesting & Optimization Engine

- 전략 시그널 발생 후 **다음 봉 시가** 기준으로 체결되는 구조를 사용해 look-ahead bias를 완화
- 주문 방식을 `all_in` 과 `fixed_amount` 로 분리해 초보 투자자의 분할 매수 시나리오도 검증 가능하도록 구현
- `CAGR`, `Sharpe`, `Sortino`, `Annual Volatility`, `MDD`, `Win Rate`, `Profit Factor` 계산
- `Buy & Hold` 벤치마크를 함께 계산해 전략 초과성과를 비교할 수 있도록 구성
- `itertools.product` 기반 Grid Search로 전략 파라미터 전수 탐색 수행

#### 3. AI News Analysis Pipeline

- 회사명, 티커, 언어 조합을 바꿔가며 다중 질의를 수행해 뉴스 검색 누락을 줄임
- URL canonicalization, 제목 normalization, 보도자료 필터링으로 중복/노이즈 기사 제거
- `Pydantic` 스키마를 사용해 Gemini 응답을 구조화 JSON으로 강제
- 모델 실패 시 중립 점수와 fallback 문구를 반환해 UI가 깨지지 않도록 처리

#### 4. Closing-Bet Scoring Service

- 종가베팅 판단을 단순 상승률이 아니라 아래 7개 신호의 조합으로 점수화
- `sector_strength`
- `close_strength`
- `volume_persistence`
- `leader_status`
- `news_follow_through`
- `tomorrow_catalyst`
- `risk_control`
- 장 마감 캔들 구조와 뉴스 맥락을 기반으로 시나리오 modifier를 추가해 최종 점수를 계산
- 결과는 점수뿐 아니라 `risk_flags`, `score_label`, `score_action` 형태로 해석 가능한 문장까지 함께 반환

#### 5. Session, Persistence, and Trading State

- 백엔드가 `paper-<random>` 형태의 계좌 ID를 생성하고, 이를 `HMAC-SHA256` 서명한 `X-App-Session` 토큰으로 전달
- 프론트는 브라우저 로컬 저장소에 세션을 보관하고, 이후 주문/조회/저장 요청에 같은 세션을 재사용
- `Supabase` 테이블 설계
- `paper_trading_accounts`: 예수금 / 시드머니
- `paper_trading_positions`: 보유 수량 / 평균단가
- `paper_trading_trades`: 거래 이력
- `closing_bet_notifications`: 알림 구독
- `closing_bet_alert_events`: 발송 이벤트
- `saved_backtests`: 백테스트 / 최적화 결과 저장
- 주문 실행과 계좌 초기화는 `RPC` 함수로 분리해 서버 로직과 DB 상태 변경을 명확히 나눔
- `RLS` 와 `service_role` 권한을 적용해 공개 권한을 차단

#### 6. Toss In-App Frontend and Edge Backend

- 기존 `Streamlit` 앱을 유지하면서, 모바일 UX 최적화를 위해 `React + Vite + TypeScript` 인앱 프론트를 별도 구축
- `shared/api/client.ts` 에서 공통 API 클라이언트를 정의해 기능 페이지별 중복 요청 코드를 줄임
- `GET /app-config`, `GET /healthz` 를 통해 백엔드 준비 상태와 기능 활성 여부를 홈 화면에서 직접 노출
- `sector-flow`, `ai-analysis`, `closing-bet`, `strategy-simulation`, `paper-trading` 페이지를 모바일 플로우로 재설계
- 환경별 API base URL을 공통 클라이언트에서 선택하도록 만들어 AIT는 Supabase Edge, 웹은 기존 FastAPI를 사용
- Yahoo Finance 차트 데이터를 Edge에서 직접 정규화하고 CORS·입력 검증·오류 응답을 통일
- `fx-usdkrw` 환율, `toss-login` user-key 교환, `closing-bet-notifications` 토스 스마트메시지 발송을 별도 함수로 분리

#### 7. Notification and Toss Integration

- 종가베팅 알림을 `email` 과 `toss_inapp` 두 채널로 분기
- 토스 로그인 authorization code를 userKey로 교환하는 API와 mTLS 기반 스마트 발송 API 연동
- 테스트 발송 / 실발송 / 발송 이력 저장 / 중복 발송 방지 로직 구현
- `NOTIFICATION_DISPATCH_TOKEN` 기반 배치 발송 엔드포인트로 운영성 확보
- Supabase Vault의 토큰을 `pg_cron`과 `pg_net`으로 읽어 국내·미국 장 마감 시간에 5분 간격으로 발송 함수를 호출

### Architecture

```text
                    [User]
                      |
         +------------+-------------+
         |                          |
         v                          v
[Streamlit Frontend]        [Toss In-App Frontend]
         |                          |
         v                          v
 [FastAPI Web API]       [Supabase Edge API]
         |                 /      |      \
         +----------------+       |       \
                          v       v        v
                    [Yahoo] [News/Gemini] [Supabase]
```

### Representative APIs

- `GET /market/sectors`
- `GET /sentiment/{ticker}`
- `POST /backtest/moving_average`
- `POST /optimize/rsi`
- `POST /closing-bet/evaluate`
- `GET /paper-trading/state`
- `POST /paper-trading/order`
- `POST /backtest/saved`
- `POST /session/bootstrap`
- `POST /functions/v1/strategy-simulation?action=backtest`
- `POST /functions/v1/strategy-simulation?action=optimize`
- `POST /functions/v1/toss-login`
- `POST /functions/v1/closing-bet-notifications?action=dispatch`

### Engineering Strengths Shown in This Project

- 분석 기능을 서비스형 아키텍처로 확장한 경험
- 외부 API 장애와 rate limit에 대비한 fallback 설계 경험
- 단일 프론트엔드가 아니라 웹앱과 인앱 프론트를 병행하는 멀티 채널 구조 경험
- 데이터 분석 로직, 모바일 UI, 세션/DB 설계, 운영 API까지 end-to-end로 연결하는 역량
- Python/Pandas 기반 계산을 Deno/TypeScript Edge 런타임으로 옮기면서 기존 API 계약과 결과 형식을 유지한 경험

## Additional Information

### Education

- [학교 / 전공 / 졸업연도]

### Experience

- [회사명 / 역할 / 기간]

### Links

- GitHub: [링크]
- Demo: [링크]
- Notion / Blog: [링크]
