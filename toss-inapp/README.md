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
- `VITE_INTERSTITIAL_AD_GROUP_ID`: 운영용 전면 광고 그룹 ID. 로컬 개발에서는 정책에 맞게 공식 테스트 ID를 강제로 사용합니다.
- `VITE_BANNER_AD_GROUP_ID`: 운영용 리스트형 배너 광고 그룹 ID. 로컬 개발에서는 공식 테스트 ID를 강제로 사용합니다.

광고 테스트:
- 로컬 개발 서버는 전면형 `ait-ad-test-interstitial-id`, 배너형 `ait-ad-test-banner-id`를 사용합니다.
- 콘솔 QR 테스트용 production 빌드에서는 두 환경 변수를 공식 테스트 ID로 덮어써서 빌드합니다.
- 실제 광고 그룹 ID는 출시 빌드에서만 사용합니다. 운영 ID가 비어 있거나 광고가 실패해도 광고 영역을 숨기고 핵심 기능은 계속 동작합니다.

QR 테스트용 번들 생성(PowerShell):

```powershell
$env:VITE_INTERSTITIAL_AD_GROUP_ID='ait-ad-test-interstitial-id'
$env:VITE_BANNER_AD_GROUP_ID='ait-ad-test-banner-id'
npm run build
Move-Item -LiteralPath 'glance-invest.ait' -Destination 'glance-invest-test.ait' -Force
Remove-Item Env:VITE_INTERSTITIAL_AD_GROUP_ID
Remove-Item Env:VITE_BANNER_AD_GROUP_ID
```

그다음 `npm run build`를 실행하면 `.env.production`의 운영 ID가 들어간 `glance-invest.ait`가 생성됩니다. `glance-invest-test.ait`는 콘솔 QR 검증 전용이고, `glance-invest.ait`는 출시 전용입니다.

문서:
- `docs/resume-status.md`
- `docs/staging-runbook.md`
- `docs/backend-integration.md`
- `docs/toss-application-prep.md`
- `docs/tds-notes.md`
