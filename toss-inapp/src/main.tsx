import React from 'react'
import ReactDOM from 'react-dom/client'

import App from './App'
import { migrateOriginStorage } from './shared/storage/originMigration'
import './styles.css'

async function bootstrap() {
  await migrateOriginStorage()

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

void bootstrap()
