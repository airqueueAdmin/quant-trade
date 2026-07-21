# Backend Integration Notes

Last updated: 2026-07-20

## Goal

Use the existing `backend/` FastAPI service as the shared API for the new `toss-inapp/` frontend.

## What was added

- Backend CORS support for separate web frontends
- Backend app-status endpoint for staging visibility
- Shared API client in `toss-inapp/src/shared/api/`

## Backend changes

### CORS

The backend now accepts direct browser requests from configured origins.

Environment variable:

- `CORS_ALLOW_ORIGINS`

Example:

```env
CORS_ALLOW_ORIGINS="http://localhost:5173,http://127.0.0.1:5173"
```

Default fallback origins:

- `http://localhost:5173`
- `http://127.0.0.1:5173`

## Shared frontend API client

Files:

- `src/shared/api/http.ts`
- `src/shared/api/types.ts`
- `src/shared/api/client.ts`

Covered endpoints:

- `GET /healthz`
- `GET /app-config`
- `GET /stocks/krx/search`
- `GET /fx/usdkrw`
- `GET /market/sectors`
- `GET /quote/{ticker}`
- `GET /sentiment/{ticker}`
- `GET /paper-trading/state`
- `POST /paper-trading/order`
- `POST /paper-trading/reset`
- `POST /backtest/moving_average`
- `POST /backtest/rsi`
- `POST /backtest/bollinger_bands`
- `POST /optimize/moving_average`
- `POST /optimize/rsi`
- `POST /optimize/bollinger_bands`

## Remaining backend gaps before real deployment

### 1. Account identity

Paper trading now prefers the Apps in Toss anonymous user key and derives a stable, pseudonymous account id on the backend. The browser-only development path still uses a local session account.

Implication:

- the same Toss user resolves to the same mock-investing account across devices
- the raw Toss key is not persisted in the paper-trading account tables or returned to the client
- profile fields are not collected; stronger OAuth-backed authentication can be added separately if the product later needs verified profile data

Current frontend exposure:

- `GET /app-config` returns `auth_mode: session_account`
- `POST /session/toss-user` exchanges the Apps in Toss anonymous user key for a stable, backend-signed paper-trading session. The raw Toss key is never stored as the account id.
- `POST /session/bootstrap` remains the browser-development fallback and returns a device-local backend-signed session.
- the web client caches the signed session locally and re-resolves it from the Toss user key when available

### 2. Request latency

Some endpoints may take a while:

- sentiment analysis
- optimization
- sector snapshot depending on external data calls

Implication:

- frontend must handle loading, retry, and error states explicitly
- long-running actions may need UX separation from lightweight lookups

### 3. Response normalization

The current API is usable, but not yet optimized for a polished mobile app contract.

Potential follow-up:

- standard error envelope
- clearer field grouping for UI-specific needs
- endpoint-specific caching strategy

### 4. Production origin policy

For production deployment, `CORS_ALLOW_ORIGINS` must be set to the real frontend domain instead of relying on local defaults.

### 5. Feature readiness visibility

The frontend now reads feature status directly from the backend.

Response shape highlights:

- `auth_mode`
- `cors_allowed_origins`
- `features.sector_flow`
- `features.ai_analysis`
- `features.paper_trading`
- `features.strategy_simulation`
