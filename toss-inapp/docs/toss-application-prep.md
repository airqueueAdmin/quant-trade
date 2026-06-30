# Toss In-App Application Prep

Last updated: 2026-06-30

## Goal

Reach the point right before submitting a Toss in-app deployment/application request.

This document is an internal prep checklist, not an official Toss checklist.

## Current deployable scope

- Frontend: `toss-inapp/` React + Vite static app
- Backend: shared `backend/` FastAPI API
- Supported core flows:
  - `sector-flow`
  - `ai-analysis`
  - `strategy-simulation`
  - `paper-trading`

## What is already ready

- Local Docker staging for `backend + toss-inapp`
- Separate web frontend build for the in-app experience
- SPA route fallback via nginx
- Backend CORS handling for separate frontend origins
- Health/status exposure through:
  - `GET /healthz`
  - `GET /app-config`

## What should be prepared before application submission

### 1. Production URLs

Decide and record:

- frontend production URL
- backend production URL
- support/contact URL
- privacy policy URL
- terms of service URL if required by the partner/application process

Current placeholders:

- frontend URL: `TODO`
- backend URL: `TODO`
- support URL: `TODO`
- privacy policy URL: `TODO`

### 2. Production environment values

Frontend:

- `VITE_BACKEND_URL`

Backend:

- `CORS_ALLOW_ORIGINS`
- `GEMINI_API_KEY`
- `NEWS_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_SCHEMA`

Minimum production expectation:

- `CORS_ALLOW_ORIGINS` must include the real frontend domain
- `TOSS_INAPP_VITE_BACKEND_URL` used at build time should point to the browser-reachable production backend
- Supabase credentials should be set if paper trading is part of the submitted scope

### 3. Submission demo scope

Decide whether the first application scope includes:

- all four pages
- only read-first pages such as `sector-flow`, `ai-analysis`, `strategy-simulation`
- exclusion of `paper-trading` until real account mapping exists

Current engineering recommendation:

- submit `sector-flow`, `ai-analysis`, and `strategy-simulation` as the primary scope
- treat `paper-trading` as conditional until real user/account mapping is defined

Reason:

- current `paper-trading` identity model is still browser-persisted session identity
- that is acceptable for staging, but weak for a production in-app rollout

### 4. Browser QA package

Capture and save:

- home screen screenshot
- `sector-flow` screenshot
- `ai-analysis` input/result screenshot
- `strategy-simulation` backtest screenshot
- `strategy-simulation` optimization screenshot
- error/loading state screenshots where relevant

Recommended device widths:

- 390px
- 430px

### 5. Operational notes for reviewers

Record these honestly in the application packet:

- AI analysis quality depends on external news/API availability
- strategy optimization can be slower than simple quote/look-up flows
- paper trading is demo-oriented unless production user mapping is added

## Known blockers before an honest production application

### Real account mapping

Current state:

- `auth_mode: session_account`
- browser-persisted backend-signed session identity

Needed next:

- real user identity binding strategy
- backend authorization model
- user/account ownership rules for paper trading data

### Legal/public pages

Before submission, publish and verify:

- privacy policy
- customer/support contact page
- service description page if the application form asks for it

### Production hosting decision

Pick the actual runtime:

- frontend static hosting/CDN
- backend host
- secret management method
- deployment owner/contact

## Suggested pre-application sequence

1. Fix the production scope decision for `paper-trading`.
2. Provision production/staging URLs.
3. Set production env values and deploy a browser-reachable preview.
4. Run mobile browser QA on the preview URL.
5. Capture screenshots and a short feature summary.
6. Submit the Toss in-app application request with the preview/prod details.

## Working submission packet template

- Product name: `TODO`
- One-line description: `TODO`
- Frontend URL: `TODO`
- Backend URL: `TODO`
- Main supported features:
  - sector rotation snapshot
  - AI-driven market/news summary
  - strategy backtest
  - strategy optimization
- Support contact: `TODO`
- Privacy policy URL: `TODO`
- Known limitations disclosed:
  - external API dependency
  - optimization latency
  - session identity model if paper trading is included
