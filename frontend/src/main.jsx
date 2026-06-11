import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { LicenseProvider } from './context/LicenseContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <LicenseProvider>
      <App />
    </LicenseProvider>
  </StrictMode>,
)
