# Page Architecture

Last updated: 2026-06-30

## Goal

Define the first in-app page structure before porting existing functionality.

## Page set

### 1. Home

Purpose:

- entry point
- current status
- quick links to core experiences

### 2. Sector Flow

Purpose:

- lightweight read-first screen
- good candidate for first functional migration

Reason for priority:

- lower input complexity
- easy to validate API client and TDS list/card patterns

### 3. AI Analysis

Purpose:

- ticker selection
- sentiment result
- article list

Key UX concern:

- long loading time
- clear separation between input state and result state

### 4. Strategy Simulation

Purpose:

- core quant experience
- backtest and optimization entry

Key UX concern:

- current Streamlit sidebar flow must be redesigned into mobile-first steps
- backtest and optimization should share inputs without overwhelming a small-screen flow

### 5. Paper Trading

Purpose:

- quote lookup
- order placement
- holdings and trade history

Key UX concern:

- current `account_id` model is not suitable for real deployment
- authentication/user binding must be addressed later
- until real auth exists, the client should prefer a browser-persisted demo identity over manual ID input

## Migration order

1. Home
2. Sector Flow
3. AI Analysis
4. Strategy Simulation
5. Paper Trading

## Current status

- Home: bootstrap complete
- Sector Flow: migrated
- AI Analysis: migrated
- Strategy Simulation: backtest + optimization migrated
- Paper Trading: migrated

## Current code mapping

- existing Streamlit home: `frontend/홈.py`
- sector flow: `frontend/pages/5_📊_주요_섹터_흐름.py`
- AI analysis: `frontend/pages/2_🤖_AI_시장_분석.py`
- strategy simulation: `frontend/pages/1_📈_투자_전략_시뮬레이션.py`
- paper trading: `frontend/pages/6_🧪_모의_투자.py`

## Notes

- Strategy Simulation now supports both mobile backtest and optimization flows in one screen.
- Optimization result visualization is still summary-first and can be expanded later with chart/table UX.
- Visual treatment is temporary and will be replaced or aligned more tightly once the actual TDS component strategy is finalized.
