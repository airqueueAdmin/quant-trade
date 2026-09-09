# Toss In-App Frontend

토스 인앱용 신규 프론트엔드를 위한 별도 작업 공간입니다.

운영 원칙:
- 기존 `frontend/` Streamlit 앱은 유지합니다.
- 기존 `backend/` FastAPI API를 공용으로 재사용합니다.
- 토스 인앱용 UI, 라우팅, 인증 흐름은 이 디렉터리에서 독립적으로 관리합니다.
- `TDS(Toss Design System)` 기준 레이아웃과 상태 표현을 우선합니다.

현재 상태:
- 프론트엔드 스택은 `React + Vite + TypeScript`로 확정했습니다.
- `sector-flow`, `ai-analysis`, `paper-trading` 1차 마이그레이션을 완료했습니다.
- 홈 화면은 백엔드 health와 기능 준비 상태를 직접 보여주는 스테이징 대시보드로 바뀌었습니다.
- `strategy-simulation`은 백테스트와 최적화 모드를 모두 포함하는 1차 모바일 플로우까지 구현했습니다.

실행:

```powershell
npm install
npm run dev
```

빌드:

```powershell
npm run build
```

환경 변수:
- `VITE_BACKEND_URL`
- `VITE_INTERSTITIAL_AD_GROUP_ID`: 앱인토스 콘솔에서 발급한 운영용 전면 광고 그룹 ID.
- `VITE_REWARDED_AD_GROUP_ID`: 앱인토스 콘솔에서 발급한 운영용 리워드 광고 그룹 ID.
- `VITE_BANNER_AD_GROUP_ID`: 앱인토스 콘솔에서 발급한 운영용 리스트형 배너 광고 그룹 ID.
- `VITE_CONTACTS_VIRAL_MODULE_ID`: 앱인토스 콘솔에서 발급한 공유 리워드 ID입니다. 값이 없으면 홈의 공유 리워드 영역을 표시하지 않습니다.

모의투자 계좌는 토스 앱에서 `getAnonymousKey`로 받은 사용자 고유 키를 서버에서 가명화해 연결합니다. 브라우저 개발 환경에서는 기존 기기 세션 계좌로 자동 대체됩니다. 운영 환경의 `APP_SESSION_SECRET`은 계좌 ID 파생과 세션 서명에 함께 사용되므로 반드시 고정된 값으로 관리해야 합니다.

광고 구성:
- 광고 그룹 ID가 없거나 테스트용으로 식별되면 광고 기능을 비활성화하고 핵심 기능은 계속 동작합니다.
- 미니앱 번들에는 앱인토스 콘솔에서 발급한 운영 광고 그룹 ID만 포함해야 합니다.
- 콘솔 QR 검증은 운영 번들과 분리된 테스트 환경에서 진행하고 테스트 키를 운영 번들에 넣지 않습니다.

공유 리워드는 토스 앱 5.223.0 이상과 승인된 미니앱에서만 동작합니다. 샌드박스가 아닌 콘솔 QR로 `sendViral`, `close`, 오류 처리와 뒤로 가기를 확인합니다.

문서:
- `docs/resume-status.md`
- `docs/staging-runbook.md`
- `docs/backend-integration.md`
- `docs/toss-application-prep.md`
- `docs/tds-notes.md`
