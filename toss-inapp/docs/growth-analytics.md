# 성장 지표 운영 가이드

## 목표

한눈투자의 성장 루프를 다음 순서로 측정한다.

1. 화면 진입
2. 시장 흐름·AI 분석·종가베팅 중 하나 완료
3. 첫 모의투자 주문 완료
4. 랭킹 확인
5. 알림 동의 또는 친구 공유
6. 알림·공유 경로를 통한 재방문

## 앱인토스 콘솔 핵심 지표

### 활성 지표

다음 이벤트 중 하나를 완료한 사용자로 설정한다.

- `sector_flow_loaded`
- `ai_analysis_completed`
- `closing_bet_evaluated`
- `paper_order_completed`

### 대표 전환

- `first_paper_order_completed`

### 보조 전환

- `daily_routine_completed`
- `notification_agreed`
- `share_completed` 또는 `ranking_share_opened`

## 이벤트 목록

| 이벤트 | 발생 시점 | 주요 파라미터 |
| --- | --- | --- |
| `screen_*` | 각 화면 진입 | `pathname` |
| `referral_link_opened` | `ref`, `referrer`, `utm_source`가 있는 링크로 앱을 연 최초 시점 | `referrer`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` |
| `referral_user_activated` | 추천 유입 사용자가 섹터 조회·AI 분석·랭킹 조회·모의주문 중 하나를 처음 성공한 시점 | `referrer`, `activation`, `market` |
| `sector_flow_loaded` | 섹터 데이터 조회 성공 | `market`, `sector_count` |
| `ai_analysis_completed` | AI 분석 API 성공 | `market`, `sentiment_score`, `used_ad_free_reward` |
| `closing_bet_evaluated` | 종가베팅 보조 데이터 조회 성공 | `market`, `history_row_count` |
| `daily_routine_item_completed` | 오늘 루틴 항목 최초 완료 | `item_path`, `completed_count`, `streak_days` |
| `daily_routine_completed` | 오늘 루틴 전체 완료 | `streak_days` |
| `paper_trade_start_clicked` | 홈에서 첫 거래 CTA 선택 | `placement` |
| `paper_order_completed` | 모의주문 API 성공 | `market`, `side`, `shares`, `is_first_order` |
| `first_paper_order_completed` | 거래 이력이 없던 사용자의 첫 주문 성공 | `market`, `side` |
| `ranking_viewed` | 랭킹 최초 조회 성공 | `sort_by`, `participant_count`, `has_my_entry` |
| `ranking_share_started` | 내 순위 공유 선택 | `rank`, `participant_count` |
| `ranking_share_opened` | 네이티브 공유 화면 호출 성공 | `rank` |
| `notification_agreement_result` | 토스 알림 동의 응답 | `result` |
| `notification_agreed` | 알림 동의 또는 기존 동의 확인 | `result` |
| `closing_bet_notification_saved` | 알림 구독 저장 성공 | `channel`, `market`, `threshold_score` |
| `share_started` | 홈 친구 초대 선택 | `placement` |
| `share_completed` | 연락처 공유 리워드 지급 이벤트 | `placement`, `reward_amount`, `reward_unit` |
| `share_session_completed` | 한 명 이상에게 공유 후 모듈 종료 | `placement`, `sent_count` |
| `d1_returned` | 최초 방문 후 24시간 이상 지난 뒤 재방문 | `days_since_first_visit` |
| `d7_returned` | 최초 방문 후 7일 이상 지난 뒤 재방문 | `days_since_first_visit` |

계좌 ID, 토스 사용자 키, 종목 검색어 같은 사용자 식별 가능 정보는 이벤트에 기록하지 않는다.

## 웹 Google Analytics 이벤트

Streamlit 웹은 앱인토스 이벤트와 별도로 다음 이벤트를 기록한다.

| 이벤트 | 발생 시점 | 주요 파라미터 |
| --- | --- | --- |
| `web_market_brief_loaded` | 국내·미국 시장 브리핑 조회 성공 | `market`, `gainer_count`, `loser_count`, `is_stale` |
| `web_cta_clicked` | 웹 홈의 AI 분석·섹터·종가베팅·모의투자 CTA 선택 | `target`, `placement`, `market` |
| `referral_link_opened` | 추천·UTM 파라미터가 있는 웹 링크 최초 방문 | `referrer`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` |
| `referral_user_activated` | 추천 유입 사용자가 시장 브리핑을 처음 조회 | `referrer`, `activation`, `market` |

추천 파라미터는 영문·숫자·하이픈·밑줄만 허용해 임의의 식별 정보가 이벤트에 들어가지 않도록 한다. 웹과 앱 모두 브라우저 저장소를 사용해 동일 사용자 세션의 중복 이벤트를 줄인다.

외부 포스팅 링크는 다음 규칙으로 만든다.

`https://서비스주소/?ref=naver_blog&utm_source=naver_blog&utm_medium=organic&utm_campaign=market_brief&utm_content=krx_movers`

모의투자 랭킹 공유 링크에는 `ref=ranking_share`를 붙여 공유 유입을 구분한다.

## 출시 후 확인

- 앱인토스 행동 이벤트는 라이브 환경에서 확인한다.
- 출시 다음 날 콘솔에서 이벤트 수집 여부를 확인한다.
- `referrer`별 첫 주문 전환율과 D1·D7 리텐션을 비교한다.
- 공유 유입은 `contacts_module`, `external_share` 경로를 분리해서 본다.
- 첫 2주는 절대 목표보다 기존 대비 전환율 개선 폭을 기준으로 판단한다.
