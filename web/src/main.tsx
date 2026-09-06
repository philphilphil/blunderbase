import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import './index.css'
import { installDesktopLinks } from './lib/desktop/links'
import { hasNativeBridge, openNatively } from './lib/desktop/nativeBridge'
import { activateLocale, initialLocale } from './lib/i18n/locale'

const root = document.getElementById('root')
if (!root) throw new Error('#root is missing from index.html')

// In the desktop app a new-tab link goes to the shell, not the webview, which has no tabs.
if (hasNativeBridge()) installDesktopLinks(openNatively)

// The catalog first, then the tree: a render before the language is settled would paint
// every screen in English and swap it a moment later.
void activateLocale(initialLocale()).then(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
