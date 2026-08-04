import { createBrowserRouter } from 'react-router-dom'

import { AnalysisPage } from '../features/ai-analysis/AnalysisPage'
import { ClosingBetPage } from '../features/closing-bet'
import { SkHynixEventPage } from '../features/events/sk-hynix/SkHynixEventPage'
import { HomePage } from '../features/home/HomePage'
import { PaperTradingPage } from '../features/paper-trading/PaperTradingPage'
import { PaperTradingRankingPage } from '../features/paper-trading/PaperTradingRankingPage'
import { SectorFlowPage } from '../features/sector-flow/SectorFlowPage'
import { StrategySimulationPage } from '../features/strategy-simulation/StrategySimulationPage'
import { AppLayout } from './AppLayout'

export const appRouter = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'sector-flow', element: <SectorFlowPage /> },
      { path: 'ai-analysis', element: <AnalysisPage /> },
      { path: 'closing-bet', element: <ClosingBetPage /> },
      { path: 'strategy-simulation', element: <StrategySimulationPage /> },
      { path: 'paper-trading', element: <PaperTradingPage /> },
      { path: 'paper-trading/rankings', element: <PaperTradingRankingPage /> },
      { path: 'events/sk-hynix', element: <SkHynixEventPage /> },
    ],
  },
])
