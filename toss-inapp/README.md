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

문서:
- `docs/resume-status.md`
- `docs/staging-runbook.md`
- `docs/backend-integration.md`
- `docs/toss-application-prep.md`
- `docs/tds-notes.md`
