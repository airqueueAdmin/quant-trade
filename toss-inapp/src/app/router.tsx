import { createBrowserRouter } from 'react-router-dom'

import { AnalysisPage } from '../features/ai-analysis/AnalysisPage'
import { ClosingBetPage } from '../features/closing-bet'
import { HomePage } from '../features/home/HomePage'
import { PaperTradingPage } from '../features/paper-trading/PaperTradingPage'
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
    ],
  },
])
