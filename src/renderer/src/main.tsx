import { createRoot } from 'react-dom/client'
import './monacoSetup'
import './styles.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
