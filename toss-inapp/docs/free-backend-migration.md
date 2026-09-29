# 무료 운영 전환 계획

## 목표

앱인토스 프론트는 AIT CDN으로 운영하고, Render 의존성은 기능별로 제거한다. 기존 FastAPI는 전환 기간 동안 계속 유지해 운영 중단을 피한다.

## 단계

### 1단계 — Edge Function 연결 검증

- `supabase/functions/health/index.ts`를 배포한다.
- `VITE_EDGE_HEALTH_URL`에 `https://<project-ref>.supabase.co/functions/v1/health`를 설정한다.
- AIT 홈의 백엔드 warmup이 Render가 아닌 Edge Function에서 `status: ok`를 받는지 확인한다.
- 다른 API는 아직 `VITE_BACKEND_URL`을 사용한다.

배포 예시:

```powershell
npx supabase functions deploy health --no-verify-jwt
```

### 2단계 — 가벼운 서버 기능 이전

다음 기능을 Edge Function으로 옮긴다.

- 세션 발급/검증
- 앱 설정 상태 조회
- Gemini 분석 프록시

현재 `app-config` 함수는 초안으로 배포할 수 있다. `GEMINI_API_KEY`,
`NEWS_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`가 필요한 기능은 해당 Edge
Function에만 secrets를 등록한다.

토스 로그인·스마트메시지는 `toss-login`, `closing-bet-notifications` Edge
Function으로 이전했다. `APPS_IN_TOSS_CERT_PATH_PEM`,
`APPS_IN_TOSS_KEY_PATH_PEM` secrets에 PEM 문자열을 등록하고 Edge 런타임의
mTLS HTTP client로 사용한다. AIT 환경 변수에는 비밀 키를 넣지 않는다.

서비스 키와 토스 인증서는 Edge Function secrets에만 둔다. AIT 환경 변수에는 비밀 키를 넣지 않는다.

### 3단계 — 데이터 기능 이전

- 모의투자 계좌·주문을 Supabase RPC 또는 Edge Function으로 이전
- 저장 데이터는 RLS로 사용자별 접근을 제한
- 기존 `SUPABASE_SERVICE_ROLE_KEY` 직접 호출은 백엔드에서만 유지

### 4단계 — 시세·계산 기능 재설계

현재 `yfinance`, `pandas`, `numpy` 의존성은 Edge Function에 그대로 옮기지 않는다.

- 전략 백테스트·최적화: Supabase Edge Function(`strategy-simulation`)으로 이전
- 시세 조회: 브라우저 사용이 허용된 외부 데이터 API로 교체
- 섹터·시장 스냅샷: 사전 수집 후 Supabase에 저장

### 5단계 — Render 종료

모든 AIT 호출이 새 함수로 전환되고 다음 검증이 끝난 뒤 Render 백엔드를 종료한다.

- 앱인토스 콘솔 QR에서 홈·AI 분석·모의투자·전략 시뮬레이션 확인
- 토스 사용자별 계좌 분리 확인
- 오류·타임아웃·무료 한도 모니터링
- 예약 알림 별도 스케줄러 확인

## 현재 상태

- AIT 빌드 성공
- `health`, `app-config`, `quote`, `stock`, `sentiment`, `sector` Edge Function 배포 및 직접 응답 검증 완료
- 운영 빌드의 자동 판정 데이터 API를 Supabase URL로 전환
- 종목 검색을 위한 `stocks-search` Edge Function 추가
- 세션 발급·검증을 위한 `session` Edge Function 배포 및 서명 호환성 검증 완료
- 자동 판정 조합과 모의투자 상태·랭킹·주문·초기화, 종가베팅 알림 저장·조회·삭제·읽음 처리, 저장 백테스트 CRUD, 토스 인앱 발송 배치까지 Edge Function으로 연결했어.
- 전략 시뮬레이션의 이동평균·RSI·볼린저 백테스트와 세 전략 최적화를 `strategy-simulation` Edge Function으로 연결했어.
- USD/KRW 환율과 토스 로그인 user-key 교환도 각각 `fx-usdkrw`, `toss-login` Edge Function으로 연결했어.

### 토스 인앱 발송 Cron 연결 완료 상태

`NOTIFICATION_DISPATCH_TOKEN`은 Edge Function Secret과 Supabase Vault에 같은 값으로 등록되어 있어야 한다. 두 값의 등록이 끝났다면 아래 Cron SQL만 실행한다. `vault.create_secret()`은 다시 실행하지 않는다.

현재 프로젝트에는 아래 두 예약 작업이 등록되어 있다.

- `glance-invest-toss-dispatch-krx`: 평일 UTC 06시부터 5분 간격
- `glance-invest-toss-dispatch-us`: 평일 UTC 19~20시, 5분 간격

아래 SQL은 동일 작업을 재등록해야 할 때 사용하는 멱등 스크립트다.

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid)
from cron.job
where jobname in ('glance-invest-toss-dispatch-krx', 'glance-invest-toss-dispatch-us');

select cron.schedule(
  'glance-invest-toss-dispatch-krx',
  '*/5 6 * * 1-5',
  $$
  select net.http_post(
    url := 'https://tiqhcbvjchwbodxzbahx.supabase.co/functions/v1/closing-bet-notifications?action=dispatch&market=krx',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Dispatch-Token', (select decrypted_secret from vault.decrypted_secrets where name = 'NOTIFICATION_DISPATCH_TOKEN')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);

select cron.schedule(
  'glance-invest-toss-dispatch-us',
  '*/5 19-20 * * 1-5',
  $$
  select net.http_post(
    url := 'https://tiqhcbvjchwbodxzbahx.supabase.co/functions/v1/closing-bet-notifications?action=dispatch&market=us',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Dispatch-Token', (select decrypted_secret from vault.decrypted_secrets where name = 'NOTIFICATION_DISPATCH_TOKEN')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
```
- 새 AIT 번들은 기능별 변경 때마다 생성되며, 최신 전략 시뮬레이션 번들은 앱인토스 콘솔 업로드 전
- Render 서비스 삭제/중지는 아직 하지 않음
