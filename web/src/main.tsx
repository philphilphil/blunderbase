import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import './index.css'
import { activateLocale, initialLocale } from './lib/i18n/locale'

const root = document.getElementById('root')
if (!root) throw new Error('#root is missing from index.html')

// The catalog first, then the tree: a render before the language is settled would paint
// every screen in English and swap it a moment later.
void activateLocale(initialLocale()).then(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
