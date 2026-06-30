# Staging Runbook

Last updated: 2026-06-30

## Goal

Run the shared backend and the new `toss-inapp` frontend together in a predictable local staging path.

Prerequisite:

- Docker Desktop / Docker daemon must be running before `docker compose build` or `docker compose up`

## Services

- `backend`
  - FastAPI
  - host port: `8000`
- `toss-inapp`
  - built static React app served by nginx
  - host port: `4173`

## Required environment variables

Create a root `.env` file from `.env.example`.

Important keys:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_SCHEMA=public
GEMINI_API_KEY=
NEWS_API_KEY=
CORS_ALLOW_ORIGINS=http://localhost:4173,http://127.0.0.1:4173,http://localhost:5173,http://127.0.0.1:5173
TOSS_INAPP_VITE_BACKEND_URL=http://localhost:8000
```

Notes:

- `TOSS_INAPP_VITE_BACKEND_URL` must be a browser-reachable backend URL.
- Do not set it to `http://backend:8000` for the built frontend, because browsers outside Docker cannot resolve that hostname.

## Build

From repo root:

```powershell
docker compose build backend toss-inapp
```

## Run

From repo root:

```powershell
docker compose up -d backend toss-inapp
```

## Verify

### 1. Container status

```powershell
docker compose ps
```

Expected:

- `backend` becomes `healthy`
- `toss-inapp` becomes `healthy`

### 2. Backend health

```powershell
Invoke-WebRequest http://localhost:8000/healthz
```

Expected:

- HTTP 200
- body contains `{"status":"ok"}`

### 3. Frontend reachability

```powershell
Invoke-WebRequest http://localhost:4173
```

Expected:

- HTTP 200
- HTML response

### 4. Browser checks

Open:

- `http://localhost:4173/`
- `http://localhost:4173/sector-flow`
- `http://localhost:4173/ai-analysis`
- `http://localhost:4173/paper-trading`

Home screen check:

- backend health shows `정상`
- auth mode shows `브라우저 고정 데모 계정`
- feature cards reflect configured API key and Supabase availability

## Functional checks

### Sector flow

- page loads
- US/KRX switch works
- summary and sector lists render

### AI analysis

- ticker input works
- KRX search works
- analysis runs when backend keys are configured

### Paper trading

- account state loads when Supabase is configured
- quote lookup works
- buy/sell order submits
- holdings and trade history render

## Logs

```powershell
docker compose logs backend
docker compose logs toss-inapp
```

## Stop

```powershell
docker compose down
```
