import { RouterProvider } from 'react-router-dom'

import { AuthGate } from './app/AuthGate'
import { Providers } from './app/Providers'
import { router } from './app/router'

export default function App() {
  return (
    <Providers>
      <AuthGate>
        <RouterProvider router={router} />
      </AuthGate>
    </Providers>
  )
}
