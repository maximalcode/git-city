import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import './client.css'

// browser-preview mock (?mock) — dynamic import so prod builds tree-shake it
if (import.meta.env.DEV) {
  void import('./lib/devMock').then((m) => m.installDevMock())
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
