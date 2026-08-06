# 광고 및 공유 리워드 연동 인수인계

작성일: 2026-07-15

## 현재 상태

- `AI 분석` 화면에 전면형 광고를 연결했다.
- 화면 진입 시 광고를 미리 로드한다.
- AI 분석 API가 성공한 뒤 광고가 준비된 경우에만 광고를 표시한다.
- 광고가 준비되지 않았거나 현재 토스 앱 환경에서 지원되지 않으면 분석 결과를 바로 표시한다.
- 광고가 닫히거나 표시에 실패하면 다음 광고를 다시 로드한다.
- 컴포넌트가 사라질 때 광고 콜백 등록을 해제한다.
- 광고 노출 가능성을 분석 실행 버튼 아래에 안내한다.
- 홈 `기능` 단계에 사용자가 직접 실행하는 리워드 광고 카드를 연결했다.
- 리워드 광고는 `userEarnedReward` 이벤트가 발생한 경우에만 SDK가 전달한 단위와 수량을 지급 완료로 안내한다.
- 리워드 광고를 닫거나 표시에 실패하면 다음 광고를 다시 로드한다.
- 모든 화면의 콘텐츠 아래, 하단 내비게이션 위에 리스트형 배너 광고를 연결했다.
- 배너 SDK는 앱 레이아웃에서 한 번 초기화하고, 미지원·초기화 실패·No Fill이면 광고 영역을 숨긴다.
- 배너 컴포넌트가 사라질 때 연결된 광고 슬롯을 제거한다.
- 홈 화면에 사용자가 직접 실행하는 공유 리워드 버튼을 연결했다.
- 공유 완료, 모듈 종료, 오류 이벤트를 안내하고 모든 종료 경로에서 브리지 콜백을 정리한다.
- 샌드박스와 토스 앱 5.223.0 미만에서는 공유 리워드 모듈을 열지 않는다.

광고 흐름:

```text
AI 분석 화면 진입
  -> 전면형 광고 미리 로드
  -> 사용자가 AI 분석 실행
  -> 분석 API 성공
  -> 광고가 준비된 경우 광고 표시
  -> 광고 닫힘 또는 표시 실패
  -> 다음 광고 미리 로드
```

리워드 광고 흐름:

```text
홈 `기능` 단계 진입
  -> 리워드 광고 미리 로드
  -> 사용자가 `광고 보고 리워드 받기` 선택
  -> 광고 표시
  -> 시청 완료 시 userEarnedReward 수신 및 리워드 완료 안내
  -> 광고 닫힘 또는 표시 실패
  -> 다음 리워드 광고 미리 로드
```

## 주요 파일

- `src/shared/ads/useFullScreenAd.ts`
  - `loadFullScreenAd`, `showFullScreenAd` 호출과 상태를 관리한다.
  - `load -> show -> next load` 순서를 보장한다.
  - `isSupported()` 확인, 리워드 이벤트 전달, 오류 처리, 콜백 정리를 포함한다.
- `src/shared/ads/RewardedAdCard.tsx`
  - 홈에서 사용자가 직접 리워드 광고를 실행하는 UI다.
  - `userEarnedReward` 수신 여부와 SDK가 전달한 리워드 단위·수량을 안내한다.
  - `dismissed`만 발생한 경우에는 리워드를 지급 완료로 처리하지 않는다.
- `src/shared/ads/BannerAd.tsx`
  - `TossAds.initialize`, `TossAds.attachBanner`를 사용한다.
  - 리스트형 배너를 콘텐츠 아래에 붙이고 실패 시 빈 공간을 남기지 않는다.
  - 언마운트 시 `destroy()`로 광고 슬롯을 정리한다.
- `src/app/AppLayout.tsx`
  - 공통 배너를 콘텐츠와 하단 내비게이션 사이에 배치한다.
- `src/shared/rewards/ContactsViralCard.tsx`
  - `contactsViral`의 `sendViral`, `close`, `onError`를 처리한다.
  - 토스 앱 환경과 최소 버전을 확인하고 중복 실행을 막는다.
  - 모듈 종료, 오류, 언마운트 시 cleanup 함수를 호출한다.
- `src/features/home/HomePage.tsx`
  - 홈 안내 흐름 아래에 리워드 광고와 공유 리워드 카드를 배치한다.
- `src/features/ai-analysis/AnalysisPage.tsx`
  - AI 분석 성공 직후 `analysisAd.showAd()`를 호출한다.
  - 사용자에게 전면 광고가 표시될 수 있음을 안내한다.
- `src/shared/config/env.ts`
  - 로컬 개발에서는 전면형·리워드형·배너형 모두 공식 테스트 ID를 사용한다.
  - production 빌드에서는 각 광고 환경 변수와 공유 리워드 ID를 사용한다.
- `.env.production`
  - 실제 전면형·배너형 운영 ID가 설정되어 있다.
- `.env.production.example`, `.env.example`, `README.md`
  - 광고 환경 변수와 테스트/출시 구분 방법이 기록되어 있다.
- `package.json`, `package-lock.json`
  - 통합 광고 API 타입을 제공하도록 Apps in Toss SDK를 `2.10.6`으로 업데이트했다.

## 현재 광고 ID

현재 `.env.production` 설정:

```dotenv
VITE_INTERSTITIAL_AD_GROUP_ID=ait.v2.live.8f0159b600724336
VITE_REWARDED_AD_GROUP_ID=ait.v2.live.f28a4566e6504f45
VITE_BANNER_AD_GROUP_ID=ait.v2.live.373b0109aa644c71
VITE_CONTACTS_VIRAL_MODULE_ID=6f578343-78b0-4398-b83f-43aaf433b405
```

개발과 콘솔 QR 테스트에는 별도로 생성한 `glance-invest-test.ait`만 사용한다.
실제 광고 ID가 포함된 `glance-invest.ait`로 반복 테스트하면 광고 정책 위반으로 판단될 수 있다.

## 내일 해야 할 일

1. 콘솔 QR에 `glance-invest-test.ait`를 등록해 토스 앱에서 실행한다.
2. `AI 분석` 화면으로 이동한다.
3. 종목을 선택하고 `AI 분석 실행`을 누른다.
4. 분석 성공 후 테스트 전면 광고가 표시되는지 확인한다.
5. 광고를 닫은 뒤 분석 결과가 정상적으로 보이는지 확인한다.
6. 다시 분석을 실행해 다음 광고가 재로드됐는지 확인한다.
7. 뒤로 가기와 하단 내비게이션이 정상 동작하는지 확인한다.
8. Android와 iOS에서 각각 확인한다.
9. 각 화면의 콘텐츠 아래에서 테스트 배너가 표시되는지 확인한다.
10. 배너 클릭 후 돌아오기와 뒤로 가기가 정상 동작하는지 확인한다.
11. 홈에서 `친구에게 공유하고 리워드 받기`를 누른다.
12. 친구 공유 완료 후 지급 리워드 또는 공유 완료 메시지가 보이는지 확인한다.
13. 공유 모듈을 뒤로 가기로 닫은 뒤 버튼을 다시 실행할 수 있는지 확인한다.
14. 공유 가능한 리워드가 없거나 오류가 발생해도 홈 기능이 계속 동작하는지 확인한다.
15. 홈 `기능` 단계에서 테스트 리워드 광고가 준비되는지 확인한다.
16. 광고를 중간에 닫으면 리워드 지급 완료로 표시되지 않는지 확인한다.
17. 광고를 끝까지 시청하면 SDK가 전달한 리워드 단위와 수량이 표시되는지 확인한다.
18. 광고 종료 뒤 다음 리워드 광고가 다시 준비되는지 확인한다.

샌드박스에서는 통합 광고가 지원되지 않으므로 콘솔 QR과 실제 토스 앱으로 테스트해야 한다.
공유 리워드도 콘솔 QR에서 테스트해야 하며, 미니앱이 승인되지 않았다면 `Internal Server Error`가 발생할 수 있다.

### 2026-07-16 진행 상태

로컬 준비 완료:

- 전면형 테스트 광고에서 `Test Mode`와 Google Ads 화면 표시 확인
- 전면형·배너형 운영 ID를 `.env.production`에 반영
- 공통 하단 리스트형 배너 구현
- 공유 리워드 ID를 `.env.production`에 반영
- 홈 공유 리워드 UI와 이벤트/오류/cleanup 처리 구현
- `npm run build:web` 성공
- `npm run build` 성공
- QR 테스트용 `glance-invest-test.ait` 생성 완료
  - SHA-256: `85C3AA20AA7886CD8522CC94B88621702A79D5E2437C6C0EBBED339C8E6E0917`
- 출시용 `glance-invest.ait` 생성 완료
  - SHA-256: `8E67966F66FD2DB0E02CB4721E7DA9DF2E99CA76C08C2DD1410317832CC13C94`
- 각 번들 내부에 테스트/운영 광고 ID, 공유 리워드 ID와 `contactsViral` 코드가 포함됐는지 확인

실기기 확인 대기:

- 토스 콘솔 QR에 `glance-invest-test.ait` 등록
- Android에서 위 2~7번 확인
- iOS에서 위 2~7번 확인
- Android와 iOS에서 위 9~10번 배너 확인
- 승인된 미니앱 상태에서 Android와 iOS로 위 11~14번 공유 리워드 확인

### 2026-07-22 진행 상태

로컬 준비 완료:

- 리워드형 운영 ID를 `.env.production`에 반영
- 홈 `기능` 단계에 리워드 광고 CTA 추가
- `userEarnedReward`가 발생한 경우에만 리워드 완료 안내
- 닫힘·표시 실패 뒤 다음 리워드 광고 재로드
- 로컬/QR 테스트용 `ait-ad-test-rewarded-id` 분기와 문서 반영
- 변경 파일 대상 엄격 타입 검사 및 `npm run build:web` 성공

실기기 확인 대기:

- 콘솔 QR에서 위 15~18번을 Android와 iOS로 확인

## 출시 직전 작업

실기기 테스트가 모두 끝나면 운영 ID가 들어간 출시 번들을 다시 만든다.

```powershell
cd D:\quant\toss-inapp
npm run build
```

생성 결과:

```text
D:\quant\toss-inapp\glance-invest.ait
```

주의: 실제 광고 ID가 들어간 번들은 개발 테스트에 사용하지 않는다.

## 광고 유형 확인

현재 구현은 전면형 광고, 리워드 광고, 리스트형 배너 광고를 사용한다.
전면 광고 타입 자체는 SDK가 `adGroupId`를 보고 결정한다.

리워드 광고는 `userEarnedReward` 이벤트가 발생했을 때만 보상 완료로 처리한다.
`dismissed` 이벤트만 발생한 경우에는 보상을 지급 완료로 처리하지 않는다.

## 검증 결과

완료된 검증:

```powershell
npm run build:web
npm run build
```

- Web 빌드 성공
- RN 0.84 번들 성공
- RN 0.72 번들 성공
- `.ait` 생성 성공
- 광고 변경 파일 대상 타입 검사 성공

전체 프로젝트 타입 검사 명령:

```powershell
npx tsc -b
```

현재 이 명령은 광고 코드와 무관한 기존 오류 때문에 실패한다.

```text
src/features/closing-bet/ClosingBetPage.tsx:808
src/features/closing-bet/ClosingBetPage.tsx:809
src/features/closing-bet/ClosingBetPage.tsx:813
src/features/closing-bet/ClosingBetPage.tsx:814
src/features/closing-bet/ClosingBetPage.tsx:815
src/features/closing-bet/ClosingBetPage.tsx:816
src/features/closing-bet/ClosingBetPage.tsx:817
Type 'number' is not assignable to type '0'.
```

이 오류는 이번 광고 작업에서는 수정하지 않았다.

## 참고 문서

- 공식 통합 광고 가이드:
  https://developers-apps-in-toss.toss.im/bedrock/reference/framework/%EA%B4%91%EA%B3%A0/IntegratedAd.html
- 공식 WebView 배너 광고 가이드:
  https://developers-apps-in-toss.toss.im/bedrock/reference/framework/%EA%B4%91%EA%B3%A0/BannerAd.html
- 공식 공유 리워드 가이드:
  https://developers-apps-in-toss.toss.im/bedrock/reference/framework/%EC%B9%9C%EA%B5%AC%EC%B4%88%EB%8C%80/contactsViral.html

## 작업 시 주의사항

- 서비스 진입 직후 광고를 자동 노출하지 않는다.
- 모의 주문이나 알림 저장 같은 사용자 작업 도중 광고를 삽입하지 않는다.
- 광고가 실패해도 AI 분석 결과를 막지 않는다.
- 같은 광고 그룹 ID를 동시에 여러 번 로드하지 않는다.
- 실제 광고 ID를 사용한 반복 테스트를 하지 않는다.
- 리워드 광고는 사용자가 홈 CTA를 직접 선택했을 때만 표시한다.
- 리워드는 `userEarnedReward` 이벤트가 발생한 경우에만 지급 완료로 처리한다.
- 공유 리워드는 자동 실행하지 않고 사용자 버튼으로만 연다.
- `close`, 오류, 컴포넌트 종료 시 공유 리워드 cleanup을 빠뜨리지 않는다.
- 다른 사용자의 기존 작업 파일과 현재 저장소의 관련 없는 변경은 건드리지 않는다.
