# Toss In-App Resume Status

Last updated: 2026-06-30 (late)

## Current objective

- Build a separate Toss in-app frontend in `toss-inapp/`
- Keep the existing `frontend/` Streamlit app unchanged
- Reuse the existing `backend/` FastAPI service
- Treat `TDS(Toss Design System)` as the UI baseline

## Decisions already made

- Frontend stack: `React + Vite + TypeScript`
- Directory strategy: same repository, separate `toss-inapp/` app
- Backend strategy: reuse current FastAPI endpoints

## Completed steps

1. Created the `toss-inapp/` workspace and base folders.
2. Added TDS-oriented project notes in `README.md` and `docs/tds-notes.md`.
3. Initialized `npm` in `toss-inapp/`.
4. Installed the current base packages:
   - `react`
   - `react-dom`
   - `vite`
   - `typescript`
   - `@vitejs/plugin-react`
   - `@types/react`
   - `@types/react-dom`
5. Added a buildable React/Vite app skeleton.
6. Added environment handling via `VITE_BACKEND_URL`.
7. Added a shared API client for the existing backend.
8. Added backend CORS support for separate web frontend access.
9. Added route structure for the first in-app page set.
10. Implemented the first functional page migration: `sector-flow`.
11. Implemented the `AI analysis` page migration.
12. Implemented the `paper trading` page migration.
13. Added Docker-based staging path for `backend + toss-inapp`.
14. Added backend-driven staging status exposure via `GET /app-config`.
15. Replaced the temporary home shell with a mobile in-app status dashboard.
16. Added Docker healthchecks for `backend` and `toss-inapp`.
17. Replaced free-text demo account input with a browser-persisted paper trading identity.
18. Added pre-submit order guards for cash/share limits in `paper-trading`.
19. Validated local Docker staging for `backend + toss-inapp`.
20. Implemented the first functional `strategy-simulation` migration for single-run backtests.
21. Expanded `strategy-simulation` to support optimization mode in the same mobile flow.
22. Re-verified the optimization expansion with:
   - successful `npm run build`
   - healthy local `backend + toss-inapp` Docker staging
   - successful sample `POST /optimize/moving_average` API call against the running backend

## Files added for the app skeleton

- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `tsconfig.app.json`
- `tsconfig.node.json`
- `vite.config.ts`
- `index.html`
- `src/App.tsx`
- `src/main.tsx`
- `src/styles.css`
- `src/components/StatusCard.tsx`
- `src/features/home/HomePage.tsx`
- `src/shared/config/env.ts`

## Next step when resuming

Resume from post-`Step 6` follow-up work. The unfinished `strategy-simulation` optimization expansion is now implemented and re-verified.

Recommended immediate tasks:

1. Decide the real in-app authentication/account mapping strategy to replace the browser-persisted `demo_account_id`.
2. Add richer visualization for backtest history / optimization comparison once chart UX is finalized.
3. Perform browser-level checks for `/strategy-simulation` in both modes after the next styling or API contract change.
4. Clean up the temporary root template folders when they are no longer needed:
   - `toss-inapp-template/`
   - `toss-inapp-react-template/`

## Current in-progress note

- No known code-level blocker remains in the current `strategy-simulation` expansion.
- Latest verification in this session covered build output and a real optimization API call, but not manual browser interaction.

## Temporary notes

- During setup, two template folders were created at repo root:
  - `toss-inapp-template/`
  - `toss-inapp-react-template/`
- They were only used to inspect Vite scaffolding behavior and can be cleaned up later if needed.
